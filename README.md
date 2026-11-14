# telegram-escrow-it

Bot Telegram di **escrow crypto** per il mercato italiano.

- Solo chat privata con il bot (niente gruppi deal)
- UI in italiano
- Solo crypto in MVP (asset placeholder: **USDT**)
- Le parti si conoscono già; il bot media il deal

Stack: **Node.js + TypeScript + [grammY](https://grammy.dev)** · store JSON su disco (`data/deals.json`)

## Requisiti

- Node.js 20+
- Un bot creato con [@BotFather](https://t.me/BotFather)
- Token in `TELEGRAM_BOT_TOKEN` (mai committare il token)

## Setup

```bash
git clone https://github.com/zfd2ndm6n9-ctrl/telegram-escrow-it.git
cd telegram-escrow-it
npm install
cp .env.example .env
# Modifica .env e inserisci TELEGRAM_BOT_TOKEN (e opzionalmente ADMIN_TELEGRAM_ID)
```

### Variabili d'ambiente

| Variabile | Obbligatoria | Descrizione |
|-----------|--------------|-------------|
| `TELEGRAM_BOT_TOKEN` | sì | Token del bot da BotFather / secret Cursor |
| `ADMIN_TELEGRAM_ID` | no | User id numerico admin per notifiche `/dispute` |
| `DATA_DIR` | no | Cartella store (default `data`) |

In Cursor Cloud Agent, `TELEGRAM_BOT_TOKEN` può essere già disponibile come secret: usa `process.env.TELEGRAM_BOT_TOKEN` senza stamparlo.

## Avvio (polling)

Sviluppo con reload:

```bash
npm run dev
```

Produzione:

```bash
npm run build
npm start
```

All’avvio il bot chiama `getMe` e stampa lo username (es. `@NomeBot`). Modalità **polling** (niente webhook in questo scaffold).

## Flusso MVP

1. `/start` — benvenuto in italiano + menu
2. `/crea` o «Crea deal» — importo USDT + controparte (`@username` o id)
3. Controparte conferma (link `t.me/<bot>?start=deal_<id>` o pulsante)
4. Bot mostra indirizzo escrow **mock**
5. «Segna depositato» (stub, nessuna verifica on-chain)
6. Release / rimborso con **doppia conferma** (pulsanti)
7. `/dispute <id>` — stato disputa + notifica admin se `ADMIN_TELEGRAM_ID` è impostato

Altri comandi: `/miei`, `/deal <id>`, `/aiuto`

## Struttura

```
src/
  index.ts           # entrypoint polling
  bot.ts             # wiring grammY
  config.ts          # env
  types.ts
  context.ts         # session + store sul context
  store/deals.ts     # persistenza JSON
  handlers/          # comandi e callback
  keyboards/         # reply / inline keyboard
  messages/it.ts     # copy italiana
  services/          # parsing e regole deal
```

## Limiti dello scaffold

- Indirizzo escrow e release/refund sono **stub** (nessun wallet reale)
- Nessuna detection automatica del deposito on-chain
- Store locale file-based (ok per demo; non multi-istanza)
- Nessun KYC / fiat / SEPA

Vedi il piano post-scaffold in `docs` del project store (`mvp-plan.md`).

## Licenza

ISC
