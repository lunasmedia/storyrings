#if canImport(UIKit)
import Combine
import SwiftUI
import UIKit

/// Viewability: how long a circle must stay at least half on screen to count as an impression.
private let impressionSeconds = 1.0

/// Longest the bar stays hidden on launch while waiting for the live feed and covers.
private let revealWaitSeconds = 0.5

/// How many groups, from the start of the bar, have their first story loaded with the feed.
private let preloadGroups = 4

/// Longest a tap waits for the first story's image before opening the viewer on a spinner.
private let openWaitSeconds = 1.5

/// Opens stories from code (a push notification, a deep link), and refreshes.
public final class StoriesBarController {
    fileprivate weak var model: BarModel?

    public init() {}

    /// Live groups currently shown.
    public var groups: [FeedGroup] { model?.feed?.groups ?? [] }

    /// Opens the viewer at a group, by id. False until the feed has loaded, or if the group
    /// isn't live.
    @discardableResult
    public func open(_ groupId: String) -> Bool { model?.open(id: groupId) ?? false }

    /// Closes the viewer if it's open.
    public func close() { model?.viewer?.close() }

    /// Refetches the feed.
    public func refresh() { model?.load(force: true) }
}

struct BarCallbacks {
    var onLoad: (([FeedGroup]) -> Void)?
    var onFail: ((StoriesError) -> Void)?
    var onClose: ((CloseReason) -> Void)?
    var viewer = ViewerCallbacks()
}

struct BarConfig: Equatable {
    var token: String
    var apiURL: String
    var bar: String
    var tags: [String]
    var analytics: Bool
}

final class BarModel: ObservableObject {
    @Published private(set) var feed: Feed?
    @Published private(set) var seen: SeenStore?
    @Published private(set) var visible = false
    @Published private(set) var failed = false
    private(set) var viewer: ViewerModel?
    private weak var presented: UIViewController?
    /// Bumped when seen state changes, so rings redraw.
    @Published private(set) var seenVersion = 0
    /// The circle tapped to open the viewer, shown pressed while its first story loads.
    @Published private(set) var openingIndex: Int?

    var callbacks = BarCallbacks()
    private(set) var config: BarConfig?
    private var client: StoriesClient?
    private var fresh = false
    private var loadSeq = 0
    private var revealWork: DispatchWorkItem?
    private var appActive = UIApplication.shared.applicationState != .background
    private var onScreen = false
    private var observers: [NSObjectProtocol] = []

    // Impressions
    private var frames: [String: CGRect] = [:]

    // Where each circle is, for the viewer to spring from and back into (iOS).
    private var markers: [String: WeakView] = [:]
    var circleRadius: CGFloat = 0
    var transition: StoriesTransition = .zoom
    private var viewportWidth: CGFloat = 0
    private var impressed = Set<String>()
    private var pending: [String: DispatchWorkItem] = [:]

