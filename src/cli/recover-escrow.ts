/**
 * Recovery one-shot: paga seller o rimborsa buyer da escrow derivato (master key),
 * senza bisogno dello store Telegram / ricreare il deal.
 *
 * Uso (locale o shell Render, con SOLANA_PRIVATE_KEY in env):
 *
 *   npm run recover:escrow -- --deal 82978c05
 *   npm run recover:escrow -- --deal 82978c05 --to seller --execute
 *   npm run recover:escrow -- --deal 82978c05 --to buyer --execute
 *   npm run recover:escrow -- --deal 82978c05 --to <pubkey> --execute
 *
 * Default = dry-run (verifica derive + saldo, nessun transfer).
 */
import "dotenv/config";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { config } from "../config.js";
import { DealStore } from "../store/deals.js";
import { getOrphanProfile, listOrphanProfiles } from "../services/orphan-profiles.js";
import {
  deriveDealKeypair,
  getDealEscrowAddress,
  getEscrowBalanceLamports,
  getMasterKeypair,
  getSolanaConnection,
  isSolanaConfigured,
  lamportsToSolString,
  payoutDealSol,
} from "../services/solana/index.js";
import type { Deal } from "../types.js";

type Args = {
  dealId: string;
  to?: string;
  execute: boolean;
  expected?: string;
  seedStore: boolean;
  groupChatId?: number;
  help: boolean;
};

