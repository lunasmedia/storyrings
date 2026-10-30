#if canImport(UIKit)
import XCTest
@testable import StoryRings

private func story(_ id: String, title: String? = nil, cta: [String: String]? = nil) -> [String: Any] {
    var s: [String: Any] = [
        "id": id, "type": "image", "url": "https://cdn.example.com/\(id).jpg", "durationMs": 5000,
        "alt": "Slide \(id)",
    ]
    if let title { s["title"] = title }
    if let cta { s["cta"] = cta }
    return s
}

private func feedBody(sharing: Bool = false, shareLink: String? = nil) -> [String: Any] {
    var app: [String: Any] = ["id": "app-1", "deepLinkSchemes": ["myshop"], "sharing": sharing]
    if let shareLink { app["shareLink"] = shareLink }
    return [
        "app": app,
        "bar": ["id": "bar-1", "key": "main"],
        "groups": [
            ["id": "g1", "title": "Sale", "coverUrl": "https://cdn.example.com/c1.png", "stories": [
                story("s1", title: "First"),
                story("s2", title: "Second", cta: ["label": "Shop now", "url": "https://shop.example.com/sale"]),
            ]],
            ["id": "g2", "title": "New in", "coverUrl": "https://cdn.example.com/c2.png", "stories": [story("s3", title: "Third")]],
        ],
    ]
}

/// A fake Stories API behind URLProtocol: serves the feed and records analytics batches.
final class FakeAPI: URLProtocol {
    static var feedStatus = 200
    static var feed: [String: Any] = feedBody()
    static var feedURLs: [URL] = []
    static var batches: [[String: Any]] = []

    static func reset() {
        feedStatus = 200
        feed = feedBody()
        feedURLs = []
        batches = []
    }

    static var session: URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FakeAPI.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        var status = 204
        var data = Data()
        if url.path == "/v1/feed" {
            Self.feedURLs.append(url)
            status = Self.feedStatus
            let error: [String: Any] = ["error": ["code": "unauthorized"]]
            data = try! JSONSerialization.data(withJSONObject: status == 200 ? Self.feed : error)
        } else {
            // URLSession hands URLProtocol the body as a stream.
            var body = request.httpBody
            if body == nil, let stream = request.httpBodyStream { body = read(stream) }
            if let body, let batch = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] {
                Self.batches.append(batch)
            }
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}

private var tokenCount = 0

final class ClientTests: XCTestCase {
    override func setUp() { FakeAPI.reset() }

    /// A fresh token each time, so tests don't share a client.
    private func start(analytics: Bool = true) -> StoriesClient {
        tokenCount += 1
        return StoriesClient.start(
            token: "pk_live_test\(tokenCount)", apiURL: "https://api.example.com/", analytics: analytics,
            storage: MemoryStorage(), session: FakeAPI.session
        )
    }

