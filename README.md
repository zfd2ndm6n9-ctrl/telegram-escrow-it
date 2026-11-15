# telegram-escrow-it

Bot Telegram di **escrow crypto** per il mercato italiano (**Escrowita**).

- Dopo `/crea` il bot (via account helper MTProto) **crea un gruppo privato** del deal e manda il **link invito** in DM
- Buyer + seller + bot nel gruppo; l’**admin** di servizio entra solo in disputa
- UI in italiano · asset MVP: **SOL (Solana mainnet)** — soldi veri
- Roadmap asset: SOL → LTC → ETH (niente USDT)

Stack: **Node.js + TypeScript + [grammY](https://grammy.dev) + [teleproto](https://docs.teleproto.dev) + [@solana/web3.js](https://github.com/solana-foundation/solana-web3.js)** · store JSON (`data/deals.json`)

## ⚠️ Sicurezza hot wallet

- I fondi in escrow stanno su account **derivati** da una chiave master (`SOLANA_PRIVATE_KEY`)
- È un modello **custodial** durante il deal: chi ha la chiave controlla i SOL
- **Inizia con importi di test piccoli** (es. `0.01` SOL)
- **Non** committare mai la chiave privata; mettila solo nelle env del servizio Render

## Requisiti

- Node.js 20+
- Bot da [@BotFather](https://t.me/BotFather)
- Account Telegram **helper** (user) per creare i gruppi — vedi [`docs/bot-created-groups.md`](./docs/bot-created-groups.md)
- `TELEGRAM_BOT_TOKEN` + helper MTProto + `SOLANA_PRIVATE_KEY` (mai committare)

## Setup

```bash
git clone https://github.com/zfd2ndm6n9-ctrl/telegram-escrow-it.git
cd telegram-escrow-it
npm install
cp .env.example .env
# Imposta TELEGRAM_BOT_TOKEN, SOLANA_PRIVATE_KEY, helper MTProto, opzionalmente ADMIN_TELEGRAM_ID
npm run solana:keygen   # genera keypair; salva secret offline / su Render
npm run helper:login    # genera TELEGRAM_HELPER_SESSION (serve TELEGRAM_API_ID/HASH)
```

### Variabili d'ambiente (Render)

| Variabile | Obbligatoria | Descrizione |
|-----------|--------------|-------------|
| `TELEGRAM_BOT_TOKEN` | sì | Token BotFather |
| `TELEGRAM_API_ID` | sì (gruppi) | api_id da my.telegram.org |
| `TELEGRAM_API_HASH` | sì (gruppi) | api_hash da my.telegram.org |
| `TELEGRAM_HELPER_SESSION` | sì (gruppi) | Session string helper (`npm run helper:login`) |
| `SOLANA_PRIVATE_KEY` | sì (per escrow) | Secret hot wallet: **base58** o **JSON array** (64 byte). Solo env Render |
| `SOLANA_RPC_URL` | no | RPC mainnet. Default pubblico. Consigliato: Helius / QuickNode / Alchemy |
| `SOLANA_WATCH_INTERVAL_MS` | no | Poll depositi (default `20000`) |
| `ADMIN_TELEGRAM_ID` | no | User id admin (dispute + force) |
| `TOS_URL` | no | Link Termini |
| `DATA_DIR` | no | Cartella store (default `data`) |
| `PORT` | no | Se impostato: `GET /healthz` (Render/Fly) |

Documentazione: [`docs/solana-escrow.md`](./docs/solana-escrow.md) · [`docs/bot-created-groups.md`](./docs/bot-created-groups.md).

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
2. Imposta i secret **solo** sul servizio Render (Environment), **inclusi** i tre helper MTProto
3. All’avvio i log stampano la **pubkey master** (per fee di rete: lascia pochi SOL sulla master)
4. Un solo processo `getUpdates` per token

## Flusso MVP (SOL mainnet)

### In privato

1. `/start` → `/crea`
2. Ruolo (*buyer* / *seller*) → crypto (*SOL* live; ETH/LTC presto) → importo — **niente wallet in DM**
3. Il bot crea il gruppo e ti manda il **link invito** da condividere con la controparte

### Nel gruppo

4. Controparte conferma il ruolo (auto-start; `/avvia` solo come fallback)
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

## Test deal piccolo (mainnet)

1. `npm run solana:keygen` → salva secret su Render come `SOLANA_PRIVATE_KEY`
2. `npm run helper:login` → salva le tre env helper su Render
3. Invia **~0.05 SOL** alla **pubkey master** (solo per fee tx)
4. Deploy / restart del worker (**Manual Deploy**)
5. Su Telegram: `/crea` → buyer → SOL → `0.01` → ricevi link gruppo
6. Controparte entra e conferma → creatore scrive ToS → Accetta → `/wallet` seller poi buyer
7. Invia `0.01 SOL` all’indirizzo mostrato da `/indirizzo`
8. Attendi “deposito rilevato” → entrambe `/pay_seller`

## Limiti

- Hot wallet custodial (rischio chiave / exit)
- Store file-based (su Render free il disco è ephemeral)
- Owner Telegram del gruppo = account **helper** (non trasferibile alle parti senza promuovere admin)
- Niente LTC/ETH ancora; niente fiat/SEPA

## Licenza

ISC
