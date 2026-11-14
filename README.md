# telegram-escrow-it

Bot Telegram di **escrow crypto** per il mercato italiano.

- Per ogni deal il bot prepara un **gruppo privato** (buyer + seller + bot)
- L’**admin** può entrare solo in disputa per arbitrare
- UI in italiano · solo crypto in MVP (asset placeholder: **USDT**)
- Le parti si conoscono già; il bot media il deal nel gruppo

Stack: **Node.js + TypeScript + [grammY](https://grammy.dev)** · store JSON (`data/deals.json`)

> Nota Bot API: i bot non possono creare gruppi da soli. Il flusso usa il deep link Telegram `?startgroup=` (l’utente conferma la creazione del gruppo con il bot già dentro), poi il bot genera un **invite link a 1 posto** per la controparte.

## Requisiti

- Node.js 20+
- Bot da [@BotFather](https://t.me/BotFather) — consigliato: **Group Privacy = Off** oppure bot sempre **admin** nel gruppo escrow
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

All’avvio: `getMe` + long-polling con update `message`, `callback_query`, `my_chat_member`, `chat_member`.

## Flusso MVP

### In privato con il bot

1. `/start` — benvenuto
2. `/crea` o «Crea escrow» — scegli ruolo (*buyer* / *seller*) e importo USDT
3. Pulsante **Crea gruppo escrow** (`t.me/<bot>?startgroup=d_<id>`)
4. Nel gruppo: promuovi il bot ad **amministratore** (invita + ban). Se serve: `/setup`

### Nel gruppo escrow

5. Il bot pubblica il **link invito controparte** (`member_limit: 1`)
6. Controparte entra → indirizzo escrow **mock**
7. «Segna depositato» / `/depositato` (stub, no on-chain)
8. `/pay_seller` o `/refund_buyer` — **doppia conferma** (oppure pulsanti)
9. `/dispute` — stato disputa, notifica admin + **link one-time** per entrare e arbitrare (`/pay_seller` / `/refund_buyer` da soli se admin)

Altri: `/indirizzo`, `/stato`, `/miei` (privato), `/aiuto`

### Protezioni base

- Invite controparte limitato a 1 posto
- Utenti extra (non buyer/seller/admin) → tentativo di **kick**
- Messaggi e comandi in italiano

## Struttura

```
src/
  index.ts              # polling + allowed_updates
  bot.ts
  config.ts
  types.ts
  store/deals.ts
  handlers/             # privato + lifecycle gruppo + comandi gruppo
  keyboards/
  messages/it.ts
  services/             # regole deal + setup gruppo
```

## Limiti dello scaffold

- Indirizzo escrow e payout sono **stub**
- Creazione gruppo via `startgroup` (non MTProto)
- Store file-based (non multi-istanza)
- Niente fiat/SEPA, niente KYC

## Licenza

ISC