    init() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.appActive = true
            // Offline at launch: try again when the app comes back.
            if !self.failed && !self.fresh && self.config != nil { self.load(force: true) }
            self.reportImpressions()
        })
        observers.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.appActive = false
            self?.reportImpressions()
        })
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        revealWork?.cancel()
        pending.values.forEach { $0.cancel() }
    }

    func configure(_ config: BarConfig, reach: Bool, storage: KeyValueStorage?) {
        let clientChanged = config.token != self.config?.token || config.apiURL != self.config?.apiURL
            || config.analytics != self.config?.analytics
        if clientChanged || client == nil {
            client = StoriesClient.start(
                token: config.token, apiURL: config.apiURL, analytics: config.analytics, reach: reach, storage: storage
            )
        }
        guard config != self.config else { return }
        self.config = config
        impressed.removeAll()
        start()
    }

    func setReach(_ reach: Bool) { client?.setReach(reach) }

    private func start() {
        guard let client, let config else { return }
        fresh = false
        failed = false
        loadSeq += 1
        // Lay out last launch's feed (hidden) while the live one loads; it shows if the network is slow.
        if let cached = client.cachedFeed(bar: config.bar, tags: config.tags) {
            feed = cached
            seen = client.seenStore(cached.appId)
        }
        revealWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.reveal() }
        revealWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + revealWaitSeconds, execute: work)
        load()
    }

    private func reveal() {
        if !visible { visible = true }
        DispatchQueue.main.async { self.reportImpressions() }
    }

    func load(force: Bool = false) {
        guard let client, let config else { return }
        let seq = loadSeq
        client.loadFeed(bar: config.bar, tags: config.tags, force: force) { [weak self] result in
            guard let self, seq == self.loadSeq else { return }
            switch result {
            case let .success(feed):
                let seen = client.seenStore(feed.appId)
                // Show new covers only once they're loaded, so they don't pop in.
                self.preloadCovers(feed) {
                    guard seq == self.loadSeq else { return }
                    self.feed = feed
                    self.seen = seen
                    self.preloadFirstStories(feed, seen: seen)
                    self.fresh = true
                    self.failed = false
                    self.reveal()
                    self.callbacks.onLoad?(feed.groups)
                }
            case let .failure(error):
                // Offline or a server hiccup: keep last launch's stories; anything else hides the bar.
                let temporary = error.code == "network" || error.code == "server"
                self.failed = !(temporary && self.feed != nil)
                if temporary && self.feed != nil { self.reveal() }
                if let onFail = self.callbacks.onFail {
                    onFail(error)
                } else {
                    print("[Stories] \(error.message)")
                }
            }
        }
    }

    /// Loads and decodes the story each of the first groups opens on, so tapping a circle opens it
    /// at once. Loaded on the tap instead, a story not yet on the device made opening wait.
    private func preloadFirstStories(_ feed: Feed, seen: SeenStore) {
        for group in feed.groups.prefix(preloadGroups) {
            let start = seen.firstUnseenIndex(group.stories.map(\.id))
            guard group.stories.indices.contains(start), group.stories[start].type == "image" else { continue }
            ImageCache.shared.load(group.stories[start].url) { _ in }
        }
    }

    private func preloadCovers(_ feed: Feed, then done: @escaping () -> Void) {
        let urls = feed.groups.prefix(8).map(\.coverURL).filter { !$0.isEmpty }
        var finished = false
        var remaining = urls.count
        let finish = {
            guard !finished else { return }
            finished = true
            done()
        }
        if remaining == 0 { return finish() }
        DispatchQueue.main.asyncAfter(deadline: .now() + revealWaitSeconds, execute: finish)
        for url in urls {
            // A missing cover just shows the placeholder; nothing to report.
            ImageCache.shared.load(url) { _ in
                remaining -= 1
                if remaining == 0 { finish() }
            }
        }
    }

    func track(_ event: StoryEvent) {
        let bar = config?.bar ?? ""
        client?.track(bar.isEmpty ? event : event.withBar(bar))
    }

    // MARK: Impressions

    func setOnScreen(_ value: Bool) {
        onScreen = value
        reportImpressions()
    }

    func updateFrames(_ frames: [String: CGRect], viewport: CGFloat) {
        self.frames = frames
        viewportWidth = viewport
        reportImpressions()
    }

    /// One impression per group per bar, by the MRC/IAB rule: at least half the circle on
    /// screen for one continuous second, while the app is active and the viewer is closed.
    func reportImpressions() {
        var showing = Set<String>()
        if fresh, visible, onScreen, viewer == nil, appActive, let feed {
            for g in feed.groups {
                guard let f = frames[g.id], !impressed.contains(g.id) else { continue }
                let shown = min(f.maxX, viewportWidth) - max(f.minX, 0)
                if shown >= f.width / 2 { showing.insert(g.id) }
            }
        }
        for (id, work) in pending where !showing.contains(id) {
            work.cancel()
            pending[id] = nil
        }
        for id in showing where pending[id] == nil {
            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.pending[id] = nil
                if self.impressed.insert(id).inserted { self.track(StoryEvent("impression", groupId: id)) }
            }
            pending[id] = work
            DispatchQueue.main.asyncAfter(deadline: .now() + impressionSeconds, execute: work)
        }
    }

    // MARK: Viewer

    func open(id: String) -> Bool {
        guard let index = feed?.groups.firstIndex(where: { $0.id == id }) else { return false }
        open(index: index)
        return true
    }

    /// Presented with UIKit from the topmost view controller rather than a SwiftUI cover, which
    /// can be dismissed when the bar sits in a List row that gets rebuilt.
    private var opening = false

    func open(index: Int) {
        guard let feed, let seen, viewer == nil, !opening, feed.groups.indices.contains(index) else { return }
        // Open once the first story's image is ready, so the viewer doesn't open on black and a
        // spinner. The first stories load with the feed (see preloadFirstStories), so this is
        // normally at once; meanwhile the circle stays pressed.
        let group = feed.groups[index]
        let start = seen.firstUnseenIndex(group.stories.map(\.id))
        let first = group.stories.indices.contains(start) ? group.stories[start] : nil
        opening = true
        var shown = false
        let show = { [weak self] in
            guard let self, !shown else { return }
            shown = true
            self.opening = false
            self.openingIndex = nil
            self.present(index: index)
        }
        guard let first, first.type == "image", ImageCache.shared.cached(first.url) == nil else { return show() }
        openingIndex = index
        DispatchQueue.main.asyncAfter(deadline: .now() + openWaitSeconds, execute: show)
        ImageCache.shared.load(first.url) { _ in show() }
    }

    func setMarker(_ view: UIView, for groupId: String) {
        markers[groupId] = WeakView(view)
    }

    /// Group `index`'s circle on screen (window coordinates), if it's visible.
    func circle(for index: Int) -> ViewerOrigin? {
        guard let id = feed?.groups.indices.contains(index) == true ? feed?.groups[index].id : nil,
              let view = markers[id]?.view, let window = view.window
        else { return nil }
        let rect = view.convert(view.bounds, to: nil)
        guard rect.width > 0, window.bounds.intersection(rect).width >= rect.width / 2 else { return nil }
        return ViewerOrigin(rect: rect, radius: min(circleRadius, rect.width / 2, rect.height / 2))
    }

    private func present(index: Int) {
        guard let feed, let seen, viewer == nil, let presenter = topViewController() else { return }
        let client = self.client
        let model = ViewerModel(
            feed: feed, groupIndex: index, seen: seen, track: { [weak self] in self?.track($0) },
            callbacks: callbacks.viewer,
            answers: client?.answerStore(feed.appId),
            sendAnswer: { [weak client] story, id, value, done in
                guard let client else { return done(nil) }
                client.sendAnswer(storyId: story, interactionId: id, value: value, completion: done)
            },
            onFinish: { [weak self] reason in self?.viewerFinished(reason) }
        )
        viewer = model
        // Slide: no circle to grow from, so the viewer slides up and shrinks towards the bottom.
        let zoom = transition == .zoom
        let host = ViewerController(model: model) { [weak self] in zoom ? self?.circle(for: $0) : nil }
        presented = host
        // The viewer animates itself in (springs from the circle) and out (back into it).
        presenter.present(host, animated: false)
        reportImpressions()
    }

    private func viewerFinished(_ reason: CloseReason) {
        viewer = nil
        presented?.dismiss(animated: false)
        // Rings turn grey for what was just watched.
        seenVersion += 1
        callbacks.onClose?(reason)
        DispatchQueue.main.async { self.reportImpressions() }
    }
}

