// Conformance: every case in /spec/cases must give its `expect` result with the Swift code,
// exactly as it does for the other SDKs (see spec/README.md).
import Foundation
import XCTest
@testable import StoryRingsCore

private let specURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().appendingPathComponent("spec")

private func readJSON(_ url: URL) throws -> Any {
    try JSONSerialization.jsonObject(with: Data(contentsOf: url), options: [.fragmentsAllowed])
}

/// JSON round trip, so results compare like the decoded expectations (1 == 1.0).
private func roundTrip(_ value: Any) throws -> Any {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
}

private func pretty(_ value: Any) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed])) ?? Data()
    return String(data: data, encoding: .utf8) ?? "\(value)"
}

private func num(_ any: Any?) -> Int { (any as? NSNumber)?.intValue ?? 0 }

final class ConformanceTests: XCTestCase {
    func testConstantsMatchSpec() throws {
        let c = try readJSON(specURL.appendingPathComponent("constants.json")) as! [String: Any]
        XCTAssertEqual(c["viewableMs"] as? [String: Int], ["image": Viewable.imageMs, "video": Viewable.videoMs])
        XCTAssertEqual(c["tapMaxMs"] as? Int, Gestures.tapMaxMs)
        XCTAssertEqual(c["sessionTimeoutMs"] as? Int, Sessions.timeoutMs)
        XCTAssertEqual(c["viewerIdMaxAgeMs"] as? Int, Sessions.viewerIdMaxAgeMs)
        XCTAssertEqual(c["seenMaxIds"] as? Int, SeenStore.maxIds)
        XCTAssertEqual(c["analytics"] as? [String: Int], [
            "flushIntervalMs": AnalyticsQueue.flushIntervalMs,
            "maxBatch": AnalyticsQueue.maxBatchDefault,
            "maxQueue": AnalyticsQueue.maxQueueDefault,
        ])
        let tags = c["tags"] as! [String: Any]
        XCTAssertEqual(tags["pattern"] as? String, Tags.pattern)
        XCTAssertEqual(tags["maxPerPerson"] as? Int, Tags.maxPerPerson)
        let labels = c["labels"] as! [String: Any]
        XCTAssertEqual(labels["openGroup"] as? [String], [
            StoriesLabels.openGroup("Sale", count: 1, seen: false),
            StoriesLabels.openGroup("Sale", count: 3, seen: true),
        ])
        XCTAssertEqual(labels["storyPosition"] as? String, StoriesLabels.storyPosition("Sale", index: 0, total: 3))
        XCTAssertEqual(labels["viewer"] as? String, StoriesLabels.viewer("Sale"))
        for (key, value) in [
            "close": StoriesLabels.close, "pause": StoriesLabels.pause, "play": StoriesLabels.play,
            "mute": StoriesLabels.mute, "unmute": StoriesLabels.unmute, "previous": StoriesLabels.previous,
            "next": StoriesLabels.next, "share": StoriesLabels.share, "linkCopied": StoriesLabels.linkCopied,
            "shareFailed": StoriesLabels.shareFailed, "bar": StoriesLabels.bar, "loading": StoriesLabels.loading,
        ] {
            XCTAssertEqual(labels[key] as? String, value, "label \(key)")
        }
        XCTAssertEqual(labels["countdownUnits"] as? [String], InteractionLabels.countdownUnits)
        XCTAssertEqual(labels["countdownEnded"] as? String, InteractionLabels.countdownEnded)
        XCTAssertEqual(labels["pollOption"] as? String, InteractionLabels.pollOption("Red", percent: 40))
        XCTAssertEqual(labels["slider"] as? String, InteractionLabels.slider("How hot?"))
        XCTAssertEqual(labels["sliderAverage"] as? String, InteractionLabels.sliderAverage)
        XCTAssertEqual(c["answersMaxIds"] as? Int, AnswerStore.maxIds)
        XCTAssertEqual((c["storage"] as? [String: String])?["answers"], "stories:answers:<appId>")
        XCTAssertEqual(c["interactions"] as? [String: AnyHashable], [
            "unitsPerWidth": Int(Interactions.unitsPerWidth), "defaultAccent": Interactions.defaultAccent,
            "defaultEmoji": Interactions.defaultEmoji, "correctColor": Interactions.correctColor,
            "wrongColor": Interactions.wrongColor,
        ])
    }

