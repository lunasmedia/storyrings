#if canImport(UIKit)
import StoryRingsCore
import SwiftUI

/// Interactive stickers (polls, quizzes, emoji sliders, links, countdowns) drawn over a story's
/// image, at the place the studio put them (spec/README.md, "Interactions"), placed with the
/// story's fit (covering the area, or shown whole in it).
struct StickersLayer: View {
    @ObservedObject var model: ViewerModel
    let story: FeedStory

    var body: some View {
        GeometryReader { box in
            let media = story.width.flatMap { w in story.height.map { (Double(w), Double($0)) } }
            ZStack(alignment: .topLeading) {
                Color.clear.allowsHitTesting(false)
                ForEach(story.interactions) { i in
                    let p = placeInteraction(
                        container: (Double(box.size.width), Double(box.size.height)), media: media,
                        cover: story.look.fills, x: i.x, y: i.y, width: i.width
                    )
                    StickerView(model: model, story: story, sticker: i, u: CGFloat(p.width / Interactions.unitsPerWidth))
                        .frame(width: CGFloat(p.width))
                        .position(x: CGFloat(p.x), y: CGFloat(p.y))
                }
            }
        }
        // Redraws when answers or results arrive.
        .id(model.answersVersion)
    }
}

private struct StickerView: View {
    @ObservedObject var model: ViewerModel
    let story: FeedStory
    let sticker: Interaction
    let u: CGFloat

    private var accent: Color { Color(hex: sticker.accent, fallback: .pink) }
    private var saved: StoredAnswer? { model.answers?.get(storyId: story.id, interactionId: sticker.id) }

    var body: some View {
        switch sticker.kind {
        case let .link(label, url):
            Button { model.openLink(label: label, url: url) } label: {
                Text("\(label) ↗")
                    .font(.system(size: 30 * u, weight: .bold))
                    .foregroundColor(accent)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
                    .frame(height: 84 * u)
                    .background(Capsule().fill(Color.white).shadow(color: .black.opacity(0.18), radius: 8 * u, y: 4 * u))
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
        case let .poll(question, options):
            card(question) { OptionsView(model: model, sticker: sticker, options: options, correct: nil, saved: saved, accent: accent, u: u) }
        case let .quiz(question, options, correct):
            card(question) { OptionsView(model: model, sticker: sticker, options: options, correct: correct, saved: saved, accent: accent, u: u) }
        case let .slider(question, emoji):
            card(question) { SliderView(model: model, sticker: sticker, emoji: emoji, saved: saved, accent: accent, u: u) }
        case let .countdown(title, endsAt):
            card(title, titleColor: accent, titleSize: 28, titleWeight: .semibold) { CountdownView(endsAt: endsAt, u: u) }
        }
    }

    private func card<Content: View>(
        _ title: String, titleColor: Color = Color(white: 0.07), titleSize: CGFloat = 32,
        titleWeight: Font.Weight = .bold, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(spacing: 0) {
            if !title.isEmpty {
                Text(title)
                    .font(.system(size: titleSize * u, weight: titleWeight))
                    .foregroundColor(titleColor)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 20 * u)
            }
            content()
        }
        .padding(28 * u)
        // The shadow is the card's only, not its text's.
        .background(RoundedRectangle(cornerRadius: 28 * u).fill(Color.white).shadow(color: .black.opacity(0.18), radius: 12 * u, y: 6 * u))
        // Touches that miss the controls stop here, so they never skip the story.
        .contentShape(Rectangle())
        .onTapGesture {}
    }
}

private struct OptionsView: View {
    @ObservedObject var model: ViewerModel
    let sticker: Interaction
    let options: [String]
    /// The right answer, for quizzes.
    let correct: Int?
    let saved: StoredAnswer?
    let accent: Color
    let u: CGFloat

