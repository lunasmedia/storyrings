import Foundation

// The /v1/feed response: parsed defensively (spec/cases/feed.json), then typed for the UI.

public struct StoriesError: Error, Equatable, CustomStringConvertible, Sendable {
    /// invalid_token, unknown_bar, network, server, invalid_response.
    public let code: String
    public let message: String
    public let status: Int?

    public init(_ code: String, _ message: String, status: Int? = nil) {
        self.code = code
        self.message = message
        self.status = status
    }

    public var description: String { "StoriesError(\(code)): \(message)" }
}

/// Shape and size of every item in the bar, from the dashboard.
public struct BarLayout: Equatable, Sendable {
    public let width: Int
    public let height: Int
    /// Corner rounding as % of the shorter side: 50 = circle, 0 = square.
    public let corner: Int
    public let gap: Int

    public var cornerRadius: Double { Double(min(width, height)) * Double(corner) / 100 }

    public var json: [String: Any] { ["width": width, "height": height, "corner": corner, "gap": gap] }

    public static let defaults = BarLayout(width: 68, height: 68, corner: 50, gap: 14)

    private static let limits: [(String, Double, Double)] = [
        ("width", 40, 160), ("height", 40, 240), ("corner", 0, 50), ("gap", 0, 48),
    ]

    /// Fills in and clamps a layout; unknown or invalid values fall back to the defaults.
    public static func resolve(_ input: Any?) -> BarLayout {
        var out = defaults.json as! [String: Int]
        if let input = object(input) {
            for (key, lo, hi) in limits {
                guard let v = number(input[key]), v.isFinite else { continue }
                out[key] = Int(min(hi, max(lo, v)).rounded())
            }
        }
        return BarLayout(width: out["width"]!, height: out["height"]!, corner: out["corner"]!, gap: out["gap"]!)
    }
}

/// Defensive parsing at the JSON level, exactly like the other SDKs: malformed groups and
/// stories are dropped rather than crashing the app. Unknown fields are kept.
public func normalizeFeedJSON(_ body: Any?) throws -> [String: Any] {
    guard let body = object(body), let rawGroups = array(body["groups"]), let app = object(body["app"]) else {
        throw StoriesError("invalid_response", "Unexpected feed format")
    }
    func validStory(_ any: Any) -> Bool {
        guard let s = object(any), value(s["id"]) is String, value(s["url"]) is String,
              let type = value(s["type"]) as? String, type == "image" || type == "video",
              let d = number(s["durationMs"]), d > 0
        else { return false }
        return true
    }
    var groups: [[String: Any]] = []
    for any in rawGroups {
        guard var g = object(any), value(g["id"]) is String, value(g["title"]) is String,
              let stories = array(g["stories"])
        else { continue }
        let valid = stories.filter(validStory)
        if valid.isEmpty { continue }
        g["stories"] = valid
        groups.append(g)
    }
    var appOut: [String: Any] = [
        "id": stringify(app["id"]),
        "deepLinkSchemes": value(app["deepLinkSchemes"]) ?? [Any](),
        "sharing": bool(app["sharing"]) == true,
    ]
    if let link = value(app["shareLink"]) as? String { appOut["shareLink"] = link }
    if object(app["layout"]) != nil { appOut["layout"] = BarLayout.resolve(app["layout"]).json }
    var out: [String: Any] = ["app": appOut, "groups": groups]
    if let bar = object(body["bar"]), let key = value(bar["key"]) as? String {
        out["bar"] = ["id": stringify(bar["id"]), "key": key]
    }
    return out
}

public struct RingStyle: Equatable, Sendable {
    /// gradient, solid or none.
    public var style: String
    public var colors: [String]
    public var angle: Double
    public var width: Double
    public var gap: Double
    /// "background", "transparent" or a hex colour.
    public var gapColor: String
    public var seenColor: String
    /// none, rotate, pulse or shimmer.
    public var animation: String
    /// slow, normal or fast.
    public var speed: String
    public var animateOnlyUnseen: Bool
}

public struct BadgeStyle: Equatable, Sendable {
    /// none, preset, text, emoji or countdown.
    public var type: String
    public var text: String
    public var background: String
    public var color: String
    /// bottom or top-right.
    public var position: String
}

public struct TitleStyle: Equatable, Sendable {
    public var hidden: Bool
    /// "inherit" or a hex colour.
    public var color: String
    public var weight: Int
    public var maxLines: Int
}

/// A group's resolved circle style, as sent by the server (dashboard defaults when absent).
public struct Appearance: Equatable, Sendable {
    public var ring: RingStyle
    public var badge: BadgeStyle
    public var title: TitleStyle

    public static let defaults = Appearance(
        ring: RingStyle(
            style: "gradient", colors: ["#feda75", "#d62976", "#962fbf"], angle: 45, width: 3, gap: 2,
            gapColor: "background", seenColor: "#c7c7cc", animation: "none", speed: "normal",
            animateOnlyUnseen: true
        ),
        badge: BadgeStyle(type: "none", text: "", background: "#e8175d", color: "#ffffff", position: "bottom"),
        title: TitleStyle(hidden: false, color: "inherit", weight: 400, maxLines: 1)
    )

    public init(ring: RingStyle, badge: BadgeStyle, title: TitleStyle) {
        self.ring = ring
        self.badge = badge
        self.title = title
    }

