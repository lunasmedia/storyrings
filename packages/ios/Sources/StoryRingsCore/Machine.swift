import Foundation

// The story viewer as a pure state machine: a port of `@stories/core`'s machine.ts.
// The UI dispatches actions from taps, swipes and timers and draws whatever state comes
// back. Behaviour is pinned by spec/cases/viewer.json.

/// A story as far as the viewer is concerned.
public struct ViewerStory: Equatable, Sendable {
    public let id: String
    public let durationMs: Int
    /// "image" or "video"; decides the viewability rule.
    public let type: String

    public init(id: String, durationMs: Int, type: String = "image") {
        self.id = id
        self.durationMs = durationMs
        self.type = type
    }
}

public struct ViewerGroup: Equatable, Sendable {
    public let id: String
    public let stories: [ViewerStory]

    public init(id: String, stories: [ViewerStory]) {
        self.id = id
        self.stories = stories
    }
}

/// MRC/IAB viewability (docs/metrics.md): images need 1 s on screen, videos 2 s of
/// continuous playback, after the media has rendered.
public enum Viewable {
    public static let imageMs = 1000
    public static let videoMs = 2000
}

public enum CloseReason: String, Sendable {
    case user, completed
}

public struct ViewerState: Equatable, Sendable {
    public var open: Bool
    public var groupIndex: Int
    public var storyIndex: Int
    /// Time shown so far for the current story.
    public var elapsedMs: Int
    public var durationMs: Int
    /// Paused by the person (hold, pause button).
    public var paused: Bool
    /// Media is loading; the timer doesn't run.
    public var buffering: Bool
    /// The current story's media has rendered (stays false if it failed).
    public var displayed: Bool
    /// The viewer is off screen (app in the background).
    public var hidden: Bool
    /// Continuous viewable time of the current story so far.
    public var viewableMs: Int
    /// The current story met the viewability rule; analytics count it as viewed.
    public var viewed: Bool
    public var closeReason: CloseReason?
    /// Goes up each time a story starts (including restarting one): reload media when it changes.
    public var seq: Int

    public static let closed = ViewerState(
        open: false, groupIndex: 0, storyIndex: 0, elapsedMs: 0, durationMs: 0, paused: false,
        buffering: false, displayed: false, hidden: false, viewableMs: 0, viewed: false,
        closeReason: nil, seq: 0
    )

    static func closed(_ reason: CloseReason, seq: Int) -> ViewerState {
        var s = ViewerState.closed
        s.closeReason = reason
        s.seq = seq
        return s
    }

    public var json: [String: Any] {
        [
            "open": open, "groupIndex": groupIndex, "storyIndex": storyIndex,
            "elapsedMs": elapsedMs, "durationMs": durationMs, "paused": paused,
            "buffering": buffering, "displayed": displayed, "hidden": hidden,
            "viewableMs": viewableMs, "viewed": viewed,
            "closeReason": closeReason?.rawValue ?? NSNull(), "seq": seq,
        ]
    }
}

public enum ViewerAction: Equatable, Sendable {
    /// Next story. `auto`: the story ended by itself (a video finished), not a tap.
    case next(auto: Bool = false)
    case prev
    case nextGroup
    case prevGroup
    case tick(ms: Int)
    case pause
    case resume
    case mediaLoading
    /// Media can play. `failed`: it couldn't load; the timer runs anyway so the viewer moves on.
    case mediaReady(durationMs: Double? = nil, failed: Bool = false)
    /// The viewer went off screen / came back (app backgrounded).
    case hide
    case show
    case close
}

/// Story to start at when entering a group going forward (e.g. the first unseen one).
public typealias StartStoryIndex = (Int) -> Int

private func show(_ s: ViewerState, _ groups: [ViewerGroup], _ groupIndex: Int, _ storyIndex: Int) -> ViewerState {
    guard groups.indices.contains(groupIndex), groups[groupIndex].stories.indices.contains(storyIndex) else {
        return .closed(.completed, seq: s.seq)
    }
    let story = groups[groupIndex].stories[storyIndex]
    return ViewerState(
        open: true, groupIndex: groupIndex, storyIndex: storyIndex, elapsedMs: 0,
        durationMs: story.durationMs, paused: false, buffering: true, displayed: false,
        hidden: s.hidden, viewableMs: 0, viewed: false, closeReason: nil, seq: s.seq + 1
    )
}

private func entryIndex(_ groups: [ViewerGroup], _ groupIndex: Int, _ start: StartStoryIndex?) -> Int {
    let count = groups.indices.contains(groupIndex) ? groups[groupIndex].stories.count : 0
    let wanted = start?(groupIndex) ?? 0
    return wanted >= 0 && wanted < count ? wanted : 0
}

