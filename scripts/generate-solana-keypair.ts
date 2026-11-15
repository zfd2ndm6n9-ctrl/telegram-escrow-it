/**
 * Genera una keypair Solana MAINNET (hot wallet escrow).
 *
 * - Stampa pubkey + secret su stdout
 * - NON scrive file: salva il secret offline / solo su Render env
 * - Non committare mai la chiave privata
 *
 * Uso: npm run solana:keygen
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

async function main(): Promise<void> {
  const kp = await Keypair.generate();
  const secretB58 = bs58.encode(kp.secretKey);
  const secretJson = JSON.stringify(Array.from(kp.secretKey));

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  Solana MAINNET escrow keypair (hot wallet)              ║
╠══════════════════════════════════════════════════════════╣
║  PUBKEY (indirizzo master / funding fee):                ║
║  ${kp.publicKey.toBase58()}
║                                                          ║
║  SALVA IL SECRET OFFLINE, poi su Render:                 ║
║  SOLANA_PRIVATE_KEY=<base58 oppure JSON array>           ║
║                                                          ║
║  ⚠️  Hot wallet: tieni SOLO importi di test piccoli.     ║
║  ⚠️  Non committare, non mettere in chat/repo/store.     ║
╚══════════════════════════════════════════════════════════╝

Public key:
${kp.publicKey.toBase58()}

SOLANA_PRIVATE_KEY (base58):
${secretB58}

SOLANA_PRIVATE_KEY (JSON array, alternativa):
${secretJson}
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
