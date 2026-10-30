import Foundation

// User tags and story group tag filters (spec/cases/tags.json).

public enum Tags {
    /// Lowercase letters, digits and . _ : - (e.g. "london", "city:london").
    public static let pattern = "^[a-z0-9][a-z0-9._:-]{0,63}$"
    public static let maxPerPerson = 50

    private static let regex = try! NSRegularExpression(pattern: pattern)

    static func isValid(_ tag: String) -> Bool {
        regex.firstMatch(in: tag, range: NSRange(tag.startIndex..., in: tag)) != nil
    }
}

/// Lowercased, trimmed, de-duplicated and sorted; anything that isn't a valid tag is dropped.
/// Accepts an array or a comma-separated string.
public func normalizeTags(_ tags: Any?) -> [String] {
    let list: [Any]
    if let s = tags as? String {
        list = s.components(separatedBy: ",")
    } else {
        list = tags as? [Any] ?? []
    }
    var out = Set<String>()
    for raw in list {
        guard let raw = raw as? String else { continue }
        let tag = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if Tags.isValid(tag) { out.insert(tag) }
    }
    return Array(out.sorted().prefix(Tags.maxPerPerson))
}

public struct TagCondition: Equatable, Sendable {
    /// "include" (people with any of the tags pass) or "exclude" (people with none of them pass).
    public let mode: String
    public let tags: [String]

    public init(mode: String, tags: [String]) {
        self.mode = mode
        self.tags = tags
    }
}

/// Every condition must pass.
public func matchesTagFilter(_ conditions: [TagCondition], _ tags: Set<String>) -> Bool {
    conditions.allSatisfy { c in
        let any = c.tags.contains(where: tags.contains)
        return c.mode == "include" ? any : !any
    }
}
