export { CTA_STYLES, ctaStyle, isAllowedCtaUrl, isSwipeCta } from '@stories/contracts/cta';
export type {
  ActivityType,
  CtaStyle,
  EventType,
  FeedDto,
  FeedGroupDto,
  FeedStoryDto,
  Platform,
} from '@stories/contracts/sdk-types';
export * from './analytics';
export * from './api';
export * from './display';
export * from './gestures';
export * from './interactions';
export * from './machine';
export * from './seen';
export * from './session';
export * from './share';
export * from './theme';
export * from './viewer';

/** Accessible labels, in one place so SDKs stay consistent (and can be localised later). */
export const labels = {
  openGroup: (title: string, count: number, seen: boolean) =>
    `${title}, ${count} ${count === 1 ? 'story' : 'stories'}${seen ? ', viewed' : ''}`,
  storyPosition: (title: string, index: number, total: number) =>
    `${title}: story ${index + 1} of ${total}`,
  viewer: (title: string) => `Stories: ${title}`,
  close: 'Close stories',
  pause: 'Pause',
  play: 'Play',
  mute: 'Mute',
  unmute: 'Unmute',
  previous: 'Previous story',
  next: 'Next story',
  share: 'Share story',
  linkCopied: 'Link copied',
  shareFailed: 'Couldn’t share this story',
  bar: 'Stories',
  loading: 'Loading stories',
};
