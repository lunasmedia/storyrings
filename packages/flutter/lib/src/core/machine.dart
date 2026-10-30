/// The story viewer as a pure state machine: a port of `@stories/core`'s machine.ts.
/// The UI dispatches actions from taps, swipes and timers and draws whatever state comes
/// back. Behaviour is pinned by spec/cases/viewer.json.
library;

/// A story as far as the viewer is concerned.
class StoryLike {
  const StoryLike({required this.id, required this.durationMs, this.type = 'image'});
  final String id;
  final int durationMs;

  /// 'image' or 'video'; decides the viewability rule.
  final String type;
}

class GroupLike {
  const GroupLike({required this.id, required this.stories});
  final String id;
  final List<StoryLike> stories;
}

/// MRC/IAB viewability (docs/metrics.md): images need 1 s on screen, videos 2 s of
/// continuous playback, after the media has rendered.
const viewableMs = (image: 1000, video: 2000);

enum CloseReason { user, completed }

class ViewerState {
  const ViewerState({
    required this.open,
    required this.groupIndex,
    required this.storyIndex,
    required this.elapsedMs,
    required this.durationMs,
    required this.paused,
    required this.buffering,
    required this.displayed,
    required this.hidden,
    required this.viewableMs,
    required this.viewed,
    required this.closeReason,
    required this.seq,
  });

  final bool open;
  final int groupIndex;
  final int storyIndex;

  /// Time shown so far for the current story.
  final int elapsedMs;
  final int durationMs;

  /// Paused by the person (hold, pause button).
  final bool paused;

  /// Media is loading; the timer doesn't run.
  final bool buffering;

  /// The current story's media has rendered (stays false if it failed).
  final bool displayed;

  /// The viewer is off screen (app in the background).
  final bool hidden;

  /// Continuous viewable time of the current story so far.
  final int viewableMs;

  /// The current story met the viewability rule; analytics count it as viewed.
  final bool viewed;
  final CloseReason? closeReason;

  /// Goes up each time a story starts (including restarting one): reload media when it changes.
  final int seq;

  ViewerState copyWith({
    int? elapsedMs,
    int? durationMs,
    bool? paused,
    bool? buffering,
    bool? displayed,
    bool? hidden,
    int? viewableMs,
    bool? viewed,
  }) =>
      ViewerState(
        open: open,
        groupIndex: groupIndex,
        storyIndex: storyIndex,
        elapsedMs: elapsedMs ?? this.elapsedMs,
        durationMs: durationMs ?? this.durationMs,
        paused: paused ?? this.paused,
        buffering: buffering ?? this.buffering,
        displayed: displayed ?? this.displayed,
        hidden: hidden ?? this.hidden,
        viewableMs: viewableMs ?? this.viewableMs,
        viewed: viewed ?? this.viewed,
        closeReason: closeReason,
        seq: seq,
      );

  Map<String, Object?> toJson() => {
        'open': open,
        'groupIndex': groupIndex,
        'storyIndex': storyIndex,
        'elapsedMs': elapsedMs,
        'durationMs': durationMs,
        'paused': paused,
        'buffering': buffering,
        'displayed': displayed,
        'hidden': hidden,
        'viewableMs': viewableMs,
        'viewed': viewed,
        'closeReason': closeReason?.name,
        'seq': seq,
      };
}

const closed = ViewerState(
  open: false,
  groupIndex: 0,
  storyIndex: 0,
  elapsedMs: 0,
  durationMs: 0,
  paused: false,
  buffering: false,
  displayed: false,
  hidden: false,
  viewableMs: 0,
  viewed: false,
  closeReason: null,
  seq: 0,
);

ViewerState _closedWith(CloseReason reason, int seq) => ViewerState(
      open: false,
      groupIndex: 0,
      storyIndex: 0,
      elapsedMs: 0,
      durationMs: 0,
      paused: false,
      buffering: false,
      displayed: false,
      hidden: false,
      viewableMs: 0,
      viewed: false,
      closeReason: reason,
      seq: seq,
    );

