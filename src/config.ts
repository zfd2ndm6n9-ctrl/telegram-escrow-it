import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Variabile d'ambiente mancante: ${name}. Copia .env.example in .env oppure esporta la variabile.`,
    );
  }
  return value;
}

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
  adminTelegramId: process.env.ADMIN_TELEGRAM_ID?.trim() || undefined,
  /** Indirizzo escrow mock finché il wallet reale non è pronto */
  mockEscrowAddress: "TXescrowMockUSDTAddressItalyMVP0001",
  defaultAsset: "USDT" as const,
  dataDir: process.env.DATA_DIR?.trim() || "data",
  /** Impostato a runtime dopo getMe() */
  botUsername: undefined as string | undefined,
};

export function assertConfig(): void {
  requireEnv("TELEGRAM_BOT_TOKEN");
}
