import { z } from 'zod';
import { MAX_TAG_CONDITIONS, MAX_USER_TAGS, TAG_MAX_LENGTH, TAG_PATTERN } from './tags';

export {
  describeTagFilter,
  matchesTagFilter,
  normalizeTags,
  type TagCondition,
} from './tags';

export const userTag = z
  .string()
  .trim()
  .toLowerCase()
  .max(TAG_MAX_LENGTH)
  .regex(TAG_PATTERN, 'Use lowercase letters, numbers and . _ : - (e.g. london or city:london)');

const tagList = z
  .array(userTag)
  .max(MAX_USER_TAGS)
  .transform((tags) => [...new Set(tags)]);

/** A group's tag filter (AND of conditions); empty conditions are dropped, [] = no filter. */
export const tagFilterInput = z
  .array(z.object({ mode: z.enum(['include', 'exclude']), tags: tagList }))
  .max(MAX_TAG_CONDITIONS)
  .transform((conditions) => conditions.filter((c) => c.tags.length > 0));

/**
 * A tag in the workspace's list (Audience). The key is what apps send (`tags="london"`) and is
 * fixed once created; the name and description are only for the team. Tags used in a group's
 * filter are added automatically.
 */
export const createTagInput = z.object({
  key: userTag,
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
});
export type CreateTagInput = z.input<typeof createTagInput>;

export const updateTagInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200),
  })
  .partial();
export type UpdateTagInput = z.input<typeof updateTagInput>;

export interface TagDto {
  id: string;
  orgId: string;
  key: string;
  name: string;
  description: string;
  /** Story groups whose tag filter uses it, across the workspace's apps. */
  groupCount: number;
  createdAt: string;
  updatedAt: string;
}