/// How the viewer opens and closes. With Reduce Motion on, both are a short fade.
public enum StoriesTransition: Sendable {
    /// Springs out of the tapped circle and goes back into the circle of the group being watched
    /// (slides when that circle isn't on screen, e.g. a group opened from code).
    case zoom
    /// Slides up from the bottom; shrinks away towards the bottom of the screen.
    case slide
}

struct ViewerOrigin {
    /// In window coordinates.
    let rect: CGRect
    let radius: CGFloat
}

final class WeakView {
    weak var view: UIView?
    init(_ view: UIView) { self.view = view }
}

/// Presents the viewer over the app and moves it with Core Animation, off the main thread's
/// drawing: it springs out of the tapped circle to open and goes back into the circle of the
/// group being watched to close (sliding up / shrinking towards the bottom when that circle
/// isn't on screen). It follows a drag down, springing back if let go early. The app behind is
/// never dimmed. With Reduce Motion on, both are a short fade.
private final class ViewerController: UIViewController {
    private let model: ViewerModel
    private let circle: (Int) -> ViewerOrigin?
    private let host: UIHostingController<StoriesViewer>
    private var dragUpdates: AnyCancellable?
    private var running: UIViewPropertyAnimator?
    private var closing = false
    private var reduceMotion: Bool { UIAccessibility.isReduceMotionEnabled }

