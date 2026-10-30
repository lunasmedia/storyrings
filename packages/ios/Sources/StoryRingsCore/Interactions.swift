import Foundation

// Interactive stickers: polls, quizzes, emoji sliders, links and countdowns drawn over a story's
// image (spec/README.md, "Interactions"; spec/cases/interactions.json).

public enum Interactions {
    /// Sizes inside a sticker are in units of its displayed width / 600.
    public static let unitsPerWidth = 600.0
    public static let defaultAccent = "#c2255c"
    public static let defaultEmoji = "😍"
    public static let correctColor = "#2f9e44"
    public static let wrongColor = "#e03131"
    static let designWidth = 1080.0
    static let designHeight = 1920.0
}

public struct Interaction: Equatable, Sendable, Identifiable {
    public enum Kind: Equatable, Sendable {
        case poll(question: String, options: [String])
        case quiz(question: String, options: [String], correct: Int)
        case slider(question: String, emoji: String)
        case link(label: String, url: String)
        case countdown(title: String, endsAt: Date)
    }

    public let id: String
    /// Centre and width in the story image's 1080 × 1920 design space.
    public let x: Double
    public let y: Double
    public let width: Double
    /// "#rrggbb".
    public let accent: String
    public let kind: Kind
    /// The raw `endsAt`, kept as sent.
    let endsAtText: String?

    /// Polls, quizzes and sliders take answers.
    public var answerable: Bool {
        switch kind {
        case .poll, .quiz, .slider: return true
        default: return false
        }
    }

    var json: [String: Any] {
        var out: [String: Any] = ["id": id, "x": x, "y": y, "width": width, "accent": accent]
        switch kind {
        case let .poll(q, o): out.merge(["kind": "poll", "question": q, "options": o]) { $1 }
        case let .quiz(q, o, c): out.merge(["kind": "quiz", "question": q, "options": o, "correct": c]) { $1 }
        case let .slider(q, e): out.merge(["kind": "slider", "question": q, "emoji": e]) { $1 }
        case let .link(l, u): out.merge(["kind": "link", "label": l, "url": u]) { $1 }
        case let .countdown(t, _): out.merge(["kind": "countdown", "title": t, "endsAt": endsAtText ?? ""]) { $1 }
        }
        return out
    }
}

/// ISO times like 2026-12-01T18:00:00.000Z or 2026-12-01T18:00:00Z.
func parseISODate(_ s: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
}

/// A story's `interactions` from the feed; malformed stickers are dropped.
public func parseInteractions(_ raw: Any?) -> [Interaction] {
    guard let list = array(raw) else { return [] }
    var out: [Interaction] = []
    for any in list {
        guard let r = object(any), let id = value(r["id"]) as? String,
              let x = number(r["x"]), let y = number(r["y"]), let width = number(r["width"]), width > 0
        else { continue }
        var accent = Interactions.defaultAccent
        if let a = value(r["accent"]) as? String, a.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil {
            accent = a
        }
        let text = { (key: String) in value(r[key]) as? String ?? "" }
        let options = Array((array(r["options"]) ?? []).compactMap { value($0) as? String }.prefix(4))
        var kind: Interaction.Kind?
        var endsAtText: String?
        switch value(r["kind"]) as? String {
        case "poll":
            if options.count >= 2 { kind = .poll(question: text("question"), options: options) }
        case "quiz":
            if options.count >= 2, let c = number(r["correct"]), c.rounded() == c, c >= 0, Int(c) < options.count {
                kind = .quiz(question: text("question"), options: options, correct: Int(c))
            }
        case "slider":
            let emoji = text("emoji")
            kind = .slider(question: text("question"), emoji: emoji.isEmpty ? Interactions.defaultEmoji : emoji)
        case "link":
            if let label = value(r["label"]) as? String, !label.isEmpty, let url = value(r["url"]) as? String {
                kind = .link(label: label, url: url)
            }
        case "countdown":
            if let s = value(r["endsAt"]) as? String, let d = parseISODate(s) {
                kind = .countdown(title: text("title"), endsAt: d)
                endsAtText = s
            }
        default:
            break
        }
        if let kind {
            out.append(Interaction(id: id, x: x, y: y, width: width, accent: accent, kind: kind, endsAtText: endsAtText))
        }
    }
    return out
}