/// Opens the viewer on a group, at its start story.
public func openViewer(_ groups: [ViewerGroup], _ groupIndex: Int, startStoryIndex: StartStoryIndex? = nil) -> ViewerState {
    guard groups.indices.contains(groupIndex), !groups[groupIndex].stories.isEmpty else { return .closed }
    return show(.closed, groups, groupIndex, entryIndex(groups, groupIndex, startStoryIndex))
}

private func nextGroup(_ s: ViewerState, _ groups: [ViewerGroup], _ start: StartStoryIndex?) -> ViewerState {
    let g = s.groupIndex + 1
    if g >= groups.count { return .closed(.completed, seq: s.seq) }
    return show(s, groups, g, entryIndex(groups, g, start))
}

/// Continuous playback restarts for a not-yet-viewed video; images keep their count.
private func restartVideo(_ s: ViewerState, _ group: ViewerGroup) -> Int {
    let story = group.stories.indices.contains(s.storyIndex) ? group.stories[s.storyIndex] : nil
    return !s.viewed && story?.type == "video" ? 0 : s.viewableMs
}

public func reduce(
    _ s: ViewerState, _ action: ViewerAction, _ groups: [ViewerGroup], startStoryIndex: StartStoryIndex? = nil
) -> ViewerState {
    if !s.open { return s }
    guard groups.indices.contains(s.groupIndex) else { return .closed(.user, seq: s.seq) }
    let group = groups[s.groupIndex]
    let lastStory = group.stories.count - 1
    var out = s

    switch action {
    case .next:
        return s.storyIndex < lastStory
            ? show(s, groups, s.groupIndex, s.storyIndex + 1)
            : nextGroup(s, groups, startStoryIndex)

    case .prev:
        if s.storyIndex > 0 { return show(s, groups, s.groupIndex, s.storyIndex - 1) }
        if s.groupIndex > 0 {
            // Like Instagram: back from a group's first story lands on the previous group's last.
            let prev = groups[s.groupIndex - 1]
            return show(s, groups, s.groupIndex - 1, prev.stories.count - 1)
        }
        // Very first story: restart it.
        return show(s, groups, 0, 0)

    case .nextGroup:
        return nextGroup(s, groups, startStoryIndex)

    case .prevGroup:
        return show(s, groups, s.groupIndex > 0 ? s.groupIndex - 1 : 0, 0)

    case let .tick(ms):
        if ms <= 0 { return s }
        let story = group.stories.indices.contains(s.storyIndex) ? group.stories[s.storyIndex] : nil
        let video = story?.type == "video"
        // Images are viewable while on screen (even when held paused); videos only while playing.
        let accruing = s.displayed && !s.viewed && !s.hidden && (!video || (!s.paused && !s.buffering))
        let viewable = accruing ? s.viewableMs + ms : s.viewableMs
        let justViewed = accruing && viewable >= (video ? Viewable.videoMs : Viewable.imageMs)
        if s.paused || s.buffering {
            if !accruing { return s }
            out.viewableMs = viewable
            out.viewed = justViewed
            return out
        }
        let elapsed = s.elapsedMs + ms
        // Report the view before moving on, so a story that ends right as it qualifies counts.
        if justViewed {
            out.viewableMs = viewable
            out.viewed = true
            out.elapsedMs = min(elapsed, s.durationMs)
            return out
        }
        if elapsed >= s.durationMs {
            return reduce(s, .next(), groups, startStoryIndex: startStoryIndex)
        }
        out.elapsedMs = elapsed
        out.viewableMs = viewable
        return out

    case .hide:
        // Off screen breaks continuity: the count starts again when it's back.
        if s.hidden { return s }
        out.hidden = true
        out.viewableMs = s.viewed ? s.viewableMs : 0
        return out

    case .show:
        out.hidden = false
        return out

    case .pause:
        // A paused video isn't playing, so its continuous playback count restarts.
        if s.paused { return s }
        out.paused = true
        out.viewableMs = restartVideo(s, group)
        return out

    case .resume:
        out.paused = false
        return out

    case .mediaLoading:
        if s.buffering { return s }
        out.buffering = true
        out.viewableMs = restartVideo(s, group)
        return out

    case let .mediaReady(durationMs, failed):
        if let d = durationMs, d.isFinite, d > 0 { out.durationMs = Int(d.rounded()) }
        out.buffering = false
        out.displayed = s.displayed || !failed
        return out

    case .close:
        return .closed(.user, seq: s.seq)
    }
}

/// Fill (0...1) of each progress bar in the current group.
public func progressSegments(_ s: ViewerState, _ groups: [ViewerGroup]) -> [Double] {
    guard s.open, groups.indices.contains(s.groupIndex) else { return [] }
    let group = groups[s.groupIndex]
    let current = s.durationMs > 0 ? min(1, max(0, Double(s.elapsedMs) / Double(s.durationMs))) : 0
    return group.stories.indices.map { i in
        i < s.storyIndex ? 1 : (i == s.storyIndex ? current : 0)
    }
}
