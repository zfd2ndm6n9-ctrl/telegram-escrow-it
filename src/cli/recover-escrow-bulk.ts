/**
 * Bulk recovery: scansiona tutti i deal in DATA_DIR (+ profili orfani noti)
 * e sweepa SOL residui dagli escrow derivati verso una pubkey (0 fee servizio).
 *
 * Uso (Render shell / one-off, stessa env del bot):
 *
 *   npm run recover:escrow:bulk
 *   npm run recover:escrow:bulk -- --to FEE_WALLET_PUBKEY
 *   npm run recover:escrow:bulk -- --to 57fv8agNAjcsaLgodeNDjexTo5azsJpjLyMigaZnfVNP --execute
 *
 * Default = dry-run (report tabella, nessun transfer). Non cambia SOLANA_PRIVATE_KEY.
 */
import "dotenv/config";
import { PublicKey } from "@solana/web3.js";
import { config } from "../config.js";
import { DealStore } from "../store/deals.js";
import { listOrphanProfiles } from "../services/orphan-profiles.js";
import {
  deriveDealKeypair,
  getEscrowBalanceLamports,
  getMasterKeypair,
  getSolanaConnection,
  isSolanaConfigured,
  lamportsToSolString,
  payoutDealSol,
} from "../services/solana/index.js";

/** Deal noti stuck/orphan da includere anche se assenti dallo store. */
const KNOWN_RESIDUAL_DEAL_IDS = ["9414aac5", "82978c05"] as const;

/** Fallback rent-exempt system account (0 byte) se RPC fallisce. */
const RENT_EXEMPT_FALLBACK = 890_880n;

type Args = {
  execute: boolean;
  to?: string;
  deals: string[];
  help: boolean;
  delayMs: number;
};

type RowStatus =
  | "empty"
  | "dust"
  | "would_sweep"
  | "swept"
  | "skip_dest"
  | "error"
  | "mismatch";

type Row = {
  dealId: string;
  source: string;
  escrow: string;
  lamports: bigint;
  status: RowStatus;
  detail: string;
};

