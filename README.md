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
# Imposta TELEGRAM_BOT_TOKEN, SOLANA_PRIVATE_KEY, opzionalmente ADMIN_TELEGRAM_ID(S)
npm run solana:keygen   # genera keypair; salva secret offline / su Render
```

### Variabili d'ambiente (Render)

| Variabile | Obbligatoria | Descrizione |
|-----------|--------------|-------------|
| `TELEGRAM_BOT_TOKEN` | sì | Token BotFather |
| `SOLANA_PRIVATE_KEY` | sì (per escrow) | Secret hot wallet: **base58** o **JSON array** (64 byte). Solo env Render. Master = fee-payer + fee 5% default |
| `FEE_WALLET_PUBKEY` | sì in prod | Fee 5% release → `57fv8agNAjcsaLgodeNDjexTo5azsJpjLyMigaZnfVNP`. Se assente = master |
| `SOLANA_RPC_URL` | no | RPC mainnet. Default pubblico. Consigliato: Helius / QuickNode / Alchemy |
| `SOLANA_WATCH_INTERVAL_MS` | no | Poll depositi (default `20000`) |
| `ADMIN_TELEGRAM_ID` | sì in prod | User id admin (dispute + `/log` + force + `/iscritti` + `/codice` + `/admin_wipe_deals`) |
| `ADMIN_TELEGRAM_IDS` | no | Lista admin (csv). Unita a `ADMIN_TELEGRAM_ID` |
| `PUBLIC_BASE_URL` | sì in prod (Web) | Host HTTPS del servizio (es. `https://….onrender.com`). Mini App ToS = `/tos`. Fallback: `RENDER_EXTERNAL_URL` |
| `TOS_URL` | no | Override URL Mini App (default `${PUBLIC_BASE_URL}/tos`) |
| `DATA_DIR` | sì in prod | Store deal + iscritti + inviti + log dispute (`deals.json`, `members.json`, `invites.json`, `deal-logs.json`, `vouch-tos-pin.json`). Render: `/var/data` |
| `UPDATES_CHANNEL_ID` | no | Canale pubblico «N iscritti» (id `-100…` o `@nome`). Bot admin del canale |
| `UPDATES_CHANNEL_MESSAGE_ID` | no | Message id vivente da editare; se assente → aggiorna *description* del canale |
| `VOUCH_CHANNEL_ID` | no (sì in prod) | Canale vouch + **gate /crea** + teaser ToS pinnato (id `-100…` preferito). Bot **admin** + Post + Pin + `getChatMember`. Id: inoltra un msg del canale a `@userinfobot` / `@getidsbot` |
| `VOUCH_INVITE_LINK` | no | Invite mostrato a `/start`. Default `https://t.me/+tww-HqO8htBiMzdk` (override su Render se ruoti il link) |
| `PORT` | no | Se impostato: `GET /healthz` + `GET /tos` (Render/Fly) |
| `TELEGRAM_BOT_CREATES_GROUPS` | no | `1` per tentare create automatica gruppo (default off) |
| `TELEGRAM_API_ID` / `HASH` / `HELPER_SESSION` | no | Solo con gate sopra; altrimenti soft-fallback manuale |

Documentazione: [`docs/TOS.md`](./docs/TOS.md) (Termini; Mini App `/tos`) · [`docs/solana-escrow.md`](./docs/solana-escrow.md) · [`docs/bot-created-groups.md`](./docs/bot-created-groups.md).

**ToS in Telegram:** «Leggi i Termini» apre una **Web App** (`web_app`) su `/tos`. Sul canale vouch: teaser corto pinnato — al boot solo re-pin se esiste `DATA_DIR/vouch-tos-pin.json` (mai un nuovo post); creare/sostituire solo con admin `/pin_tos`. Dopo Manual Deploy imposta `PUBLIC_BASE_URL` se non c’è già `RENDER_EXTERNAL_URL`.

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

1. `/start` → iscrizione (anche senza `@`: «utente» + soft remind) → entra nel **canale reviews** (hard gate) → `/crea`
2. Ruolo (*buyer* / *seller*) → crypto (*SOL* live; ETH/LTC presto) — **niente wallet in DM**
3. Chi apre (`/crea`) risponde alle **3 domande** termini in DM (Prodotto → Prezzo € → Condizioni), poi istruzioni gruppo → bot admin → `/avvia`

### Nel gruppo

4. `/avvia` → chiede *Buyer* o *Seller* (ruolo mancante) di entrare/scrivere. Soft `@` + canale vouch solo per chi apre (`/crea`); controparte: Accetta / `/wallet` / release senza `/start`
5. *ToS*: card con *Accetta* o *Proponi i ToS* (la controparte). Proponi → stesse 3 domande *nel gruppo* (igiene Q+A); si scambiano finché uno Accetta (lock €→SOL)
6. Wallet **seller**, poi **buyer** (`/wallet` o indirizzo in chiaro)
7. Indirizzo escrow (verifica solo nei messaggi del bot) → buyer deposita SOL
8. Rilevamento automatico → seller *Ho spedito* → buyer *Paga* (dual-confirm; alias silenti `/payseller` per admin)
9. Dopo 2/2 **paga-seller** (non rimborso): review breve seller → buyer → **un** post vouch (Prodotto/Prezzo/Condizioni + review @) → release on-chain (seller 95% + fee 5%). Refund: payout immediato senza review
10. `/dispute` / `/support` → stato `disputed`, link one-time all’admin; admin forza release/refund on-chain (salta review)

