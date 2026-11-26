# Ethereum MAINNET escrow — telegram-escrow-it

**Per:** Francesco  
**Asset:** ETH (mainnet), stesso flusso deal di SOL/LTC.  
**Secret:** solo env Render — mai repo / store / chat.

## Modello (allineato a SOL/LTC)

**Indirizzo deposito univoco per deal** (chiavi derivate), non pooled wallet.

1. `ETH_PRIVATE_KEY` = master hot wallet (hex 32 byte, opz. `0x`)
2. Per deal `id`: `HMAC-SHA256(masterSecret, "telegram-escrow-it:eth:deal:"+id)` → seed → secp256k1 → address **`0x…`**
3. Buyer invia ETH a quell’indirizzo
4. Watcher (~20s) o verifica deposito → `funded` se saldo ≥ **importo ETH lockato** (mai FX live)
5. Dual-confirm release/refund (stesso UX SOL/LTC)
6. **Release:** 95% seller · **5%** fee piattaforma (`FEE_WALLET_ETH`). Con invito **e** wallet collab **ETH** valido: 2.5%/2.5%. Se il collab è ancora un wallet SOL (codici `/codice` attuali) → **5% tutto a platform** (fold).
7. **Refund:** 100% − gas → buyer (0 fee servizio)
8. **Gas rete:** dedotto dal saldo escrow prima dello split (native ETH; la master non è fee-payer on-chain). Release = 2–3 tx sequenziali (seller → fee → collab).
9. Contabilità idempotente (`payoutCompleted` + `payoutTxSig` = hash tx primaria seller/refund)

### Lock importo ETH (anti underpay FX)

- Prezzo commerciale = **€**. All’**Accetto** si converte €→ETH **una volta** (`amount` + `amountConfirmedAt`).
- Watcher e Verifica confrontano **solo** quel target. Nessun ricalcolo CoinGecko/Coinbase dopo il lock.

## Env vars da impostare su Render

Sul **Web Service** (o Background Worker) del bot — Environment:

| Nome | Obbligatorio | Valore |
|------|--------------|--------|
| `ETH_PRIVATE_KEY` | **sì per deal ETH** | Output di `npm run eth:keygen` (hex 32 byte, con o senza `0x`). Master = derive escrow; default fee se `FEE_WALLET_ETH` assente |
| `FEE_WALLET_ETH` | **sì in prod** (consigliato) | Address ETH fee piattaforma (5% release). Alias accettato: `ETH_FEE_ADDRESS`. Se assente = address della master |
| `ETH_RPC_URL` | consigliato | Default `https://ethereum.publicnode.com`. Prod: Alchemy / Infura / QuickNode |
| `ETH_WATCH_INTERVAL_MS` | no | Default = `SOLANA_WATCH_INTERVAL_MS` o `20000` |

Le env SOL/LTC restano indipendenti. `/crea` parte se **almeno una** tra SOL, LTC e ETH è configurata.

### Generare la chiave (una tantum)

```bash
npm run eth:keygen
```

- Copia l’**address** (serve se finanzi la master o come riferimento)
- Copia `ETH_PRIVATE_KEY` in Render → Environment → Save → Manual Deploy / restart
- Imposta `FEE_WALLET_ETH` al wallet fee ETH di Francesco (se diverso dalla master)
- **Non** salvare il secret nel repo, in `docs/`, né in transcript agent

All’avvio i log Render stampano:
- `Escrow ETH mainnet attivo. Master address: …`
- `Fee piattaforma ETH (5% release): …` ← deve coincidere con `FEE_WALLET_ETH` se settata

## Differenze vs SOL / LTC (operative)

| | SOL | LTC | ETH |
|--|-----|-----|-----|
| Unità base | lamports (1e9) | satoshi (1e8) | wei (1e18) |
| Fee rete | pagata dalla master | tolta dagli UTXO escrow | tolta dal saldo escrow (gas) |
| Fee servizio dest | `FEE_WALLET_PUBKEY` | `FEE_WALLET_LTC` | `FEE_WALLET_ETH` |
| Explorer `/blockchain` | solscan.io | litecoinspace.org | etherscan.io |
| Invite collab 2.5% | wallet SOL su `/codice` | solo se collab è LTC; altrimenti fold | solo se collab è ETH; altrimenti fold |
| Atomicità payout | 1 tx multi-ix | 1 tx multi-out | 2–3 tx sequenziali |

## Test senza fondi / smoke

```bash
npm exec tsx scripts/check-eth-math.ts      # derive, fee split, address (offline)
npm exec tsx scripts/check-eth-api-smoke.ts # saldo/fee read-only (soft-skip se offline)
npm run typecheck
```

## Test deal tiny mainnet (dopo env)

1. Deploy + `ETH_PRIVATE_KEY` + `FEE_WALLET_ETH` + Manual Deploy
2. `/crea` → **Ξ ETH** → termini € piccoli
3. Gruppo + Accetto → wallet ETH seller/buyer → deposito
4. Dual-confirm paga-seller → Hash su etherscan
5. Secondo micro-deal: rimborso

## Persistenza / recovery

Stesso `DATA_DIR` di SOL/LTC. Gli indirizzi escrow ETH dipendono da **`ETH_PRIVATE_KEY`**: non ruotare la master se ci sono deal aperti.

Recovery CLI dedicato ETH: fuori scope di questo PR (usa stesso pattern derive + payout quando serve).