function printHelp(): void {
  const known = listOrphanProfiles()
    .map(
      (p) =>
        `  #${p.dealId}  escrow=${p.escrowAddress}  amount=${p.amount} ${p.asset}\n` +
        `           seller=${p.sellerWallet}\n` +
        `           buyer=${p.buyerWallet}`,
    )
    .join("\n");
  console.log(`recover:escrow — payout/refund escrow orfano (master key)

Uso:
  npm run recover:escrow -- --deal <id> [--to seller|buyer|<addr>] [--execute]
  npm run recover:escrow -- --deal 82978c05
  npm run recover:escrow -- --deal 82978c05 --to seller --execute
  npm run recover:escrow -- --deal 82978c05 --to buyer --execute
  npm run recover:escrow -- --deal 82978c05 --seed-store --group-chat-id <id>

Flag:
  --deal <id>              Deal id (8 hex), es. 82978c05
  --to seller|buyer|addr   Destinazione (default seller se profilo noto)
  --execute                Esegue il transfer (senza flag = solo verifica)
  --expected <pubkey>      Escrow atteso (default dal profilo orfano se noto)
  --seed-store             Scrive/aggiorna deals.json (DATA_DIR) come funded
  --group-chat-id <n>      Chat id Telegram del gruppo (con --seed-store)
  --help                   Questo aiuto

Profili orfani noti:
${known || "  (nessuno)"}

Requisiti: SOLANA_PRIVATE_KEY (stessa master di Render). Non cambia le chiavi.
Fee di rete dalla master: lascia pochi SOL sulla hot wallet.
`);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    dealId: "",
    execute: false,
    seedStore: false,
    help: false,
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
    if (a === "--seed-store") {
      out.seedStore = true;
      continue;
    }
    if (a === "--deal" || a === "--deal-id") {
      out.dealId = (argv[++i] ?? "").trim().toLowerCase();
      continue;
    }
    if (a === "--to") {
      out.to = (argv[++i] ?? "").trim();
      continue;
    }
    if (a === "--expected") {
      out.expected = (argv[++i] ?? "").trim();
      continue;
    }
    if (a === "--group-chat-id") {
      const raw = (argv[++i] ?? "").trim();
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new Error(`--group-chat-id non valido: ${raw}`);
      }
      out.groupChatId = n;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Flag sconosciuto: ${a} (usa --help)`);
    }
  }
  return out;
}

function resolveDestination(
  toRaw: string | undefined,
  profile: ReturnType<typeof getOrphanProfile>,
): { label: string; address: string } {
  const to = (toRaw ?? (profile ? "seller" : "")).trim();
  if (!to) {
    throw new Error("Specifica --to seller|buyer|<indirizzo>");
  }
  const lower = to.toLowerCase();
  if (lower === "seller") {
    if (!profile?.sellerWallet) {
      throw new Error("Nessun sellerWallet nel profilo: passa un indirizzo con --to");
    }
    return { label: "seller", address: profile.sellerWallet };
  }
  if (lower === "buyer") {
    if (!profile?.buyerWallet) {
      throw new Error("Nessun buyerWallet nel profilo: passa un indirizzo con --to");
    }
    return { label: "buyer", address: profile.buyerWallet };
  }
  try {
    const pk = new PublicKey(to);
    return { label: "custom", address: pk.toBase58() };
  } catch {
    throw new Error(`Indirizzo --to non valido: ${to}`);
  }
}

function buildSeedDeal(
  dealId: string,
  profile: NonNullable<ReturnType<typeof getOrphanProfile>>,
  escrowAddress: string,
  groupChatId: number | undefined,
  depositLamports: string,
): Deal {
  const ts = new Date().toISOString();
  return {
    id: dealId,
    creatorId: 0,
    creatorRole: "seller",
    amount: profile.amount,
    asset: profile.asset,
    status: "funded",
    escrowAddress,
    sellerWallet: profile.sellerWallet,
    buyerWallet: profile.buyerWallet,
    groupChatId,
    releaseVotes: [],
    refundVotes: [],
    botPromptIds: [],
    depositLamports,
    depositDetectedAt: ts,
    tosText: "[ripristinato] deal orfano dopo redeploy",
    tosAcceptedAt: ts,
    createdAt: ts,
    updatedAt: ts,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.dealId) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  if (!/^[a-f0-9]{8}$/.test(args.dealId)) {
    throw new Error(`Deal id non valido (attesi 8 hex): ${args.dealId}`);
  }

  const profile = getOrphanProfile(args.dealId);
  const expected =
    args.expected?.trim() || profile?.escrowAddress || undefined;

  console.log(`\n=== recover:escrow deal #${args.dealId} ===`);
  if (profile) {
    console.log(`Profilo orfano noto: ${profile.note}`);
  }

  if (!isSolanaConfigured()) {
    throw new Error(
      "SOLANA_PRIVATE_KEY assente. Esporta la stessa chiave master di Render (non generarne una nuova).",
    );
  }

  const master = await getMasterKeypair();
  if (!master) {
    throw new Error("SOLANA_PRIVATE_KEY non valida o non caricabile.");
  }
  console.log(`Master pubkey: ${master.publicKey.toBase58()}`);

  const derived = await deriveDealKeypair(master, args.dealId);
  const derivedAddr = derived.publicKey.toBase58();
  const viaHelper = await getDealEscrowAddress(args.dealId);
  console.log(`Escrow derivato (HMAC): ${derivedAddr}`);
  if (viaHelper && viaHelper !== derivedAddr) {
    throw new Error("Incoerenza deriveDealKeypair vs getDealEscrowAddress");
  }

  if (expected && expected !== derivedAddr) {
    throw new Error(
      `Mismatch escrow: atteso ${expected}, derivato ${derivedAddr}. ` +
        `NON procedere — verifica che SOLANA_PRIVATE_KEY sia la master originale (non una nuova keygen).`,
    );
  }
  if (expected) {
    console.log(`Match escrow atteso: OK (${expected})`);
  } else {
    console.log(
      "Nessun --expected / profilo: verifica manualmente l'indirizzo prima di --execute.",
    );
  }

  const connection = getSolanaConnection();
  const balance = await getEscrowBalanceLamports(derivedAddr);
  const sol = lamportsToSolString(balance);
  const masterBal = await connection.getBalance(master.publicKey);
  console.log(`Saldo escrow: ${sol} SOL (${balance} lamports)`);
  console.log(
    `Saldo master (fee): ${lamportsToSolString(BigInt(masterBal))} SOL`,
  );
  console.log(`Solscan: https://solscan.io/account/${derivedAddr}`);

  if (balance <= 0n) {
    console.log("Escrow vuoto: niente da recuperare (già pagato o mai depositato).");
    process.exit(0);
  }

  if (args.seedStore) {
    if (!profile) {
      throw new Error("--seed-store richiede un profilo orfano noto per questo deal id");
    }
    const store = new DealStore(config.dataDir);
    const deal = buildSeedDeal(
      args.dealId,
      profile,
      derivedAddr,
      args.groupChatId,
      String(balance),
    );
    store.upsert(deal);
    console.log(
      `Store aggiornato: ${resolve(config.dataDir, "deals.json")} ` +
        `(status=funded${args.groupChatId != null ? `, groupChatId=${args.groupChatId}` : ", groupChatId assente — usa /ripristina nel gruppo"})`,
    );
  }

  if (!args.execute) {
    const destPreview = resolveDestination(args.to, profile);
    console.log(`\nDry-run OK. Fondi al sicuro sull'escrow derivato.`);
    console.log(
      `Per pagare: npm run recover:escrow -- --deal ${args.dealId} --to ${args.to ?? destPreview.label} --execute`,
    );
    console.log(
      `Destinazione prevista (${destPreview.label}): ${destPreview.address}`,
    );
    return;
  }

  const dest = resolveDestination(args.to, profile);
  // seller → release (fee 5%/2.5%); buyer → refund 100%;
  // indirizzo custom → sweep intero (no fee servizio) per non sottrarre 5% in recovery.
  const kind =
    dest.label === "seller"
      ? "release"
      : dest.label === "buyer"
        ? "refund"
        : "refund";
  const storeForInvite = new DealStore(config.dataDir);
  const existingDeal = storeForInvite.get(args.dealId);
  console.log(`\nEseguo payout (${kind}) → ${dest.label} ${dest.address} …`);
  if (dest.label === "seller") {
    console.log(
      existingDeal?.collaboratorWallet
        ? `  Fee: 2.5% master + 2.5% collab ${existingDeal.collaboratorWallet}`
        : "  Fee: 5% piattaforma (seller 95%)",
    );
  } else if (dest.label === "buyer") {
    console.log("  Fee servizio: nessuna (refund)");
  } else {
    console.log(
      "  Fee servizio: nessuna (sweep custom — recovery full balance)",
    );
  }
  const result = await payoutDealSol(args.dealId, dest.address, {
    kind,
    collaboratorWallet:
      dest.label === "seller" ? existingDeal?.collaboratorWallet : undefined,
    feePayer: dest.label === "seller" ? existingDeal?.feePayer : undefined,
  });
  if (!result.ok) {
    console.error(`Payout fallito: ${result.error}`);
    process.exit(1);
  }

  console.log(`\n✅ Payout OK`);
  console.log(`  SOL: ${result.sol}`);
  console.log(`  Tx:  ${result.signature}`);
  if (result.platformFeeLamports != null) {
    console.log(`  Fee piattaforma: ${lamportsToSolString(result.platformFeeLamports)} SOL`);
  }
  if (result.collaboratorFeeLamports != null && result.collaboratorFeeLamports > 0n) {
    console.log(
      `  Fee collaboratore: ${lamportsToSolString(result.collaboratorFeeLamports)} SOL`,
    );
  }
  console.log(`  Solscan: https://solscan.io/tx/${result.signature}`);

  if (args.seedStore && profile) {
    const store = storeForInvite;
    const existing = store.get(args.dealId);
    if (existing) {
      store.update(args.dealId, {
        status: dest.label === "buyer" ? "refunded" : "released",
        payoutTxSig: result.signature,
        payoutCompleted: true,
        sellerPayoutLamports:
          result.sellerLamports != null
            ? String(result.sellerLamports)
            : String(result.lamports),
        platformFeeLamports:
          result.platformFeeLamports != null
            ? String(result.platformFeeLamports)
            : undefined,
        collaboratorFeeLamports:
          result.collaboratorFeeLamports != null
            ? String(result.collaboratorFeeLamports)
            : undefined,
      });
      console.log("Store: deal aggiornato a released/refunded.");
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
