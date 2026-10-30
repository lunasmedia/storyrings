#if canImport(UIKit)
import StoryRingsCore
import SwiftUI

/// The story button, in its style (spec: Story button): a white or dark pill, an outline, or a
/// swipe up (a chevron over the label, or over a white pill).
struct CtaButton: View {
    let label: String
    let style: CtaStyle
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                if style.isSwipe { Chevron() }
                text
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isLink)
    }

    @ViewBuilder
    private var text: some View {
        let t = Text(label)
            .font(.system(size: 15, weight: .semibold))
            .lineLimit(1)
        switch style {
        case .pill, .swipePill:
            t.foregroundColor(.black)
                .padding(.horizontal, 22)
                .padding(.vertical, 12)
                .background(Capsule().fill(Color.white))
        case .dark:
            t.foregroundColor(.white)
                .padding(.horizontal, 22)
                .padding(.vertical, 12)
                .background(Capsule().fill(Color(white: 0.067)))
        case .outline:
            t.foregroundColor(.white)
                .shadow(color: .black.opacity(0.4), radius: 1, y: 1)
                .padding(.horizontal, 22)
                .padding(.vertical, 12)
                .overlay(Capsule().strokeBorder(Color.white, lineWidth: 2))
                .contentShape(Capsule())
        case .swipe:
            t.foregroundColor(.white)
                .shadow(color: .black.opacity(0.5), radius: 1.5, y: 1)
                .padding(.horizontal, 22)
                .padding(.top, 4)
                .padding(.bottom, 10)
                .contentShape(Rectangle())
        }
    }
}

/// An upward chevron that bobs gently, unless the person asked for reduced motion.
private struct Chevron: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var up = false

    var body: some View {
        Image(systemName: "chevron.up")
            .font(.system(size: 20, weight: .bold))
            .foregroundColor(.white)
            .shadow(color: .black.opacity(0.5), radius: 1.5, y: 1)
            .padding(.top, 8)
            .padding(.bottom, 4)
            .offset(y: up ? -6 : 0)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { up = true }
            }
            .accessibilityHidden(true)
    }
}
#endif
