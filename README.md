# telegram-escrow-it

Bot Telegram di **escrow crypto** per il mercato italiano.

- Buyer + seller creano un **gruppo privato** (max 2 persone), aggiungono il bot come **admin**, poi avviano il deal
- L’**admin** di servizio può entrare solo in disputa
- UI in italiano · asset MVP: **SOL (Solana mainnet)** — soldi veri
- Roadmap asset: SOL → LTC → ETH (niente USDT)

Stack: **Node.js + TypeScript + [grammY](https://grammy.dev) + [@solana/web3.js](https://github.com/solana-foundation/solana-web3.js)** · store JSON (`data/deals.json`)

## ⚠️ Sicurezza hot wallet

- I fondi in escrow stanno su account **derivati** da una chiave master (`SOLANA_PRIVATE_KEY`)
- È un modello **custodial** durante il deal: chi ha la chiave controlla i SOL
- **Inizia con importi di test piccoli** (es. `0.01` SOL)
- **Non** committare mai la chiave privata; mettila solo nelle env del servizio Render

## Requisiti

- Node.js 20+
- Bot da [@BotFather](https://t.me/BotFather) — bot **admin** nel gruppo escrow
- `TELEGRAM_BOT_TOKEN` + `SOLANA_PRIVATE_KEY` (mai committare)

## Setup

```bash
git clone https://github.com/zfd2ndm6n9-ctrl/telegram-escrow-it.git
cd telegram-escrow-it
npm install
cp .env.example .env
# Imposta TELEGRAM_BOT_TOKEN, SOLANA_PRIVATE_KEY, opzionalmente ADMIN_TELEGRAM_ID
npm run solana:keygen   # genera keypair; salva secret offline / su Render
```

### Variabili d'ambiente (Render)

| Variabile | Obbligatoria | Descrizione |
|-----------|--------------|-------------|
| `TELEGRAM_BOT_TOKEN` | sì | Token BotFather |
| `SOLANA_PRIVATE_KEY` | sì (per escrow) | Secret hot wallet: **base58** o **JSON array** (64 byte). Solo env Render |
| `SOLANA_RPC_URL` | no | RPC mainnet. Default pubblico `https://api.mainnet-beta.solana.com`. Consigliato: Helius / QuickNode / Alchemy |
| `SOLANA_WATCH_INTERVAL_MS` | no | Poll depositi (default `20000`) |
| `ADMIN_TELEGRAM_ID` | no | User id admin (dispute + force) |
| `TOS_URL` | no | Link Termini |
| `DATA_DIR` | no | Cartella store (default `data`) |
| `PORT` | no | Se impostato: `GET /healthz` (Render/Fly) |

Documentazione tecnica: [`docs/solana-escrow.md`](./docs/solana-escrow.md).

## Avvio (polling)

```bash
npm run dev      # sviluppo (tsx watch)
npm run build && npm start
# oppure con riavvio automatico:
npm run build && npm run start:forever
```

Se `PORT` è impostato (default su Docker/Render/Fly: 8080), espone anche `GET /healthz`. Il bot resta in **long-polling** Telegram e avvia il **deposit watcher** SOL.

### Deploy always-on (Render)

1. Deploy da `main` (Web Service con healthz, oppure Background Worker)
2. Imposta i secret **solo** sul servizio Render (Environment)
3. All’avvio i log stampano la **pubkey master** (per fee di rete: lascia pochi SOL sulla master)
4. Un solo processo `getUpdates` per token

## Flusso MVP (SOL mainnet)

### In privato

1. `/start` → `/crea`
2. Ruolo (*buyer* / *seller*) → importo **SOL** — **niente wallet in DM**
3. Crea gruppo (max 2) → aggiungi bot → in disputa il supporto

### Nel gruppo

4. `/avvia` (bot admin con permessi) → controparte conferma il ruolo
5. *Stabiliamo i ToS*: il creatore scrive i termini; la controparte conferma col pulsante
6. Wallet **seller**, poi **buyer** (`/wallet` o indirizzo in chiaro)
7. Solo allora: indirizzo escrow → buyer deposita SOL
8. Rilevamento automatico (o «Verifica deposito» / `/depositato`)
9. `/pay_seller` o `/refund_buyer` (doppia conferma) → transfer on-chain
10. `/dispute` → admin forza release/refund on-chain

Altri: `/indirizzo`, `/stato`, `/miei` (privato), `/aiuto`

### Modello deposito

- **Indirizzo univoco per deal** (HMAC dalla master key → keypair derivata)
- Fee di rete pagate dalla **master** al payout (ricarica la master con poco SOL)
- Alternative pooled+memo: più semplici ma più ambigue — non usate in questo MVP

## Test deal piccolo (mainnet)

1. `npm run solana:keygen` → salva secret su Render come `SOLANA_PRIVATE_KEY`
2. Invia **~0.05 SOL** alla **pubkey master** (solo per fee tx)
3. Deploy / restart del worker
4. Su Telegram: `/crea` → buyer → `0.01` → gruppo → `/avvia`
5. Controparte conferma → creatore scrive ToS → controparte Accetta → `/wallet` seller poi buyer
6. Invia `0.01 SOL` all’indirizzo mostrato da `/indirizzo`
7. Attendi messaggio “deposito rilevato” (o «Verifica deposito»)
8. Entrambe: `/pay_seller` → controlla signature su Solscan

## Limiti

- Hot wallet custodial (rischio chiave / exit)
- Store file-based (su Render free il disco è ephemeral)
- Niente LTC/ETH ancora; niente fiat/SEPA

## Licenza

ISC
