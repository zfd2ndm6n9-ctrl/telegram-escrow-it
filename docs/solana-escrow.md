# Solana MAINNET escrow — telegram-escrow-it

**Per:** Francesco  
**Asset MVP:** SOL (mainnet). Roadmap: LTC → ETH. Niente USDT.  
**Secret:** solo env Render — mai repo / store / chat lunga durata se evitabile.

## Modello scelto (MVP)

**Indirizzo deposito univoco per deal** (account derivati), non pooled wallet.

| | Derived per-deal (scelto) | Pooled + memo/importo |
|--|---------------------------|------------------------|
| Matching deposito | Chiaro (1 address = 1 deal) | Fragile (collisioni importo / memo mancante) |
| Complessità | HMAC(master, dealId) → seed | Più semplice a creare, più ambigua a riconciliare |
| Chiavi extra in DB | No (ricalcolo runtime) | No |
| Sweep / payout | Firma con keypair derivata; fee da master | Un solo account da gestire |
| Rischio | Master compromessa ⇒ tutti i deal | Idem + attribution errors |

**Perché derived:** per un MVP “soldi veri” l’errore più costoso è accreditare il deposito sbagliato. Unique address evita matching per importo.

### Come funziona

1. `SOLANA_PRIVATE_KEY` = master hot wallet (base58 o JSON array)
2. Per deal `id`: `HMAC-SHA256(masterSecret, "telegram-escrow-it:deal:"+id)` → 32 byte seed → keypair
3. Buyer invia SOL a quell’indirizzo
4. Watcher (~20s) o `/depositato` (verifica saldo) → `funded` se saldo ≥ importo
5. Dual-confirm `/pay_seller` (alias `/payseller`) / `/refund_buyer` (alias `/refundbuyer`) (o admin in disputa)
6. **Release:** una tx atomica — **95%** → seller, **5%** fee piattaforma. Se il deal ha invito collaboratore: **2.5%** → master/`FEE_WALLET_PUBKEY`, **2.5%** → wallet collaboratore. **Refund:** 100% → buyer (nessuna fee servizio)
7. **Fee di rete** pagate dalla **master** (`feePayer`): ricarica la master con poco SOL (es. 0.05)
8. Payout: `getLatestBlockhash("confirmed")` + stesso `preflightCommitment`, con retry su #7050008 (Blockhash not found). Contabilità idempotente (`payoutCompleted` + `payoutTxSig`)

## Avviso rischio

- Custodial durante l’escrow: chi ha `SOLANA_PRIVATE_KEY` muove i fondi
- Hot wallet su Render: compromissione env = perdita fondi
- **Inizia con test piccoli** (es. 0.01 SOL)
- RPC pubblico mainnet è rate-limited: in prod usa provider dedicato

## Env vars da impostare su Render

Sul **Web Service** (o Background Worker) che esegue il bot — Environment:

| Nome | Obbligatorio | Valore |
|------|--------------|--------|
| `TELEGRAM_BOT_TOKEN` | sì | Token BotFather |
| `SOLANA_PRIVATE_KEY` | sì | Output di `npm run solana:keygen` (base58 **oppure** JSON array). Master = **fee-payer rete** (gas). Non è la destinazione fee servizio se `FEE_WALLET_PUBKEY` è settata |
| `FEE_WALLET_PUBKEY` | **sì in prod** | Destinazione fee piattaforma (5% release senza invito). **Render:** `FEE_WALLET_PUBKEY=57fv8agNAjcsaLgodeNDjexTo5azsJpjLyMigaZnfVNP`. Se assente = master pubkey |
| `SOLANA_RPC_URL` | consigliato | Es. Helius/QuickNode; default pubblico ok per test |
| `SOLANA_WATCH_INTERVAL_MS` | no | Default `20000` |
| `ADMIN_TELEGRAM_ID` | sì per dispute / codici | Tuo user id Telegram |
| `TOS_URL` | no | Link ToS |
| `DATA_DIR` | sì in prod | Persistenza deal + iscritti + inviti (`deals.json`, `members.json`, `invites.json`). Su Render: `/var/data` |
| `PORT` | auto su Web | Per `/healthz` |

### Generare la chiave (una tantum)

Esegui **in locale / su una macchina tua**, non in chat agent:

```bash
npm run solana:keygen
```

- Copia la **pubkey** (serve per ricaricare le fee sulla master — pochi SOL)
- Copia `SOLANA_PRIVATE_KEY` in Render → Environment → Save → restart
- **Non** salvare il secret nel repo, in `docs/`, né in transcript agent
- Se una chiave è stata stampata in un log agent, **scartala** e generane una nuova

