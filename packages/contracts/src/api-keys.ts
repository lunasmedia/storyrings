import { z } from 'zod';

/** Secret keys start with this, so they're easy to spot (and to catch in leaked code). */
export const API_KEY_PREFIX = 'sk_live_';

/**
 * A workspace API key (Settings → Account): lets your own systems read and write story
 * content through the Content API (/v1/content). Shown once when created; only admins and
 * owners can create or revoke keys.
 */
export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(60),
  /** Revoke every other active key at the same time (rotation). */
  revokeOthers: z.boolean().optional(),
});
export type CreateApiKeyInput = z.input<typeof createApiKeyInput>;

export interface ApiKeyDto {
  id: string;
  name: string;
  /** "sk_live_…a1b2": enough to recognise a key without revealing it. */
  hint: string;
  createdAt: string;
  createdBy: { name: string; email: string } | null;
  lastUsedAt: string | null;
}

export interface CreatedApiKeyDto {
  key: ApiKeyDto;
  /** The full key. Only returned here, once. */
  secret: string;
}
