import type { Attachment, Collection, Message } from "discord.js";
import type { AIImage } from "../ai/types.js";
import { logger } from "../shared/logger.js";

export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif)$/i;

function isImage(a: Pick<Attachment, "contentType" | "name" | "size">): boolean {
  return (a.contentType ? IMAGE_TYPES.test(a.contentType) : /\.(png|jpe?g|webp|gif)$/i.test(a.name ?? "")) && a.size <= MAX_IMAGE_BYTES;
}

/** Download Discord image attachments and inline them as data URLs (the AI provider never touches Discord's CDN). */
export async function downloadImages(attachments: Iterable<Pick<Attachment, "url" | "contentType" | "name" | "size">>, fetchFn: typeof fetch = fetch): Promise<AIImage[]> {
  const out: AIImage[] = [];
  for (const a of attachments) {
    if (out.length >= MAX_IMAGES) break;
    if (!isImage(a)) continue;
    try {
      const res = await fetchFn(a.url);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES) continue;
      const type = a.contentType ?? `image/${(a.name ?? "x.png").split(".").pop()!.toLowerCase().replace("jpg", "jpeg")}`;
      out.push({ dataUrl: `data:${type};base64,${bytes.toString("base64")}`, detail: "high" });
    } catch (err) {
      logger.warn("image download failed", { error: err });
    }
  }
  return out;
}

/**
 * Images for a message: its own attachments, or (if it has none and is a reply) the replied-to message's,
 * so "mustardbot what's this?" as a reply to a screenshot works.
 */
export async function messageImages(message: Pick<Message, "attachments" | "reference" | "fetchReference">): Promise<AIImage[]> {
  const own = [...(message.attachments as Collection<string, Attachment>).values()];
  if (own.length) return downloadImages(own);
  if (!message.reference?.messageId) return [];
  try {
    const ref = await message.fetchReference();
    return downloadImages([...ref.attachments.values()]);
  } catch {
    return [];
  }
}
