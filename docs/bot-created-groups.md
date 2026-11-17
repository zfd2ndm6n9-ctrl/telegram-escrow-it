# Gruppi escrow (manuale + helper opzionale)

## Path felice (default)

1. `/crea` in privato → ruolo → crypto → importo  
2. L’utente crea un **gruppo privato**  
3. Aggiunge il bot come **amministratore** (Elimina messaggi, Blocca utenti, Invita utenti)  
4. Nel gruppo: `/avvia`  
5. Invita solo la controparte  

**`TELEGRAM_HELPER_SESSION` non è richiesta** per questo flusso.

## Creazione automatica (opzionale)

La Bot API non può creare gruppi. Con gate esplicito + account helper MTProto il bot può creare il supergroup dopo `/crea`.

| Env | Ruolo |
|-----|--------|
| `TELEGRAM_BOT_CREATES_GROUPS=1` | Abilita il tentativo di create automatica |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | App su [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_HELPER_SESSION` | Session string (`npm run helper:login`) |

Se il gate è on ma helper manca o fallisce → **soft-fallback**: deal già creato + istruzioni manuali (non si rompe `/crea`).

## Flusso automatico (solo se gate + helper ok)

1. Helper: `channels.createChannel` (megagroup)  
2. Helper: `channels.editAdmin` → bot con diritti forti  
3. Default banned rights + `setChatPermissions`  
4. Link invito in DM (`member_limit: 2`)  
5. Auto-start conferma controparte  

## Permessi bot (admin)

Obbligatori per `/avvia`: Elimina messaggi, Blocca utenti, Invita utenti.

Per titolo gruppo + foto branding (`setChatTitle` / `setChatPhoto`): serve anche **Cambia info del gruppo** (`can_change_info`). Se manca, setup e escrow proseguono comunque (soft-fail + log).

## Foto profilo gruppo (Escrowita)

Alla prima `/avvia` / bind riuscito il bot carica `assets/escrowita-group.png` via `setChatPhoto` (una volta per deal; flag `groupPhotoSetAt`). Non viene ri-caricata a ogni rename.

### Foto profilo del bot (BotFather) — manuale

La Bot API **non** può impostare la foto profilo del bot. Francesco carica lo stesso PNG (`assets/escrowita-group.png` / media store) in [@BotFather](https://t.me/BotFather) → bot → Edit Bot → Edit Botpic (e sul canale, se serve).

## Harden membri + igiene

- Membri senza change info / invite / pin / stickers inline  
- Kick umani extra (oltre buyer/seller; admin solo in disputa)  
- Kick bot non autorizzati  
- Messaggi inoltrati: cancellati se possibile + avviso  
- Alert se buyer/seller cambiano username o nome  

## Cosa Telegram non può impedire

| Limite | Mitigazione |
|--------|-------------|
| Owner = chi ha creato il gruppo (parti) | Bot admin obbligatorio; non promuovere altri bot |
| Link invito inoltrato | Kick extra + avviso forward |
| Compromissione bot token | Secret solo su Render |
| Helper owner (solo path automatico) | Gate off di default; proteggi session helper |
