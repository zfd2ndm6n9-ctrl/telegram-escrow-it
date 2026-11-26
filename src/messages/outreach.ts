/**
 * Copy outreach IT (admin `/outreach escrow|seller`).
 * Markdown legacy Telegram — niente `_` non escapati nei testi.
 * Asset: solo SOL (niente LTC/ETH in pitch).
 */

export const OUTREACH_BOT_USERNAME = "ESCROWITAbot";

export type OutreachAudience = "escrow" | "seller";

/** Messaggio 1 — escrow / MM umani. */
export const OUTREACH_ESCROW_BODY = `\
Ciao — *Escrowita* (@ESCROWITAbot) è l’escrow automatico in italiano su *SOL*.

Se sei un escrow o un MM e ti arrivano tante richieste che ti mangiano tempo, puoi passarle al bot: le parti usano il *tuo codice invito* e tu resti nel loop senza fare da custode h24.

Quando vuoi, apri il bot e prova un deal di test.`;

/** Messaggio 2 — seller / admin community. */
export const OUTREACH_SELLER_BODY = `\
*Escrowita* (@ESCROWITAbot) — escrow automatico italiano per deal in *SOL*.

• Fiducia: fondi bloccati nel bot, non in un MM umano
• Disponibile *24/7*
• Rilascio e rimborso con *doppia conferma*
• Niente exit-scam umano: la custodia è del protocollo bot
• Fee trasparente: *5%* a release (con codice invito si divide *2.5% / 2.5%*)

Per seller e admin di community che vogliono proteggere i deal senza fare da garante a mano.`;

export const OUTREACH_BUTTON_LABEL = "Apri @ESCROWITAbot";

export const OUTREACH_USAGE =
  "Uso (admin, DM): `/outreach escrow` oppure `/outreach seller`\n" +
  "Ricevi il messaggio + bottone da inoltrare.";

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

export function outreachBody(audience: OutreachAudience): string {
  return audience === "escrow" ? OUTREACH_ESCROW_BODY : OUTREACH_SELLER_BODY;
}
