/**
 * Genera una keypair Ethereum MAINNET (hot wallet escrow).
 *
 * - Stampa address + hex su stdout
 * - NON scrive file: salva il secret offline / solo su Render env
 * - Non committare mai la chiave privata
 *
 * Uso: npm run eth:keygen
 */
import { Wallet } from "ethers";

function main(): void {
  const wallet = Wallet.createRandom();
  const address = wallet.address;
  const hex = wallet.privateKey; // 0x…
  const hexBare = hex.slice(2);

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  Ethereum MAINNET escrow keypair (hot wallet)            ║
╠══════════════════════════════════════════════════════════╣
║  ADDRESS (master / funding fee default):                 ║
║  ${address}
║                                                          ║
║  SALVA IL SECRET OFFLINE, poi su Render:                 ║
║  ETH_PRIVATE_KEY=<hex 32 byte, opz. 0x>                    ║
║                                                          ║
║  Fee piattaforma (opzionale, separata dalla master):     ║
║  FEE_WALLET_ETH=<0x…>                                    ║
║                                                          ║
║  ⚠️  Hot wallet: tieni SOLO importi di test piccoli.     ║
║  ⚠️  Non committare, non mettere in chat/repo/store.     ║
╚══════════════════════════════════════════════════════════╝

Address:
${address}

ETH_PRIVATE_KEY (0x hex):
${hex}

ETH_PRIVATE_KEY (hex senza 0x):
${hexBare}
`);
}

main();