    /// Clips the story: it's the circle's shape and place when small, the screen when open.
    /// UIKit sets the presented view's frame itself, so that view isn't animated directly.
    private let card = UIView()
    /// The story, always laid out at screen size and scaled to the card's width.
    private var story: UIView { host.view }

    init(model: ViewerModel, circle: @escaping (Int) -> ViewerOrigin?) {
        self.model = model
        self.circle = circle
        host = UIHostingController(rootView: StoriesViewer(model: model))
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalPresentationCapturesStatusBarAppearance = true
        model.closeAnimation = { [weak self] _, done in
            guard let self else { return done() }
            self.animateOut(done)
        }
        dragUpdates = model.$drag.sink { [weak self] in self?.dragged(to: $0) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Light status bar content only while the story covers the top of the screen; otherwise the
    /// app's own style, so the status bar never turns white over the app.
    private var lightStatusBar = false {
        didSet {
            guard lightStatusBar != oldValue else { return }
            // A short fade, except while a finger drags the story: then the change is immediate,
            // so the status bar update (and any layout it triggers) isn't swept into an animation
            // that fights the finger.
            if model.dragging {
                setNeedsStatusBarAppearanceUpdate()
            } else {
                UIView.animate(withDuration: 0.2) { self.setNeedsStatusBarAppearanceUpdate() }
            }
        }
    }

    /// Set once a drag has pulled the story fully below the status bar; the status bar then keeps
    /// the app's style until the finger is lifted, however the finger wobbles.
    private var dragUncoveredTop = false

    override var preferredStatusBarStyle: UIStatusBarStyle {
        lightStatusBar ? .lightContent : (presentingViewController?.preferredStatusBarStyle ?? .default)
    }

    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    private var statusBarHeight: CGFloat {
        view.window?.windowScene?.statusBarManager?.statusBarFrame.height ?? view.safeAreaInsets.top
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        card.backgroundColor = .black
        card.layer.cornerCurve = .continuous
        card.layer.masksToBounds = true
        view.addSubview(card)
        addChild(host)
        story.backgroundColor = .black
        card.addSubview(story)
        host.didMove(toParent: self)
        place(view.bounds, corner: 0)
    }

    private var height: CGFloat { view.bounds.height > 0 ? view.bounds.height : UIScreen.main.bounds.height }

    /// The card at `rect` (this view's coordinates) with rounded corners; the story at screen
    /// size inside it, scaled to its width and centred.
    private func place(_ rect: CGRect, corner: CGFloat) {
        let screen = view.bounds
        card.transform = .identity
        card.frame = rect
        card.layer.cornerRadius = corner
        story.bounds = CGRect(origin: .zero, size: screen.size)
        story.center = CGPoint(x: rect.width / 2, y: rect.height / 2)
        let scale = screen.width > 0 ? rect.width / screen.width : 1
        story.transform = CGAffineTransform(scaleX: scale, y: scale)
    }

    /// Where the circle of group `index` is, in this view's coordinates.
    private func origin(_ index: Int) -> ViewerOrigin? {
        guard !reduceMotion, let o = circle(index) else { return nil }
        return ViewerOrigin(rect: view.convert(o.rect, from: nil), radius: o.radius)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // From the screen it's presented over: this view isn't in a window yet.
        let insets = presentingViewController?.view.window?.safeAreaInsets ?? view.window?.safeAreaInsets ?? .zero
        host.rootView = StoriesViewer(model: model, insets: insets)
        // First drawn in place but practically invisible: its first draw (laying out the story,
        // uploading the image) would otherwise land on the first frames of the motion and stall it.
        card.alpha = 0.01
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Long enough for the one-off cost of building the story to pass while it's invisible.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { [weak self] in
            guard let self, !self.closing else { return }
            if self.reduceMotion {
                self.card.alpha = 0
                self.run(UIViewPropertyAnimator(duration: 0.15, curve: .linear) { self.card.alpha = 1 })
                self.lightStatusBar = true
                return
            }
            let full = self.view.bounds
            if let o = self.origin(self.model.shown.groupIndex) {
                // Springs out of the tapped circle.
                self.place(o.rect, corner: o.radius)
                self.card.alpha = 1
                self.run(UIViewPropertyAnimator(duration: 0.5, dampingRatio: 0.82) {
                    self.place(full, corner: 0)
                })
            } else {
                // Not on screen (opened from code, or scrolled away): slides up from the bottom.
                self.card.transform = CGAffineTransform(translationX: 0, y: self.height)
                self.card.alpha = 1
                self.run(UIViewPropertyAnimator(duration: 0.3, controlPoint1: CGPoint(x: 0.2, y: 0), controlPoint2: CGPoint(x: 0, y: 1)) {
                    self.card.transform = .identity
                })
            }
            // By about half way through, the story covers the top of the screen.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                guard let self, !self.closing, self.model.drag == 0 else { return }
                self.lightStatusBar = true
            }
        }
    }

