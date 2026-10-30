import Foundation

// Helpers for JSON decoded with JSONSerialization, where null is NSNull and numbers and
// booleans are both NSNumber. The feed is normalised at this level so unknown fields are kept,
// exactly like the other SDKs.

/// The value, with JSON null treated as missing.
func value(_ any: Any?) -> Any? {
    if any == nil || any is NSNull { return nil }
    return any
}

/// A JSON object, or nil.
func object(_ any: Any?) -> [String: Any]? { value(any) as? [String: Any] }

/// A JSON array, or nil.
func array(_ any: Any?) -> [Any]? { value(any) as? [Any] }

func isBool(_ any: Any?) -> Bool {
    guard let n = value(any) as? NSNumber else { return false }
    return CFGetTypeID(n) == CFBooleanGetTypeID()
}

/// A JSON number (not a boolean), or nil.
func number(_ any: Any?) -> Double? {
    guard let n = value(any) as? NSNumber, !isBool(n) else { return nil }
    return n.doubleValue
}

/// A JSON boolean, or nil.
func bool(_ any: Any?) -> Bool? {
    isBool(any) ? (value(any) as? NSNumber)?.boolValue : nil
}

/// Like string interpolation in the other SDKs: numbers without a trailing ".0", null as "null".
func stringify(_ any: Any?) -> String {
    guard let v = value(any) else { return "null" }
    if let s = v as? String { return s }
    if isBool(v) { return (v as! NSNumber).boolValue ? "true" : "false" }
    if let d = number(v) {
        return d.rounded() == d && abs(d) < 1e15 ? String(Int64(d)) : String(d)
    }
    return "\(v)"
}
