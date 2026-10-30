#if canImport(UIKit)
import Foundation
import UIKit

/// The SDK version, sent with analytics as `ios@<version>`.
public let storiesSDKVersion = "0.1.0"

/// Loads feeds and holds per-app state (seen stories, analytics) shared by every story bar,
/// like the other SDKs' clients. Use it from the main thread.
public final class StoriesClient {
    public let token: String
    public let apiURL: String
    public let analytics: Bool
    public let storage: KeyValueStorage

    private let session: URLSession
    private var queue: AnalyticsQueue?
    private var viewerId: String?
    private var reachOn = false
    private var leftAt: Int?
    private var feeds: [String: [(Result<Feed, StoriesError>) -> Void]] = [:]
    /// The last feed per story bar this launch, so bars that reappear don't refetch.
    private var latest: [String: Feed] = [:]
    private var seen: [String: SeenStore] = [:]
    private var answers: [String: AnswerStore] = [:]
    private var observers: [NSObjectProtocol] = []

    private static var clients: [String: StoriesClient] = [:]

    /// One client per token / API URL / analytics setting, shared by every bar.
    /// Call it at app launch so sessions (active users) are counted before a bar is on screen.
    @discardableResult
    public static func start(
        token: String,
        apiURL: String,
        analytics: Bool = true,
        reach: Bool = true,
        storage: KeyValueStorage? = nil,
        session: URLSession = .shared
    ) -> StoriesClient {
        precondition(!token.isEmpty, "Stories: a public token is required")
        let key = "\(token)|\(apiURL)|\(analytics)"
        if let existing = clients[key] { return existing }
        let client = StoriesClient(
            token: token, apiURL: apiURL, analytics: analytics, reach: reach,
            storage: storage ?? UserDefaultsStorage(), session: session
        )
        clients[key] = client
        return client
    }

