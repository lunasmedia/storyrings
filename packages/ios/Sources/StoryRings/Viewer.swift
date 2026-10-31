#if canImport(UIKit)
import AVFoundation
import SwiftUI
import UIKit

public struct StoryOpenEvent {
    public let groupId: String
    public let storyId: String
    public let groupIndex: Int
    public let storyIndex: Int
    public let groupTitle: String
}

public struct CtaClickEvent {
    public let url: String
    public let label: String
    public let groupId: String
    public let storyId: String
    /// Closes the viewer (useful when you handle the link with your own navigation).
    public let close: () -> Void
}

public struct ShareEvent {
    /// Your share link from the dashboard with {group} and {story} filled in.
    public let url: String
    /// Story name (or the group title).
    public let title: String
    public let groupId: String
    public let storyId: String
}

/// What the SDK does after your `onCtaClick`.
public enum CtaResult {
    /// You handled the link: the SDK doesn't open it.
    case handled
    /// The SDK opens it (https links, or your app's deep-link schemes).
    case `default`
}

/// What the SDK does after your `onShare`.
public enum ShareResult {
    /// You shared it: the SDK doesn't show the share sheet.
    case handled
    /// The SDK shows the system share sheet.
    case `default`
}

struct ViewerCallbacks {
    var onStoryOpen: ((StoryOpenEvent) -> Void)?
    var onCtaClick: ((CtaClickEvent) -> CtaResult)?
    var onShare: ((ShareEvent) -> ShareResult)?
}

/// Video sound preference for the session: once unmuted, later videos play with sound too.
private var sessionMuted = true

private enum PauseReason {
    case user, hold, background, share
}

/// Drives the viewer: navigation, timing and analytics come from the core state machine
/// (spec/cases/viewer.json); the view draws it and feeds it touches and media events.
final class ViewerModel: ObservableObject {
    @Published private(set) var state: ViewerState
    /// The last open state: what's drawn, including while the viewer animates closed.
    @Published private(set) var shown: ViewerState
    @Published private(set) var drag: CGFloat = 0
    /// A finger is down and has moved (set before `drag` changes). False once it's lifted: only
    /// then does a story pulled down spring back. Moving back above the start point while still
    /// dragging just gives a drag of 0.
    private(set) var dragging = false
    /// Set by the screen: plays the closing animation, then calls `done`. Without it (tests) the
    /// viewer finishes at once.
    var closeAnimation: ((CloseReason, _ done: @escaping () -> Void) -> Void)?
    /// The photo story shown before this one, drawn under it until it has drawn (so a story still
    /// loading never shows black). Only photos: a video's player belongs to the current story.
    @Published private(set) var previous: FeedStory?
    @Published private(set) var muted = sessionMuted
    @Published private(set) var player: AVPlayer?

    let feed: Feed
    let groups: [ViewerGroup]
    private let seen: SeenStore
    private let track: (StoryEvent) -> Void
    private let callbacks: ViewerCallbacks
    private let onFinish: (CloseReason) -> Void
    /// Polls, quizzes and sliders: answers kept on this device, and how to send one.
    let answers: AnswerStore?
    private let sendAnswer: ((String, String, Int, @escaping (AnswerResults?) -> Void) -> Void)?
    /// Changes when an answer (or its results) arrives, so the stickers redraw.
    @Published private(set) var answersVersion = 0

    private var pauses = Set<PauseReason>()
    private var done = false
    private var link: CADisplayLink?
    private var lastTick: CFTimeInterval?
    private var observers: [NSObjectProtocol] = []
    private var playerObservers: [NSKeyValueObservation] = []
    private var endObserver: NSObjectProtocol?
    private var videoSeq = -1
    private var videoReady = false
    private var wasBuffering = false
    private(set) lazy var gestures = GestureRecognizer(GestureHandlers(
        onTap: { [weak self] x in
            guard let self else { return }
            self.pauses.remove(.hold)
            self.syncPause()
            self.dispatch(x < 0.3 ? .prev : .next())
        },
        onPress: { [weak self] in self?.setPaused(.hold, true) },
        onRelease: { [weak self] in self?.setPaused(.hold, false) },
        onSwipe: { [weak self] direction in
            guard let self else { return }
            self.pauses.remove(.hold)
            self.syncPause()
            switch direction {
            case .left: self.dispatch(.nextGroup)
            case .right: self.dispatch(.prevGroup)
            case .down: self.close()
            // A swipe-up button: swiping up anywhere on the story opens its link.
            case .up: if self.onScreen.ctaLabel != nil, self.onScreen.ctaStyle.isSwipe { self.cta() }
            }
        },
        onDrag: { [weak self] dx, dy in
            // (0, 0) is the recogniser saying the finger was lifted (or the touch cancelled).
            let lifted = dx == 0 && dy == 0
            self?.dragging = !lifted
            self?.drag = lifted ? 0 : max(0, dy)
        }
    ))

