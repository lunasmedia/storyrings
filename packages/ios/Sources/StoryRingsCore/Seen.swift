import Foundation

// Which stories this device has seen (spec/cases/seen.json).

/// A group counts as seen when all of its current stories are, so adding a story makes its
/// ring active again. Only the newest ``maxIds`` ids are kept.
public final class SeenStore {
    public static let maxIds = 1000

    private let storage: KeyValueStorage?
    private let key: String
    /// Oldest first.
    private var order: [String] = []
    private var ids = Set<String>()

    public init(storage: KeyValueStorage?, appId: String) {
        self.storage = storage
        key = "stories:seen:\(appId)"
        load()
    }

    private func load() {
        guard let raw = storage?.getItem(key), let data = raw.data(using: .utf8),
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [Any]
        else { return }
        // Storage unavailable or corrupt: start empty.
        for case let id as String in list where ids.insert(id).inserted { order.append(id) }
    }

    public func has(_ storyId: String) -> Bool { ids.contains(storyId) }

    public func markSeen(_ storyId: String) {
        guard ids.insert(storyId).inserted else { return }
        order.append(storyId)
        if order.count > Self.maxIds {
            let drop = order.count - Self.maxIds
            for id in order.prefix(drop) { ids.remove(id) }
            order.removeFirst(drop)
        }
        persist()
    }

    public func isGroupSeen(_ storyIds: [String]) -> Bool {
        !storyIds.isEmpty && storyIds.allSatisfy(ids.contains)
    }

    /// First unseen story in a group, or 0 if it's fully seen (it replays from the start).
    public func firstUnseenIndex(_ storyIds: [String]) -> Int {
        storyIds.firstIndex { !ids.contains($0) } ?? 0
    }

    private func persist() {
        guard let storage, let data = try? JSONSerialization.data(withJSONObject: order),
              let s = String(data: data, encoding: .utf8)
        else { return }
        storage.setItem(key, s)
    }
}