    /// Dragging down: the story follows the finger and shrinks a little, with rounded corners.
    private func dragged(to d: CGFloat) {
        guard !closing, !reduceMotion, isViewLoaded, view.window != nil else { return }
        if model.dragging {
            // The finger is down: the story follows it exactly (back to its place if it moves
            // above where it started).
            running?.stopAnimation(true)
            running = nil
            applyDrag(d)
            if d >= statusBarHeight { dragUncoveredTop = true }
            lightStatusBar = !dragUncoveredTop
        } else if card.transform != .identity {
            // Lifted without closing: spring back.
            dragUncoveredTop = false
            run(UIViewPropertyAnimator(duration: 0.35, dampingRatio: 0.8) { self.applyDrag(0) })
            lightStatusBar = true
        }
    }

    private func applyDrag(_ d: CGFloat) {
        let dragged = min(1, max(0, d / height))
        let scale = 1 - 0.12 * dragged
        card.transform = d > 0 ? CGAffineTransform(translationX: 0, y: d).scaledBy(x: scale, y: scale) : .identity
        // In the card's own (unscaled) coordinates.
        card.layer.cornerRadius = 16 / scale * min(1, dragged * 8)
    }

    /// Back into the circle of the group being watched, from wherever the story is; or, when that
    /// circle isn't on screen, shrinks towards the bottom centre of the screen.
    private func animateOut(_ done: @escaping () -> Void) {
        closing = true
        // The app shows around the story as it goes.
        lightStatusBar = false
        // Freezes any open, drag or spring-back motion where it is, so the close carries on from there.
        running?.stopAnimation(true)
        running = nil
        if reduceMotion {
            UIView.animate(withDuration: 0.15, delay: 0, options: .curveLinear, animations: { self.card.alpha = 0 }) { _ in done() }
            return
        }
        // Re-express the card's current (possibly dragged) look as a plain frame, without a visible change.
        let visible = card.frame
        let corner = card.layer.cornerRadius * card.transform.a
        place(visible, corner: corner)

        if let o = origin(model.shown.groupIndex) {
            let back = UIViewPropertyAnimator(duration: 0.42, dampingRatio: 0.92) {
                self.place(o.rect, corner: o.radius)
            }
            back.addCompletion { _ in done() }
            back.startAnimation()
            // Hands over to the circle's cover as it lands.
            UIView.animate(withDuration: 0.12, delay: 0.26, options: .curveLinear) { self.card.alpha = 0 }
            return
        }
        let h = height
        let scale: CGFloat = 0.12
        let target = CGRect(
            x: (view.bounds.width - view.bounds.width * scale) / 2, y: h * 0.92 - h * scale / 2,
            width: view.bounds.width * scale, height: h * scale
        )
        let shrink = UIViewPropertyAnimator(duration: 0.3, controlPoint1: CGPoint(x: 0.4, y: 0), controlPoint2: CGPoint(x: 0.2, y: 1)) {
            self.place(target, corner: 16)
        }
        shrink.addCompletion { _ in done() }
        shrink.startAnimation()
        UIView.animate(withDuration: 0.12, delay: 0.18, options: .curveLinear) { self.card.alpha = 0 }
    }

