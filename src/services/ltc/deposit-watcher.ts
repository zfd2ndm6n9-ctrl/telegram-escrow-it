import type { Api } from "grammy";
import type { DealStore } from "../../store/deals.js";
import type { Deal } from "../../types.js";
import { amountConfirmed, lockedCryptoAmount } from "../deal-logic.js";
import { postShipAsk } from "../group-setup.js";
import { ltcToSats, satsToLtcString } from "./amounts.js";
import { getEscrowBalanceSats } from "./transfer.js";
import { isLtcConfigured } from "./client.js";

/** Target deposito: solo importo lockato (mai FX live). */
function expectedDepositLtc(deal: Deal): string | null {
  const locked = lockedCryptoAmount(deal);
  if (locked) return locked;
  if (deal.amount && ltcToSats(deal.amount) != null) return deal.amount;
  return null;
}

const DEFAULT_INTERVAL_MS = 20_000;

export type DepositWatcherHandle = {
  stop: () => void;
};

/**
 * Poll periodico dei deal LTC in `awaiting_deposit`: saldo ≥ importo → `funded`.
 */
export function startLtcDepositWatcher(
  store: DealStore,
  api: Api,
  intervalMs = DEFAULT_INTERVAL_MS,
): DepositWatcherHandle {
  if (!isLtcConfigured()) {
    console.warn("Deposit watcher LTC: LTC_PRIVATE_KEY assente, skip.");
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
        if (deal.asset !== "LTC") continue;
        if (!deal.escrowAddress || deal.escrowAddress.startsWith("PENDING_")) {
          continue;
        }

        const targetLtc = expectedDepositLtc(deal);
        if (!targetLtc) {
          console.warn(
            `Watcher LTC #${deal.id}: nessun target lockato (amount/amountConfirmedAt assenti)`,
          );
          continue;
        }
        const expected = ltcToSats(targetLtc);
        if (expected == null) continue;

        let balance: bigint;
        try {
          balance = await getEscrowBalanceSats(deal.escrowAddress);
        } catch (err) {
          console.warn(
            `Watcher LTC balance fail #${deal.id}:`,
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
          `Deal #${deal.id} funded on-chain: ${satsToLtcString(balance)} LTC`,
        );

        if (updated.groupChatId != null) {
          try {
            await postShipAsk(api, store, updated);
          } catch (err) {
            console.warn(`Notify funded/ship LTC #${deal.id} failed:`, err);
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
export async function checkDealDepositLtc(
  store: DealStore,
  dealId: string,
): Promise<
  | { ok: true; funded: boolean; balanceLtc: string; expectedLtc: string }
  | { ok: false; error: string }
> {
  const deal = store.get(dealId);
  if (!deal) return { ok: false, error: "Deal non trovato" };
  if (deal.asset !== "LTC") {
    return { ok: false, error: "Asset non LTC" };
  }
  if (!deal.escrowAddress) {
    return { ok: false, error: "Nessun indirizzo escrow" };
  }

  const targetLtc = expectedDepositLtc(deal);
  if (!targetLtc) {
    return {
      ok: false,
      error: amountConfirmed(deal)
        ? "Importo LTC lockato non valido"
        : "Importo LTC non ancora lockato (Accetto)",
    };
  }
  const expected = ltcToSats(targetLtc);
  if (expected == null) {
    return { ok: false, error: "Importo deal non valido" };
  }

  try {
    const balance = await getEscrowBalanceSats(deal.escrowAddress);
    const balanceLtc = satsToLtcString(balance);
    if (balance >= expected && deal.status === "awaiting_deposit") {
      store.update(deal.id, {
        status: "funded",
        depositLamports: balance.toString(),
        depositDetectedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        funded: true,
        balanceLtc,
        expectedLtc: targetLtc,
      };
    }
    return {
      ok: true,
      funded: deal.status === "funded" || balance >= expected,
      balanceLtc,
      expectedLtc: targetLtc,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
