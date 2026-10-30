import { z } from 'zod';
import { BLOCKED_SCHEMES } from './cta';

export {
  BLOCKED_SCHEMES,
  CTA_STYLES,
  type CtaStyle,
  ctaStyle,
  isAllowedCtaUrl,
  isSwipeCta,
} from './cta';

export const id = z.uuid();

export const errorCodes = [
  'bad_request',
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'group_incomplete',
  'internal_error',
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

/** Body for reorder endpoints: the complete list of ids in their new order. */
export const reorderInput = z.object({
  ids: z.array(id).min(1).max(500),
});

/**
 * Reordering the groups of one story bar: `ids` lists that bar's groups in their new order.
 * They swap places among the positions they already hold, so other groups don't move.
 */
export const reorderGroupsInput = reorderInput.extend({ barId: id.optional() });
export type ReorderInput = z.infer<typeof reorderInput>;

export const urlScheme = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9+.-]{0,31}$/, 'Invalid URL scheme')
  .refine((s) => !BLOCKED_SCHEMES.has(s) && s !== 'http' && s !== 'https', 'Scheme not allowed');