public struct Placement: Equatable, Sendable {
    /// Centre, in the viewer's coordinates.
    public let x: Double
    public let y: Double
    /// Displayed width.
    public let width: Double
    /// Displayed points per design pixel.
    public let scale: Double
}

/// Where a sticker goes on the story image as displayed: the image (its size, or 1080 × 1920 when
/// unknown) is fitted into the container (`cover` or `contain`), and the design space mapped onto it.
public func placeInteraction(container: (width: Double, height: Double), media: (width: Double, height: Double)?,
                             cover: Bool, x: Double, y: Double, width: Double) -> Placement {
    let mw = (media?.width ?? 0) > 0 ? media!.width : Interactions.designWidth
    let mh = (media?.height ?? 0) > 0 ? media!.height : Interactions.designHeight
    let s = cover ? max(container.width / mw, container.height / mh) : min(container.width / mw, container.height / mh)
    let w = mw * s, h = mh * s
    let left = (container.width - w) / 2, top = (container.height - h) / 2
    let k = w / Interactions.designWidth
    return Placement(x: left + x * k, y: top + y * h / Interactions.designHeight, width: width * k, scale: k)
}

/// Whole percentages that add up to 100 (largest remainder; ties go to the earlier option).
public func percentages(_ counts: [Int]) -> [Int] {
    let total = counts.reduce(0, +)
    guard total > 0 else { return counts.map { _ in 0 } }
    let exact = counts.map { Double($0) * 100 / Double(total) }
    var out = exact.map { Int($0.rounded(.down)) }
    var left = 100 - out.reduce(0, +)
    let order = exact.indices.sorted {
        let a = exact[$0] - exact[$0].rounded(.down), b = exact[$1] - exact[$1].rounded(.down)
        return a != b ? a > b : $0 < $1
    }
    for i in order where left > 0 {
        out[i] += 1
        left -= 1
    }
    return out
}

public struct CountdownParts: Equatable, Sendable {
    public let ended: Bool
    public let days: Int
    public let hours: Int
    public let minutes: Int
    public let seconds: Int
}

public func countdownParts(endsAt: Date, now: Date = Date()) -> CountdownParts {
    let left = Int((endsAt.timeIntervalSince(now)).rounded(.down))
    guard left > 0 else { return CountdownParts(ended: true, days: 0, hours: 0, minutes: 0, seconds: 0) }
    return CountdownParts(ended: false, days: left / 86400, hours: left % 86400 / 3600, minutes: left % 3600 / 60, seconds: left % 60)
}

/// What people answered so far: votes per option (poll, quiz) or the average (slider, 0–100).
public struct AnswerResults: Equatable, Sendable {
    public let total: Int
    public let counts: [Int]?
    public let average: Int?

    public init?(json: Any?) {
        guard let o = object(json), let total = number(o["total"]) else { return nil }
        self.total = Int(total)
        counts = array(o["counts"])?.compactMap { number($0).map { Int($0) } }
        average = number(o["average"]).map { Int($0) }
    }

    var json: [String: Any] {
        var out: [String: Any] = ["total": total]
        if let counts { out["counts"] = counts }
        if let average { out["average"] = average }
        return out
    }
}

/// A person's answer to a sticker, and the results they were shown.
public struct StoredAnswer: Equatable, Sendable {
    public let value: Int
    public let results: AnswerResults?

    public init(value: Int, results: AnswerResults? = nil) {
        self.value = value
        self.results = results
    }
}

/// Answers kept on the device, so a story shows what the person answered when they come back.
/// Keyed by story and sticker; the oldest are dropped past ``maxIds``.
public final class AnswerStore: @unchecked Sendable {
    public static let maxIds = 200

    private let storage: KeyValueStorage?
    private let key: String
    /// Oldest first.
    private var order: [String] = []
    private var map: [String: StoredAnswer] = [:]
    private let lock = NSLock()

