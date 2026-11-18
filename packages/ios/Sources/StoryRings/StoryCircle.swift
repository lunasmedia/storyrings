#if canImport(UIKit)
import AVFoundation
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
    /// Energized style: its viewer is open, opened while this card previewed: the circle stays
    /// aside until the preview shows again (or moves on to another card).
    var held = false
    let onTap: () -> Void
    /// Receives a view the size of the circle, whose position on screen the viewer opens from
    /// and closes into.
    var marker: ((UIView) -> Void)?
    /// Energized style: the story previewing in this card now, if any.
    var preview: FeedStory?
    /// Changes each time a preview starts, so the same story starts again.
    var previewTurn = 0
    /// Energized style: drawn as a story card (a still of the group's first story, which plays on
    /// its turn) with the circle in the middle (hidden while the story shows) and the title
    /// inside; false = the usual circle.
    var card = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Energized style: the preview is showing (loaded), so the circle steps aside for it.
    @State private var previewShown = false
    /// The circle stays aside while the viewer that opened from this previewing card is open.
    @State private var keepAside = false
    /// Energized style: the card's still couldn't load, so it shows the cover instead.
    @State private var stillFailed = false

    private var ring: RingStyle { group.appearance.ring }
    private var animates: Bool {
        ring.style != "none" && ring.animation != "none" && !(seen && ring.animateOnlyUnseen) && !reduceMotion
    }

    var body: some View {
        let a = group.appearance
        Button(action: onTap) {
            if card {
                energizedCard
                    // Items are wider than the card by the title allowance, like the other SDKs.
                    .frame(width: width + 12)
                    .contentShape(Rectangle())
            } else {
                VStack(spacing: 6) {
                    circle(width: width, height: height, radius: radius)
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
        }
        .buttonStyle(PressableStyle(held: opening))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(StoriesLabels.openGroup(group.title, count: group.stories.count, seen: seen))
        .accessibilityAddTraits(.isButton)
    }

    /// Energized style: the circle gives way to the story while it previews, and while the viewer
    /// opened from that preview is open.
    /// Worked out from what the card is given, not only from state set in `onChange` (which
    /// runs after a first draw): as the viewer opens, the preview goes and the card becomes held
    /// in the same update, and the circle mustn't start coming back for even one frame.
    private var circleAside: Bool { (previewShown && (preview != nil || held)) || keepAside }

    /// Energized style: the story-shaped card, showing a still of the group's first story (which
    /// plays on its turn), the circle in the middle and the title inside at the bottom.
    private var energizedCard: some View {
        let a = group.appearance
        let avatar = (width * energizedAvatarShare).rounded()
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return ZStack {
            Color(white: 0.13)
            // A still of the group's first story (the one it previews): the image, or a video's
            // first frame. The cover fills the card only if there's no still to show: shown
            // while the still loads, it would flash up and then change.
            if let first = group.stories.first, !stillFailed {
                RemoteImage(url: first.url, videoFrame: first.type == "video") { ok in
                    if !ok { stillFailed = true }
                }
            } else if !group.coverURL.isEmpty {
                RemoteImage(url: group.coverURL)
            }
            if let preview {
                StoryPreview(story: preview, onShown: { shown in
                    previewShown = shown
                    if shown { keepAside = false }
                })
                    .id(previewTurn)
                    .transition(.opacity)
            }
            VStack {
                Spacer()
                LinearGradient(colors: [.black.opacity(0), .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                    .frame(height: height * 0.45)
            }
            // The circle (and its badge) gives way to the story while it previews.
            circle(width: avatar, height: avatar, radius: avatar / 2, marks: false)
                .opacity(circleAside ? 0 : 1)
                .animation(.easeInOut(duration: 0.3), value: circleAside)
            if !a.title.hidden && !theme.hideTitles {
                VStack {
                    Spacer()
                    Text(group.title)
                        .font(theme.titleFont(weight: a.title.weight))
                        .foregroundColor(.white)
                        .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
                        .lineLimit(max(1, a.title.maxLines))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 6)
                        .padding(.bottom, 8)
                }
            }
        }
        .frame(width: width, height: height)
        .clipShape(shape)
        .onChange(of: preview == nil) { gone in
            // While held, the story it showed stays as it was (the viewer is opening from it).
            guard gone, !held else { return }
            previewShown = false
            keepAside = false
        }
        .onChange(of: held) { isHeld in
            if isHeld {
                keepAside = true
            } else if preview == nil {
                // The viewer closed and the previews moved on: the circle comes back.
                previewShown = false
                keepAside = false
            }
        }
        // The viewer opens from (and closes into) the whole card.
        .background(marker.map { MarkerView(onView: $0) })
        .allowsHitTesting(false)
    }

    /// The circle: cover, ring and badge. `marks`: it stands for the item on screen (for the
    /// viewer to open from) — the usual circle always does.
    private func circle(width: CGFloat, height: CGFloat, radius: CGFloat, marks: Bool = true) -> some View {
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
        .background(marks ? marker.map { MarkerView(onView: $0) } : nil)
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

/// Energized cards: the circle in the middle is this share of the card's width.
let energizedAvatarShare: CGFloat = 0.5

/// Energized style: a story over the cover, a muted video or an image zooming in and out.
/// It fades in once it can show, so the cover stays until then (or if it can't load).
private struct StoryPreview: View {
    let story: FeedStory
    /// Whether it's showing: true once it can, false if the image can't load.
    var onShown: (Bool) -> Void = { _ in }
    @State private var shown = false
    @State private var zoomed = false

    var body: some View {
        Group {
            if story.type == "video", let url = URL(string: story.url) {
                PreviewVideoView(url: url, onReady: { shown = true })
            } else {
                RemoteImage(url: story.url, onResult: { ok in shown = ok })
                    .scaleEffect(zoomed ? 1.1 : 1)
                    .onAppear {
                        // In to 110% and back out over the preview.
                        let half = Double(energizedPreviewMs) / 2000
                        withAnimation(.easeInOut(duration: half).repeatCount(2, autoreverses: true)) { zoomed = true }
                    }
            }
        }
        .opacity(shown ? 1 : 0)
        .animation(.easeOut(duration: 0.3), value: shown)
        .onChange(of: shown) { onShown($0) }
        .onAppear { onShown(shown) }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct PreviewVideoView: View {
    @StateObject private var video: PreviewVideo
    let onReady: () -> Void

    init(url: URL, onReady: @escaping () -> Void) {
        _video = StateObject(wrappedValue: PreviewVideo(url: url))
        self.onReady = onReady
    }

    var body: some View {
        PlayerView(player: video.player, gravity: .resizeAspectFill)
            .onChange(of: video.ready) { if $0 { onReady() } }
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
