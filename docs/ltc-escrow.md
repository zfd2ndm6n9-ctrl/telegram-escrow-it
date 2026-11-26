# Litecoin MAINNET escrow — telegram-escrow-it

**Per:** Francesco  
**Asset:** LTC (mainnet), stesso flusso deal di SOL.  
**Secret:** solo env Render — mai repo / store / chat.

## Modello (allineato a SOL)

**Indirizzo deposito univoco per deal** (chiavi derivate), non pooled wallet.

1. `LTC_PRIVATE_KEY` = master hot wallet (WIF o hex 32 byte)
2. Per deal `id`: `HMAC-SHA256(masterSecret, "telegram-escrow-it:ltc:deal:"+id)` → seed → keypair secp256k1 → address **bech32 P2WPKH** (`ltc1q…`)
3. Buyer invia LTC a quell’indirizzo
4. Watcher (~20s) o verifica deposito → `funded` se saldo ≥ **importo LTC lockato** (mai FX live)
5. Dual-confirm release/refund (stesso UX SOL)
6. **Release:** 95% seller · **5%** fee piattaforma (`FEE_WALLET_LTC`). Con invito **e** wallet collab **LTC** valido: 2.5%/2.5%. Se il collab è ancora un wallet SOL (codici `/codice` attuali) → **5% tutto a platform** (fold).
7. **Refund:** 100% → buyer (0 fee servizio)
8. **Fee di rete:** dedotte dagli UTXO escrow (modello UTXO; la master non è fee-payer on-chain)
9. Contabilità idempotente (`payoutCompleted` + `payoutTxSig`)

### Lock importo LTC (anti underpay FX)

- Prezzo commerciale = **€**. All’**Accetto** si converte €→LTC **una volta** (`amount` + `amountConfirmedAt`).
- Watcher e Verifica confrontano **solo** quel target. Nessun ricalcolo CoinGecko/Coinbase dopo il lock.

## Env vars da impostare su Render

Sul **Web Service** (o Background Worker) del bot — Environment:

| Nome | Obbligatorio | Valore |
|------|--------------|--------|
| `LTC_PRIVATE_KEY` | **sì per deal LTC** | Output di `npm run ltc:keygen` (WIF **oppure** hex 32 byte). Master = derive escrow; default fee se `FEE_WALLET_LTC` assente |
| `FEE_WALLET_LTC` | **sì in prod** (consigliato) | Address LTC fee piattaforma (5% release). Alias accettato: `LTC_FEE_ADDRESS`. Se assente = address della master |
| `LTC_API_URL` | consigliato | Default `https://litecoinspace.org/api`. Alternativa BlockCypher: `https://api.blockcypher.com/v1/ltc/main` |
| `LTC_API_TOKEN` | no | Token BlockCypher (`token=` query) se usi quel provider |
| `LTC_WATCH_INTERVAL_MS` | no | Default = `SOLANA_WATCH_INTERVAL_MS` o `20000` |

Le env SOL (`SOLANA_PRIVATE_KEY`, `FEE_WALLET_PUBKEY`, …) restano indipendenti. `/crea` parte se **almeno una** tra SOL e LTC è configurata.

### Generare la chiave (una tantum)

```bash
npm run ltc:keygen
```

- Copia l’**address** (serve se finanzi la master o come riferimento)
- Copia `LTC_PRIVATE_KEY` in Render → Environment → Save → Manual Deploy / restart
- Imposta `FEE_WALLET_LTC` al wallet fee LTC di Francesco (se diverso dalla master)
- **Non** salvare il secret nel repo, in `docs/`, né in transcript agent

All’avvio i log Render stampano:
- `Escrow LTC mainnet attivo. Master address: …`
- `Fee piattaforma LTC (5% release): …` ← deve coincidere con `FEE_WALLET_LTC` se settata

## Differenze vs SOL (operative)

| | SOL | LTC |
|--|-----|-----|
| Unità base | lamports (1e9) | satoshi (1e8) |
| Fee rete | pagata dalla master | tolta dagli UTXO escrow |
| Fee servizio dest | `FEE_WALLET_PUBKEY` | `FEE_WALLET_LTC` |
| Explorer `/blockchain` | solscan.io | litecoinspace.org |
| Invite collab 2.5% | wallet SOL su `/codice` | solo se collab wallet è LTC; altrimenti fold → platform |

## Test senza fondi / smoke

```bash
npm exec tsx scripts/check-ltc-math.ts      # derive, fee split, address (offline)
npm exec tsx scripts/check-ltc-api-smoke.ts # saldo/fee rates read-only (soft-skip se offline)
npm run typecheck
```

## Test deal tiny mainnet (dopo env)

1. Deploy + `LTC_PRIVATE_KEY` + `FEE_WALLET_LTC` + Manual Deploy
2. `/crea` → **Ł LTC** → termini € piccoli
3. Gruppo + Accetto → wallet LTC seller/buyer → deposito
4. Dual-confirm paga-seller → Hash su litecoinspace
5. Secondo micro-deal: rimborso

## Persistenza / recovery

Stesso `DATA_DIR` di SOL. Gli indirizzi escrow LTC dipendono da **`LTC_PRIVATE_KEY`**: non ruotare la master se ci sono deal aperti.

Recovery CLI dedicato LTC: fuori scope di questo PR (usa stesso pattern derive + payout quando serve).
