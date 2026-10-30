/** A new app session starts after this long in the background (the Firebase rule). */
export const SESSION_TIMEOUT_MS = 30 * 60_000;

/** Whether returning to the app at `now`, after leaving it at `leftAt`, starts a new session. */
export function startsNewSession(leftAt: number | null, now: number): boolean {
  return leftAt !== null && now - leftAt >= SESSION_TIMEOUT_MS;
}