    public init(json: Any?) {
        guard let json = object(json) else {
            self = .defaults
            return
        }
        let d = Appearance.defaults
        let r = object(json["ring"]) ?? [:]
        let b = object(json["badge"]) ?? [:]
        let t = object(json["title"]) ?? [:]
        func str(_ m: [String: Any], _ k: String, _ fallback: String) -> String { value(m[k]) as? String ?? fallback }
        func num(_ m: [String: Any], _ k: String, _ fallback: Double) -> Double { number(m[k]) ?? fallback }
        ring = RingStyle(
            style: str(r, "style", d.ring.style),
            colors: array(r["colors"]).map { $0.compactMap { $0 as? String } } ?? d.ring.colors,
            angle: num(r, "angle", d.ring.angle),
            width: num(r, "width", d.ring.width),
            gap: num(r, "gap", d.ring.gap),
            gapColor: str(r, "gapColor", d.ring.gapColor),
            seenColor: str(r, "seenColor", d.ring.seenColor),
            animation: str(r, "animation", d.ring.animation),
            speed: str(r, "speed", d.ring.speed),
            animateOnlyUnseen: bool(r["animateOnlyUnseen"]) ?? d.ring.animateOnlyUnseen
        )
        badge = BadgeStyle(
            type: str(b, "type", d.badge.type),
            text: str(b, "text", d.badge.text),
            background: str(b, "background", d.badge.background),
            color: str(b, "color", d.badge.color),
            position: str(b, "position", d.badge.position)
        )
        title = TitleStyle(
            hidden: bool(t["hidden"]) ?? d.title.hidden,
            color: str(t, "color", d.title.color),
            weight: Int(num(t, "weight", Double(d.title.weight))),
            maxLines: Int(num(t, "maxLines", Double(d.title.maxLines)))
        )
    }

    /// Text in the badge, or nil if there's none. Countdowns need the group's end date.
    public func badgeLabel(endsAt: Date?, now: Date = Date()) -> String? {
        switch badge.type {
        case "none":
            return nil
        case "countdown":
            guard let endsAt else { return nil }
            return formatCountdown(ms: Int(endsAt.timeIntervalSince(now) * 1000))
        default:
            return badge.text.isEmpty ? nil : badge.text
        }
    }
}

/// "2d", "5h", "12m"; nil once the time is up.
public func formatCountdown(ms: Int) -> String? {
    if ms <= 0 { return nil }
    let minutes = Int((Double(ms) / 60000).rounded(.up))
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 48 { return "\(hours)h" }
    return "\(hours / 24)d"
}

public struct FeedStory: Equatable, Sendable, Identifiable {
    public let id: String
    public let type: String
    public let url: String
    public let durationMs: Int
    public let title: String?
    public let width: Int?
    public let height: Int?
    public let alt: String
    public let ctaLabel: String?
    public let ctaURL: String?
    public let ctaStyle: CtaStyle
    /// Interactive stickers drawn over the image.
    public let interactions: [Interaction]
    /// How it fits the screen.
    public let look: StoryLook

    init(json: [String: Any]) {
        id = json["id"] as! String
        type = json["type"] as! String
        url = json["url"] as! String
        durationMs = Int(number(json["durationMs"])!.rounded())
        title = value(json["title"]) as? String
        width = number(json["width"]).map { Int($0) }
        height = number(json["height"]).map { Int($0) }
        alt = value(json["alt"]) as? String ?? ""
        let cta = object(json["cta"])
        ctaLabel = value(cta?["label"]) as? String
        ctaURL = value(cta?["url"]) as? String
        ctaStyle = CtaStyle(json: cta?["style"])
        interactions = parseInteractions(json["interactions"])
        look = StoryLook(json: json)
    }

    public var viewer: ViewerStory { ViewerStory(id: id, durationMs: durationMs, type: type) }
}

public struct FeedGroup: Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    /// Still cover (also the poster of animated covers).
    public let coverURL: String
    /// Looping muted video for animated covers.
    public let coverVideoURL: String?
    public let stories: [FeedStory]
    public let appearance: Appearance
    public let endsAt: Date?

    init(json: [String: Any]) {
        id = json["id"] as! String
        title = json["title"] as! String
        let cover = object(json["cover"])
        coverURL = value(cover?["image"]) as? String ?? (value(json["coverUrl"]).map(stringify) ?? "")
        coverVideoURL = value(cover?["video"]) as? String
        stories = (array(json["stories"]) ?? []).compactMap(object).map(FeedStory.init(json:))
        appearance = Appearance(json: json["appearance"])
        endsAt = (value(json["endsAt"]) as? String).flatMap(parseDate)
    }

    public var viewer: ViewerGroup { ViewerGroup(id: id, stories: stories.map(\.viewer)) }
}

private func parseDate(_ s: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
}

public struct Feed: Equatable, Sendable {
    public let appId: String
    public let deepLinkSchemes: [String]
    public let sharing: Bool
    /// The app's share link with {group}/{story} placeholders (set when sharing is on).
    public let shareLink: String?
    public let layout: BarLayout?
    public let barKey: String?
    public let groups: [FeedGroup]

    /// From a raw /v1/feed body. Throws ``StoriesError`` for an unusable response.
    public init(body: Any?) throws {
        self.init(normalized: try normalizeFeedJSON(body))
    }

    public init(normalized json: [String: Any]) {
        let app = object(json["app"]) ?? [:]
        appId = stringify(app["id"])
        deepLinkSchemes = (array(app["deepLinkSchemes"]) ?? []).compactMap { $0 as? String }
        sharing = bool(app["sharing"]) == true
        shareLink = value(app["shareLink"]) as? String
        layout = value(app["layout"]) == nil ? nil : BarLayout.resolve(app["layout"])
        barKey = value(object(json["bar"])?["key"]) as? String
        groups = (array(json["groups"]) ?? []).compactMap(object).map(FeedGroup.init(json:))
    }

    public var viewerGroups: [ViewerGroup] { groups.map(\.viewer) }
}