    init(
        feed: Feed, groupIndex: Int, seen: SeenStore, track: @escaping (StoryEvent) -> Void,
        callbacks: ViewerCallbacks,
        answers: AnswerStore? = nil,
        sendAnswer: ((String, String, Int, @escaping (AnswerResults?) -> Void) -> Void)? = nil,
        onFinish: @escaping (CloseReason) -> Void
    ) {
        self.answers = answers
        self.sendAnswer = sendAnswer
        self.feed = feed
        groups = feed.viewerGroups
        self.seen = seen
        self.track = track
        self.callbacks = callbacks
        self.onFinish = onFinish
        let groups = self.groups
        let opened = openViewer(groups, groupIndex) { seen.firstUnseenIndex(groups[$0].stories.map(\.id)) }
        state = opened
        shown = opened
        transitionEvents(.closed, state, groups).forEach(track)
    }

    deinit {
        link?.invalidate()
        observers.forEach(NotificationCenter.default.removeObserver)
        teardownVideo()
    }

    var group: FeedGroup { feed.groups[shown.groupIndex] }
    var story: FeedStory { group.stories[shown.storyIndex] }
    /// The story whose photo is on screen: the previous one until this one has drawn. Its button
    /// and stickers go with it, so they never change before the photo does.
    var onScreen: FeedStory {
        if let p = previous, !shown.displayed, story.type != "video" { return p }
        return story
    }
    private var onScreenGroup: FeedGroup {
        let s = onScreen
        return feed.groups.first { $0.stories.contains { $0.id == s.id } } ?? group
    }
    var userPaused: Bool { pauses.contains(.user) }
    var canShare: Bool { feed.sharing && feed.shareLink != nil }
    var progress: [Double] { progressSegments(shown, groups) }

