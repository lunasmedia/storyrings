import type { GroupLike } from './machine';

/** localStorage, AsyncStorage, or anything with the same shape. */
export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

const MAX_IDS = 1000;

/**
 * Remembers which stories this device has seen, so circles can show a
 * "viewed" ring. A group counts as seen when all of its current stories are,
 * so adding a story makes the ring active again.
 */
export class SeenStore {
  private ids = new Set<string>();
  private readonly key: string;

  constructor(
    private readonly storage: KeyValueStorage | null,
    appId: string,
  ) {
    this.key = `stories:seen:${appId}`;
  }

  async load(): Promise<void> {
    try {
      const raw = await this.storage?.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        this.ids = new Set(parsed.filter((v): v is string => typeof v === 'string'));
      }
    } catch {
      // Storage can be unavailable (private mode, blocked cookies); start empty.
    }
  }

  has(storyId: string): boolean {
    return this.ids.has(storyId);
  }

  markSeen(storyId: string): void {
    if (this.ids.has(storyId)) return;
    this.ids.add(storyId);
    // Sets keep insertion order, so dropping from the front evicts the oldest.
    while (this.ids.size > MAX_IDS) this.ids.delete(this.ids.values().next().value as string);
    this.persist();
  }

  isGroupSeen(group: GroupLike): boolean {
    return group.stories.length > 0 && group.stories.every((s) => this.ids.has(s.id));
  }

  /** First unseen story in a group, or 0 if it's fully seen (replays from the start). */
  firstUnseenIndex(group: GroupLike): number {
    const i = group.stories.findIndex((s) => !this.ids.has(s.id));
    return i === -1 ? 0 : i;
  }

  private persist(): void {
    try {
      const result = this.storage?.setItem(this.key, JSON.stringify([...this.ids]));
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Ignore quota or availability errors; "seen" is a nicety.
    }
  }
}
