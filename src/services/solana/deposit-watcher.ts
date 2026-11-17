import type { Api } from "grammy";
import type { DealStore } from "../../store/deals.js";
import type { Deal } from "../../types.js";
import { amountConfirmed, lockedSolAmount } from "../deal-logic.js";
import { postShipAsk } from "../group-setup.js";
import { solToLamports, lamportsToSolString } from "./amounts.js";
import { getEscrowBalanceLamports } from "./transfer.js";
import { isSolanaConfigured } from "./client.js";

/** Target deposito: solo importo lockato (mai FX live). */
function expectedDepositSol(deal: Deal): string | null {
  const locked = lockedSolAmount(deal);
  if (locked) return locked;
  // Mid-flight legacy: amount senza confirmedAt — usa amount se parseabile.
  if (deal.amount && solToLamports(deal.amount) != null) return deal.amount;
  return null;
}

const DEFAULT_INTERVAL_MS = 20_000;

export type DepositWatcherHandle = {
  stop: () => void;
};

/**
 * Poll periodico dei deal in `awaiting_deposit`: se il saldo ≥ importo → `funded`.
 * Poi: cancella prompt deposito e chiede al seller di spedire.
 */
export function startDepositWatcher(
  store: DealStore,
  api: Api,
  intervalMs = DEFAULT_INTERVAL_MS,
): DepositWatcherHandle {
  if (!isSolanaConfigured()) {
    console.warn("Deposit watcher: SOLANA_PRIVATE_KEY assente, skip.");
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
        if (deal.asset !== "SOL") continue;
        if (!deal.escrowAddress || deal.escrowAddress.startsWith("TXescrow")) {
          continue;
        }

        const targetSol = expectedDepositSol(deal);
        if (!targetSol) {
          console.warn(
            `Watcher #${deal.id}: nessun target SOL lockato (amount/amountConfirmedAt assenti)`,
          );
          continue;
        }
        const expected = solToLamports(targetSol);
        if (expected == null) continue;

        let balance: bigint;
        try {
          balance = await getEscrowBalanceLamports(deal.escrowAddress);
        } catch (err) {
          console.warn(
            `Watcher balance fail #${deal.id}:`,
            err instanceof Error ? err.message : err,
          );
          continue;
        }

        // ≥ target lockato → funded. Non ricalcolare da FX live.
        if (balance < expected) continue;

        // Race: /depositato o altro tick può aver già avanzato lo status
        const latest = store.get(deal.id);
        if (!latest || latest.status !== "awaiting_deposit") continue;

        const updated = store.update(deal.id, {
          status: "funded",
          depositLamports: balance.toString(),
          depositDetectedAt: new Date().toISOString(),
        });
        if (!updated) continue;

        console.log(
          `Deal #${deal.id} funded on-chain: ${lamportsToSolString(balance)} SOL`,
        );

        if (updated.groupChatId != null) {
          try {
            await postShipAsk(api, store, updated);
          } catch (err) {
            console.warn(`Notify funded/ship #${deal.id} failed:`, err);
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
  // Non tenere vivo il processo solo per il timer in alcuni ambienti
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
export async function checkDealDeposit(
  store: DealStore,
  dealId: string,
): Promise<
  | { ok: true; funded: boolean; balanceSol: string; expectedSol: string }
  | { ok: false; error: string }
> {
  const deal = store.get(dealId);
  if (!deal) return { ok: false, error: "Deal non trovato" };
  if (deal.asset !== "SOL") {
    return { ok: false, error: "Asset non SOL" };
  }
  if (!deal.escrowAddress) {
    return { ok: false, error: "Nessun indirizzo escrow" };
  }

  const targetSol = expectedDepositSol(deal);
  if (!targetSol) {
    return {
      ok: false,
      error: amountConfirmed(deal)
        ? "Importo SOL lockato non valido"
        : "Importo SOL non ancora lockato (Accetto)",
    };
  }
  const expected = solToLamports(targetSol);
  if (expected == null) {
    return { ok: false, error: "Importo deal non valido" };
  }

  try {
    const balance = await getEscrowBalanceLamports(deal.escrowAddress);
    const balanceSol = lamportsToSolString(balance);
    // Confronto solo vs target lockato — mai conversione €→SOL live.
    if (balance >= expected && deal.status === "awaiting_deposit") {
      store.update(deal.id, {
        status: "funded",
        depositLamports: balance.toString(),
        depositDetectedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        funded: true,
        balanceSol,
        expectedSol: targetSol,
      };
    }
    return {
      ok: true,
      funded: deal.status === "funded" || balance >= expected,
      balanceSol,
      expectedSol: targetSol,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