sealed class ViewerAction {
  const ViewerAction();
}

/// Next story. `auto`: the story ended by itself (a video finished), not a tap.
class Next extends ViewerAction {
  const Next({this.auto = false});
  final bool auto;
}

class Prev extends ViewerAction {
  const Prev();
}

class NextGroup extends ViewerAction {
  const NextGroup();
}

class PrevGroup extends ViewerAction {
  const PrevGroup();
}

class Tick extends ViewerAction {
  const Tick(this.ms);
  final int ms;
}

class Pause extends ViewerAction {
  const Pause();
}

class Resume extends ViewerAction {
  const Resume();
}

class MediaLoading extends ViewerAction {
  const MediaLoading();
}

/// The viewer went off screen / came back (app backgrounded).
class Hide extends ViewerAction {
  const Hide();
}

class Show extends ViewerAction {
  const Show();
}

/// Media can play. `failed`: it couldn't load; the timer runs anyway so the viewer moves on.
class MediaReady extends ViewerAction {
  const MediaReady({this.durationMs, this.failed = false});
  final num? durationMs;
  final bool failed;
}

class Close extends ViewerAction {
  const Close();
}

/// Story to start at when entering a group going forward (e.g. the first unseen one).
typedef StartStoryIndex = int Function(int groupIndex);

ViewerState _show(ViewerState s, List<GroupLike> groups, int groupIndex, int storyIndex) {
  final g = groupIndex >= 0 && groupIndex < groups.length ? groups[groupIndex] : null;
  final story = g != null && storyIndex >= 0 && storyIndex < g.stories.length ? g.stories[storyIndex] : null;
  if (story == null) return _closedWith(CloseReason.completed, s.seq);
  return ViewerState(
    open: true,
    groupIndex: groupIndex,
    storyIndex: storyIndex,
    elapsedMs: 0,
    durationMs: story.durationMs,
    paused: false,
    buffering: true,
    displayed: false,
    hidden: s.hidden,
    viewableMs: 0,
    viewed: false,
    closeReason: null,
    seq: s.seq + 1,
  );
}

int _entryIndex(List<GroupLike> groups, int groupIndex, StartStoryIndex? start) {
  final count = groupIndex >= 0 && groupIndex < groups.length ? groups[groupIndex].stories.length : 0;
  final wanted = start?.call(groupIndex) ?? 0;
  return wanted >= 0 && wanted < count ? wanted : 0;
}

/// Opens the viewer on a group, at its start story.
ViewerState openViewer(List<GroupLike> groups, int groupIndex, {StartStoryIndex? startStoryIndex}) {
  if (groupIndex < 0 || groupIndex >= groups.length || groups[groupIndex].stories.isEmpty) {
    return closed;
  }
  return _show(closed, groups, groupIndex, _entryIndex(groups, groupIndex, startStoryIndex));
}

ViewerState _nextGroup(ViewerState s, List<GroupLike> groups, StartStoryIndex? start) {
  final g = s.groupIndex + 1;
  if (g >= groups.length) return _closedWith(CloseReason.completed, s.seq);
  return _show(s, groups, g, _entryIndex(groups, g, start));
}

