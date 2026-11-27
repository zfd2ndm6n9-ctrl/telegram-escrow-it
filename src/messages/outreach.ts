/**
 * Copy outreach IT (admin `/outreach escrow|seller`).
 * HTML + tg-emoji (custom animated) — link nel body, niente InlineKeyboard.
 * Inoltra così com’è; preview Telegram sul t.me/<bot>.
 */

export const OUTREACH_BOT_USERNAME = "ESCROWITAbot";

export type OutreachAudience = "escrow" | "seller";

/** RestrictedEmoji / NewsEmoji — verificati via getCustomEmojiStickers. */
export const OUTREACH_EMOJI = {
  wave: { id: "5472055112702629499", alt: "👋" },
  sparkles: { id: "5472164874886846699", alt: "✨" },
  gem: { id: "5471952986970267163", alt: "💎" },
  handshake: { id: "5357080225463149588", alt: "🤝" },
} as const;

/** HTML entity: animated custom emoji con fallback Unicode. */
export function tgEmoji(
  kind: keyof typeof OUTREACH_EMOJI,
): string {
  const { id, alt } = OUTREACH_EMOJI[kind];
  return `<tg-emoji emoji-id="${id}">${alt}</tg-emoji>`;
}

/** Messaggio 1 — escrow / MM umani. */
export const OUTREACH_ESCROW_BODY = `\
${tgEmoji("wave")} Ciao — siamo <b>Escrowita</b> (@ESCROWITAbot).

Troppe richieste che pagano poco e ti mangiano le ore? ${tgEmoji("sparkles")}
Le parti usano il <b>tuo codice invito</b>: noi gestiamo la custodia, tu resti nel loop. ${tgEmoji("handshake")}

https://t.me/ESCROWITAbot`;

/** Messaggio 2 — seller / admin community. */
export const OUTREACH_SELLER_BODY = `\
${tgEmoji("wave")} Ciao — siamo <b>Escrowita</b> (@ESCROWITAbot).

Per seller e admin: i tuoi utenti verificano chiave e indirizzo sul bot; tu guadagni una quota con un <b>codice invito</b>. ${tgEmoji("gem")}

Disponibile <b>24/7</b>, rilascio e rimborso con <b>doppia conferma</b>. Fee <b>5%</b> (con invito <b>2.5% / 2.5%</b>).

https://t.me/ESCROWITAbot`;

/** Uso admin: messaggio inoltrabile (solo link + emoji, niente bottone). */
export const OUTREACH_USAGE =
  "Uso (admin, DM): `/outreach escrow` oppure `/outreach seller`\n" +
  "Ricevi *un messaggio* con link `t.me` + emoji animate — Inoltra così com’è.";

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