    /// Called when the viewer appears.
    func start() {
        guard link == nil, !done else { return }
        guard state.open else { return finish(.completed) }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.setPaused(.background, true)
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.setPaused(.background, false)
        })
        let link = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
        storyStarted()
    }

    // MARK: State machine

    func dispatch(_ action: ViewerAction) {
        let prev = state
        guard prev.open, !done else { return }
        actionEvents(prev, action, groups).forEach(track)
        let start: StartStoryIndex = { [seen, groups] in seen.firstUnseenIndex(groups[$0].stories.map(\.id)) }
        let next = reduce(prev, action, groups, startStoryIndex: start)
        if next == prev { return }
        state = next
        if next.open { shown = next }
        transitionEvents(prev, next, groups).forEach(track)
        if !next.open { return finish(next.closeReason ?? .user) }
        if next.seq != prev.seq {
            if prev.displayed {
                let before = feed.groups[prev.groupIndex].stories[prev.storyIndex]
                previous = before.type == "image" ? before : nil
            }
            // A hold or pause doesn't carry over to a new story.
            pauses.remove(.user)
            pauses.remove(.hold)
            storyStarted()
        }
        syncVideo()
    }

    fileprivate func tick(_ time: CFTimeInterval) {
        defer { lastTick = time }
        guard let last = lastTick else { return }
        let ms = Int(((time - last) * 1000).rounded())
        if ms > 0 { dispatch(.tick(ms: ms)) }
    }

    private func setPaused(_ reason: PauseReason, _ on: Bool) {
        if on { pauses.insert(reason) } else { pauses.remove(reason) }
        // In the background the story is off screen (viewability restarts).
        dispatch(pauses.contains(.background) ? .hide : .show)
        syncPause()
    }

    private func syncPause() {
        dispatch(pauses.isEmpty ? .resume : .pause)
        objectWillChange.send()
    }

    func toggleUserPause() { setPaused(.user, !userPaused) }

    /// Dragging the emoji slider holds the story.
    func hold(_ on: Bool) { setPaused(.hold, on) }

    /// Keeps the answer, shows it at once, then the results once they arrive.
    func answer(_ interaction: Interaction, value: Int) {
        let storyId = story.id
        answers?.set(storyId: storyId, interactionId: interaction.id, StoredAnswer(value: value))
        answersVersion += 1
        sendAnswer?(storyId, interaction.id, value) { [weak self] results in
            guard let self, let results else { return }
            self.answers?.set(storyId: storyId, interactionId: interaction.id, StoredAnswer(value: value, results: results))
            self.answersVersion += 1
        }
    }

    func close() { dispatch(.close) }

    private func finish(_ reason: CloseReason) {
        guard !done else { return }
        done = true
        link?.invalidate()
        link = nil
        player?.pause()
        if let closeAnimation {
            closeAnimation(reason) { [onFinish] in onFinish(reason) }
        } else {
            onFinish(reason)
        }
    }

    /// A story started: seen state, media, callbacks, announcements.
    private func storyStarted() {
        let g = group
        let s = story
        seen.markSeen(s.id)
        callbacks.onStoryOpen?(StoryOpenEvent(
            groupId: g.id, storyId: s.id, groupIndex: state.groupIndex, storyIndex: state.storyIndex, groupTitle: g.title
        ))
        let name = s.title ?? g.title
        var announcement = StoriesLabels.storyPosition(g.title, index: state.storyIndex, total: g.stories.count)
        if name != g.title { announcement += ", \(name)" }
        if !s.alt.isEmpty { announcement += ". \(s.alt)" }
        UIAccessibility.post(notification: .announcement, argument: announcement)
        loadVideo()
    }

    // MARK: Media

    /// The image for story `seq` rendered (or failed).
    func imageResult(seq: Int, ok: Bool) {
        guard seq == state.seq, !state.displayed else { return }
        if ok {
            dispatch(.mediaReady())
        } else if state.buffering {
            dispatch(.mediaReady(failed: true))
        }
    }

    private func teardownVideo() {
        playerObservers.forEach { $0.invalidate() }
        playerObservers = []
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player?.pause()
    }

    private func loadVideo() {
        teardownVideo()
        player = nil
        videoSeq = -1
        videoReady = false
        wasBuffering = false
        guard story.type == "video", let url = URL(string: story.url) else { return }
        let seq = state.seq
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.isMuted = muted
        player.automaticallyWaitsToMinimizeStalling = true
        self.player = player
        videoSeq = seq
        playerObservers.append(item.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async { self?.videoStatus(item, seq: seq) }
        })
        playerObservers.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            DispatchQueue.main.async { self?.videoBuffering(player, seq: seq) }
        })
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            guard let self, self.videoSeq == seq else { return }
            self.dispatch(.next(auto: true))
        }
    }

    private func videoStatus(_ item: AVPlayerItem, seq: Int) {
        guard videoSeq == seq, state.open else { return }
        switch item.status {
        case .readyToPlay where !videoReady:
            videoReady = true
            let seconds = item.duration.seconds
            dispatch(.mediaReady(durationMs: seconds.isFinite ? seconds * 1000 : nil))
            syncVideo()
        case .failed:
            dispatch(.mediaReady(failed: true))
        default:
            break
        }
    }

    private func videoBuffering(_ player: AVPlayer, seq: Int) {
        guard videoSeq == seq, videoReady, state.open else { return }
        let buffering = player.timeControlStatus == .waitingToPlayAtSpecifiedRate
        guard buffering != wasBuffering else { return }
        wasBuffering = buffering
        dispatch(buffering ? .mediaLoading : .mediaReady())
    }

    private func syncVideo() {
        guard let player, videoReady else { return }
        let play = state.open && !state.paused && !state.hidden
        if play && player.rate == 0 { player.play() }
        if !play && player.rate != 0 { player.pause() }
    }

    func toggleMute() {
        sessionMuted.toggle()
        muted = sessionMuted
        player?.isMuted = muted
    }

    // MARK: Actions

    func cta() {
        guard let url = onScreen.ctaURL else { return }
        openLink(label: onScreen.ctaLabel ?? "", url: url)
    }

    /// The story button, or a link sticker: both count as a button tap and follow the same rules.
    func openLink(label: String, url: String) {
        let g = onScreenGroup
        let s = onScreen
        track(StoryEvent("cta_click", groupId: g.id, storyId: s.id))
        let result = callbacks.onCtaClick?(CtaClickEvent(
            url: url, label: label, groupId: g.id, storyId: s.id, close: { [weak self] in self?.close() }
        ))
        if result == .handled || !state.open { return }
        if isAllowedCtaURL(url, deepLinkSchemes: feed.deepLinkSchemes), let target = URL(string: url) {
            UIApplication.shared.open(target)
        }
    }

    func share() {
        guard canShare, let link = feed.shareLink else { return }
        let g = group
        let s = story
        let url = appShareURL(link, groupId: g.id, storyId: s.id)
        let title = s.title ?? g.title
        let event = StoryEvent("share", groupId: g.id, storyId: s.id)
        if callbacks.onShare?(ShareEvent(url: url, title: title, groupId: g.id, storyId: s.id)) == .handled {
            track(event)
            return
        }
        guard let presenter = topViewController() else { return }
        // The share sheet covers the story, so it waits.
        setPaused(.share, true)
        var items: [Any] = [title]
        items.append(URL(string: url) ?? url)
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.completionWithItemsHandler = { [weak self] _, completed, _, _ in
            if completed { self?.track(event) }
            self?.setPaused(.share, false)
        }
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.maxX - 80, y: 60, width: 1, height: 1)
        }
        presenter.present(sheet, animated: true)
    }
}

func topViewController() -> UIViewController? {
    let window = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
        .first { $0.isKeyWindow }
    var top = window?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
}

/// CADisplayLink keeps a strong reference to its target; this breaks the cycle.
private final class DisplayLinkProxy: NSObject {
    weak var model: ViewerModel?
    init(_ model: ViewerModel) { self.model = model }
    @objc func tick(_ link: CADisplayLink) {
        guard let model else { return link.invalidate() }
        model.tick(link.timestamp)
    }
}

/// Full-screen story viewer. It's drawn full screen and still; the window it's presented in
/// (`ViewerHostingController`) slides it up, follows a drag and shrinks it away with Core
/// Animation, so a busy main thread can't make the motion stutter.
struct StoriesViewer: View {
    @ObservedObject var model: ViewerModel
    /// The screen's insets (status bar, home indicator), fixed: the story moves and scales while
    /// it opens and closes, and its own safe area would change on every frame.
    var insets: UIEdgeInsets = .zero
    /// The loading indicator, only for loads that take a while.
    @State private var spinner = false

    var body: some View {
        ZStack {
            Color.black
            if model.shown.open {
                content
            }
        }
        .ignoresSafeArea()
        .onAppear { model.start() }
        .onChange(of: model.shown.seq) { _ in spinner = false }
        .task(id: model.shown.seq) {
            try? await Task.sleep(nanoseconds: 400_000_000)
            spinner = true
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(model.shown.open ? StoriesLabels.viewer(model.group.title) : "")
        .accessibilityAction(.escape) { model.close() }
    }

    /// The story covers the whole screen, under the status bar and home indicator, as the
    /// studio previews it on full phone screens; the header and button stay clear of them.
    private var content: some View {
        let g = model.group
        let s = model.story
        return ZStack {
            TouchSurface(model: model)
                .background(gaps(s).allowsHitTesting(false))
                .overlay(media(s).allowsHitTesting(false))
                .clipped()
                .accessibilityElement()
                .accessibilityLabel(s.alt)
                .accessibilityAddTraits(s.type == "image" ? .isImage : [])
                .accessibilityAction(named: StoriesLabels.previous) { model.dispatch(.prev) }
                .accessibilityAction(named: StoriesLabels.next) { model.dispatch(.next()) }
            if spinner && model.shown.buffering && !model.shown.displayed {
                ProgressView().tint(.white.opacity(0.6))
            }
            // The button and stickers stay with the photo on screen (see onScreen).
            if !model.onScreen.interactions.isEmpty {
                StickersLayer(model: model, story: model.onScreen)
            }
            VStack(spacing: 0) {
                header(g, s)
                Spacer()
                if let label = model.onScreen.ctaLabel, model.onScreen.ctaURL != nil {
                    CtaButton(label: label, style: model.onScreen.ctaStyle, action: model.cta)
                        .padding(.bottom, 24)
                }
            }
            .padding(.top, insets.top)
            .padding(.bottom, insets.bottom)
        }
    }

    @ViewBuilder
    private func media(_ s: FeedStory) -> some View {
        // Fill covers the screen; fit shows all of it, with the gaps in the story's colours.
        if s.type == "video" {
            if let player = model.player {
                PlayerView(player: player, gravity: s.look.fills ? .resizeAspectFill : .resizeAspect)
            }
            // A designed video's text and stickers, fitted as the story image would be.
            if let overlay = s.look.overlay {
                RemoteImage(url: overlay, contentMode: s.look.fills ? .fill : .fit)
            }
        } else {
            let seq = model.shown.seq
            ZStack {
                // The previous story stays on screen until this one has drawn.
                if let p = model.previous, !model.shown.displayed {
                    gaps(p)
                    RemoteImage(url: p.url, contentMode: p.look.fills ? .fill : .fit)
                }
                RemoteImage(url: s.url, contentMode: s.look.fills ? .fill : .fit) { ok in model.imageResult(seq: seq, ok: ok) }
                    .id(seq)
            }
        }
    }

    /// What shows in the gaps around a story shown whole: its colours, top to bottom (or black).
    @ViewBuilder
    private func gaps(_ s: FeedStory) -> some View {
        if let top = s.look.fillTop, let bottom = s.look.fillBottom {
            LinearGradient(
                colors: [Color(hex: top, fallback: .black), Color(hex: bottom, fallback: .black)],
                startPoint: .top, endPoint: .bottom
            )
        } else {
            Color.black
        }
    }

    private func header(_ g: FeedGroup, _ s: FeedStory) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 3) {
                ForEach(Array(model.progress.enumerated()), id: \.offset) { _, fill in
                    GeometryReader { box in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.3))
                            Capsule().fill(Color.white).frame(width: box.size.width * fill)
                        }
                    }
                    .frame(height: 2.5)
                }
            }
            .accessibilityHidden(true)
            HStack(spacing: 8) {
                RemoteImage(url: g.coverURL)
                    .frame(width: 32, height: 32)
                    .clipShape(Circle())
                Text(s.title ?? g.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                if model.canShare {
                    iconButton(StoriesLabels.share, "square.and.arrow.up", action: model.share)
                }
                iconButton(
                    model.userPaused ? StoriesLabels.play : StoriesLabels.pause,
                    model.userPaused ? "play.fill" : "pause.fill",
                    action: model.toggleUserPause
                )
                if s.type == "video" {
                    iconButton(
                        model.muted ? StoriesLabels.unmute : StoriesLabels.mute,
                        model.muted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                        action: model.toggleMute
                    )
                }
                iconButton(StoriesLabels.close, "xmark", action: model.close)
            }
            // 16pt in from the edge, clear of the screen's rounded corners.
            .padding(.leading, 6)
        }
        .padding(.horizontal, 10)
        .padding(.top, 8)
        .padding(.bottom, 14)
        .background(
            // Reaches up behind the status bar, keeping it readable over light stories.
            LinearGradient(gradient: Gradient(colors: [Color.black.opacity(0.4), .clear]), startPoint: .top, endPoint: .bottom)
                .padding(.top, -insets.top)
        )
    }

    private func iconButton(_ label: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(label)
    }
}

