/// Analytics events derived from the viewer (a port of `@stories/core` viewer events;
/// definitions in docs/metrics.md, pinned by spec/cases/viewer.json).
library;

import 'machine.dart';

/// A story event: about a group (and story), in the bar or the viewer.
class StoryEvent {
  const StoryEvent(this.type, this.groupId, {this.storyId, this.bar});
  final String type;
  final String groupId;
  final String? storyId;

  /// Key of the story bar it happened in; null = the main bar.
  final String? bar;

  StoryEvent withBar(String? bar) => StoryEvent(type, groupId, storyId: storyId, bar: bar);

  Map<String, Object?> toJson() => {
        'type': type,
        'groupId': groupId,
        if (storyId != null) 'storyId': storyId,
        if (bar != null) 'bar': bar,
      };
}

/// Activity outside the bar: `app_open` when an app session starts.
class ActivityEvent {
  const ActivityEvent(this.type);
  final String type;
  Map<String, Object?> toJson() => {'type': type};
}

/// Events from a change of viewer state:
/// - group_complete when moving forward past a group's last story after it was shown
/// - group_open when the viewer opens on a group or moves to another one
/// - story_view once a story meets the viewability rule
List<StoryEvent> transitionEvents(ViewerState prev, ViewerState next, List<GroupLike> groups) {
  final events = <StoryEvent>[];
  final prevGroup = prev.groupIndex >= 0 && prev.groupIndex < groups.length ? groups[prev.groupIndex] : null;
  if (prev.open && prevGroup != null) {
    final wasLast = prev.storyIndex == prevGroup.stories.length - 1;
    final movedForward = next.open ? next.groupIndex > prev.groupIndex : next.closeReason == CloseReason.completed;
    if (wasLast && movedForward && prev.displayed) {
      events.add(StoryEvent('group_complete', prevGroup.id));
    }
  }
  if (!next.open) return events;
  if (next.groupIndex < 0 || next.groupIndex >= groups.length) return events;
  final group = groups[next.groupIndex];
  if (next.storyIndex < 0 || next.storyIndex >= group.stories.length) return events;
  final story = group.stories[next.storyIndex];
  final sameStory = prev.open && prev.seq == next.seq;
  if (!sameStory && (!prev.open || prev.groupIndex != next.groupIndex)) {
    events.add(StoryEvent('group_open', group.id));
  }
  if (next.viewed && !(sameStory && prev.viewed)) {
    events.add(StoryEvent('story_view', group.id, storyId: story.id));
  }
  return events;
}

/// Events from how the person moves (a state change alone can't tell a tap from a story
/// ending). Call with the state before the action.
/// tap_forward (Next by the person), tap_back (Prev), group_skip (NextGroup), exit (Close).
List<StoryEvent> actionEvents(ViewerState state, ViewerAction action, List<GroupLike> groups) {
  if (!state.open || state.groupIndex < 0 || state.groupIndex >= groups.length) return const [];
  final group = groups[state.groupIndex];
  if (state.storyIndex < 0 || state.storyIndex >= group.stories.length) return const [];
  final story = group.stories[state.storyIndex];
  final type = switch (action) {
    Next(:final auto) => auto ? null : 'tap_forward',
    Prev() => 'tap_back',
    NextGroup() => 'group_skip',
    Close() => 'exit',
    _ => null,
  };
  return type == null ? const [] : [StoryEvent(type, group.id, storyId: story.id)];
}
