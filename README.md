# telegram-escrow-it

Bot Telegram di **escrow crypto** per il mercato italiano (**Escrowita**).

- Dopo `/crea`: crea un **gruppo privato**, aggiungi il bot come **admin**, poi `/avvia`
- Buyer + seller + bot nel gruppo; il **supporto** entra solo in disputa
- UI in italiano · asset MVP: **SOL (Solana mainnet)** — soldi veri
- Roadmap asset: SOL → LTC → ETH (niente USDT)

Stack: **Node.js + TypeScript + [grammY](https://grammy.dev) + [teleproto](https://docs.teleproto.dev) (opzionale) + [@solana/web3.js](https://github.com/solana-foundation/solana-web3.js)** · store JSON (`data/deals.json`, `data/members.json`)

## ⚠️ Sicurezza hot wallet

- I fondi in escrow stanno su account **derivati** da una chiave master (`SOLANA_PRIVATE_KEY`)
- È un modello **custodial** durante il deal: chi ha la chiave controlla i SOL
- **Inizia con importi di test piccoli** (es. `0.01` SOL)
- **Non** committare mai la chiave privata; mettila solo nelle env del servizio Render

## Requisiti

- Node.js 20+
- Bot da [@BotFather](https://t.me/BotFather)
- `TELEGRAM_BOT_TOKEN` + `SOLANA_PRIVATE_KEY` (mai committare)
- Helper MTProto **opzionale** (solo se `TELEGRAM_BOT_CREATES_GROUPS=1`) — vedi [`docs/bot-created-groups.md`](./docs/bot-created-groups.md)

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
| `SOLANA_RPC_URL` | no | RPC mainnet. Default pubblico. Consigliato: Helius / QuickNode / Alchemy |
| `SOLANA_WATCH_INTERVAL_MS` | no | Poll depositi (default `20000`) |
| `ADMIN_TELEGRAM_ID` | no | User id admin (dispute + force) |
| `TOS_URL` | no | Link Termini |
| `DATA_DIR` | sì in prod | Store deal + iscritti (`deals.json`, `members.json`). Render: `/var/data` su Persistent Disk (starter+). Default `data` |
| `PORT` | no | Se impostato: `GET /healthz` (Render/Fly) |
| `TELEGRAM_BOT_CREATES_GROUPS` | no | `1` per tentare create automatica gruppo (default off) |
| `TELEGRAM_API_ID` / `HASH` / `HELPER_SESSION` | no | Solo con gate sopra; altrimenti soft-fallback manuale |

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
2. Imposta i secret **solo** sul servizio Render (Environment)
3. All’avvio i log stampano la **pubkey master** (per fee di rete: lascia pochi SOL sulla master)
4. Un solo processo `getUpdates` per token
5. **Manual Deploy** dopo il merge della PR

## Flusso MVP (SOL mainnet)

### In privato

1. `/start` (iscrizione) → `/crea`
2. Ruolo (*buyer* / *seller*) → crypto (*SOL* live; ETH/LTC presto) → importo — **niente wallet in DM**
3. Istruzioni: crea gruppo privato → aggiungi bot admin → `/avvia`

### Nel gruppo

4. Controparte conferma il ruolo
5. *ToS*: il creatore scrive i termini; la controparte conferma col pulsante
6. Wallet **seller**, poi **buyer** (`/wallet` o indirizzo in chiaro)
7. Indirizzo escrow (verifica solo nei messaggi del bot) → buyer deposita SOL
8. Rilevamento automatico (o `/depositato`)
9. `/pay_seller` (alias `/payseller`, `/release`) o `/refund_buyer` (alias `/refundbuyer`) — doppia conferma → transfer on-chain
10. `/dispute` / `/support` → admin forza release/refund on-chain

Altri: `/indirizzo`, `/stato`, `/blockchain`, `/menu`, `/miei` (privato), `/aiuto`

### Igiene anti-truffa

- Kick utenti extra e bot non autorizzati
- Blocco messaggi inoltrati (delete se possibile)
- Avviso se buyer/seller cambiano nome o username

### Modello deposito

- **Indirizzo univoco per deal** (HMAC dalla master key → keypair derivata)
- Fee di rete pagate dalla **master** al payout (ricarica la master con poco SOL)

## Test deal piccolo (mainnet)

1. `npm run solana:keygen` → salva secret su Render come `SOLANA_PRIVATE_KEY`
2. Invia **~0.05 SOL** alla **pubkey master** (solo per fee tx)
3. Deploy / restart del worker (**Manual Deploy**)
4. Su Telegram: `/crea` → buyer → SOL → `0.01`
5. Crea gruppo privato → aggiungi bot admin → `/avvia` → invita controparte
6. Controparte conferma → creatore scrive ToS → Accetta → `/wallet` seller poi buyer
7. Invia `0.01 SOL` all’indirizzo mostrato da `/indirizzo`
8. Attendi “deposito rilevato” → entrambe `/payseller` (o pulsante *Paga seller*)

### Persistenza e recovery

- Su Render serve **Persistent Disk** + `DATA_DIR=/var/data` (vedi `render.yaml`): senza volume i deal spariscono al redeploy, i fondi restano sull’escrow derivato.
- Recovery one-shot (stessa master key, senza ricreare il deal Telegram):

```bash
npm run recover:escrow -- --deal 82978c05
npm run recover:escrow -- --deal 82978c05 --to seller --execute
```

- Admin in gruppo: `/ripristina 82978c05` · `/admin_payout 82978c05 seller`

Dettagli: [`docs/solana-escrow.md`](./docs/solana-escrow.md).

## Limiti

- Hot wallet custodial (rischio chiave / exit)
- Store file-based: senza Persistent Disk su Render i deal non sopravvivono al redeploy
- Niente LTC/ETH ancora; niente fiat/SEPA
- Niente partial pay / community / marketplace

## Licenza

ISC
