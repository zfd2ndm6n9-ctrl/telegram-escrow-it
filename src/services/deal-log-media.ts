import type { DealLogMediaType } from "../store/deal-logs.js";

type MediaMessageLike = {
  caption?: string;
  photo?: Array<{ width?: number; height?: number; file_unique_id?: string }>;
  video?: {
    file_name?: string;
    mime_type?: string;
    duration?: number;
    width?: number;
    height?: number;
    file_unique_id?: string;
    file_size?: number;
  };
  video_note?: {
    duration?: number;
    length?: number;
    file_unique_id?: string;
    file_size?: number;
  };
  animation?: {
    file_name?: string;
    mime_type?: string;
    duration?: number;
    width?: number;
    height?: number;
    file_unique_id?: string;
    file_size?: number;
  };
  document?: {
    file_name?: string;
    mime_type?: string;
    file_unique_id?: string;
    file_size?: number;
  };
  audio?: {
    file_name?: string;
    mime_type?: string;
    duration?: number;
    title?: string;
    performer?: string;
    file_unique_id?: string;
    file_size?: number;
  };
  voice?: {
    duration?: number;
    mime_type?: string;
    file_unique_id?: string;
    file_size?: number;
  };
  sticker?: {
    emoji?: string;
    set_name?: string;
    file_unique_id?: string;
    is_animated?: boolean;
    is_video?: boolean;
  };
};

export type MediaLogSummary = {
  mediaType: DealLogMediaType;
  /** Riga silent-log: tipo + metadata best-effort (niente byte). */
  text: string;
};

function fmtSize(bytes: number | undefined): string | undefined {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function joinMeta(parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(" · ");
}

/**
 * Estrae tipo + descrizione media da un messaggio Telegram.
 * Bot API non consegna i byte dopo delete utente: tratteniamo solo metadata.
 */
export function summarizeMessageMedia(
  msg: MediaMessageLike | undefined,
): MediaLogSummary | null {
  if (!msg) return null;
  const caption = msg.caption?.replace(/\s+/g, " ").trim();

  if (msg.photo && msg.photo.length > 0) {
    const best = msg.photo[msg.photo.length - 1]!;
    const dims =
      best.width && best.height ? `${best.width}×${best.height}` : undefined;
    const text = joinMeta([
      "[photo]",
      dims,
      caption ? `caption: ${caption}` : "(senza caption — byte non ritrattenuti)",
      best.file_unique_id ? `uid:${best.file_unique_id}` : undefined,
    ]);
    return { mediaType: "photo", text };
  }

  if (msg.video) {
    const v = msg.video;
    const dims = v.width && v.height ? `${v.width}×${v.height}` : undefined;
    const dur = v.duration != null ? `${v.duration}s` : undefined;
    const text = joinMeta([
      "[video]",
      v.file_name,
      dims,
      dur,
      v.mime_type,
      fmtSize(v.file_size),
      caption ? `caption: ${caption}` : "(senza caption — byte non ritrattenuti)",
      v.file_unique_id ? `uid:${v.file_unique_id}` : undefined,
    ]);
    return { mediaType: "video", text };
  }

  if (msg.video_note) {
    const v = msg.video_note;
    const text = joinMeta([
      "[video_note]",
      v.length != null ? `${v.length}px` : undefined,
      v.duration != null ? `${v.duration}s` : undefined,
      fmtSize(v.file_size),
      "(byte non ritrattenuti)",
      v.file_unique_id ? `uid:${v.file_unique_id}` : undefined,
    ]);
    return { mediaType: "video_note", text };
  }

  if (msg.animation) {
    const a = msg.animation;
    const dims = a.width && a.height ? `${a.width}×${a.height}` : undefined;
    const text = joinMeta([
      "[animation/gif]",
      a.file_name,
      dims,
      a.duration != null ? `${a.duration}s` : undefined,
      a.mime_type,
      fmtSize(a.file_size),
      caption ? `caption: ${caption}` : "(senza caption — byte non ritrattenuti)",
      a.file_unique_id ? `uid:${a.file_unique_id}` : undefined,
    ]);
    return { mediaType: "animation", text };
  }

  if (msg.document) {
    const d = msg.document;
    const text = joinMeta([
      "[document]",
      d.file_name,
      d.mime_type,
      fmtSize(d.file_size),
      caption ? `caption: ${caption}` : "(byte non ritrattenuti)",
      d.file_unique_id ? `uid:${d.file_unique_id}` : undefined,
    ]);
    return { mediaType: "document", text };
  }

  if (msg.audio) {
    const a = msg.audio;
    const who = [a.performer, a.title].filter(Boolean).join(" — ");
    const text = joinMeta([
      "[audio]",
      a.file_name || who || undefined,
      a.duration != null ? `${a.duration}s` : undefined,
      a.mime_type,
      fmtSize(a.file_size),
      caption ? `caption: ${caption}` : "(byte non ritrattenuti)",
      a.file_unique_id ? `uid:${a.file_unique_id}` : undefined,
    ]);
    return { mediaType: "audio", text };
  }

  if (msg.voice) {
    const v = msg.voice;
    const text = joinMeta([
      "[voice]",
      v.duration != null ? `${v.duration}s` : undefined,
      v.mime_type,
      fmtSize(v.file_size),
      "(byte non ritrattenuti)",
      v.file_unique_id ? `uid:${v.file_unique_id}` : undefined,
    ]);
    return { mediaType: "voice", text };
  }

  if (msg.sticker) {
    const s = msg.sticker;
    const kind = s.is_video ? "video-sticker" : s.is_animated ? "animated-sticker" : "sticker";
    const text = joinMeta([
      `[${kind}]`,
      s.emoji,
      s.set_name ? `set:${s.set_name}` : undefined,
      "(byte non ritrattenuti)",
      s.file_unique_id ? `uid:${s.file_unique_id}` : undefined,
    ]);
    return { mediaType: "sticker", text };
  }

  return null;
}