    func testEverySuiteHasAnAdapter() throws {
        for file in try caseFiles() {
            let suite = (try readJSON(file) as! [String: Any])["suite"] as! String
            XCTAssertNotNil(suites[suite], "no Swift adapter for \"\(suite)\"")
        }
    }

    func testViewer() throws { try run("viewer") }
    func testFeed() throws { try run("feed") }
    func testTags() throws { try run("tags") }
    func testLinks() throws { try run("links") }
    func testGestures() throws { try run("gestures") }
    func testSeen() throws { try run("seen") }
    func testAnalytics() throws { try run("analytics") }
    func testSessions() throws { try run("sessions") }
    func testInteractions() throws { try run("interactions") }
    func testDisplay() throws { try run("display") }

    private func caseFiles() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: specURL.appendingPathComponent("cases"), includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.path < $1.path }
    }

    private func run(_ suite: String) throws {
        let data = try readJSON(specURL.appendingPathComponent("cases/\(suite).json")) as! [String: Any]
        let adapter = try XCTUnwrap(suites[suite])
        let cases = data["cases"] as! [[String: Any]]
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            let name = c["name"] as! String
            let actual = try roundTrip(adapter(c["input"] as! [String: Any]))
            let expected = c["expect"]!
            if !(actual as AnyObject).isEqual(expected) {
                XCTFail("\(suite): \(name)\nExpected:\n\(pretty(expected))\nActual:\n\(pretty(actual))")
            }
        }
    }
}

private typealias Adapter = ([String: Any]) -> Any

private let suites: [String: Adapter] = [
    "viewer": viewer, "feed": feed, "tags": tags, "links": links, "gestures": gestures,
    "seen": seen, "analytics": analytics, "sessions": sessions, "interactions": interactions,
    "display": { StoryLook(json: $0["story"] as! [String: Any]).json },
]

// MARK: interactions

private func interactions(_ input: [String: Any]) -> Any {
    let r3 = { (v: Double) in (v * 1000).rounded() / 1000 }
    switch input["op"] as! String {
    case "parse":
        return ["interactions": parseInteractions(input["interactions"]).map(\.json)]
    case "place":
        let c = input["container"] as! [NSNumber]
        let m = input["media"] as? [NSNumber]
        let p = placeInteraction(
            container: (c[0].doubleValue, c[1].doubleValue),
            media: m.map { ($0[0].doubleValue, $0[1].doubleValue) },
            cover: input["fit"] as? String == "cover",
            x: (input["x"] as! NSNumber).doubleValue, y: (input["y"] as! NSNumber).doubleValue,
            width: (input["width"] as! NSNumber).doubleValue
        )
        return ["x": r3(p.x), "y": r3(p.y), "width": r3(p.width), "scale": r3(p.scale)]
    case "percentages":
        return ["percents": percentages((input["counts"] as! [NSNumber]).map(\.intValue))]
    case "countdown":
        let c = countdownParts(endsAt: parseISODate(input["endsAt"] as! String)!, now: parseISODate(input["now"] as! String)!)
        return ["ended": c.ended, "days": c.days, "hours": c.hours, "minutes": c.minutes, "seconds": c.seconds]
    default:
        fatalError("unknown op")
    }
}

// MARK: viewer

private func action(_ a: [String: Any]) -> ViewerAction {
    switch a["type"] as! String {
    case "NEXT": return .next(auto: a["auto"] as? Bool == true)
    case "PREV": return .prev
    case "NEXT_GROUP": return .nextGroup
    case "PREV_GROUP": return .prevGroup
    case "TICK": return .tick(ms: num(a["ms"]))
    case "PAUSE": return .pause
    case "RESUME": return .resume
    case "MEDIA_LOADING": return .mediaLoading
    case "HIDE": return .hide
    case "SHOW": return .show
    case "MEDIA_READY": return .mediaReady(durationMs: (a["durationMs"] as? NSNumber)?.doubleValue, failed: a["failed"] as? Bool == true)
    case "CLOSE": return .close
    default: fatalError("Unknown action \(a)")
    }
}

