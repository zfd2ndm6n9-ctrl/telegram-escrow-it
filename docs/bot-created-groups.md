# Gruppi escrow creati dal bot

## Perché un account helper

La **Telegram Bot API non può creare gruppi**. CoinXpert-style: un **account user MTProto** (helper) crea il supergroup, promuove il bot ad admin, genera il link invito. Il bot grammY resta il runtime del deal.

Variabili:

| Env | Ruolo |
|-----|--------|
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | App su [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_HELPER_SESSION` | Session string (`npm run helper:login`) |

## Flusso dopo `/crea`

1. Ruolo → crypto → importo SOL  
2. Helper: `channels.createChannel` (megagroup)  
3. Helper: `channels.editAdmin` → bot con diritti forti  
4. Default banned rights + `setChatPermissions` (membri senza change info / invite / pin)  
5. Tentativo invite creator (se ha username); sempre **link invito** in DM (`member_limit: 2`)  
6. Auto-start: conferma controparte nel gruppo (`/avvia` resta fallback)

## Permessi bot (admin)

Impostati via MTProto `ChatAdminRights`:

- `changeInfo`, `deleteMessages`, `banUsers`, `inviteUsers`, `pinMessages`
- `manageCall`, `manageTopics`, `other`
- `postMessages` / `editMessages` (canali; innocui in gruppo)
- **`addAdmins: false`** — le parti non ricevono ownership/admin

## Harden membri

Vietato ai non-admin: cambiare info, invitare liberamente, pinnare, poll/stickers/inline, ecc. Consentito: messaggi di testo (+ foto/documenti per wallet/screenshot).

I membri **non** hanno `can_delete_messages` (solo admin): non possono cancellare i messaggi altrui.

## Cosa Telegram non può impedire

| Limite | Mitigazione |
|--------|-------------|
| Owner del gruppo = **account helper**, non il buyer/seller | Helper dedicato; non promuovere le parti ad admin |
| L’owner (helper) può ancora eliminare il gruppo | Proteggi session/telefono helper; non condividere |
| Privacy utente può bloccare l’add diretto del creator | Link invito in DM (path principale) |
| Link invito inoltrato a terzi | `member_limit: 2` + kick extra dopo 2 party |
| Controparte può lasciare / spam-report | Processo disputa + admin |
| Compromissione helper o bot token | Secret solo su Render; ruota session se sospetto |
| Bot API senza helper → niente create group | Deploy richiede le 3 env helper |

## Legacy

`/avvia` (e `?startgroup=`) restano per gruppi già esistenti o recovery. Il path UX primario **non** chiede più «crea il gruppo / aggiungi il bot».