Altri: `/indirizzo`, `/stato`, `/blockchain`, `/miei` (privato, solo deal *conclusi* `released`/`refunded`), `/invito CODICE`.  
Admin: `/log #dealId` (DM), `/iscritti`, `/codice`, `/codici`, `/fee`, `/admin_wipe_deals` (DM: svuota `deals.json` + `deal-logs.json`; con saldi escrow richiede `FORCE`).

### Log dispute (`/log`) — privacy

- Mentre un deal è attivo, il bot **trattiene** i testi delle parti nel gruppo (user-to-user) + eventi chiave (wallet, spedito, disputa, payout). **Non** i prompt effimeri del bot.
- Quando l’igiene cancella un messaggio utente, resta la copia locale (`[del]` nel transcript).
- **Solo admin** (DM): `/log #250538a0` o `/log 250538a0`.
- Cap: max **200** voci/deal; retention **30 giorni** dall’ultimo aggiornamento del bucket (`deal-logs.json` in `DATA_DIR`).
- Scopo: supporto dispute se qualcuno cancella messaggi in chat. Non è archivio completo né sostituto di processo legale.

### Branding gruppi

- Alla prima `/avvia` il bot imposta la **foto del gruppo** (`assets/escrowita-group.png` via `setChatPhoto`, una volta per deal). Soft-fail se manca `can_change_info`.
- La **foto profilo del bot** non è impostabile via API: caricala a mano su [@BotFather](https://t.me/BotFather) con lo stesso PNG (canale + bot).

### Igiene anti-truffa

- Kick utenti extra e bot non autorizzati
- Blocco messaggi inoltrati (delete se possibile)
- Avviso se buyer/seller cambiano nome o username
- Wallet: delete prompt + risposta utente, poi step successivo (niente conferma flash)

### Modello deposito

- **Indirizzo univoco per deal** (HMAC dalla master key → keypair derivata)
- Fee di rete pagate dalla **master** al payout (ricarica la master con poco SOL)
- Fee servizio **5%** solo su release (2.5%+2.5% se invito collaboratore); **0** su refund

## Test deal piccolo (mainnet)

1. `npm run solana:keygen` → salva secret su Render come `SOLANA_PRIVATE_KEY`
2. Invia **~0.05 SOL** alla **pubkey master** (solo per fee tx)
3. Deploy / restart del worker (**Manual Deploy**)
4. Su Telegram: `/crea` → buyer → SOL → `0.01`
5. Crea gruppo privato → aggiungi bot admin → `/avvia` → invita controparte (scrive un messaggio per bind). Hai *10 minuti* dopo le istruzioni DM; oltre → deal auto-annullato, rifai `/crea`.
6. Termini DM opener → controparte *Accetta* (o *Proponi i ToS*) → `/wallet` seller poi buyer
7. Invia `0.01 SOL` all’indirizzo mostrato da `/indirizzo`
8. Attendi “deposito rilevato” → ship → *Paga* (dual-confirm)

### Persistenza e recovery

- Su Render serve **Persistent Disk** + `DATA_DIR=/var/data` (vedi `render.yaml`): senza volume i deal spariscono al redeploy, i fondi restano sull’escrow derivato.
- Recovery one-shot (stessa master key, senza ricreare il deal Telegram):

```bash
npm run recover:escrow -- --deal 82978c05
npm run recover:escrow -- --deal 82978c05 --to seller --execute

# Bulk: tutti i deal in DATA_DIR + orfani noti → dry-run, poi sweep 0-fee
npm run recover:escrow:bulk -- --to FEE_WALLET_PUBKEY
npm run recover:escrow:bulk -- --to FEE_WALLET_PUBKEY --execute
```

- Admin in gruppo: `/ripristina 82978c05` · `/admin_payout 82978c05 seller`
- Soft-launch cleanup store (DM admin): `/admin_wipe_deals` → anteprima → `/admin_wipe_deals CONFERMA` (o `CONFERMA FORCE` se escrow on-chain ancora finanziati; i SOL restano sull’indirizzo derivato)

Dettagli: [`docs/solana-escrow.md`](./docs/solana-escrow.md).

## Limiti

- Hot wallet custodial (rischio chiave / exit)
- Store file-based: senza Persistent Disk su Render i deal non sopravvivono al redeploy
- Niente LTC/ETH ancora; niente fiat/SEPA
- Niente partial pay / community / marketplace

## Licenza

ISC
