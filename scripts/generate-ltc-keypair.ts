/**
 * Genera una keypair Litecoin MAINNET (hot wallet escrow).
 *
 * - Stampa address + WIF su stdout
 * - NON scrive file: salva il secret offline / solo su Render env
 * - Non committare mai la chiave privata
 *
 * Uso: npm run ltc:keygen
 */
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { litecoinMainnet } from "../src/services/ltc/network.js";

const ECPair = ECPairFactory(ecc);

function main(): void {
  const kp = ECPair.makeRandom({ network: litecoinMainnet });
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(kp.publicKey),
    network: litecoinMainnet,
  });
  const address = payment.address;
  const wif = kp.toWIF();
  const hex = Buffer.from(kp.privateKey!).toString("hex");

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  Litecoin MAINNET escrow keypair (hot wallet)            ║
╠══════════════════════════════════════════════════════════╣
║  ADDRESS (master / funding fee default):                 ║
║  ${address}
║                                                          ║
║  SALVA IL SECRET OFFLINE, poi su Render:                 ║
║  LTC_PRIVATE_KEY=<WIF oppure hex 32 byte>                 ║
║                                                          ║
║  Fee piattaforma (opzionale, separata dalla master):     ║
║  FEE_WALLET_LTC=<ltc1… o L…>                             ║
║                                                          ║
║  ⚠️  Hot wallet: tieni SOLO importi di test piccoli.     ║
║  ⚠️  Non committare, non mettere in chat/repo/store.     ║
╚══════════════════════════════════════════════════════════╝

Address (bech32 P2WPKH):
${address}

LTC_PRIVATE_KEY (WIF):
${wif}

LTC_PRIVATE_KEY (hex, alternativa):
${hex}
`);
}

main();
