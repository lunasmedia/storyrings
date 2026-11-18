import Foundation

// The Energized style's order (spec/cases/energized.json).

/// How long each group's story previews in its card before the next card takes a turn.
public let energizedPreviewMs = 7000

/// The card previewing now: which group, its story (always the first), and which turn this is.
public struct EnergizedPreview: Equatable, Sendable {
    public let groupIndex: Int
    public let storyIndex: Int
    public let storyId: String
    /// Goes up every time a preview starts (even the same group again): restart the media.
    public let turn: Int

    public var json: [String: Any] {
        ["groupIndex": groupIndex, "storyIndex": storyIndex, "storyId": storyId, "turn": turn]
    }
}

/// One group at a time shows its first story (only ever the first, seen or not) inside its card
/// for ``energizedPreviewMs``, then the next group does, through every group in bar order and back
/// to the first; the UI scrolls each card into view for its turn. It starts from the first fully
/// visible group. When the bar is scrolled so that the card previewing is no longer fully
/// visible, it starts again from the first visible one. The UI reports which cards are fully
/// on screen, passes time with ``tick(_:)`` and draws ``current``.
public final class EnergizedCycle {
    /// Each group's story ids, in bar order.
    private var groups: [[String]]
    /// Indexes of the groups with stories, in bar order: the turns go through these.
    private var order: [Int] = []
    /// Indexes of the groups with stories whose cards are fully on screen.
    private var visible: [Int] = []
    /// Where in `order` the preview is, or nil when nothing previews.
    private var position: Int?
    private var elapsed = 0
    private var turns = 0

    public init(groups: [[String]]) {
        self.groups = groups
        order = withStories(Array(groups.indices))
    }

    /// New feed: starts again from the first visible group that still has stories.
    public func setGroups(_ groups: [[String]]) {
        self.groups = groups
        order = withStories(Array(groups.indices))
        visible = withStories(visible)
        restart()
    }

    /// Indexes of the groups whose cards are fully on screen, in any order. Groups without
    /// stories are skipped. While the card previewing is among them nothing changes (the bar
    /// scrolled to it, or only a little); otherwise it starts again from the first.
    public func setVisible(_ indexes: [Int]) {
        visible = withStories(indexes)
        if let index = currentIndex, visible.contains(index) { return }
        restart()
    }

    /// Time passing (only while previews may play: on screen, nothing covering the bar).
    public func tick(_ ms: Int) {
        guard var p = position, ms > 0 else { return }
        elapsed += ms
        while elapsed >= energizedPreviewMs {
            elapsed -= energizedPreviewMs
            p = (p + 1) % order.count
            turns += 1
        }
        position = p
    }

    /// Milliseconds left of the current preview (for scheduling the next tick).
    public var remainingMs: Int { position == nil ? 0 : energizedPreviewMs - elapsed }

    public var current: EnergizedPreview? {
        guard let groupIndex = currentIndex, let first = groups[groupIndex].first else { return nil }
        return EnergizedPreview(groupIndex: groupIndex, storyIndex: 0, storyId: first, turn: turns)
    }

    private var currentIndex: Int? {
        guard let p = position, order.indices.contains(p) else { return nil }
        return order[p]
    }

    /// From the first visible group, or nothing when none is.
    private func restart() {
        elapsed = 0
        position = visible.first.flatMap { order.firstIndex(of: $0) }
        if position != nil { turns += 1 }
    }

    private func withStories(_ indexes: [Int]) -> [Int] {
        Set(indexes).filter { $0 >= 0 && $0 < groups.count && !groups[$0].isEmpty }.sorted()
    }
}
