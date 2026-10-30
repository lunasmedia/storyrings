// Analytics events derived from the viewer (a port of `@stories/core` viewer events;
// definitions in docs/metrics.md, pinned by spec/cases/viewer.json).

/// A story event: about a group (and story), in the bar or the viewer.
public struct StoryEvent: Equatable, Sendable {
    public let type: String
    public let groupId: String
    public let storyId: String?
    /// Key of the story bar it happened in; nil = the main bar.
    public let bar: String?

    public init(_ type: String, groupId: String, storyId: String? = nil, bar: String? = nil) {
        self.type = type
        self.groupId = groupId
        self.storyId = storyId
        self.bar = bar
    }

    public func withBar(_ bar: String?) -> StoryEvent {
        StoryEvent(type, groupId: groupId, storyId: storyId, bar: bar)
    }

    public var json: [String: Any] {
        var out: [String: Any] = ["type": type, "groupId": groupId]
        if let storyId { out["storyId"] = storyId }
        if let bar { out["bar"] = bar }
        return out
    }
}

/// Events from a change of viewer state:
/// - group_complete when moving forward past a group's last story after it was shown
/// - group_open when the viewer opens on a group or moves to another one
/// - story_view once a story meets the viewability rule
public func transitionEvents(_ prev: ViewerState, _ next: ViewerState, _ groups: [ViewerGroup]) -> [StoryEvent] {
    var events: [StoryEvent] = []
    if prev.open, groups.indices.contains(prev.groupIndex) {
        let prevGroup = groups[prev.groupIndex]
        let wasLast = prev.storyIndex == prevGroup.stories.count - 1
        let movedForward = next.open ? next.groupIndex > prev.groupIndex : next.closeReason == .completed
        if wasLast && movedForward && prev.displayed {
            events.append(StoryEvent("group_complete", groupId: prevGroup.id))
        }
    }
    guard next.open, groups.indices.contains(next.groupIndex) else { return events }
    let group = groups[next.groupIndex]
    guard group.stories.indices.contains(next.storyIndex) else { return events }
    let story = group.stories[next.storyIndex]
    let sameStory = prev.open && prev.seq == next.seq
    if !sameStory && (!prev.open || prev.groupIndex != next.groupIndex) {
        events.append(StoryEvent("group_open", groupId: group.id))
    }
    if next.viewed && !(sameStory && prev.viewed) {
        events.append(StoryEvent("story_view", groupId: group.id, storyId: story.id))
    }
    return events
}

/// Events from how the person moves (a state change alone can't tell a tap from a story
/// ending). Call with the state before the action.
/// tap_forward (next by the person), tap_back (prev), group_skip (nextGroup), exit (close).
public func actionEvents(_ state: ViewerState, _ action: ViewerAction, _ groups: [ViewerGroup]) -> [StoryEvent] {
    guard state.open, groups.indices.contains(state.groupIndex) else { return [] }
    let group = groups[state.groupIndex]
    guard group.stories.indices.contains(state.storyIndex) else { return [] }
    let story = group.stories[state.storyIndex]
    let type: String?
    switch action {
    case let .next(auto): type = auto ? nil : "tap_forward"
    case .prev: type = "tap_back"
    case .nextGroup: type = "group_skip"
    case .close: type = "exit"
    default: type = nil
    }
    guard let type else { return [] }
    return [StoryEvent(type, groupId: group.id, storyId: story.id)]
}
