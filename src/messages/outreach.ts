/**
 * Copy outreach IT (admin `/outreach escrow|seller`).
 * Markdown legacy Telegram — niente `_` non escapati nei testi.
 * Un solo messaggio con URL in testo → Inoltra pulito (niente bottone obbligatorio).
 */

export const OUTREACH_BOT_USERNAME = "ESCROWITAbot";

export type OutreachAudience = "escrow" | "seller";

/** Messaggio 1 — escrow / MM umani. */
export const OUTREACH_ESCROW_BODY = `\
Ciao, siamo *Escrowita* (@ESCROWITAbot).

Se fai escrow o MM e ti arrivano tante richieste che pagano poco ma ti mangiano ore, c’è un modo più leggero: le parti usano il *tuo codice invito* e lasciamo che ce ne occupiamo noi.

Tu resti nel loop; noi gestiamo la custodia. Niente notti a fare da garante.

Quando vuoi dare un’occhiata: https://t.me/ESCROWITAbot`;

/** Messaggio 2 — seller / admin community. */
export const OUTREACH_SELLER_BODY = `\
Ciao, siamo *Escrowita* (@ESCROWITAbot).

Per seller e admin di community: i tuoi utenti possono verificare chiave e indirizzo escrow sul bot, e tu guadagni una quota senza dover fare nulla — basta condividere un *codice invito*.

Disponibile *24/7*, rilascio e rimborso con *doppia conferma*. Fee trasparente: *5%* a release (con invito si divide *2.5% / 2.5%*).

Quando vuoi: https://t.me/ESCROWITAbot`;

/** Uso admin: un messaggio inoltrabile (link nel body). */
export const OUTREACH_USAGE =
  "Uso (admin, DM): `/outreach escrow` oppure `/outreach seller`\n" +
  "Ricevi *un solo messaggio* con il link nel testo — Inoltra così com’è.";

export function outreachBotUrl(botUsername?: string): string {
  const user = (botUsername ?? OUTREACH_BOT_USERNAME).replace(/^@/, "");
  return `https://t.me/${user}`;
}

export function resolveOutreachAudience(
  raw: string | undefined,
): OutreachAudience | undefined {
  const key = (raw ?? "").trim().toLowerCase();
  if (key === "escrow" || key === "mm" || key === "escrows") return "escrow";
  if (
    key === "seller" ||
    key === "sellers" ||
    key === "admin" ||
    key === "community" ||
    key === "admins"
  ) {
    return "seller";
  }
  return undefined;
}

export function outreachBody(
  audience: OutreachAudience,
  botUsername?: string,
): string {
  const base =
    audience === "escrow" ? OUTREACH_ESCROW_BODY : OUTREACH_SELLER_BODY;
  const url = outreachBotUrl(botUsername);
  if (url === "https://t.me/ESCROWITAbot") return base;
  // Se il bot username runtime differisce, allinea il link nel body.
  return base.replaceAll("https://t.me/ESCROWITAbot", url);
}
