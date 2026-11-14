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
```

## Flusso MVP

### In privato

1. `/start` → `/crea` (o «Crea escrow»)
2. Scegli ruolo (*buyer* / *seller*) e importo USDT
3. Il bot **non** manda un invite come se il gruppo esistesse già: spiega di creare il gruppo con la controparte, aggiungere `@ESCROWITAbot` come admin, poi `/avvia` nel gruppo
4. Pulsante opzionale «Aggiungi il bot a un gruppo» (`startgroup`) — solo per aggiungere il bot, non per invitare la controparte

### Nel gruppo (dopo che buyer + seller ci sono già)

5. Promuovi il bot ad **amministratore**
6. `/avvia` (chi ha creato il deal in privato)
7. Controparte tocca **Confermo**
8. Bot mostra importo, indirizzo escrow **mock**, comandi
9. `/depositato` → `/pay_seller` / `/refund_buyer` (doppia conferma)
10. `/dispute` → notifica admin + link one-time (solo per l’admin)

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
