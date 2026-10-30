#if canImport(UIKit)
import SwiftUI
import UIKit

extension Color {
    /// "#rrggbb" (or "#rgb") to a colour; `fallback` for anything else.
    init(hex: String?, fallback: Color) {
        guard let hex, hex.hasPrefix("#") else {
            self = fallback
            return
        }
        var h = String(hex.dropFirst())
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else {
            self = fallback
            return
        }
        self = Color(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }
}

/// Ring animation length per speed, the same as the other SDKs.
let ringSpeedMs: [String: Double] = ["slow": 4000, "normal": 2400, "fast": 1200]

/// Size and spacing your code can set; the dashboard's shape and size win once set there.
public struct StoriesTheme: Equatable {
    /// Item width and height when the dashboard sets no shape and size.
    public var circleSize: CGFloat
    public var gap: CGFloat
    /// Space before the first and after the last item.
    public var barPadding: CGFloat
    public var titleSize: CGFloat
    /// Font for titles, e.g. your app's font (the dashboard's title colour and weight win).
    public var titleFontName: String?
    public var hideTitles: Bool

    public init(
        circleSize: CGFloat = 68,
        gap: CGFloat = 14,
        barPadding: CGFloat = 12,
        titleSize: CGFloat = 12,
        titleFontName: String? = nil,
        hideTitles: Bool = false
    ) {
        self.circleSize = circleSize
        self.gap = gap
        self.barPadding = barPadding
        self.titleSize = titleSize
        self.titleFontName = titleFontName
        self.hideTitles = hideTitles
    }

    func titleFont(weight: Int) -> Font {
        let w: Font.Weight = switch weight {
        case ..<250: .ultraLight
        case ..<350: .light
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        case ..<750: .bold
        default: .heavy
        }
        if let name = titleFontName { return .custom(name, size: titleSize).weight(w) }
        return .system(size: titleSize, weight: w)
    }
}
#endif
