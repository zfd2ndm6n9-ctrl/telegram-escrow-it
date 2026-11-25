# Gruppi escrow creati dal servizio

> Dettaglio limiti Telegram + decisione prodotto: store `docs/bot-owned-groups.md` (BET-102).

## Path preferito (default)

1. `/crea` in privato → ruolo → crypto → termini  
2. **Helper MTProto** crea un megagroup privato (la Bot API **non** può creare gruppi)  
3. Helper = owner (account di servizio, non una parte)  
4. Bot promosso admin con diritti forti (incluso promote → demote parti)  
5. DM con **due link invito** (`member_limit: 1`): creator + controparte  
6. Parti entrano come **membri** → `/avvia` / auto-bind  

`TELEGRAM_BOT_CREATES_GROUPS` è **on** di default. Imposta `0` solo per forzare il path manuale legacy.

| Env | Ruolo |
|-----|--------|
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | App su [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_HELPER_SESSION` | Session string (`npm run helper:login`) |
| `TELEGRAM_BOT_CREATES_GROUPS` | Default on; `0`/`false` = solo manuale |

Senza helper: messaggio chiaro sul limite Bot API + istruzioni manuali **di emergenza** (owner umano = rischio kick/delete).

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