    private func load(_ client: StoriesClient, bar: String = "", tags: [String] = []) -> Result<Feed, StoriesError> {
        let done = expectation(description: "feed")
        var result: Result<Feed, StoriesError>!
        client.loadFeed(bar: bar, tags: tags) {
            result = $0
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        return result
    }

    func testSendsTheBarKeyAndTagsAndRemembersTheFeed() throws {
        let client = start()
        let feed = try load(client, bar: "product-page", tags: normalizeTags(["Premium", " london "])).get()
        XCTAssertEqual(feed.groups.map(\.id), ["g1", "g2"])
        let query = URLComponents(url: try XCTUnwrap(FakeAPI.feedURLs.first), resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(query.first { $0.name == "bar" }?.value, "product-page")
        XCTAssertEqual(query.first { $0.name == "tags" }?.value, "london,premium")
        XCTAssertEqual(client.cachedFeed(bar: "product-page", tags: ["london", "premium"])?.groups.count, 2)
        // A second bar showing it doesn't refetch.
        _ = load(client, bar: "product-page", tags: ["london", "premium"])
        XCTAssertEqual(FakeAPI.feedURLs.count, 1)
        client.dispose()
    }

    func testReportsARejectedToken() {
        FakeAPI.feedStatus = 401
        let client = start()
        guard case let .failure(error) = load(client) else { return XCTFail("expected a failure") }
        XCTAssertEqual(error.code, "invalid_token")
        client.dispose()
    }

    func testCountsAnAppSessionAsIOS() {
        let client = start()
        client.dispose() // sends what's queued
        let sent = expectation(description: "batch")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { sent.fulfill() }
        wait(for: [sent], timeout: 3)
        let batch = FakeAPI.batches.first
        XCTAssertEqual(batch?["sdk"] as? String, "ios@\(storiesSDKVersion)")
        XCTAssertEqual(batch?["platform"] as? String, "ios")
        XCTAssertNotNil(batch?["viewer"] as? String)
        XCTAssertEqual((batch?["events"] as? [[String: Any]])?.first?["type"] as? String, "app_open")
    }
}

final class ViewerModelTests: XCTestCase {
    private var events: [StoryEvent] = []
    private var finished: CloseReason?

    private func viewer(_ body: [String: Any] = feedBody(), group: Int = 0, callbacks: ViewerCallbacks = ViewerCallbacks()) throws -> ViewerModel {
        events = []
        finished = nil
        return ViewerModel(
            feed: try Feed(body: body), groupIndex: group, seen: SeenStore(storage: nil, appId: "app-1"),
            track: { [unowned self] in self.events.append($0) }, callbacks: callbacks,
            onFinish: { [unowned self] in self.finished = $0 }
        )
    }

    private func tap(_ model: ViewerModel, x: Double) {
        model.gestures.down(x, 300, 0)
        model.gestures.up(x, 300, 100, width: 400)
    }

    private var types: [String] { events.map(\.type) }

    func testTapsMoveForwardAndBackAndAreReported() throws {
        let model = try viewer()
        XCTAssertEqual(types, ["group_open"])
        tap(model, x: 300)
        XCTAssertEqual(model.story.id, "s2")
        tap(model, x: 40)
        XCTAssertEqual(model.story.id, "s1")
        XCTAssertEqual(types, ["group_open", "tap_forward", "tap_back"])
        XCTAssertEqual(events[1].storyId, "s1")
    }

    func testSwipesChangeGroupAndSwipeDownCloses() throws {
        let model = try viewer()
        model.gestures.down(300, 300, 0)
        model.gestures.move(150, 305)
        model.gestures.up(100, 305, 200, width: 400)
        XCTAssertEqual(model.group.id, "g2")
        model.gestures.down(200, 100, 1000)
        model.gestures.move(200, 200)
        model.gestures.up(200, 300, 1200, width: 400)
        XCTAssertEqual(finished, .user)
        XCTAssertEqual(types, ["group_open", "group_skip", "group_open", "exit"])
    }

    func testHoldingPausesAndReleasingResumes() throws {
        let model = try viewer()
        model.gestures.down(200, 300, 0)
        XCTAssertTrue(model.state.paused)
        model.gestures.up(200, 300, 800, width: 400)
        XCTAssertFalse(model.state.paused)
        XCTAssertEqual(model.story.id, "s1")
    }

    func testLetsTheAppHandleAStoryButton() throws {
        var opened: String?
        var callbacks = ViewerCallbacks()
        callbacks.onCtaClick = { event in
            opened = event.url
            event.close()
            return .handled
        }
        let model = try viewer(callbacks: callbacks)
        tap(model, x: 300)
        model.cta()
        XCTAssertEqual(opened, "https://shop.example.com/sale")
        XCTAssertEqual(finished, .user)
        XCTAssertTrue(types.contains("cta_click"))
    }

    func testShareFillsInTheStoryLinkOnlyWhenSharingIsOn() throws {
        XCTAssertFalse(try viewer().canShare)
        var shared: ShareEvent?
        var callbacks = ViewerCallbacks()
        callbacks.onShare = { shared = $0; return .handled }
        let model = try viewer(
            feedBody(sharing: true, shareLink: "https://news.example.com/stories/{group}/{story}"), group: 1, callbacks: callbacks
        )
        XCTAssertTrue(model.canShare)
        model.share()
        XCTAssertEqual(shared?.url, "https://news.example.com/stories/g2/s3")
        XCTAssertEqual(shared?.title, "Third")
        XCTAssertEqual(events.last, StoryEvent("share", groupId: "g2", storyId: "s3"))
    }

    func testStartsAtTheFirstUnseenStory() throws {
        let seen = SeenStore(storage: nil, appId: "app-1")
        seen.markSeen("s1")
        let model = ViewerModel(
            feed: try Feed(body: feedBody()), groupIndex: 0, seen: seen, track: { _ in }, callbacks: ViewerCallbacks(), onFinish: { _ in }
        )
        XCTAssertEqual(model.story.id, "s2")
    }

    func testAnswersAStickerAndKeepsTheResults() throws {
        var body = feedBody()
        var groups = body["groups"] as! [[String: Any]]
        var stories = groups[0]["stories"] as! [[String: Any]]
        stories[0]["interactions"] = [[
            "id": "p1", "kind": "poll", "x": 540, "y": 1200, "width": 760, "accent": "#c2255c",
            "question": "Which?", "options": ["Red", "Blue"],
        ]]
        groups[0]["stories"] = stories
        body["groups"] = groups
        let answers = AnswerStore(storage: MemoryStorage(), appId: "app-1")
        var sent: [(String, String, Int)] = []
        var reply: ((AnswerResults?) -> Void)?
        let model = ViewerModel(
            feed: try Feed(body: body), groupIndex: 0, seen: SeenStore(storage: nil, appId: "app-1"),
            track: { _ in }, callbacks: ViewerCallbacks(), answers: answers,
            sendAnswer: { story, id, value, done in sent.append((story, id, value)); reply = done },
            onFinish: { _ in }
        )
        let poll = try XCTUnwrap(model.story.interactions.first)
        model.answer(poll, value: 1)
        XCTAssertEqual(sent.map(\.2), [1])
        XCTAssertEqual(answers.get(storyId: "s1", interactionId: "p1"), StoredAnswer(value: 1))
        reply?(AnswerResults(json: ["total": 4, "counts": [1, 3]]))
        XCTAssertEqual(answers.get(storyId: "s1", interactionId: "p1")?.results?.counts, [1, 3])
        XCTAssertEqual(model.answersVersion, 2)
        // Answering doesn't move to another story.
        XCTAssertEqual(model.story.id, "s1")
    }

    func testLinkStickersWorkLikeTheButton() throws {
        var clicked: CtaClickEvent?
        var callbacks = ViewerCallbacks()
        callbacks.onCtaClick = { clicked = $0; return .handled }
        let model = try viewer(callbacks: callbacks)
        model.openLink(label: "Shop", url: "myshop://sale")
        XCTAssertEqual(clicked?.url, "myshop://sale")
        XCTAssertEqual(events.last?.json["type"] as? String, "cta_click")
    }
}
#endif