All’avvio i log Render stampano:
- `Escrow SOL mainnet attivo. Master pubkey: …` ← address da finanziare per le **fee di rete**
- `Fee piattaforma (5% release): …` ← deve coincidere con `57fv8agNAjcsaLgodeNDjexTo5azsJpjLyMigaZnfVNP` se `FEE_WALLET_PUBKEY` è settata

## Test deal tiny mainnet

1. Deploy branch con Solana + env settate; restart worker
2. Master funded con ~0.05 SOL (solo fee)
3. Telegram: `/crea` → buyer → `0.01` (niente wallet in DM)
4. Gruppo + bot admin + `/avvia` → controparte Confermo → ToS creatore + Accetto → wallet seller poi buyer
5. Invia `0.01 SOL` a `/indirizzo`
6. Attendi “Deposito rilevato” (o «Verifica deposito»)
7. Entrambi `/pay_seller` → signature su [Solscan](https://solscan.io)
8. Prova anche `/refund_buyer` su un secondo micro-deal

## Persistenza deal (Render)

Il bot salva i deal in `DATA_DIR/deals.json`. Su Render **free** il disco è ephemeral: un Manual Deploy azzera lo store e i gruppi rispondono «nessun deal collegato», mentre i fondi restano sull’indirizzo escrow derivato (`HMAC(master, dealId)`).

1. Piano **starter+** con Persistent Disk montato (blueprint: `/var/data`)
2. Env `DATA_DIR=/var/data`
3. Non cambiare `SOLANA_PRIVATE_KEY` (stessa master → stessi indirizzi deal)

## Recovery escrow orfano (senza ricreare il deal Telegram)

I fondi non dipendono dallo store: con la **stessa** master key si ridériva la keypair e si può pagare.

```bash
# Dry-run: verifica derive + saldo (default)
npm run recover:escrow -- --deal 82978c05

# Paga il seller (fee 5%/2.5%) o rimborsa buyer (100%)
npm run recover:escrow -- --deal 82978c05 --to seller --execute
npm run recover:escrow -- --deal 82978c05 --to buyer --execute

# Indirizzo libero = sweep intero (nessuna fee servizio — recovery)
npm run recover:escrow -- --deal 82978c05 --to <PUBKEY> --execute
```

In produzione (dopo `npm run build`): `npm run recover:escrow:prod -- …`.

Admin in Telegram (dopo deploy):

- `/ripristina 82978c05` nel gruppo orfano → riscrive il deal nello store e collega il gruppo (conserva invite/fee se già nello store)
- `/admin_payout 82978c05 seller` (o `buyer`) → payout one-shot anche senza store

**Wallet lock:** dopo `awaiting_deposit` i wallet buyer/seller non si possono più cambiare via `/wallet` (anti-swap destinazione). In emergenza: `/dispute` + admin.

## Fee 5% + codici invito

**Destinazione fee piattaforma (prod):** `FEE_WALLET_PUBKEY=57fv8agNAjcsaLgodeNDjexTo5azsJpjLyMigaZnfVNP`  
(Render → Environment → Save → Manual Deploy / restart. Boot log: `Fee piattaforma (5% release): 57fv…`.)

| Path | Split |
|------|-------|
| Release senza invito | 95% seller · **5%** → `FEE_WALLET_PUBKEY` |
| Release con invito | 95% seller · **2.5%** → `FEE_WALLET_PUBKEY` · **2.5%** → wallet collaboratore |
| Refund | 100% buyer · **0** fee servizio |

### Creare un codice (admin)

```
/codice <WALLET_SOL_COLLAB> <@user|userId> [CODICE_OPZ]
```

Esempio: `/codice So111…abc @mario` → genera `ESC-XXXXXX`.  
L’utente: `/invito ESC-XXXXXX` (o dopo soft signup, oppure `/start ESC-XXXXXX`).  
I deal che **crea** ereditano il codice → split 2.5/2.5 alla release.

Altri comandi admin: `/codici` (lista), `/fee` (riepilogo fee da deal released).

Persistenza: `DATA_DIR/invites.json`.

## Admin

- In disputa: `/pay_seller` o `/refund_buyer` forza payout on-chain
- Emergenza: `/depositato force` (solo `ADMIN_TELEGRAM_ID`) marca `funded` senza saldo (non crea SOL)
- `/ripristina` · `/admin_payout` — recovery orfani (solo admin)
- `/codice` · `/codici` · `/fee` — inviti e fee summary

## Fuori scope (dopo)

- LTC / ETH
- KMS / cold / multi-sig
- Postgres / replica off-site del JSON