    private func run(_ animator: UIViewPropertyAnimator) {
        running?.stopAnimation(true)
        running = animator
        animator.addCompletion { [weak self, weak animator] _ in
            if self?.running === animator { self?.running = nil }
        }
        animator.startAnimation()
    }
}

private struct FramesKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

/// An Instagram-style story bar. Tapping a circle opens the full-screen viewer.
///
/// ```swift
/// StoriesBar(token: "pk_live_…", apiURL: "https://stories.example.com")
/// StoriesBar(token: "pk_live_…", apiURL: "…", bar: "product-page")   // a second story bar
/// StoriesBar(token: "pk_live_…", apiURL: "…", tags: ["london"])      // the person's tags
///     .onCtaClick { event in router.open(event.url); return .handled }
/// ```
public struct StoriesBar: View {
    private let config: BarConfig
    private let reach: Bool
    private let storage: KeyValueStorage?
    private let theme: StoriesTheme
    private let transition: StoriesTransition
    private let controller: StoriesBarController?
    private var callbacks = BarCallbacks()

    @StateObject private var model = BarModel()

    /// - Parameters:
    ///   - token: Public token from the dashboard (Settings → Apps & websites → your app).
    ///   - apiURL: Your Stories server, e.g. https://stories.example.com.
    ///   - bar: Which story bar to show: its key from the dashboard. Nil = the main bar.
    ///   - tags: The person's tags from your own user data (e.g. ["london", "premium"]). Groups
    ///     with an audience only show to people whose tags pass it. Never personal data such as
    ///     emails or IDs. Changing them reloads the feed.
    ///   - analytics: Send analytics events.
    ///   - reach: Count unique viewers with an anonymous ID kept on the device. Pass false until
    ///     the person consents if your privacy rules require it.
    ///   - storage: Where seen stories, the last feed and the anonymous ID are kept (default
    ///     UserDefaults).
    ///   - transition: How the viewer opens and closes: `.zoom` (out of the tapped circle and
    ///     back into it) or `.slide` (up from the bottom, shrinking away towards the bottom).
    public init(
        token: String,
        apiURL: String,
        bar: String? = nil,
        tags: [String] = [],
        analytics: Bool = true,
        reach: Bool = true,
        storage: KeyValueStorage? = nil,
        theme: StoriesTheme = StoriesTheme(),
        transition: StoriesTransition = .zoom,
        controller: StoriesBarController? = nil
    ) {
        config = BarConfig(
            token: token,
            apiURL: apiURL,
            bar: bar?.trimmingCharacters(in: .whitespaces).lowercased() ?? "",
            tags: normalizeTags(tags),
            analytics: analytics
        )
        self.reach = reach
        self.storage = storage
        self.theme = theme
        self.transition = transition
        self.controller = controller
    }

    /// Called with the live groups once loaded (may be empty).
    public func onLoad(_ action: @escaping ([FeedGroup]) -> Void) -> Self { with { $0.onLoad = action } }

