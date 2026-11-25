# Gruppi escrow creati dal servizio

> Dettaglio limiti Telegram + decisione prodotto: store `docs/bot-owned-groups.md` (BET-102 / BET-103).

## Path preferito (default)

1. `/crea` in privato → ruolo → crypto → termini  
2. **Helper MTProto** crea un megagroup privato (la Bot API **non** può creare gruppi)  
3. Helper = **owner** (account supporto di Francesco, non una parte)  
4. Bot promosso admin con diritti forti (incluso promote → demote parti)  
5. DM creator: «Il tuo gruppo è stato creato» + link clickable (`member_limit: 1`)  
6. Nel gruppo: testo **Entra come buyer** / **Entra come seller** + invite link (ruolo opposto al wizard; niente bottone Invita)  
7. Parti entrano come **membri** → auto-bind / `/avvia`  
8. Helper/support (`ADMIN_TELEGRAM_ID(S)`) **non** è mai buyer/seller — solo le due parti dei link

`TELEGRAM_BOT_CREATES_GROUPS` è **on** di default. Imposta `0` solo per forzare il path manuale legacy.

| Env | Ruolo |
|-----|--------|
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | App su [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_HELPER_SESSION` | Session string (`npm run helper:login`) |
| `TELEGRAM_BOT_CREATES_GROUPS` | Default on; `0`/`false` = solo manuale |
| `DISPUTE_ADMIN_NOTIFY` | Default **off**. `1` = DM admin su ogni disputa |

Senza helper: messaggio chiaro sul limite Bot API + istruzioni manuali **di emergenza** (owner umano = rischio kick/delete).

## Alert admin

| Evento | DM admin |
|--------|----------|
| Disputa aperta | **No** (default). Operatore apre il gruppo helper quando vuole. |
| Bot kick / gruppo cancellato / wipe card / admin kickato | **Sì** (critico) |

## Path manuale (degradato)

1. L’utente crea un gruppo privato  
2. Aggiunge il bot come amministratore (Elimina messaggi, Blocca utenti, Invita utenti)  
3. Nel gruppo: `/avvia`  
4. Deal marcato `groupCreatedVia: manual` — la parte creatrice resta **owner** Telegram  

## Permessi bot (admin)

Obbligatori per `/avvia`: Elimina messaggi, Blocca utenti, Invita utenti.

Su gruppi helper il bot ha anche **promuovi membri** per demote automatico se una parte viene promossa admin.

## Harden membri + igiene

- Membri senza change info / invite / pin / stickers inline  
- Kick umani extra (oltre buyer/seller; admin solo in disputa)  
- Kick bot non autorizzati  
- Su `groupCreatedVia: helper`: demote admin umani editabili (parti restano membri)  
- Alert se buyer/seller cambiano username o nome  

## Limiti onesti

| Limite | Mitigazione |
|--------|-------------|
| Bot API non crea gruppi | Helper MTProto |
| Bot non può essere owner | Helper owner + bot admin + demote parti |
| Owner umano (path manuale) | Evitare; warning in DM; compromise freeze se kick bot |
| Helper owner | Proteggi `TELEGRAM_HELPER_SESSION` come secret di produzione |

---

## Operator guide (Francesco) — login una volta + Render

### A. Login helper (una volta, in locale)

1. Apri [my.telegram.org](https://my.telegram.org) → **API development tools** → crea un’app.  
2. Annota `api_id` e `api_hash`.  
3. Usa l’account Telegram di **supporto** (quello che deve restare owner di ogni deal group).  
4. In clone del repo:

```bash
export TELEGRAM_API_ID=…
export TELEGRAM_API_HASH=…
npm run helper:login
```

5. Inserisci telefono (+39…), codice Telegram, eventuale 2FA.  
6. Copia la riga `TELEGRAM_HELPER_SESSION=…` stampata (è un secret: non committare).

### B. Env su Render (Background Worker)

Dashboard → servizio bot → **Environment** → aggiungi (o aggiorna):

| Key | Value |
|-----|--------|
| `TELEGRAM_API_ID` | da my.telegram.org |
| `TELEGRAM_API_HASH` | da my.telegram.org |
| `TELEGRAM_HELPER_SESSION` | output di `helper:login` |

Opzionali:

- `TELEGRAM_BOT_CREATES_GROUPS` — lascia assente / non `0` (default on).  
- `DISPUTE_ADMIN_NOTIFY` — **non** impostare (default off = niente spam disputa).  
- `ADMIN_TELEGRAM_IDS` — resta utile per `/deal`, force payout, alert critici.

Salva → **Manual Deploy** del worker su `main` (include PR **#74** + **#75** e follow-up quiet alerts).

### C. Verifica dopo deploy

Nei log del worker cerca:

- `Creazione gruppi ON: helper MTProto pronto`  
- `Dispute admin DM: OFF (default)`  

Poi un `/crea` di prova: il gruppo deve apparire sotto l’account helper come **owner**; bot admin; parti solo membri.