    public init(storage: KeyValueStorage?, appId: String) {
        self.storage = storage
        key = "stories:answers:\(appId)"
        guard let raw = storage?.getItem(key), let data = raw.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return }
        // JSON objects keep no order when decoded here; the stored "order" list does.
        let keys = (obj["__order"] as? [String]) ?? Array(obj.keys)
        for k in keys where k != "__order" {
            guard let a = object(obj[k]), let v = number(a["value"]) else { continue }
            map[k] = StoredAnswer(value: Int(v), results: AnswerResults(json: a["results"]))
            order.append(k)
        }
    }

    public func get(storyId: String, interactionId: String) -> StoredAnswer? {
        lock.lock(); defer { lock.unlock() }
        return map["\(storyId):\(interactionId)"]
    }

    public func set(storyId: String, interactionId: String, _ answer: StoredAnswer) {
        lock.lock()
        let k = "\(storyId):\(interactionId)"
        order.removeAll { $0 == k }
        order.append(k)
        map[k] = answer
        if order.count > Self.maxIds {
            for old in order.prefix(order.count - Self.maxIds) { map[old] = nil }
            order.removeFirst(order.count - Self.maxIds)
        }
        var obj: [String: Any] = ["__order": order]
        for k in order {
            guard let a = map[k] else { continue }
            var e: [String: Any] = ["value": a.value]
            if let r = a.results { e["results"] = r.json }
            obj[k] = e
        }
        lock.unlock()
        if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) {
            storage?.setItem(key, s)
        }
    }
}

public func answersURL(apiURL: String, token: String) -> URL? {
    var base = apiURL
    while base.hasSuffix("/") { base.removeLast() }
    let t = token.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? token
    return URL(string: "\(base)/v1/answers?token=\(t)")
}

/// The JSON body of an answer.
public func answerBody(storyId: String, interactionId: String, value: Int, viewer: String?) -> Data {
    var body: [String: Any] = ["storyId": storyId, "interactionId": interactionId, "value": value]
    if let viewer { body["viewer"] = viewer }
    return (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
}

public enum InteractionLabels {
    public static let countdownUnits = ["days", "hours", "mins", "secs"]
    public static let countdownEnded = "Ended"
    public static func pollOption(_ option: String, percent: Int) -> String { "\(option), \(percent)%" }
    public static func slider(_ question: String) -> String { question.isEmpty ? "Slide to answer" : "\(question) Slide to answer" }
    public static let sliderAverage = "Average"
}

// MARK: Fitting the screen (spec/cases/display.json)

/// How a story fits the screen: covering it, or shown whole with the gaps in `fill` colours;
/// and a designed video's overlay.
public struct StoryLook: Equatable, Sendable {
    /// Covers the screen (edges may be cropped). False: shown whole ("fit").
    public let fills: Bool
    /// Gap colours for a story shown whole, top to bottom ("#rrggbb"); nil = black.
    public let fillTop: String?
    public let fillBottom: String?
    /// A designed video's text and stickers: a transparent 1080 × 1920 image drawn over it,
    /// fitted as a story image would be. Videos only, http(s) only; nil = none.
    public let overlay: String?

    public init(json: [String: Any]) {
        fills = value(json["fit"]) as? String == "fill"
        let f = object(json["fill"])
        let hex = { (s: Any?) -> String? in
            guard let s = value(s) as? String, s.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else { return nil }
            return s
        }
        if !fills, let top = hex(f?["top"]), let bottom = hex(f?["bottom"]) {
            fillTop = top
            fillBottom = bottom
        } else {
            fillTop = nil
            fillBottom = nil
        }
        if value(json["type"]) as? String == "video", let o = value(json["overlay"]) as? String,
           o.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil {
            overlay = o
        } else {
            overlay = nil
        }
    }

    var json: [String: Any] {
        var out: [String: Any] = ["fit": fills ? "fill" : "fit"]
        if let fillTop, let fillBottom { out["fill"] = ["top": fillTop, "bottom": fillBottom] } else { out["fill"] = NSNull() }
        out["overlay"] = overlay ?? NSNull()
        return out
    }
}
