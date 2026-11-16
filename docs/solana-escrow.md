# Solana MAINNET escrow — telegram-escrow-it

**Per:** Francesco  
**Asset MVP:** SOL (mainnet). Roadmap: LTC → ETH. Niente USDT.  
**Secret:** solo env Render — mai repo / store / chat lunga durata se evitabile.

## Modello scelto (MVP)

**Indirizzo deposito univoco per deal** (account derivati), non pooled wallet.

| | Derived per-deal (scelto) | Pooled + memo/importo |
|--|---------------------------|------------------------|
| Matching deposito | Chiaro (1 address = 1 deal) | Fragile (collisioni importo / memo mancante) |
| Complessità | HMAC(master, dealId) → seed | Più semplice a creare, più ambigua a riconciliare |
| Chiavi extra in DB | No (ricalcolo runtime) | No |
| Sweep / payout | Firma con keypair derivata; fee da master | Un solo account da gestire |
| Rischio | Master compromessa ⇒ tutti i deal | Idem + attribution errors |

**Perché derived:** per un MVP “soldi veri” l’errore più costoso è accreditare il deposito sbagliato. Unique address evita matching per importo.

### Come funziona

1. `SOLANA_PRIVATE_KEY` = master hot wallet (base58 o JSON array)
2. Per deal `id`: `HMAC-SHA256(masterSecret, "telegram-escrow-it:deal:"+id)` → 32 byte seed → keypair
3. Buyer invia SOL a quell’indirizzo
4. Watcher (~20s) o `/depositato` (verifica saldo) → `funded` se saldo ≥ importo
5. Dual-confirm `/pay_seller` (alias `/payseller`) / `/refund_buyer` (alias `/refundbuyer`) (o admin in disputa) → transfer **intero saldo** deal → wallet seller/buyer
6. **Fee di rete** pagate dalla **master** (`feePayer`): ricarica la master con poco SOL (es. 0.05)
7. Payout: `getLatestBlockhash("confirmed")` + stesso `preflightCommitment`, con retry su #7050008 (Blockhash not found)

## Avviso rischio

- Custodial durante l’escrow: chi ha `SOLANA_PRIVATE_KEY` muove i fondi
- Hot wallet su Render: compromissione env = perdita fondi
- **Inizia con test piccoli** (es. 0.01 SOL)
- RPC pubblico mainnet è rate-limited: in prod usa provider dedicato

## Env vars da impostare su Render

Sul **Web Service** (o Background Worker) che esegue il bot — Environment:

| Nome | Obbligatorio | Valore |
|------|--------------|--------|
| `TELEGRAM_BOT_TOKEN` | sì | Token BotFather |
| `SOLANA_PRIVATE_KEY` | sì | Output di `npm run solana:keygen` (base58 **oppure** JSON array) |
| `SOLANA_RPC_URL` | consigliato | Es. Helius/QuickNode; default pubblico ok per test |
| `SOLANA_WATCH_INTERVAL_MS` | no | Default `20000` |
| `ADMIN_TELEGRAM_ID` | sì per dispute | Tuo user id Telegram |
| `TOS_URL` | no | Link ToS |
| `DATA_DIR` | no | Default `data` (ephemeral su Render free) |
| `PORT` | auto su Web | Per `/healthz` |

### Generare la chiave (una tantum)

Esegui **in locale / su una macchina tua**, non in chat agent:

```bash
npm run solana:keygen
```

- Copia la **pubkey** (serve per ricaricare le fee sulla master — pochi SOL)
- Copia `SOLANA_PRIVATE_KEY` in Render → Environment → Save → restart
- **Non** salvare il secret nel repo, in `docs/`, né in transcript agent
- Se una chiave è stata stampata in un log agent, **scartala** e generane una nuova

All’avvio i log Render stampano: `Escrow SOL mainnet attivo. Master pubkey: …` ← quella è l’address da finanziare per le fee.

## Test deal tiny mainnet

1. Deploy branch con Solana + env settate; restart worker
2. Master funded con ~0.05 SOL (solo fee)
3. Telegram: `/crea` → buyer → `0.01` (niente wallet in DM)
4. Gruppo + bot admin + `/avvia` → controparte Confermo → ToS creatore + Accetto → wallet seller poi buyer
5. Invia `0.01 SOL` a `/indirizzo`
6. Attendi “Deposito rilevato” (o «Verifica deposito»)
7. Entrambi `/pay_seller` → signature su [Solscan](https://solscan.io)
8. Prova anche `/refund_buyer` su un secondo micro-deal

## Admin

- In disputa: `/pay_seller` o `/refund_buyer` forza payout on-chain
- Emergenza: `/depositato force` (solo `ADMIN_TELEGRAM_ID`) marca `funded` senza saldo (non crea SOL)

## Fuori scope (dopo)

- LTC / ETH
- KMS / cold / multi-sig
- Fee di servizio sul payout
- Persistenza Postgres + volume disco
