# telegram-escrow-it

Bot Telegram di **escrow crypto** per il mercato italiano.

- Buyer + seller creano un **gruppo privato** (max 2 persone), aggiungono il bot come **admin**, poi avviano il deal
- L’**admin** di servizio può entrare solo in disputa
- UI in italiano · solo crypto in MVP (asset placeholder: **USDT**)

Stack: **Node.js + TypeScript + [grammY](https://grammy.dev)** · store JSON (`data/deals.json`)

## Requisiti

- Node.js 20+
- Bot da [@BotFather](https://t.me/BotFather) — bot **admin** nel gruppo escrow
- `TELEGRAM_BOT_TOKEN` (mai committare il token)

## Setup

```bash
git clone https://github.com/zfd2ndm6n9-ctrl/telegram-escrow-it.git
cd telegram-escrow-it
npm install
cp .env.example .env
# Imposta TELEGRAM_BOT_TOKEN e opzionalmente ADMIN_TELEGRAM_ID
```

### Variabili d'ambiente

| Variabile | Obbligatoria | Descrizione |
|-----------|--------------|-------------|
| `TELEGRAM_BOT_TOKEN` | sì | Token BotFather / secret Cursor |
| `ADMIN_TELEGRAM_ID` | no | User id numerico admin (dispute + ingresso gruppo) |
| `DATA_DIR` | no | Cartella store (default `data`) |

## Avvio (polling)

```bash
npm run dev      # sviluppo (tsx watch)
npm run build && npm start
# oppure con riavvio automatico:
npm run build && npm run start:forever
```

Se `PORT` è impostato (default su Docker/Render/Fly: 8080), espone anche `GET /healthz` per i healthcheck PaaS. Il bot resta in **long-polling** Telegram.

### Deploy always-on

Vedi la guida progetto `docs/hosting.md` (store Cursor) e i file in repo:

- `Dockerfile` / `Procfile` / `render.yaml` / `fly.toml`
- Richiede account **Render / Railway / Fly** di Francesco + secret `TELEGRAM_BOT_TOKEN`

La cloud VM Cursor **non** è hosting sempre acceso: può spegnersi con la sessione agent.

## Flusso MVP

### In privato

1. `/start` → `/crea` (o «Crea escrow»)
2. Scegli ruolo (*buyer* / *seller*) e importo USDT
3. Un messaggio con *Passi*: crea gruppo (max 2) → pulsante **+ Aggiungi il bot a un gruppo +** → leggi i ToS → in disputa aggiungi il supporto
4. Pulsante **📄 Leggi i Termini** (URL `TOS_URL` oppure “in arrivo”)

### Nel gruppo

5. `/avvia` richiede bot admin con: *Elimina messaggi*, *Blocca utenti*, *Invita utenti* — altrimenti messaggio IT con cosa manca e **nessun escrow**
6. Conferma controparte → indirizzo escrow **mock**, `/depositato`, `/pay_seller` / `/refund_buyer`, `/dispute`

Altri: `/indirizzo`, `/stato`, `/miei` (privato), `/aiuto`

### Protezioni base

- Dopo l’attivazione: kick utenti che non sono buyer/seller/admin
- Nessun invite link controparte generato dal bot in setup
- Messaggi in italiano

## Limiti dello scaffold

- Escrow address e payout sono **stub**
- Store file-based
- Niente fiat/SEPA

## Licenza

ISC