private func viewer(_ input: [String: Any]) -> Any {
    let groups = (input["groups"] as! [[String: Any]]).map { g in
        ViewerGroup(id: g["id"] as! String, stories: (g["stories"] as! [[String: Any]]).map { s in
            ViewerStory(id: s["id"] as! String, durationMs: num(s["durationMs"]), type: s["type"] as? String ?? "image")
        })
    }
    let starts = input["startStoryIndex"] as? [String: Any] ?? [:]
    let start: StartStoryIndex = { num(starts["\($0)"]) }
    func snap(_ s: ViewerState) -> [String: Any] {
        var out = s.json
        out["at"] = s.open ? groups[s.groupIndex].stories[s.storyIndex].id : "closed"
        return out
    }
    let opened = openViewer(groups, num(input["open"]), startStoryIndex: start)
    var state = opened
    var steps: [Any] = []
    for raw in input["steps"] as! [[String: Any]] {
        let a = action(raw)
        let next = reduce(state, a, groups, startStoryIndex: start)
        let events = actionEvents(state, a, groups) + transitionEvents(state, next, groups)
        state = next
        steps.append([
            "action": raw,
            "state": snap(next),
            "events": events.map(\.json),
            "progress": progressSegments(next, groups),
        ] as [String: Any])
    }
    return [
        "opened": snap(opened),
        "events": transitionEvents(.closed, opened, groups).map(\.json),
        "steps": steps,
    ] as [String: Any]
}

// MARK: feed / tags / links

private func feed(_ input: [String: Any]) -> Any {
    do {
        return ["feed": try normalizeFeedJSON(input["body"])]
    } catch let e as StoriesError {
        return ["error": e.code]
    } catch {
        return ["error": "\(error)"]
    }
}

private func tags(_ input: [String: Any]) -> Any {
    if input["op"] as? String == "normalize" { return ["tags": normalizeTags(input["tags"])] }
    let conditions = (input["conditions"] as! [[String: Any]]).map {
        TagCondition(mode: $0["mode"] as! String, tags: $0["tags"] as! [String])
    }
    return ["matches": matchesTagFilter(conditions, Set(input["tags"] as! [String]))]
}

private func links(_ input: [String: Any]) -> Any {
    let target = input["target"] as? [String: Any]
    switch input["op"] as! String {
    case "shareUrl":
        return ["url": shareURL(input["pageUrl"] as! String, groupId: target!["groupId"] as! String, storyId: target!["storyId"] as? String)]
    case "parseShareLink":
        guard let t = parseShareLink(input["url"] as! String) else { return ["target": NSNull()] }
        var out: [String: Any] = ["groupId": t.groupId]
        if let s = t.storyId { out["storyId"] = s }
        return ["target": out]
    case "withoutShareLink":
        return ["url": withoutShareLink(input["url"] as! String)]
    case "appShareUrl":
        return ["url": appShareURL(input["template"] as! String, groupId: target!["groupId"] as! String, storyId: target!["storyId"] as! String)]
    case "ctaAllowed":
        return ["allowed": isAllowedCtaURL(input["url"] as! String, deepLinkSchemes: input["schemes"] as? [String] ?? [])]
    case "ctaStyle":
        let style = CtaStyle(json: input["style"])
        return ["style": style.rawValue, "swipe": style.isSwipe]
    default:
        fatalError("Unknown links op \(input)")
    }
}

// MARK: gestures / seen