    /// Called if the feed can't be loaded. The bar then shows nothing, except stories from the
    /// last launch when offline.
    public func onFail(_ action: @escaping (StoriesError) -> Void) -> Self { with { $0.onFail = action } }

    /// Called every time a story starts.
    public func onStoryOpen(_ action: @escaping (StoryOpenEvent) -> Void) -> Self { with { $0.viewer.onStoryOpen = action } }

    /// Called when the viewer closes: `.user` or `.completed` (watched to the end).
    public func onClose(_ action: @escaping (CloseReason) -> Void) -> Self { with { $0.onClose = action } }

    /// A story button was tapped. Return `.handled` to handle the link yourself (e.g. navigate
    /// inside your app); `.default` lets the SDK open it.
    public func onCtaClick(_ action: @escaping (CtaClickEvent) -> CtaResult) -> Self { with { $0.viewer.onCtaClick = action } }

    /// Share was tapped (shown when sharing is on in the dashboard). Return `.handled` to share
    /// yourself; `.default` shows the system share sheet.
    public func onShare(_ action: @escaping (ShareEvent) -> ShareResult) -> Self { with { $0.viewer.onShare = action } }

    private func with(_ change: (inout BarCallbacks) -> Void) -> Self {
        var copy = self
        change(&copy.callbacks)
        return copy
    }

    public var body: some View {
        content
            .onAppear {
                model.callbacks = callbacks
                controller?.model = model
                model.configure(config, reach: reach, storage: storage)
                model.setOnScreen(true)
            }
            .onDisappear { model.setOnScreen(false) }
            .onChange(of: config) { model.configure($0, reach: reach, storage: storage) }
            .onChange(of: reach) { model.setReach($0) }
    }

    @ViewBuilder
    private var content: some View {
        // Callbacks can capture new state, and the controller can be a new instance, on each update.
        let _ = {
            model.callbacks = callbacks
            model.transition = transition
            controller?.model = model
        }()
        if !model.failed, let feed = model.feed, let seen = model.seen, !feed.groups.isEmpty {
            let layout = feed.layout
            let width = layout.map { CGFloat($0.width) } ?? theme.circleSize
            let height = layout.map { CGFloat($0.height) } ?? theme.circleSize
            let radius = layout.map { CGFloat($0.cornerRadius) } ?? theme.circleSize / 2
            let _ = { model.circleRadius = radius }()
            let gap = layout.map { CGFloat($0.gap) } ?? theme.gap
            GeometryReader { outer in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: gap) {
                        ForEach(Array(feed.groups.enumerated()), id: \.element.id) { index, group in
                            StoryCircle(
                                group: group, width: width, height: height, radius: radius,
                                seen: seen.isGroupSeen(group.stories.map(\.id)),
                                theme: theme,
                                opening: model.openingIndex == index,
                                onTap: { model.open(index: index) },
                                marker: { model.setMarker($0, for: group.id) }
                            )
                            .background(GeometryReader { item in
                                Color.clear.preference(key: FramesKey.self, value: [group.id: item.frame(in: .named("storiesBar"))])
                            })
                        }
                    }
                    .padding(.horizontal, theme.barPadding)
                    .padding(.top, 4)
                    .padding(.bottom, 10)
                }
                .coordinateSpace(name: "storiesBar")
                .onPreferenceChange(FramesKey.self) { model.updateFrames($0, viewport: outer.size.width) }
            }
            .frame(height: barHeight(height))
            .opacity(model.visible ? 1 : 0)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(StoriesLabels.bar)
        } else {
            // Nothing to show yet, but something must be on screen for onAppear to start loading.
            Color.clear.frame(height: 0).accessibilityHidden(true)
        }
    }

    private func barHeight(_ item: CGFloat) -> CGFloat {
        let titles = theme.hideTitles ? 0 : 6 + ceil(theme.titleSize * 1.25) * 2
        return item + titles + 14
    }
}
#endif
