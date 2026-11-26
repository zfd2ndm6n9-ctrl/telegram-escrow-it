import type { Api } from "grammy";
import type { DealStore } from "../../store/deals.js";
import type { Deal } from "../../types.js";
import { amountConfirmed, lockedCryptoAmount } from "../deal-logic.js";
import { postShipAsk } from "../group-setup.js";
import { ethToWei, weiToEthString } from "./amounts.js";
import { getEscrowBalanceWei } from "./transfer.js";
import { isEthConfigured } from "./client.js";

/** Target deposito: solo importo lockato (mai FX live). */
function expectedDepositEth(deal: Deal): string | null {
  const locked = lockedCryptoAmount(deal);
  if (locked) return locked;
  if (deal.amount && ethToWei(deal.amount) != null) return deal.amount;
  return null;
}

const DEFAULT_INTERVAL_MS = 20_000;

export type DepositWatcherHandle = {
  stop: () => void;
};

/**
 * Poll periodico dei deal ETH in `awaiting_deposit`: saldo ≥ importo → `funded`.
 */
export function startEthDepositWatcher(
  store: DealStore,
  api: Api,
  intervalMs = DEFAULT_INTERVAL_MS,
): DepositWatcherHandle {
  if (!isEthConfigured()) {
    console.warn("Deposit watcher ETH: ETH_PRIVATE_KEY assente, skip.");
    return { stop: () => undefined };
  }

  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const pending = store.listByStatus("awaiting_deposit");
      for (const deal of pending) {
        if (deal.asset !== "ETH") continue;
        if (!deal.escrowAddress || deal.escrowAddress.startsWith("PENDING_")) {
          continue;
        }

        const targetEth = expectedDepositEth(deal);
        if (!targetEth) {
          console.warn(
            `Watcher ETH #${deal.id}: nessun target lockato (amount/amountConfirmedAt assenti)`,
          );
          continue;
        }
        const expected = ethToWei(targetEth);
        if (expected == null) continue;

        let balance: bigint;
        try {
          balance = await getEscrowBalanceWei(deal.escrowAddress);
        } catch (err) {
          console.warn(
            `Watcher ETH balance fail #${deal.id}:`,
            err instanceof Error ? err.message : err,
          );
          continue;
        }

        if (balance < expected) continue;

        const latest = store.get(deal.id);
        if (!latest || latest.status !== "awaiting_deposit") continue;

        const updated = store.update(deal.id, {
          status: "funded",
          depositLamports: balance.toString(),
          depositDetectedAt: new Date().toISOString(),
        });
        if (!updated) continue;

        console.log(
          `Deal #${deal.id} funded on-chain: ${weiToEthString(balance)} ETH`,
        );

        if (updated.groupChatId != null) {
          try {
            await postShipAsk(api, store, updated);
          } catch (err) {
            console.warn(`Notify funded/ship ETH #${deal.id} failed:`, err);
          }
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** Verifica immediata (comando utente / admin). */
export async function checkDealDepositEth(
  store: DealStore,
  dealId: string,
): Promise<
  | { ok: true; funded: boolean; balanceEth: string; expectedEth: string }
  | { ok: false; error: string }
> {
  const deal = store.get(dealId);
  if (!deal) return { ok: false, error: "Deal non trovato" };
  if (deal.asset !== "ETH") {
    return { ok: false, error: "Asset non ETH" };
  }
  if (!deal.escrowAddress) {
    return { ok: false, error: "Nessun indirizzo escrow" };
  }

  const targetEth = expectedDepositEth(deal);
  if (!targetEth) {
    return {
      ok: false,
      error: amountConfirmed(deal)
        ? "Importo ETH lockato non valido"
        : "Importo ETH non ancora lockato (Accetto)",
    };
  }
  const expected = ethToWei(targetEth);
  if (expected == null) {
    return { ok: false, error: "Importo deal non valido" };
  }

  try {
    const balance = await getEscrowBalanceWei(deal.escrowAddress);
    const balanceEth = weiToEthString(balance);
    if (balance >= expected && deal.status === "awaiting_deposit") {
      store.update(deal.id, {
        status: "funded",
        depositLamports: balance.toString(),
        depositDetectedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        funded: true,
        balanceEth,
        expectedEth: targetEth,
      };
    }
    return {
      ok: true,
      funded: deal.status === "funded" || balance >= expected,
      balanceEth,
      expectedEth: targetEth,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