    var body: some View {
        let pct = saved?.results?.counts.map(percentages)
        VStack(spacing: 12 * u) {
            ForEach(Array(options.enumerated()), id: \.offset) { n, label in
                let chosen = saved?.value == n
                let right = saved != nil && correct == n
                let wrong = saved != nil && correct != nil && chosen && !right
                let share = right || wrong ? 100 : pct.map { $0.indices.contains(n) ? $0[n] : 0 } ?? (chosen ? 100 : 0)
                let mark = saved == nil ? "" : wrong ? "✕ " : chosen || right ? "✓ " : ""
                Button { model.answer(sticker, value: n) } label: {
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color(red: 0.945, green: 0.953, blue: 0.961))
                        if saved != nil {
                            GeometryReader { g in
                                Rectangle()
                                    .fill(right ? Color(hex: Interactions.correctColor, fallback: .green)
                                        : wrong ? Color(hex: Interactions.wrongColor, fallback: .red) : accent)
                                    .opacity(right || wrong ? 0.35 : chosen ? 0.5 : 0.3)
                                    .frame(width: g.size.width * CGFloat(share) / 100)
                            }
                        }
                        HStack(spacing: 12 * u) {
                            Text(mark + label)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: saved == nil ? .center : .leading)
                            if let pct, pct.indices.contains(n) {
                                Text("\(pct[n])%").font(.system(size: 24 * u, weight: .semibold))
                            }
                        }
                        .font(.system(size: 28 * u, weight: .semibold))
                        .foregroundColor(Color(white: 0.07))
                        .padding(.horizontal, 24 * u)
                    }
                    .frame(height: 76 * u)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(saved != nil)
                .accessibilityLabel(pct.map { InteractionLabels.pollOption(label, percent: $0.indices.contains(n) ? $0[n] : 0) } ?? label)
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
    }
}

private struct SliderView: View {
    @ObservedObject var model: ViewerModel
    let sticker: Interaction
    let emoji: String
    let saved: StoredAnswer?
    let accent: Color
    let u: CGFloat
    @State private var value: Double = 0
    @State private var dragging = false

    var body: some View {
        GeometryReader { g in
            let at = { (v: Double) in 36 * u + (g.size.width - 72 * u) * CGFloat(v / 100) }
            let shown = saved.map { Double($0.value) } ?? value
            ZStack(alignment: .leading) {
                Capsule().fill(Color(red: 0.914, green: 0.925, blue: 0.937)).frame(height: 14 * u)
                Capsule().fill(accent).frame(width: at(shown), height: 14 * u)
                if let avg = saved?.results?.average {
                    Circle().fill(accent)
                        .overlay(Circle().stroke(Color.white, lineWidth: 4 * u))
                        .frame(width: 28 * u, height: 28 * u)
                        .position(x: at(Double(avg)), y: 36 * u)
                }
                Text(emoji)
                    .font(.system(size: 56 * u))
                    .frame(width: 72 * u, height: 72 * u)
                    .position(x: at(shown), y: 36 * u)
            }
            .frame(height: 72 * u)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { d in
                        guard saved == nil else { return }
                        if !dragging {
                            dragging = true
                            model.hold(true)
                        }
                        value = max(0, min(100, Double((d.location.x - 36 * u) / (g.size.width - 72 * u)) * 100)).rounded()
                    }
                    .onEnded { _ in
                        guard saved == nil, dragging else { return }
                        dragging = false
                        model.hold(false)
                        model.answer(sticker, value: Int(value))
                    }
            )
        }
        .frame(height: 72 * u)
        .accessibilityElement()
        .accessibilityLabel(InteractionLabels.slider({ if case let .slider(q, _) = sticker.kind { return q }; return "" }()))
        .accessibilityValue("\(Int(saved.map { Double($0.value) } ?? value))%")
        .accessibilityAdjustableAction { direction in
            guard saved == nil else { return }
            value = max(0, min(100, value + (direction == .increment ? 10 : -10)))
        }
        .accessibilityAction { if saved == nil { model.answer(sticker, value: Int(value)) } }
    }
}

private struct CountdownView: View {
    let endsAt: Date
    let u: CGFloat

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let c = countdownParts(endsAt: endsAt, now: context.date)
            if c.ended {
                Text(InteractionLabels.countdownEnded)
                    .font(.system(size: 40 * u, weight: .bold))
                    .foregroundColor(Color(white: 0.07))
            } else {
                HStack(spacing: 12 * u) {
                    ForEach(Array([c.days, c.hours, c.minutes, c.seconds].enumerated()), id: \.offset) { k, n in
                        VStack(spacing: 4 * u) {
                            Text(String(format: "%02d", n))
                                .font(.system(size: 56 * u, weight: .bold).monospacedDigit())
                                .foregroundColor(Color(white: 0.07))
                            Text(InteractionLabels.countdownUnits[k])
                                .font(.system(size: 18 * u))
                                .foregroundColor(Color(red: 0.525, green: 0.557, blue: 0.588))
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
#endif
