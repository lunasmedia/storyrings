import { z } from 'zod';
import {
  type AppearanceOverrides,
  appearanceOverrides,
  type BarLayout,
  barLayoutSchema,
} from './appearance-schema';

/** The bar SDKs show when they don't name one. Every app has it. */
export const DEFAULT_BAR_KEY = 'main';

/**
 * What developers put in the embed (bar="product-page"): lowercase letters, digits and
 * single dashes. Fixed once the bar is created, so installed embeds keep working.
 */
export const barKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes, e.g. product-page')
  .max(40);

/** "Product page!" → "product-page" (a suggestion for the key field). */
export function slugifyBarKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

const barName = z.string().trim().min(1).max(60);

export const createBarInput = z.object({
  name: barName,
  key: barKey,
  /** Groups to show in it straight away (e.g. copied from another bar). */
  groupIds: z.array(z.uuid()).max(500).optional(),
});
export type CreateBarInput = z.input<typeof createBarInput>;

export const updateBarInput = z
  .object({
    name: barName,
    /** Overrides over the app-wide story bar style. null = same as the app. */
    style: appearanceOverrides.nullable(),
    /** Shape and size for this bar. null = the app-wide layout. */
    layout: barLayoutSchema.nullable(),
  })
  .partial();
export type UpdateBarInput = z.input<typeof updateBarInput>;

export interface BarDto {
  id: string;
  appId: string;
  key: string;
  name: string;
  /** The bar used when an embed doesn't name one. Can't be deleted. */
  isDefault: boolean;
  style: AppearanceOverrides | null;
  layout: BarLayout | null;
  /** Groups assigned to it (live or not). */
  groupCount: number;
  createdAt: string;
  updatedAt: string;
}
