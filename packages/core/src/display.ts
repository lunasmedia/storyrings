import type { StoryFill, StoryFit } from '@stories/contracts/sdk-types';

export type { StoryFill, StoryFit } from '@stories/contracts/sdk-types';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * How a story fits the screen (spec: display): "fill" covers it, "fit" shows all of it with
 * gaps in the `fill` colours (null = black). Older servers send neither: "fit". A designed video
 * has an `overlay` image drawn over it (http(s) only; null = none).
 */
export function storyLook(story: {
  type?: unknown;
  fit?: unknown;
  fill?: unknown;
  overlay?: unknown;
}): {
  fit: StoryFit;
  fill: StoryFill | null;
  overlay: string | null;
} {
  const fit: StoryFit = story.fit === 'fill' ? 'fill' : 'fit';
  const f = story.fill as Partial<StoryFill> | null | undefined;
  const fill =
    fit === 'fit' &&
    f &&
    typeof f.top === 'string' &&
    HEX.test(f.top) &&
    typeof f.bottom === 'string' &&
    HEX.test(f.bottom)
      ? { top: f.top, bottom: f.bottom }
      : null;
  const overlay =
    story.type === 'video' &&
    typeof story.overlay === 'string' &&
    /^https?:\/\//i.test(story.overlay)
      ? story.overlay
      : null;
  return { fit, fill, overlay };
}
