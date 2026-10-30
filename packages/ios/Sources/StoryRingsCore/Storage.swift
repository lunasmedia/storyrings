import Foundation

/// Where the SDK keeps "seen" stories, the last feed and the anonymous viewer ID.
public protocol KeyValueStorage: AnyObject {
    func getItem(_ key: String) -> String?
    func setItem(_ key: String, _ value: String)
}

/// For tests, or when nothing should persist between launches.
public final class MemoryStorage: KeyValueStorage {
    private var data: [String: String] = [:]
    public init() {}
    public func getItem(_ key: String) -> String? { data[key] }
    public func setItem(_ key: String, _ value: String) { data[key] = value }
}

/// UserDefaults (the default on iOS).
public final class UserDefaultsStorage: KeyValueStorage {
    private let defaults: UserDefaults
    public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func getItem(_ key: String) -> String? { defaults.string(forKey: key) }
    public func setItem(_ key: String, _ value: String) { defaults.set(value, forKey: key) }
}