ViewerState reduce(
  ViewerState s,
  ViewerAction action,
  List<GroupLike> groups, {
  StartStoryIndex? startStoryIndex,
}) {
  if (!s.open) return s;
  if (s.groupIndex < 0 || s.groupIndex >= groups.length) return _closedWith(CloseReason.user, s.seq);
  final group = groups[s.groupIndex];
  final lastStory = group.stories.length - 1;

  switch (action) {
    case Next():
      return s.storyIndex < lastStory
          ? _show(s, groups, s.groupIndex, s.storyIndex + 1)
          : _nextGroup(s, groups, startStoryIndex);

    case Prev():
      if (s.storyIndex > 0) return _show(s, groups, s.groupIndex, s.storyIndex - 1);
      if (s.groupIndex > 0) {
        // Like Instagram: back from a group's first story lands on the previous group's last.
        final prev = groups[s.groupIndex - 1];
        return _show(s, groups, s.groupIndex - 1, prev.stories.length - 1);
      }
      // Very first story: restart it.
      return _show(s, groups, 0, 0);

    case NextGroup():
      return _nextGroup(s, groups, startStoryIndex);

    case PrevGroup():
      return _show(s, groups, s.groupIndex > 0 ? s.groupIndex - 1 : 0, 0);

    case Tick(:final ms):
      if (ms <= 0) return s;
      final story = s.storyIndex >= 0 && s.storyIndex < group.stories.length ? group.stories[s.storyIndex] : null;
      final video = story?.type == 'video';
      // Images are viewable while on screen (even when held paused); videos only while playing.
      final accruing = s.displayed && !s.viewed && !s.hidden && (!video || (!s.paused && !s.buffering));
      final viewable = accruing ? s.viewableMs + ms : s.viewableMs;
      final justViewed = accruing && viewable >= (video ? viewableMs.video : viewableMs.image);
      if (s.paused || s.buffering) {
        return accruing ? s.copyWith(viewableMs: viewable, viewed: justViewed) : s;
      }
      final elapsed = s.elapsedMs + ms;
      // Report the view before moving on, so a story that ends right as it qualifies counts.
      if (justViewed) {
        return s.copyWith(
          viewableMs: viewable,
          viewed: true,
          elapsedMs: elapsed < s.durationMs ? elapsed : s.durationMs,
        );
      }
      if (elapsed >= s.durationMs) {
        return reduce(s, const Next(), groups, startStoryIndex: startStoryIndex);
      }
      return s.copyWith(elapsedMs: elapsed, viewableMs: viewable);

    case Hide():
      // Off screen breaks continuity: the count starts again when it's back.
      return s.hidden ? s : s.copyWith(hidden: true, viewableMs: s.viewed ? s.viewableMs : 0);

    case Show():
      return s.hidden ? s.copyWith(hidden: false) : s;

    case Pause():
      // A paused video isn't playing, so its continuous playback count restarts.
      return s.paused ? s : s.copyWith(paused: true, viewableMs: _restartVideo(s, group));

    case Resume():
      return s.paused ? s.copyWith(paused: false) : s;

    case MediaLoading():
      return s.buffering ? s : s.copyWith(buffering: true, viewableMs: _restartVideo(s, group));

    case MediaReady(:final durationMs, :final failed):
      final d = durationMs != null && durationMs.isFinite && durationMs > 0 ? durationMs.round() : s.durationMs;
      return s.copyWith(buffering: false, durationMs: d, displayed: s.displayed || !failed);

    case Close():
      return _closedWith(CloseReason.user, s.seq);
  }
}

/// Continuous playback restarts for a not-yet-viewed video; images keep their count.
int _restartVideo(ViewerState s, GroupLike group) {
  final story = s.storyIndex >= 0 && s.storyIndex < group.stories.length ? group.stories[s.storyIndex] : null;
  return !s.viewed && story?.type == 'video' ? 0 : s.viewableMs;
}

/// Fill (0..1) of each progress bar in the current group.
List<double> progressSegments(ViewerState s, List<GroupLike> groups) {
  if (!s.open || s.groupIndex < 0 || s.groupIndex >= groups.length) return const [];
  final group = groups[s.groupIndex];
  final current = s.durationMs > 0 ? (s.elapsedMs / s.durationMs).clamp(0, 1).toDouble() : 0.0;
  return [
    for (var i = 0; i < group.stories.length; i++) i < s.storyIndex ? 1.0 : (i == s.storyIndex ? current : 0.0),
  ];
}
