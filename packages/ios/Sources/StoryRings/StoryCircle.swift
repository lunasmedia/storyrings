#if canImport(UIKit)
import SwiftUI

/// One item in the story bar: cover, ring, badge and title, in the dashboard's style.
struct StoryCircle: View {
    let group: FeedGroup
    let width: CGFloat
    let height: CGFloat
    let radius: CGFloat
    let seen: Bool
    let theme: StoriesTheme
    /// Its viewer is opening (waiting for the first story): shown pressed.
    var opening = false
    let onTap: () -> Void
    /// Receives a view the size of the circle, whose position on screen the viewer opens from
    /// and closes into.
    var marker: ((UIView) -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var ring: RingStyle { group.appearance.ring }
    private var animates: Bool {
        ring.style != "none" && ring.animation != "none" && !(seen && ring.animateOnlyUnseen) && !reduceMotion
    }

    var body: some View {
        let a = group.appearance
        Button(action: onTap) {
            VStack(spacing: 6) {
                circle
                if !a.title.hidden && !theme.hideTitles {
                    Text(group.title)
                        .font(theme.titleFont(weight: a.title.weight))
                        .foregroundColor(a.title.color == "inherit" ? .primary : Color(hex: a.title.color, fallback: .primary))
                        .lineLimit(max(1, a.title.maxLines))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
            }
            // Items are wider than the ring by the title allowance, like the other SDKs.
            .frame(width: width + 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(held: opening))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(StoriesLabels.openGroup(group.title, count: group.stories.count, seen: seen))
        .accessibilityAddTraits(.isButton)
    }

    private var circle: some View {
        let ringWidth = ring.style == "none" ? 0 : CGFloat(ring.width)
        let inset = ringWidth + (ring.style == "none" ? 0 : CGFloat(ring.gap))
        let innerRadius = max(0, radius - inset)
        let label = group.appearance.badgeLabel(endsAt: group.endsAt)
        return ZStack {
            if let gap = gapColor {
                RoundedRectangle(cornerRadius: max(0, radius - ringWidth), style: .continuous)
                    .fill(gap)
                    .padding(ringWidth)
            }
            Cover(group: group, animated: !reduceMotion)
                .clipShape(RoundedRectangle(cornerRadius: innerRadius, style: .continuous))
                .padding(inset)
            if ring.style != "none" {
                TimelineView(.animation(minimumInterval: nil, paused: !animates)) { context in
                    RingView(ring: ring, seen: seen, radius: radius, t: animates ? phase(context.date) : 0)
                }
            }
        }
        .frame(width: width, height: height)
        .background(marker.map { MarkerView(onView: $0) })
        .overlay(alignment: group.appearance.badge.position == "top-right" ? .topTrailing : .bottom) {
            if let label { badge(label) }
        }
    }

    private var gapColor: Color? {
        ring.style == "none" || ring.gapColor == "background" || ring.gapColor == "transparent"
            ? nil : Color(hex: ring.gapColor, fallback: .clear)
    }

    private func phase(_ date: Date) -> Double {
        let ms = ringSpeedMs[ring.speed] ?? 2400
        return (date.timeIntervalSinceReferenceDate * 1000).truncatingRemainder(dividingBy: ms) / ms
    }

    private func badge(_ label: String) -> some View {
        let b = group.appearance.badge
        return Text(label)
            .font(.system(size: 9.5, weight: .bold))
            .foregroundColor(Color(hex: b.color, fallback: .white))
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Capsule().fill(Color(hex: b.background, fallback: Color(hex: "#e8175d", fallback: .pink))))
            .overlay(Capsule().strokeBorder(Color.white, lineWidth: 1.5))
            .fixedSize()
            .offset(x: b.position == "top-right" ? 2 : 0, y: b.position == "top-right" ? -2 : 6)
    }
}

/// The still cover, with an animated cover's looping video over it once it plays.
private struct Cover: View {
    let group: FeedGroup
    let animated: Bool

    var body: some View {
        ZStack {
            Color(red: 0.898, green: 0.898, blue: 0.918)
            if !group.coverURL.isEmpty { RemoteImage(url: group.coverURL) }
            if animated, let video = group.coverVideoURL, let url = URL(string: video) {
                CoverVideo(url: url).id(video)
            }
        }
    }
}

private struct CoverVideo: View {
    @StateObject private var video: LoopingVideo

    init(url: URL) {
        _video = StateObject(wrappedValue: LoopingVideo(url: url))
    }

    var body: some View {
        PlayerView(player: video.player, gravity: .resizeAspectFill)
            .opacity(video.ready ? 1 : 0)
    }
}

/// The ring: gradient or solid, grey once seen, with the dashboard's animation at phase `t`.
private struct RingView: View {
    let ring: RingStyle
    let seen: Bool
    let radius: CGFloat
    let t: Double

    private var colors: [Color] {
        let c = ring.colors.map { Color(hex: $0, fallback: Color(hex: "#d62976", fallback: .pink)) }
        return c.isEmpty ? [Color(hex: "#d62976", fallback: .pink)] : c
    }

    var body: some View {
        let w = CGFloat(ring.width)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        ZStack {
            if seen {
                shape.strokeBorder(Color(hex: ring.seenColor, fallback: Color(white: 0.78)), lineWidth: w)
            } else {
                if ring.style == "solid" || colors.count == 1 {
                    shape.strokeBorder(colors[0], lineWidth: w)
                } else if ring.animation == "rotate" {
                    shape.strokeBorder(
                        AngularGradient(gradient: Gradient(colors: colors + [colors[0]]), center: .center, angle: .degrees(t * 360)),
                        lineWidth: w
                    )
                } else {
                    // CSS angles: 0° points up, 90° right.
                    let rad = (ring.angle - 90) * .pi / 180
                    let dx = cos(rad) / 2
                    let dy = sin(rad) / 2
                    shape.strokeBorder(
                        LinearGradient(gradient: Gradient(colors: colors), startPoint: UnitPoint(x: 0.5 - dx, y: 0.5 - dy), endPoint: UnitPoint(x: 0.5 + dx, y: 0.5 + dy)),
                        lineWidth: w
                    )
                }
                if ring.animation == "pulse" {
                    // A glow that grows outwards and fades, like the web's.
                    shape.strokeBorder(colors[0].opacity(0.75 * (1 - t)), lineWidth: w)
                        .scaleEffect(1 + 0.3 * t)
                } else if ring.animation == "shimmer" {
                    // A light band sweeping across the ring for the first 60% of each cycle.
                    let p = min(1, max(0, t / 0.6))
                    let x = (-1.1 + 3.1 * p + 1) / 2
                    shape.strokeBorder(
                        LinearGradient(
                            gradient: Gradient(colors: [.white.opacity(0), .white.opacity(0.85), .white.opacity(0)]),
                            startPoint: UnitPoint(x: x - 0.275, y: 0.5),
                            endPoint: UnitPoint(x: x + 0.275, y: 0.5)
                        ),
                        lineWidth: w
                    )
                }
            }
        }
        .allowsHitTesting(false)
    }
}

/// A slight dim while pressed, like system buttons.
private struct PressableStyle: ButtonStyle {
    /// Stays pressed after the finger lifts (the viewer is opening).
    var held = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed || held ? 0.7 : 1)
    }
}

/// An invisible UIKit view standing in for the circle, to find where it is on screen.
private struct MarkerView: UIViewRepresentable {
    let onView: (UIView) -> Void

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        onView(view)
        return view
    }

    func updateUIView(_ view: UIView, context: Context) { onView(view) }
}
#endif
