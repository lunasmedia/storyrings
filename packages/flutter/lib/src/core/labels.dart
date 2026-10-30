/// Accessible labels, worded exactly like the other SDKs (spec/constants.json → labels).
library;

abstract final class StoriesLabels {
  static String openGroup(String title, int count, bool seen) =>
      '$title, $count ${count == 1 ? 'story' : 'stories'}${seen ? ', viewed' : ''}';
  static String storyPosition(String title, int index, int total) => '$title: story ${index + 1} of $total';
  static String viewer(String title) => 'Stories: $title';
  static const close = 'Close stories';
  static const pause = 'Pause';
  static const play = 'Play';
  static const mute = 'Mute';
  static const unmute = 'Unmute';
  static const previous = 'Previous story';
  static const next = 'Next story';
  static const share = 'Share story';
  static const linkCopied = 'Link copied';
  static const shareFailed = 'Couldn’t share this story';
  static const bar = 'Stories';
  static const loading = 'Loading stories';
}
