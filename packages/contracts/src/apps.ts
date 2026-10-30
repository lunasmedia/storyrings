import { z } from 'zod';
import {
  type AppearanceOverrides,
  appearanceOverrides,
  type BarLayout,
  barLayoutSchema,
} from './appearance-schema';
import { urlScheme } from './common';

export const appKinds = ['mobile', 'web'] as const;
export type AppKind = (typeof appKinds)[number];

/** iOS bundle id or Android package name, e.g. com.example.shop */
export const bundleId = z
  .string()
  .trim()
  .max(155)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/, 'Invalid bundle ID / package name');

/** An origin such as https://shop.example.com or http://localhost:5173 */
export const origin = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
      return u.origin;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Must be an http(s) URL' });
      return z.NEVER;
    }
  });

const name = z.string().trim().min(1).max(100);

export const createAppInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('mobile'),
    name,
    bundleIds: z.array(bundleId).min(1).max(10),
    deepLinkSchemes: z.array(urlScheme).max(10).default([]),
  }),
  z.object({
    kind: z.literal('web'),
    name,
    /**
     * Optional website URL. Its origin is added to allowedOrigins. With no
     * allowed origins, browsers are refused until a domain is added.
     */
    url: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      origin.optional(),
    ),
    allowedOrigins: z.array(origin).max(20).default([]),
    deepLinkSchemes: z.array(urlScheme).max(10).default([]),
  }),
]);
export type CreateAppInput = z.input<typeof createAppInput>;

export const updateAppInput = z
  .object({
    name,
    bundleIds: z.array(bundleId).min(1).max(10),
    /** Empty = only server-side requests (no Origin header) are accepted. */
    allowedOrigins: z.array(origin).max(20),
    deepLinkSchemes: z.array(urlScheme).max(10),
    /** App-wide story bar style; every group inherits it. null = built-in defaults. */
    barStyle: appearanceOverrides.nullable(),
    /** Show a Share button in the story viewer. Mobile apps also need a `shareLink`. */
    sharingEnabled: z.boolean(),
    /**
     * Mobile apps: the link a shared story opens, with {group} and/or {story} filled in, e.g.
     * https://news.example.com/stories/{group}/{story} (a universal link / App Link that
     * opens your app, and your website for people without it). Websites share the page URL.
     */
    shareLink: z
      .string()
      .trim()
      .max(500)
      .regex(/^https:\/\/[^\s/]+\.[^\s]+$/, 'Use a full https:// link')
      .refine((v) => v.includes('{story}') || v.includes('{group}'), {
        message: 'Include {story} (and optionally {group}) so each link opens the right story',
      })
      .nullable(),
    /** App-wide shape and size of the story bar items. null = the SDK's own size. */
    barLayout: barLayoutSchema.nullable(),
  })
  .partial();
export type UpdateAppInput = z.input<typeof updateAppInput>;

export interface AppDto {
  id: string;
  orgId: string;
  kind: AppKind;
  name: string;
  bundleIds: string[];
  allowedOrigins: string[];
  deepLinkSchemes: string[];
  publicToken: string;
  barStyle: AppearanceOverrides | null;
  sharingEnabled: boolean;
  /** Mobile apps: what shared stories link to (see updateAppInput). */
  shareLink: string | null;
  barLayout: BarLayout | null;
  createdAt: string;
  updatedAt: string;
}
