import type { Network } from "bitcoinjs-lib";

/**
 * Parametri rete Litecoin mainnet per bitcoinjs-lib.
 * (bitcoinjs non include LTC di default.)
 */
export const litecoinMainnet: Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: {
    public: 0x01_9d_a4_62,
    private: 0x01_9d_9c_fe,
  },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};