function printHelp(): void {
  console.log(`recover:escrow:bulk — sweep residui escrow → destinazione (0 fee servizio)

Uso:
  npm run recover:escrow:bulk
  npm run recover:escrow:bulk -- --to FEE_WALLET_PUBKEY
  npm run recover:escrow:bulk -- --to <PUBKEY> --execute
  npm run recover:escrow:bulk -- --deal 9414aac5 --to FEE_WALLET_PUBKEY

Flag:
  --to <pubkey|FEE_WALLET_PUBKEY|FEE_WALLET>
                       Destinazione sweep (obbligatoria con --execute).
                       FEE_WALLET(_PUBKEY) → legge env FEE_WALLET_PUBKEY.
  --execute            Esegue i transfer (senza = solo dry-run / report)
  --deal <id>[,id…]    Limita a uno o più deal id (ripetibile)
  --delay-ms <n>       Pausa tra RPC (default 250; alza se 429)
  --help               Questo aiuto

Fonti dealId:
  1) deals.json in DATA_DIR (${config.dataDir})
  2) profili orfani noti (orphan-profiles)
  3) stuck/orphan noti: ${KNOWN_RESIDUAL_DEAL_IDS.join(", ")}

Requisiti: stessa SOLANA_PRIVATE_KEY di Render + SOLANA_RPC_URL dedicato consigliato.
Fee di rete dalla master (hot wallet). Idempotente se escrow già vuoto.
`);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    execute: false,
    deals: [],
    help: false,
    delayMs: 250,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (a === "--execute") {
      out.execute = true;
      continue;
    }
    if (a === "--to") {
      out.to = (argv[++i] ?? "").trim();
      continue;
    }
    if (a === "--deal" || a === "--deal-id") {
      const raw = (argv[++i] ?? "").trim().toLowerCase();
      for (const part of raw.split(/[,\s]+/)) {
        const id = part.trim();
        if (id) out.deals.push(id);
      }
      continue;
    }
    if (a === "--delay-ms") {
      const n = Number((argv[++i] ?? "").trim());
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`--delay-ms non valido`);
      }
      out.delayMs = Math.floor(n);
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Flag sconosciuto: ${a} (usa --help)`);
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Risolve destinazione. Non inventa pubkey: solo --to esplicito o FEE_WALLET_PUBKEY env.
 */
function resolveSweepDestination(
  toRaw: string | undefined,
): { ok: true; address: string; label: string } | { ok: false; error: string } {
  const raw = (toRaw ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      error:
        "Specifica --to <PUBKEY> oppure --to FEE_WALLET_PUBKEY (env FEE_WALLET_PUBKEY).",
    };
  }
  const upper = raw.toUpperCase();
  if (upper === "FEE_WALLET_PUBKEY" || upper === "FEE_WALLET") {
    const fromEnv = config.feeWalletPubkey?.trim();
    if (!fromEnv) {
      return {
        ok: false,
        error:
          "FEE_WALLET_PUBKEY assente in env. Passa --to <PUBKEY> esplicita.",
      };
    }
    try {
      return {
        ok: true,
        address: new PublicKey(fromEnv).toBase58(),
        label: "FEE_WALLET_PUBKEY",
      };
    } catch {
      return {
        ok: false,
        error: `FEE_WALLET_PUBKEY env non valida: ${fromEnv}`,
      };
    }
  }
  try {
    return {
      ok: true,
      address: new PublicKey(raw).toBase58(),
      label: "custom",
    };
  } catch {
    return { ok: false, error: `Indirizzo --to non valido: ${raw}` };
  }
}

function collectDealIds(
  store: DealStore,
  filter: string[],
): Map<string, string> {
  /** dealId → source label */
  const map = new Map<string, string>();

  for (const deal of store.listAll()) {
    const id = deal.id.trim().toLowerCase();
    if (/^[a-f0-9]{8}$/.test(id)) {
      map.set(id, `store:${deal.status}`);
    }
  }

  for (const p of listOrphanProfiles()) {
    const id = p.dealId.trim().toLowerCase();
    if (!map.has(id)) map.set(id, "orphan-profile");
    else map.set(id, `${map.get(id)}+orphan`);
  }

  for (const id of KNOWN_RESIDUAL_DEAL_IDS) {
    if (!map.has(id)) map.set(id, "known-residual");
    else if (!map.get(id)!.includes("known")) {
      map.set(id, `${map.get(id)}+known`);
    }
  }

  if (filter.length > 0) {
    const wanted = new Set(filter.map((d) => d.trim().toLowerCase()));
    for (const id of wanted) {
      if (!/^[a-f0-9]{8}$/.test(id)) {
        throw new Error(`Deal id non valido (attesi 8 hex): ${id}`);
      }
      if (!map.has(id)) map.set(id, "cli-filter");
    }
    for (const id of [...map.keys()]) {
      if (!wanted.has(id)) map.delete(id);
    }
  }

  return map;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printTable(rows: Row[]): void {
  console.log(
    `\n${pad("dealId", 10)} ${pad("escrow", 46)} ${pad("lamports", 14)} ${pad("status", 12)} detail`,
  );
  console.log("-".repeat(120));
  for (const r of rows) {
    console.log(
      `${pad(r.dealId, 10)} ${pad(r.escrow || "-", 46)} ${pad(String(r.lamports), 14)} ${pad(r.status, 12)} ${r.detail}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log(`\n=== recover:escrow:bulk ===`);
  console.log(`DATA_DIR=${config.dataDir}`);
  console.log(`RPC=${config.solanaRpcUrl}`);
  console.log(`Mode=${args.execute ? "EXECUTE" : "DRY-RUN"}`);

  if (!isSolanaConfigured()) {
    throw new Error(
      "SOLANA_PRIVATE_KEY assente. Usa la stessa master di Render — non generarne una nuova.",
    );
  }

  const master = await getMasterKeypair();
  if (!master) {
    throw new Error("SOLANA_PRIVATE_KEY non valida o non caricabile.");
  }
  console.log(`Master pubkey: ${master.publicKey.toBase58()}`);

  const destResolved = resolveSweepDestination(args.to);
  if (args.execute && !destResolved.ok) {
    throw new Error(destResolved.error);
  }
  if (destResolved.ok) {
    console.log(
      `Destinazione (${destResolved.label}): ${destResolved.address}`,
    );
    console.log(`Fee servizio: 0 (sweep H3 / refund path)`);
  } else if (args.to) {
    throw new Error(destResolved.error);
  } else {
    console.log(
      "Destinazione: (non impostata — dry-run solo saldo; serve --to per --execute)",
    );
  }

  const store = new DealStore(config.dataDir);
  const dealMap = collectDealIds(store, args.deals);
  const dealIds = [...dealMap.keys()].sort();
  console.log(`Deal da scansionare: ${dealIds.length}`);

  const connection = getSolanaConnection();
  let rentExempt: bigint;
  try {
    rentExempt = BigInt(await connection.getMinimumBalanceForRentExemption(0));
  } catch {
    rentExempt = RENT_EXEMPT_FALLBACK;
    console.warn(
      `getMinimumBalanceForRentExemption fallito — uso fallback ${rentExempt}`,
    );
  }
  console.log(`Soglia dust (rent-exempt 0-byte): ${rentExempt} lamports`);

  const masterBal = await connection.getBalance(master.publicKey);
  console.log(
    `Saldo master (gas rete): ${lamportsToSolString(BigInt(masterBal))} SOL`,
  );
  if (args.execute && masterBal < 30_000) {
    throw new Error(
      "Master senza SOL per fee di rete. Ricarica ~0.05 SOL sulla hot wallet.",
    );
  }

  const rows: Row[] = [];
  let sweepable = 0n;
  let sweptOk = 0;
  let errors = 0;

  for (let i = 0; i < dealIds.length; i++) {
    const dealId = dealIds[i]!;
    const source = dealMap.get(dealId) ?? "?";
    if (i > 0 && args.delayMs > 0) await sleep(args.delayMs);

    let escrow = "";
    try {
      const kp = await deriveDealKeypair(master, dealId);
      escrow = kp.publicKey.toBase58();

      const orphan = listOrphanProfiles().find((p) => p.dealId === dealId);
      if (orphan && orphan.escrowAddress !== escrow) {
        rows.push({
          dealId,
          source,
          escrow,
          lamports: 0n,
          status: "mismatch",
          detail: `SKIP: derive≠orphan expected ${orphan.escrowAddress} — verifica SOLANA_PRIVATE_KEY`,
        });
        errors += 1;
        continue;
      }

      const balance = await getEscrowBalanceLamports(escrow);

      if (balance <= 0n) {
        rows.push({
          dealId,
          source,
          escrow,
          lamports: balance,
          status: "empty",
          detail: "skip: già vuoto",
        });
        continue;
      }

      if (balance <= rentExempt) {
        rows.push({
          dealId,
          source,
          escrow,
          lamports: balance,
          status: "dust",
          detail: `skip: ≤ rent-exempt (${lamportsToSolString(balance)} SOL)`,
        });
        continue;
      }

      sweepable += balance;

      if (!args.execute) {
        rows.push({
          dealId,
          source,
          escrow,
          lamports: balance,
          status: "would_sweep",
          detail: destResolved.ok
            ? `dry-run → ${destResolved.address} (${lamportsToSolString(balance)} SOL)`
            : `dry-run ${lamportsToSolString(balance)} SOL (serve --to per execute)`,
        });
        continue;
      }

      if (!destResolved.ok) {
        rows.push({
          dealId,
          source,
          escrow,
          lamports: balance,
          status: "skip_dest",
          detail: destResolved.error,
        });
        errors += 1;
        continue;
      }

      // H3: custom pubkey → payoutDealSol kind refund = full balance, 0 fee servizio
      const result = await payoutDealSol(dealId, destResolved.address, {
        kind: "refund",
      });
      if (!result.ok) {
        if (result.errorCode === "empty_escrow") {
          rows.push({
            dealId,
            source,
            escrow,
            lamports: 0n,
            status: "empty",
            detail: "skip: empty al momento del transfer (race/idempotent)",
          });
          continue;
        }
        rows.push({
          dealId,
          source,
          escrow,
          lamports: balance,
          status: "error",
          detail: `${result.errorCode ?? "err"}: ${result.error}`,
        });
        errors += 1;
        continue;
      }

      sweptOk += 1;
      rows.push({
        dealId,
        source,
        escrow,
        lamports: balance,
        status: "swept",
        detail: `tx ${result.signature} → ${destResolved.address}`,
      });
    } catch (err) {
      errors += 1;
      rows.push({
        dealId,
        source,
        escrow,
        lamports: 0n,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  printTable(rows);

  const would = rows.filter((r) => r.status === "would_sweep").length;
  const empty = rows.filter((r) => r.status === "empty").length;
  const dust = rows.filter((r) => r.status === "dust").length;

  console.log(`\n--- summary ---`);
  console.log(`scansionati: ${rows.length}`);
  console.log(`vuoti:       ${empty}`);
  console.log(`dust:        ${dust}`);
  if (args.execute) {
    console.log(`swept OK:    ${sweptOk}`);
    console.log(`errori:      ${errors}`);
  } else {
    console.log(`would_sweep: ${would} (totale ${lamportsToSolString(sweepable)} SOL)`);
    console.log(`errori:      ${errors}`);
    if (would > 0 && destResolved.ok) {
      console.log(
        `\nPer eseguire:\n  npm run recover:escrow:bulk -- --to ${args.to ?? destResolved.address} --execute`,
      );
    } else if (would > 0) {
      console.log(
        `\nPer eseguire:\n  npm run recover:escrow:bulk -- --to FEE_WALLET_PUBKEY --execute`,
      );
    }
  }

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
