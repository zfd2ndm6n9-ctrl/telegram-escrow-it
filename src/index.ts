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
  getMasterKeypair as getLtcMasterKeypair,
  getPlatformFeeWalletAddress,
  isLtcConfigured,
  keypairToAddress,
  startLtcDepositWatcher,
} from "./services/ltc/index.js";
import {
  getMasterWallet as getEthMasterWallet,
  getPlatformFeeWalletAddress as getEthPlatformFeeWalletAddress,
  isEthConfigured,
  walletToAddress as ethWalletToAddress,
  startEthDepositWatcher,
} from "./services/eth/index.js";
import {
  getMtprotoHelper,
  isMtprotoHelperConfigured,
  stopMtprotoHelper,
} from "./services/mtproto-helper.js";
import { startGroupBindExpiryWatcher } from "./services/group-bind-expiry.js";
import { startGroupCloseCleanupWatcher } from "./services/group-close-cleanup.js";
import { startUsernameRefresh } from "./services/username-refresh.js";
import { ensureTosMenuButtons } from "./services/tos-menu-button.js";
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
        `Fee piattaforma SOL (5% release): ${feeWallet ?? master.publicKey.toBase58()}` +
          (config.feeWalletPubkey ? " (FEE_WALLET_PUBKEY)" : " (= master)"),
      );
      console.log(
        "⚠️ Hot wallet SOL: tieni solo importi di test piccoli. Secret solo su Render env.",
      );
    }
  } else {
    console.warn(
      "SOLANA_PRIVATE_KEY assente: deal SOL disabilitati finché non la imposti.",
    );
  }

  if (isLtcConfigured()) {
    const master = getLtcMasterKeypair();
    if (master) {
      const masterAddr = keypairToAddress(master);
      console.log(`Escrow LTC mainnet attivo. Master address: ${masterAddr}`);
      const feeWallet = getPlatformFeeWalletAddress();
      console.log(
        `Fee piattaforma LTC (5% release): ${feeWallet ?? masterAddr}` +
          (config.ltcFeeAddress ? " (FEE_WALLET_LTC)" : " (= master)"),
      );
      console.log(
        "⚠️ Hot wallet LTC: tieni solo importi di test piccoli. Secret solo su Render env.",
      );
    }
  } else {
    console.warn(
      "LTC_PRIVATE_KEY assente: deal LTC disabilitati finché non la imposti.",
    );
  }

  if (isEthConfigured()) {
    const master = getEthMasterWallet();
    if (master) {
      const masterAddr = ethWalletToAddress(master);
      console.log(`Escrow ETH mainnet attivo. Master address: ${masterAddr}`);
      const feeWallet = getEthPlatformFeeWalletAddress();
      console.log(
        `Fee piattaforma ETH (5% release): ${feeWallet ?? masterAddr}` +
          (config.ethFeeAddress ? " (FEE_WALLET_ETH)" : " (= master)"),
      );
      console.log(
        "⚠️ Hot wallet ETH: tieni solo importi di test piccoli. Secret solo su Render env.",
      );
    }
  } else {
    console.warn(
      "ETH_PRIVATE_KEY assente: deal ETH disabilitati finché non la imposti.",
    );
  }

  if (!isSolanaConfigured() && !isLtcConfigured() && !isEthConfigured()) {
    console.warn(
      "Nessuna chiave escrow (SOL/LTC/ETH): /crea on-chain disabilitato.",
    );
  }

  const { bot, store, members, invites, dealLogs } = createBot(config.botToken);

  const rawDataDir = process.env.DATA_DIR?.trim() || "(unset → data)";
  console.log(
    `Persistenza deal: DATA_DIR env=${rawDataDir} → resolved=${store.dataDir} → ${store.path} (${store.size} deal). ` +
      "Su Render: Persistent Disk mount /var/data + DATA_DIR=/var/data (assoluto).",
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
  console.log(
    `APP_ENV=${config.appEnv} · CREATE_GATE=${config.createGate}` +
      (config.createGate === "admin"
        ? " (staging: solo admin /crea)"
        : config.createGate === "invite"
          ? " (soft-launch: invito obbligatorio)"
          : " (dev: invito opzionale)"),
  );
  if (config.adminTelegramIds.length) {
    console.log(
      `Admin ids: ${config.adminTelegramIds.join(", ")} (ADMIN_TELEGRAM_ID/S)`,
    );
  } else {
    console.warn(
      "Nessun ADMIN_TELEGRAM_ID / ADMIN_TELEGRAM_IDS: /log e force payout disabilitati.",
    );
  }
  console.log(
    config.disputeAdminNotify
      ? "Dispute admin DM: ON (default; DISPUTE_ADMIN_NOTIFY=0 per off)."
      : "Dispute admin DM: OFF (DISPUTE_ADMIN_NOTIFY=0). Critici kick/delete restano ON.",
  );
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
    console.log(
      `ToS Mini App: ${config.tosWebAppUrl} (pin gruppo ESCROWITA TOS + Leggi; canale «Leggi i Termini»; Accetta resta callback card)`,
    );
  } else {
    console.warn(
      "PUBLIC_BASE_URL / RENDER_EXTERNAL_URL / TOS_URL assenti: " +
        "pin ESCROWITA TOS non disponibile; Accetta resta callback sulla card.",
    );
  }

  // Menu button bot (DM default) + tentativo sul canale vouch.
  void ensureTosMenuButtons(bot.api).catch((err) => {
    console.warn("[tos-menu] boot error:", err);
  });

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
        console.log(
          "Creazione gruppi ON: helper MTProto pronto (path preferito dopo /crea).",
        );
      } catch (err) {
        console.warn(
          "Creazione gruppi ON ma helper MTProto non disponibile (fallback manuale degradato):",
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      console.warn(
        "Creazione gruppi ON ma mancano TELEGRAM_API_ID/HASH/HELPER_SESSION: Bot API non può creare gruppi — serve helper. Fallback = manuale (owner umano).",
      );
    }
  } else {
    console.log(
      "Creazione automatica gruppi OFF (TELEGRAM_BOT_CREATES_GROUPS=0). Path legacy: gruppo privato → bot admin → /avvia.",
    );
  }

  const watcher = startDepositWatcher(
    store,
    bot.api,
    Number.isFinite(config.solanaWatchIntervalMs)
      ? config.solanaWatchIntervalMs
      : 20_000,
  );
  const ltcWatcher = startLtcDepositWatcher(
    store,
    bot.api,
    Number.isFinite(config.ltcWatchIntervalMs)
      ? config.ltcWatchIntervalMs
      : 20_000,
  );
  const ethWatcher = startEthDepositWatcher(
    store,
    bot.api,
    Number.isFinite(config.ethWatchIntervalMs)
      ? config.ethWatchIntervalMs
      : 20_000,
  );

  const groupBindExpiry = startGroupBindExpiryWatcher(store, bot.api, 30_000);
  // ~1 min post-payout: tick ogni 15s così la delete arriva vicino al minuto.
  const groupCloseCleanup = startGroupCloseCleanupWatcher(store, bot.api, 15_000);
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
    ltcWatcher.stop();
    ethWatcher.stop();
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
