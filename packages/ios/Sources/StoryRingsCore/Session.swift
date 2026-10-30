import Foundation

// App sessions (active users) and the anonymous viewer ID (spec/cases/sessions.json).

public enum Sessions {
    /// A new app session starts after this long in the background (the Firebase rule).
    public static let timeoutMs = 30 * 60_000
    /// Anonymous viewer IDs are replaced after 13 months, the usual limit for audience measurement.
    public static let viewerIdMaxAgeMs = 395 * 86_400_000
    static let viewerKey = "stories:viewer"

    /// Whether coming back at `now`, after leaving at `leftAt`, starts a new session.
    public static func startsNew(leftAt: Int?, now: Int) -> Bool {
        guard let leftAt else { return false }
        return now - leftAt >= timeoutMs
    }

    /// The anonymous ID used to count unique viewers: random, made on this device, with no link
    /// to who the person is (the server only keeps a hash of it per app). Nil without storage.
    public static func loadViewerId(_ storage: KeyValueStorage?, now: Int = nowMs()) -> String? {
        guard let storage else { return nil }
        if let raw = storage.getItem(viewerKey), let data = raw.data(using: .utf8),
           let stored = object(try? JSONSerialization.jsonObject(with: data)),
           let id = value(stored["id"]) as? String, let created = number(stored["created"]),
           Double(now) - created < Double(viewerIdMaxAgeMs) {
            return id
        }
        let fresh = randomId()
        if let data = try? JSONSerialization.data(withJSONObject: ["id": fresh, "created": now]),
           let s = String(data: data, encoding: .utf8) {
            storage.setItem(viewerKey, s)
        }
        return fresh
    }

    /// Forgets the ID (e.g. when someone withdraws consent).
    public static func clearViewerId(_ storage: KeyValueStorage?) {
        storage?.setItem(viewerKey, "")
    }
}

/// A random version 4 UUID, lowercase.
public func randomId() -> String { UUID().uuidString.lowercased() }

/// Milliseconds since 1970.
public func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }
