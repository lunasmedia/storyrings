#if canImport(UIKit)
import SwiftUI
import UIKit

/// The story bar for UIKit screens. Add it like any view; it sizes itself to its content
/// height (or nothing while there are no live stories).
///
/// ```swift
/// let stories = StoriesBarView(token: "pk_live_…", apiURL: "https://stories.example.com")
/// stories.onCtaClick = { event in router.open(event.url); return .handled }
/// stackView.addArrangedSubview(stories)
/// ```
public final class StoriesBarView: UIView {
    public let controller = StoriesBarController()

    /// The person's tags; changing them reloads the feed.
    public var tags: [String] { didSet { update() } }
    /// Unique-viewer counting; turning it off deletes the anonymous ID.
    public var reach: Bool { didSet { update() } }
    public var theme: StoriesTheme { didSet { update() } }
    /// How the viewer opens and closes: `.zoom` (default) or `.slide`.
    public var transition: StoriesTransition { didSet { update() } }

    public var onLoad: (([FeedGroup]) -> Void)? { didSet { update() } }
    public var onFail: ((StoriesError) -> Void)? { didSet { update() } }
    public var onStoryOpen: ((StoryOpenEvent) -> Void)? { didSet { update() } }
    public var onClose: ((CloseReason) -> Void)? { didSet { update() } }
    public var onCtaClick: ((CtaClickEvent) -> CtaResult)? { didSet { update() } }
    public var onShare: ((ShareEvent) -> ShareResult)? { didSet { update() } }

    private let token: String
    private let apiURL: String
    private let bar: String?
    private let analytics: Bool
    private let storage: KeyValueStorage?
    private let host: UIHostingController<AnyView>

    public init(
        token: String,
        apiURL: String,
        bar: String? = nil,
        tags: [String] = [],
        analytics: Bool = true,
        reach: Bool = true,
        storage: KeyValueStorage? = nil,
        theme: StoriesTheme = StoriesTheme(),
        transition: StoriesTransition = .zoom
    ) {
        self.token = token
        self.apiURL = apiURL
        self.bar = bar
        self.tags = tags
        self.analytics = analytics
        self.reach = reach
        self.storage = storage
        self.theme = theme
        self.transition = transition
        host = UIHostingController(rootView: AnyView(EmptyView()))
        super.init(frame: .zero)
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        if #available(iOS 16.0, *) { host.sizingOptions = .intrinsicContentSize }
        addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: trailingAnchor),
            host.view.topAnchor.constraint(equalTo: topAnchor),
            host.view.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        update()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Use init(token:apiURL:…)") }

    /// Opens the viewer at a group, by id (e.g. from a push notification).
    @discardableResult
    public func open(_ groupId: String) -> Bool { controller.open(groupId) }

    /// Refetches the feed.
    public func refresh() { controller.refresh() }

    /// The hosting controller joins the nearest view controller, so the viewer can be presented.
    override public func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, host.parent == nil, let parent = nearestViewController else { return }
        parent.addChild(host)
        host.didMove(toParent: parent)
    }

    override public func removeFromSuperview() {
        host.willMove(toParent: nil)
        host.removeFromParent()
        super.removeFromSuperview()
    }

    override public var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: host.view.intrinsicContentSize.height)
    }

    override public func layoutSubviews() {
        super.layoutSubviews()
        invalidateIntrinsicContentSize()
    }

    private var nearestViewController: UIViewController? {
        var responder: UIResponder? = self
        while let r = responder {
            if let vc = r as? UIViewController { return vc }
            responder = r.next
        }
        return nil
    }

    private func update() {
        var view = StoriesBar(
            token: token, apiURL: apiURL, bar: bar, tags: tags, analytics: analytics, reach: reach,
            storage: storage, theme: theme, transition: transition, controller: controller
        )
        if let onLoad { view = view.onLoad { [weak self] groups in onLoad(groups); self?.invalidateIntrinsicContentSize() } }
        if let onFail { view = view.onFail(onFail) }
        if let onStoryOpen { view = view.onStoryOpen(onStoryOpen) }
        if let onClose { view = view.onClose(onClose) }
        if let onCtaClick { view = view.onCtaClick(onCtaClick) }
        if let onShare { view = view.onShare(onShare) }
        host.rootView = AnyView(view)
        invalidateIntrinsicContentSize()
    }
}
#endif
