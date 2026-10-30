import { describe, expect, it } from 'vitest';
import { SESSION_TIMEOUT_MS, startsNewSession } from '../src/session';

describe('app sessions', () => {
  it('starts a new session after 30 minutes away, not before', () => {
    expect(startsNewSession(null, 1_000)).toBe(false); // never left
    expect(startsNewSession(0, SESSION_TIMEOUT_MS - 1)).toBe(false);
    expect(startsNewSession(0, SESSION_TIMEOUT_MS)).toBe(true);
    expect(SESSION_TIMEOUT_MS).toBe(30 * 60_000);
  });
});
