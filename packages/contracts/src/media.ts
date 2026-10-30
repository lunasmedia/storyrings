import { z } from 'zod';

export const MEDIA_LIMITS = {
  image: { maxBytes: 5 * 1024 * 1024 },
  video: { maxBytes: 50 * 1024 * 1024, maxDurationMs: 60_000 },
  /** Animated GIFs are only allowed as group covers; converted to MP4 on the server. */
  gif: { maxBytes: 10 * 1024 * 1024, maxDurationMs: 10_000 },
} as const;

export const ALLOWED_MIME = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/gif': { kind: 'gif', ext: 'gif' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/webm': { kind: 'video', ext: 'webm' },
} as const;
export type AllowedMime = keyof typeof ALLOWED_MIME;

export const createUploadInput = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.enum(Object.keys(ALLOWED_MIME) as [AllowedMime, ...AllowedMime[]]),
  bytes: z.number().int().positive(),
});
export type CreateUploadInput = z.input<typeof createUploadInput>;

export interface UploadTicketDto {
  mediaId: string;
  uploadUrl: string;
  method: 'PUT';
  /** Headers the client must send with the PUT. */
  headers: Record<string, string>;
  expiresAt: string;
}

export const completeUploadInput = z.object({
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  /** Required for videos. Read by the client from the media element's metadata. */
  durationMs: z.number().int().positive().optional(),
});
export type CompleteUploadInput = z.input<typeof completeUploadInput>;
