import { generateSnowflake } from "@discord-mocker/protocol";
import type { APIAttachment } from "discord-api-types/v10";

export interface StoredAttachment {
  id: string;
  filename: string;
  contentType: string;
  data: Buffer;
  width?: number;
  height?: number;
}

/** Reads the pixel dimensions out of a PNG header (IHDR is always the first chunk). */
function pngDimensions(data: Buffer): { width: number; height: number } | undefined {
  const isPng = data.length > 24 && data.readUInt32BE(0) === 0x89504e47;
  if (!isPng) return undefined;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Walks JPEG segments to the first frame header, which carries the dimensions. */
function jpegDimensions(data: Buffer): { width: number; height: number } | undefined {
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) return undefined;

  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1] ?? 0;
    // SOF0-SOF15, excluding the non-frame markers in that range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    offset += 2 + data.readUInt16BE(offset + 2);
  }
  return undefined;
}

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  json: "application/json",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
};

function guessContentType(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Holds files the bot uploaded, and serves them back over HTTP.
 *
 * Bots that render their output as an image — stat cards, graphs, leaderboards —
 * send the picture as a multipart attachment and reference it from an embed as
 * `attachment://name.png`. Without somewhere to put those bytes, the mocker shows
 * an empty box where the bot's actual output should be.
 */
export class AttachmentStore {
  private readonly files = new Map<string, StoredAttachment>();

  /** The path attachments are served from. */
  static readonly ROUTE = "/attachments";

  add(filename: string, contentType: string | undefined, data: Buffer): StoredAttachment {
    const dimensions = pngDimensions(data) ?? jpegDimensions(data);
    // discord.js does not always set a part content type, and the client decides
    // whether to render a file inline from exactly this value.
    const resolvedType = contentType || guessContentType(filename);
    const stored: StoredAttachment = {
      id: generateSnowflake(),
      filename,
      contentType: resolvedType,
      data,
      ...(dimensions ?? {}),
    };
    this.files.set(stored.id, stored);
    return stored;
  }

  get(id: string): StoredAttachment | undefined {
    return this.files.get(id);
  }

  /** The URL a stored file is reachable at, as Discord would report it. */
  urlFor(stored: StoredAttachment, host: string): string {
    return `http://${host}${AttachmentStore.ROUTE}/${stored.id}/${encodeURIComponent(stored.filename)}`;
  }

  toApiAttachment(stored: StoredAttachment, host: string, index: number): APIAttachment {
    const url = this.urlFor(stored, host);
    return {
      id: String(index),
      filename: stored.filename,
      size: stored.data.byteLength,
      url,
      proxy_url: url,
      content_type: stored.contentType,
      ...(stored.width ? { width: stored.width } : {}),
      ...(stored.height ? { height: stored.height } : {}),
    };
  }
}

/**
 * Rewrites `attachment://name.png` references to the URLs the files are served
 * from, so embeds and galleries resolve exactly as they do on Discord.
 */
export function resolveAttachmentUrls<T>(payload: T, byFilename: Map<string, string>): T {
  if (typeof payload === "string") {
    if (!payload.startsWith("attachment://")) return payload;
    return (byFilename.get(payload.slice("attachment://".length)) ?? payload) as T;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => resolveAttachmentUrls(item, byFilename)) as T;
  }

  if (payload && typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        resolveAttachmentUrls(value, byFilename),
      ]),
    ) as T;
  }

  return payload;
}
