import Foundation

// Batches analytics events (spec/cases/analytics.json) and sends them to /v1/events.

/// Sends one batch and calls `completion` with whether it was accepted. `beacon`: the app is
/// going away, so the send isn't retried.
public typealias AnalyticsTransport = (_ url: String, _ body: String, _ beacon: Bool, _ completion: @escaping (Bool) -> Void) -> Void

/// Batches events and sends them every few seconds, or at once when a batch is full.
/// Use it from the main thread; the transport may call back on any thread.
public final class AnalyticsQueue {
    public static let flushIntervalMs = 5000
    public static let maxBatchDefault = 50
    public static let maxQueueDefault = 500

    public let url: String
    /// e.g. "ios@1.0.0".
    public let sdk: String
    public let sessionId: String
    /// ios or android.
    public let platform: String?
    public let automation: Bool
    private let transport: AnalyticsTransport
    private let flushInterval: TimeInterval
    private let maxBatch: Int
    /// Cap on events held while the network is failing (the oldest are dropped).
    private let maxQueue: Int
    private let now: () -> Int
    /// The anonymous viewer ID, read when sending (nil = unique viewers aren't counted).
    private let viewer: (() -> String?)?

    private var queue: [[String: Any]] = []
    private var timer: DispatchWorkItem?
    private var sending = false
    private var flushAfterSend = false

    public init(
        url: String,
        sdk: String,
        transport: @escaping AnalyticsTransport,
        flushInterval: TimeInterval = Double(flushIntervalMs) / 1000,
        maxBatch: Int = maxBatchDefault,
        maxQueue: Int = maxQueueDefault,
        now: @escaping () -> Int = nowMs,
        sessionId: String = randomId(),
        viewer: (() -> String?)? = nil,
        platform: String? = nil,
        automation: Bool = false
    ) {
        self.url = url
        self.sdk = sdk
        self.transport = transport
        self.flushInterval = flushInterval
        self.maxBatch = maxBatch
        self.maxQueue = maxQueue
        self.now = now
        self.sessionId = sessionId
        self.viewer = viewer
        self.platform = platform
        self.automation = automation
    }

    public var pending: Int { queue.count }

    /// Queues an event (a ``StoryEvent``'s or activity event's JSON) with the current time.
    public func track(_ event: [String: Any]) {
        var e = event
        e["ts"] = now()
        queue.append(e)
        if queue.count > maxQueue { queue.removeFirst(queue.count - maxQueue) }
        if queue.count >= maxBatch {
            flush()
        } else {
            schedule()
        }
    }

    /// Sends everything queued. With `beacon` (the app is going away) failed sends aren't kept.
    public func flush(beacon: Bool = false) {
        clearTimer()
        if sending && !beacon {
            flushAfterSend = true
            return
        }
        sendNext(beacon: beacon)
    }

    private func body(_ batch: [[String: Any]]) -> String {
        var out: [String: Any] = ["sdk": sdk, "sessionId": sessionId, "events": batch]
        if let v = viewer?() { out["viewer"] = v }
        if let platform { out["platform"] = platform }
        if automation { out["automation"] = true }
        let data = (try? JSONSerialization.data(withJSONObject: out)) ?? Data()
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private func sendNext(beacon: Bool) {
        while !queue.isEmpty {
            let batch = Array(queue.prefix(maxBatch))
            queue.removeFirst(batch.count)
            if beacon {
                transport(url, body(batch), true) { _ in }
                continue
            }
            sending = true
            transport(url, body(batch), false) { [weak self] ok in
                let done = {
                    guard let self else { return }
                    self.sending = false
                    self.flushAfterSend = false
                    if ok {
                        self.sendNext(beacon: false)
                    } else {
                        // Put the batch back and retry on the next flush.
                        self.queue.insert(contentsOf: batch, at: 0)
                        self.schedule()
                    }
                }
                if Thread.isMainThread { done() } else { DispatchQueue.main.async(execute: done) }
            }
            return
        }
    }

    /// Sends what's left without retrying (the app is going away) and stops the timer.
    public func dispose() {
        clearTimer()
        flush(beacon: true)
    }

    /// Stops the flush timer without sending (tests).
    public func cancelTimer() { clearTimer() }

    private func schedule() {
        guard timer == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            self?.timer = nil
            self?.flush()
        }
        timer = item
        DispatchQueue.main.asyncAfter(deadline: .now() + flushInterval, execute: item)
    }

    private func clearTimer() {
        timer?.cancel()
        timer = nil
    }
}
