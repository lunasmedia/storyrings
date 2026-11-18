import { ENERGIZED_PREVIEW_MS } from '@stories/contracts/appearance';
import type { GroupLike } from './machine';

export { ENERGIZED_PREVIEW_MS, isEnergized, isVerticalLayout } from '@stories/contracts/appearance';

/** The card previewing now: which group, its story (always the first), and which turn this is. */
export interface EnergizedPreview {
  groupIndex: number;
  storyIndex: number;
  storyId: string;
  /** Goes up every time a preview starts (even the same group again): restart the media. */
  turn: number;
}

/**
 * The Energized style's order (spec/cases/energized.json). One group at a time shows its first
 * story (only ever the first, seen or not) inside its card for ENERGIZED_PREVIEW_MS, then the
 * next group does, through every group in bar order and back to the first; the platform scrolls
 * each card into view for its turn. It starts from the first fully visible group. When the
 * bar is scrolled so that the card previewing is no longer fully visible, it starts again from
 * the first visible one. Platform code reports which cards are fully on screen, passes time
 * with tick(), and draws current().
 */
export class EnergizedCycle {
  /** Indexes of the groups with stories, in bar order: the turns go through these. */
  private order: number[] = [];
  /** Indexes of the groups with stories whose cards are fully on screen. */
  private visible: number[] = [];
  /** Where in `order` the preview is, or -1 when nothing previews. */
  private position = -1;
  private elapsed = 0;
  private turns = 0;

  constructor(private groups: readonly GroupLike[]) {
    this.order = this.withStories(groups.map((_, i) => i));
  }

  /** New feed: starts again from the first visible group that still has stories. */
  setGroups(groups: readonly GroupLike[]): void {
    this.groups = groups;
    this.order = this.withStories(groups.map((_, i) => i));
    this.visible = this.withStories(this.visible);
    this.restart();
  }

  /**
   * Indexes of the groups whose cards are fully on screen, in any order. Groups without
   * stories are skipped. While the card previewing is among them nothing changes (the bar
   * scrolled to it, or only a little); otherwise it starts again from the first.
   */
  setVisible(indexes: readonly number[]): void {
    this.visible = this.withStories(indexes);
    const current = this.order[this.position];
    if (current !== undefined && this.visible.includes(current)) return;
    this.restart();
  }

  /** Time passing (only while previews may play: on screen, nothing covering the bar). */
  tick(ms: number): void {
    if (this.position < 0 || !(ms > 0)) return;
    this.elapsed += ms;
    while (this.elapsed >= ENERGIZED_PREVIEW_MS) {
      this.elapsed -= ENERGIZED_PREVIEW_MS;
      this.position = (this.position + 1) % this.order.length;
      this.turns++;
    }
  }

  /** Milliseconds left of the current preview (for scheduling the next tick). */
  remainingMs(): number {
    return this.position < 0 ? 0 : ENERGIZED_PREVIEW_MS - this.elapsed;
  }

  current(): EnergizedPreview | null {
    const groupIndex = this.order[this.position];
    const story = groupIndex === undefined ? undefined : this.groups[groupIndex]?.stories[0];
    if (groupIndex === undefined || !story) return null;
    return { groupIndex, storyIndex: 0, storyId: story.id, turn: this.turns };
  }

  /** From the first visible group, or nothing when none is. */
  private restart(): void {
    this.elapsed = 0;
    const first = this.visible[0];
    this.position = first === undefined ? -1 : this.order.indexOf(first);
    if (this.position >= 0) this.turns++;
  }

  private withStories(indexes: readonly number[]): number[] {
    return [...new Set(indexes)]
      .filter((i) => Number.isInteger(i) && (this.groups[i]?.stories.length ?? 0) > 0)
      .sort((a, b) => a - b);
  }
}