    private init(token: String, apiURL: String, analytics: Bool, reach: Bool, storage: KeyValueStorage, session: URLSession) {
        self.token = token
        self.apiURL = apiURL.hasSuffix("/") ? String(apiURL.dropLast()) : apiURL
        self.analytics = analytics
        self.storage = storage
        self.session = session
        guard analytics else { return }
        queue = AnalyticsQueue(
            url: "\(self.apiURL)/v1/events?token=\(encodeQuery(token))",
            sdk: "ios@\(storiesSDKVersion)",
            transport: { [weak self] url, body, beacon, completion in
                self?.send(url, body, beacon: beacon, completion: completion) ?? completion(false)
            },
            viewer: { [weak self] in self?.viewerId },
            platform: "ios"
        )
        if reach { setReach(true) }
        // A session starts now, and again after 30+ minutes away (the Firebase rule).
        queue?.track(["type": "app_open"])
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.didEnterBackground()
        })
        observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.willEnterForeground()
        })
    }

    private func didEnterBackground() {
        if leftAt == nil { leftAt = nowMs() }
        // Send what's queued before the app is suspended, with a little background time to finish.
        let app = UIApplication.shared
        let task = BackgroundTask()
        task.id = app.beginBackgroundTask(withName: "Stories analytics") { task.end() }
        queue?.flush(beacon: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { task.end() }
    }

    private func willEnterForeground() {
        if Sessions.startsNew(leftAt: leftAt, now: nowMs()) { queue?.track(["type": "app_open"]) }
        leftAt = nil
    }

    /// Turns unique-viewer counting on or off (e.g. when someone gives or withdraws consent).
    /// Turning it off also deletes the stored anonymous ID.
    public func setReach(_ enabled: Bool) {
        reachOn = enabled && queue != nil
        if !reachOn {
            viewerId = nil
            if !enabled { Sessions.clearViewerId(storage) }
            return
        }
        viewerId = Sessions.loadViewerId(storage)
    }

    func track(_ event: StoryEvent) { queue?.track(event.json) }

    private func feedKey(_ bar: String, _ tags: [String]) -> String {
        "stories:feed:\(token)\(bar.isEmpty ? "" : ":\(bar)")\(tags.isEmpty ? "" : "#\(tags.joined(separator: ","))")"
    }

    /// Fetches a story bar's feed once per launch (again with `force`), sharing one request
    /// between bars that ask at the same time.
    /// `bar`: its key from the dashboard ("" = the main bar). `tags` must be normalised.
    func loadFeed(bar: String, tags: [String], force: Bool = false, completion: @escaping (Result<Feed, StoriesError>) -> Void) {
        let key = feedKey(bar, tags)
        if !force, let feed = latest[key] { return completion(.success(feed)) }
        if feeds[key] != nil {
            feeds[key]!.append(completion)
            return
        }
        feeds[key] = [completion]
        fetch(bar: bar, tags: tags) { [weak self] result in
            guard let self else { return }
            let waiting = self.feeds.removeValue(forKey: key) ?? []
            let typed = result.map { normalized -> Feed in
                // Remembered so the next launch can show the bar before the network answers.
                if let data = try? JSONSerialization.data(withJSONObject: normalized),
                   let s = String(data: data, encoding: .utf8) {
                    self.storage.setItem(key, s)
                }
                let feed = Feed(normalized: normalized)
                self.latest[key] = feed
                return feed
            }
            waiting.forEach { $0(typed) }
        }
    }

    /// A story bar's feed from the previous launch, if any.
    func cachedFeed(bar: String, tags: [String]) -> Feed? {
        guard let raw = storage.getItem(feedKey(bar, tags)), let data = raw.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        return Feed(normalized: json)
    }

    private func fetch(bar: String, tags: [String], completion: @escaping (Result<[String: Any], StoriesError>) -> Void) {
        var components = URLComponents(string: "\(apiURL)/v1/feed")
        var query = [URLQueryItem(name: "token", value: token)]
        if !bar.isEmpty { query.append(URLQueryItem(name: "bar", value: bar)) }
        if !tags.isEmpty { query.append(URLQueryItem(name: "tags", value: tags.joined(separator: ","))) }
        components?.queryItems = query
        guard let url = components?.url else {
            completion(.failure(StoriesError("network", "Invalid Stories API URL: \(apiURL)")))
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        session.dataTask(with: request) { data, response, error in
            let result: Result<[String: Any], StoriesError>
            if error != nil || data == nil {
                result = .failure(StoriesError("network", "Could not reach the Stories API"))
            } else {
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 401 {
                    result = .failure(StoriesError("invalid_token", "Invalid Stories token", status: 401))
                } else if status == 404 && !bar.isEmpty {
                    result = .failure(StoriesError(
                        "unknown_bar",
                        "No story bar with the key \"\(bar)\" for this token. Check the key under Settings → Apps & websites in the dashboard.",
                        status: 404
                    ))
                } else if status >= 400 {
                    result = .failure(StoriesError("server", "Stories API error (\(status))", status: status))
                } else if let body = try? JSONSerialization.jsonObject(with: data!) {
                    do {
                        result = .success(try normalizeFeedJSON(body))
                    } catch let e as StoriesError {
                        result = .failure(e)
                    } catch {
                        result = .failure(StoriesError("invalid_response", "Unexpected feed format", status: status))
                    }
                } else {
                    result = .failure(StoriesError("invalid_response", "Stories API returned invalid JSON", status: status))
                }
            }
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }

    func seenStore(_ appId: String) -> SeenStore {
        if let s = seen[appId] { return s }
        let s = SeenStore(storage: storage, appId: appId)
        seen[appId] = s
        return s
    }

    /// Answers to polls, quizzes and sliders kept on this device.
    func answerStore(_ appId: String) -> AnswerStore {
        if let s = answers[appId] { return s }
        let s = AnswerStore(storage: storage, appId: appId)
        answers[appId] = s
        return s
    }

    /// Sends an answer to a poll, quiz or slider; completes on the main thread with the results,
    /// or nil if it couldn't be sent.
    func sendAnswer(storyId: String, interactionId: String, value: Int, completion: @escaping (AnswerResults?) -> Void) {
        guard let url = answersURL(apiURL: apiURL, token: token) else { return completion(nil) }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("text/plain;charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = answerBody(storyId: storyId, interactionId: interactionId, value: value, viewer: viewerId)
        session.dataTask(with: request) { data, response, _ in
            let ok = ((response as? HTTPURLResponse)?.statusCode ?? 0) == 200
            let json = ok ? data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] : nil
            let results = AnswerResults(json: json?["results"])
            DispatchQueue.main.async { completion(results) }
        }.resume()
    }

    private func send(_ url: String, _ body: String, beacon: Bool, completion: @escaping (Bool) -> Void) {
        guard let target = URL(string: url) else { return completion(false) }
        var request = URLRequest(url: target, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("text/plain;charset=UTF-8", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        session.dataTask(with: request) { _, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            // 4xx means the batch itself is bad: retrying won't help, so it counts as handled.
            completion(error == nil && status < 500)
        }.resume()
    }

    /// Stops analytics and lifecycle observing (tests, or a sign-out that should stop counting).
    public func dispose() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        queue?.dispose()
        queue = nil
        Self.clients = Self.clients.filter { $0.value !== self }
    }
}

/// A background task that can be ended once, from either the expiry handler or a timer.
private final class BackgroundTask {
    var id = UIBackgroundTaskIdentifier.invalid
    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}

private let queryAllowed = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
)

func encodeQuery(_ s: String) -> String {
    s.addingPercentEncoding(withAllowedCharacters: queryAllowed) ?? s
}
#endif
