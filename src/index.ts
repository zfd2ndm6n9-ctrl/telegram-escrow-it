import { assertConfig, config } from "./config.js";
import { createBot } from "./bot.js";
import { startHealthServer } from "./health.js";
import {
  getMasterKeypair,
  getPlatformFeeWalletPubkey,
  isSolanaConfigured,
  startDepositWatcher,
} from "./services/solana/index.js";
import {
  getMtprotoHelper,
  isMtprotoHelperConfigured,
  stopMtprotoHelper,
} from "./services/mtproto-helper.js";
import { startGroupBindExpiryWatcher } from "./services/group-bind-expiry.js";
import { startGroupCloseCleanupWatcher } from "./services/group-close-cleanup.js";
import { startUsernameRefresh } from "./services/username-refresh.js";
import { ensureVouchTosPin } from "./services/vouch-tos-pin.js";

async function main(): Promise<void> {
  // Render Web Service: aprire PORT subito, prima di Telegram / assertConfig
  const portRaw = process.env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : 0;
  if (Number.isFinite(port) && port > 0) {
    await startHealthServer(port);
  } else {
    console.log("PORT non impostato: nessun health HTTP (ok in locale senza PaaS).");
  }

  assertConfig();

  if (isSolanaConfigured()) {
    const master = await getMasterKeypair();
    if (master) {
      console.log(
        `Escrow SOL mainnet attivo. Master pubkey: ${master.publicKey.toBase58()}`,
      );
      const feeWallet = await getPlatformFeeWalletPubkey();
      console.log(
        `Fee piattaforma (5% release): ${feeWallet ?? master.publicKey.toBase58()}` +
          (config.feeWalletPubkey ? " (FEE_WALLET_PUBKEY)" : " (= master)"),
      );
      console.log(
        "⚠️ Hot wallet: tieni solo importi di test piccoli. Secret solo su Render env.",
      );
    }
  } else {
    console.warn(
      "SOLANA_PRIVATE_KEY assente: /crea on-chain disabilitato finché non la imposti.",
    );
  }

  const { bot, store, members, invites, dealLogs } = createBot(config.botToken);
  console.log(
    `Persistenza deal: DATA_DIR=${store.dataDir} → ${store.path} (${store.size} deal). ` +
      "Su Render serve Persistent Disk: senza volume i deal spariscono al redeploy.",
  );
  console.log(
    `Persistenza iscritti: ${members.path} (${members.registeredCount} iscritti).`,
  );
  console.log(
    `Persistenza inviti: ${invites.path} (${invites.size} codici).`,
  );
  console.log(
    `Persistenza log dispute: ${dealLogs.path} (cap ${200} voci/deal, retention 30g).`,
  );
  if (config.adminTelegramIds.length) {
    console.log(
      `Admin ids: ${config.adminTelegramIds.join(", ")} (ADMIN_TELEGRAM_ID/S)`,
    );
  } else {
    console.warn(
      "Nessun ADMIN_TELEGRAM_ID / ADMIN_TELEGRAM_IDS: dispute notify e /log disabilitati.",
    );
  }
  if (config.updatesChannelId != null) {
    console.log(
      `Contatore pubblico: UPDATES_CHANNEL_ID=${config.updatesChannelId}` +
        (config.updatesChannelMessageId != null
          ? ` message=${config.updatesChannelMessageId}`
          : " (description)"),
    );
  } else {
    console.log(
      "UPDATES_CHANNEL_ID non impostato: conteggio iscritti solo via /iscritti (admin).",
    );
  }
  if (config.vouchChannelId != null) {
    console.log(
      `Vouch channel: VOUCH_CHANNEL_ID=${config.vouchChannelId} ` +
        `invite=${config.vouchInviteLink} ` +
        "(bot admin + Post; gate /crea via getChatMember)",
    );
  } else {
    console.error(
      "[vouch] VOUCH_CHANNEL_ID non impostato: review post-pay restano solo nel gruppo; " +
        "gate membership disattivato (dev). Imposta env + bot admin canale. " +
        `Invite ${config.vouchInviteLink}`,
    );
  }
  const me = await bot.api.getMe();
  config.botUsername = me.username;

  if (config.tosWebAppUrl) {
    console.log(`ToS Mini App: ${config.tosWebAppUrl} (web_app «Leggi i Termini»)`);
  } else {
    console.warn(
      "PUBLIC_BASE_URL / RENDER_EXTERNAL_URL / TOS_URL assenti: " +
        "«Leggi i Termini» userà il fallback corto in chat (niente Mini App).",
    );
  }

  // Soft boot: solo re-pin se esiste vouch-tos-pin.json in DATA_DIR — mai nuovo post.
  void ensureVouchTosPin(bot.api)
    .then((r) => {
      if (r.ok) {
        console.log(
          `[vouch-tos] pin ok msg=${r.messageId} reused=${r.reused} via=${r.via}`,
        );
      } else if (r.reason === "no_state") {
        console.warn(
          `[vouch-tos] soft-boot: nessun pin tracciato — skip post. Admin: /pin_tos` +
            (r.detail ? ` (${r.detail})` : ""),
        );
      } else if (r.reason !== "no_channel") {
        console.warn(
          `[vouch-tos] pin skip: ${r.reason}${r.detail ? ` (${r.detail})` : ""} — admin: /pin_tos`,
        );
      }
    })
    .catch((err) => {
      console.warn("[vouch-tos] pin boot error:", err);
    });

  if (config.telegramBotCreatesGroups) {
    if (isMtprotoHelperConfigured()) {
      try {
        await getMtprotoHelper();
      } catch (err) {
        console.warn(
          "TELEGRAM_BOT_CREATES_GROUPS=1 ma helper MTProto non disponibile (soft-fallback a gruppo manuale):",
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      console.warn(
        "TELEGRAM_BOT_CREATES_GROUPS=1 ma mancano TELEGRAM_API_ID/HASH/HELPER_SESSION: path felice = gruppo manuale + /avvia.",
      );
    }
  } else {
    console.log(
      "Creazione automatica gruppi OFF (default). Path felice: gruppo privato → bot admin → /avvia. Gate: TELEGRAM_BOT_CREATES_GROUPS=1.",
    );
  }

  const watcher = startDepositWatcher(
    store,
    bot.api,
    Number.isFinite(config.solanaWatchIntervalMs)
      ? config.solanaWatchIntervalMs
      : 20_000,
  );

  const groupBindExpiry = startGroupBindExpiryWatcher(store, bot.api, 30_000);
  const groupCloseCleanup = startGroupCloseCleanupWatcher(store, bot.api, 30_000);
  const usernameRefresh = startUsernameRefresh(bot.api, store, members, 60_000);

  const allowed_updates = [
    "message",
    "callback_query",
    "my_chat_member",
    "chat_member",
  ] as const;

  console.log(`Bot avviato in polling: @${me.username} (id ${me.id})`);

  const stop = async () => {
    watcher.stop();
    groupBindExpiry.stop();
    groupCloseCleanup.stop();
    usernameRefresh.stop();
    await stopMtprotoHelper();
    await bot.stop();
  };
  process.once("SIGINT", () => {
    void stop().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().finally(() => process.exit(0));
  });

  await bot.start({
    allowed_updates: [...allowed_updates],
    onStart: () => {
      console.log("Polling attivo. Ctrl+C per terminare.");
    },
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