private func gestures(_ input: [String: Any]) -> Any {
    var calls: [Any] = []
    let r = GestureRecognizer(GestureHandlers(
        onTap: { calls.append(["tap", ($0 * 1000).rounded() / 1000]) },
        onPress: { calls.append(["press"]) },
        onRelease: { calls.append(["release"]) },
        onSwipe: { calls.append(["swipe", $0.rawValue]) },
        onDrag: { calls.append(["drag", $0, $1]) }
    ))
    let width = (input["width"] as! NSNumber).doubleValue
    for e in input["events"] as! [[Any]] {
        func n(_ i: Int) -> Double { (e[i] as! NSNumber).doubleValue }
        switch e[0] as! String {
        case "down": r.down(n(1), n(2), num(e[3]))
        case "move": r.move(n(1), n(2))
        case "up": r.up(n(1), n(2), num(e[3]), width: width)
        default: r.cancel()
        }
    }
    return ["calls": calls]
}

private func seen(_ input: [String: Any]) -> Any {
    let store = SeenStore(storage: nil, appId: "app")
    var results: [Any] = []
    for op in input["ops"] as! [[Any]] {
        switch op[0] as! String {
        case "markSeen":
            store.markSeen(op[1] as! String)
            results.append(NSNull())
        case "markMany":
            for i in 0..<num(op[2]) { store.markSeen("\(op[1] as! String)\(i)") }
            results.append(NSNull())
        case "has":
            results.append(store.has(op[1] as! String))
        case "isGroupSeen":
            results.append(store.isGroupSeen(op[1] as! [String]))
        case "firstUnseenIndex":
            results.append(store.firstUnseenIndex(op[1] as! [String]))
        default:
            fatalError("Unknown seen op \(op)")
        }
    }
    return ["results": results]
}

// MARK: analytics / sessions

private func analytics(_ input: [String: Any]) -> Any {
    let options = input["options"] as! [String: Any]
    var now = 0
    var failNext = 0
    var sent: [[String: Any]] = []
    let viewerId = options["viewer"] as? String
    let queue = AnalyticsQueue(
        url: "https://api.example.com/v1/events?token=pk_live_x",
        sdk: options["sdk"] as! String,
        transport: { _, body, beacon, completion in
            let parsed = try! JSONSerialization.jsonObject(with: Data(body.utf8))
            sent.append(["body": parsed, "beacon": beacon])
            if failNext > 0 {
                failNext -= 1
                completion(false)
            } else {
                completion(true)
            }
        },
        flushInterval: 365 * 86400,
        maxBatch: (options["maxBatch"] as? Int) ?? 50,
        maxQueue: (options["maxQueue"] as? Int) ?? 500,
        now: { now },
        sessionId: options["sessionId"] as! String,
        viewer: viewerId.map { id in { id } },
        platform: options["platform"] as? String,
        automation: options["automation"] as? Bool == true
    )
    var steps: [Any] = []
    for step in input["steps"] as! [[String: Any]] {
        let before = sent.count
        if let track = step["track"] as? [String: Any] {
            if let at = step["at"] { now = num(at) }
            queue.track(track)
        } else if let f = step["flush"] as? [String: Any] {
            failNext = num(f["fail"])
            queue.flush(beacon: f["beacon"] as? Bool == true)
        }
        steps.append(["sent": Array(sent[before...]), "pending": queue.pending] as [String: Any])
    }
    queue.cancelTimer()
    return ["steps": steps]
}

private func sessions(_ input: [String: Any]) -> Any {
    if input["op"] as? String == "newSession" {
        return ["newSession": Sessions.startsNew(leftAt: (input["leftAt"] as? NSNumber)?.intValue, now: num(input["now"]))]
    }
    let storage = MemoryStorage()
    let stored = input["stored"]
    if let stored {
        if let s = stored as? String {
            storage.setItem("stories:viewer", s)
        } else {
            let data = try! JSONSerialization.data(withJSONObject: stored, options: [.fragmentsAllowed])
            storage.setItem("stories:viewer", String(data: data, encoding: .utf8)!)
        }
    }
    let id = Sessions.loadViewerId(storage, now: num(input["now"]))
    let keptId = (stored as? [String: Any])?["id"] as? String
    return ["kept": id != nil && id == keptId, "stored": storage.getItem("stories:viewer") != nil]
}
