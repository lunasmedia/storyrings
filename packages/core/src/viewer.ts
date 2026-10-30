import type { KeyValueStorage } from './seen';

/** Anonymous viewer IDs are replaced after 13 months, the usual limit for audience measurement. */
export const VIEWER_ID_MAX_AGE_MS = 395 * 86_400_000;
const KEY = 'stories:viewer';

interface Stored {
  id: string;
  created: number;
}

/**
 * The anonymous ID used to count unique viewers (reach): a random value made on this
 * device, kept in storage, with no link to who the person is. The server only stores a
 * hash of it per app.
 */
export async function loadViewerId(
  storage: KeyValueStorage | null,
  now = Date.now(),
): Promise<string | null> {
  if (!storage) return null;
  try {
    const raw = await storage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Stored>) : null;
    if (
      stored &&
      typeof stored.id === 'string' &&
      typeof stored.created === 'number' &&
      now - stored.created < VIEWER_ID_MAX_AGE_MS
    ) {
      return stored.id;
    }
    const fresh: Stored = { id: randomId(), created: now };
    await storage.setItem(KEY, JSON.stringify(fresh));
    return fresh.id;
  } catch {
    // Storage unavailable: unique viewers can't be counted on this device.
    return null;
  }
}

/** Forgets the ID (e.g. when someone withdraws consent). */
export async function clearViewerId(storage: KeyValueStorage | null): Promise<void> {
  try {
    await storage?.setItem(KEY, '');
  } catch {}
}

export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
