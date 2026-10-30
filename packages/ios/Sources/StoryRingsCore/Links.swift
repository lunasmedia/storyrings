import Foundation

// Share links and which story button links may open (spec/cases/links.json).
// Works on strings rather than URL, which re-encodes some characters.

private let sharePrefix = "#stories="

/// Schemes that may never be opened from a story button.
public let blockedSchemes: Set<String> = ["javascript", "data", "vbscript", "file", "blob", "about"]

/// The scheme (as written) and the rest after the first ":", or nil if it doesn't start with
/// a valid scheme.
private func splitScheme(_ url: String) -> (scheme: String, rest: Substring)? {
    guard let colon = url.firstIndex(of: ":") else { return nil }
    let scheme = url[..<colon]
    guard let first = scheme.unicodeScalars.first, first.isASCIILetter,
          scheme.unicodeScalars.allSatisfy({ $0.isASCIILetter || $0.isASCIIDigit || "+.-".unicodeScalars.contains($0) })
    else { return nil }
    return (String(scheme), url[url.index(after: colon)...])
}

private extension Unicode.Scalar {
    var isASCIILetter: Bool { ("a"..."z").contains(self) || ("A"..."Z").contains(self) }
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}

/// A button link is allowed when it's an absolute http(s) URL or uses one of the app's own
/// deep-link schemes.
public func isAllowedCtaURL(_ url: String, deepLinkSchemes: [String] = []) -> Bool {
    // Control characters and spaces can smuggle schemes past naive checks.
    if url.unicodeScalars.contains(where: { $0.value <= 0x20 || $0.value == 0x7F }) { return false }
    guard let (rawScheme, rest) = splitScheme(url) else { return false }
    let scheme = rawScheme.lowercased()
    if blockedSchemes.contains(scheme) { return false }
    if scheme == "http" || scheme == "https" {
        guard rest.hasPrefix("//") else { return false }
        let host = rest.dropFirst(2)
        return host.first.map { !"/?#".contains($0) } ?? false
    }
    return deepLinkSchemes.contains(scheme) && !rest.isEmpty
}

/// How the story button looks: a white pill, a dark pill or an outline, or a swipe up (a
/// chevron over the label, or over a white pill), where swiping up on the story opens the link.
public enum CtaStyle: String, Equatable, Sendable, CaseIterable {
    case pill, dark, outline, swipe
    case swipePill = "swipe-pill"

    /// Anything unknown (or none, from older servers) is a pill.
    public init(json: Any?) {
        self = (json as? String).flatMap(CtaStyle.init(rawValue:)) ?? .pill
    }

    /// Swiping up on the story opens the link.
    public var isSwipe: Bool { self == .swipe || self == .swipePill }
}

/// Characters left as they are, like JavaScript's encodeURIComponent.
private let componentAllowed = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
)

func encodeComponent(_ s: String) -> String {
    s.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? s
}

/// A mobile app's link to a story: its share link (set in the dashboard) with {group} and
/// {story} filled in.
public func appShareURL(_ template: String, groupId: String, storyId: String) -> String {
    template
        .components(separatedBy: "{group}").joined(separator: encodeComponent(groupId))
        .components(separatedBy: "{story}").joined(separator: encodeComponent(storyId))
}

/// Websites: a link to a story on a page (any existing fragment is replaced).
public func shareURL(_ pageURL: String, groupId: String, storyId: String? = nil) -> String {
    let base = pageURL.firstIndex(of: "#").map { String(pageURL[..<$0]) } ?? pageURL
    return base + sharePrefix + encodeComponent(groupId) + (storyId.map { "/" + encodeComponent($0) } ?? "")
}

public struct ShareTarget: Equatable, Sendable {
    public let groupId: String
    public let storyId: String?
}

/// The story a web share link points to, or nil.
public func parseShareLink(_ url: String) -> ShareTarget? {
    guard splitScheme(url) != nil, let hash = url.firstIndex(of: "#"),
          url[hash...].hasPrefix(sharePrefix)
    else { return nil }
    let parts = url[url.index(hash, offsetBy: sharePrefix.count)...]
        .split(separator: "/", omittingEmptySubsequences: false)
    guard !parts.isEmpty, !parts[0].isEmpty, parts.count <= 2,
          let groupId = String(parts[0]).removingPercentEncoding
    else { return nil }
    if parts.count == 2 && !parts[1].isEmpty {
        guard let storyId = String(parts[1]).removingPercentEncoding else { return nil }
        return ShareTarget(groupId: groupId, storyId: storyId)
    }
    return ShareTarget(groupId: groupId, storyId: nil)
}

/// The URL without a web share link fragment (other fragments are kept).
public func withoutShareLink(_ url: String) -> String {
    guard parseShareLink(url) != nil, let hash = url.firstIndex(of: "#") else { return url }
    return String(url[..<hash])
}