/// Raw touches for the spec's gesture recogniser: tap, hold to pause, swipe.
private struct TouchSurface: UIViewRepresentable {
    let model: ViewerModel

    func makeUIView(context: Context) -> TouchView {
        let view = TouchView()
        view.recognizer = model.gestures
        view.isMultipleTouchEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: TouchView, context: Context) {
        view.recognizer = model.gestures
    }

    final class TouchView: UIView {
        var recognizer: GestureRecognizer?

        private func ms(_ touch: UITouch) -> Int { Int(touch.timestamp * 1000) }

        /// The finger's position on screen (window coordinates), not in this view: the view moves
        /// with the story while it's dragged, and measuring against it would feed the drag back
        /// into itself (the story jumping back and forth under a slow or held finger).
        private func point(_ touch: UITouch) -> CGPoint { touch.location(in: nil) }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let t = touches.first else { return }
            let p = point(t)
            recognizer?.down(p.x, p.y, ms(t))
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let t = touches.first else { return }
            let p = point(t)
            recognizer?.move(p.x, p.y)
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let t = touches.first else { return }
            let p = point(t)
            recognizer?.up(p.x, p.y, ms(t), width: Double(window?.bounds.width ?? bounds.width))
        }

        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
            recognizer?.cancel()
        }
    }
}
#endif
