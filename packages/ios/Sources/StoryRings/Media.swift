#if canImport(UIKit)
import AVFoundation
import ImageIO
import SwiftUI
import UIKit

/// Downloaded images in memory, so covers preloaded before the bar appears show at once.
/// Downloads go through URLSession's own cache too.
final class ImageCache {
    static let shared = ImageCache()

    /// Covers and other small images keep a cache of their own, so a few big story photos can
    /// never push them out (the header's cover blinking out between stories).
    private let small: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.totalCostLimit = 16 * 1024 * 1024
        return c
    }()
    private let large: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.totalCostLimit = 96 * 1024 * 1024
        return c
    }()
    private var waiting: [String: [(UIImage?) -> Void]] = [:]
    /// Images up to this many bytes decoded count as small.
    private static let smallBytes = 2 * 1024 * 1024

    func cached(_ url: String) -> UIImage? {
        small.object(forKey: url as NSString) ?? large.object(forKey: url as NSString)
    }

    /// Calls back on the main thread with the image, or nil if it couldn't load.
    func load(_ url: String, completion: @escaping (UIImage?) -> Void) {
        if let image = cached(url) { return completion(image) }
        guard let target = URL(string: url) else { return completion(nil) }
        if waiting[url] != nil {
            waiting[url]!.append(completion)
            return
        }
        waiting[url] = [completion]
        let screen = Self.screenPixels
        URLSession.shared.dataTask(with: target) { data, _, _ in
            // Decoded off the main thread, so big images don't stall scrolling.
            let image = data.flatMap { Self.decode($0, toCover: screen) }
            DispatchQueue.main.async {
                if let image, let cg = image.cgImage {
                    let cost = cg.bytesPerRow * cg.height
                    (cost <= Self.smallBytes ? self.small : self.large).setObject(image, forKey: url as NSString, cost: cost)
                }
                self.waiting.removeValue(forKey: url)?.forEach { $0(image) }
            }
        }.resume()
    }

    /// The screen in pixels, portrait.
    private static var screenPixels: CGSize {
        let b = UIScreen.main.nativeBounds.size
        return CGSize(width: min(b.width, b.height), height: max(b.width, b.height))
    }

    /// Decodes an image no bigger than it needs to be to cover `screen`: phone photos are often
    /// 25 megapixels or more (100 MB and up decoded), far beyond what the screen shows.
    private static func decode(_ data: Data, toCover screen: CGSize) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        var w = (props?[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue ?? 0
        var h = (props?[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue ?? 0
        // EXIF orientations 5-8 are rotated a quarter turn.
        if let o = (props?[kCGImagePropertyOrientation] as? NSNumber)?.intValue, o >= 5 { swap(&w, &h) }
        if w > 0, h > 0 {
            let scale = max(screen.width / w, screen.height / h)
            if scale < 1 {
                let options: [CFString: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceShouldCacheImmediately: true,
                    kCGImageSourceThumbnailMaxPixelSize: Int((max(w, h) * scale).rounded(.up)),
                ]
                if let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) {
                    return UIImage(cgImage: cg)
                }
            }
        }
        return UIImage(data: data)?.preparingForDisplay()
    }
}

/// A network image that shows immediately when cached, and reports when it rendered or failed.
struct RemoteImage: View {
    let url: String
    var contentMode: ContentMode = .fill
    var onResult: ((Bool) -> Void)?

    @State private var image: UIImage?
    @State private var loadedURL: String?

    var body: some View {
        let shown = loadedURL == url ? image : ImageCache.shared.cached(url)
        // Sized to exactly the space it's given: `.fill` then covers it (cropping the overflow)
        // and `.fit` sits whole in the middle. A flexible frame here let a filled image settle
        // at its own shape instead, leaving bars like `.fit`.
        GeometryReader { box in
            if let shown {
                Image(uiImage: shown)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .frame(width: box.size.width, height: box.size.height)
            }
        }
        .clipped()
        .onAppear { load() }
        .onChange(of: url) { _ in load() }
        .accessibilityHidden(true)
    }

    private func load() {
        let wanted = url
        if let cached = ImageCache.shared.cached(wanted) {
            image = cached
            loadedURL = wanted
            // After this frame, once it's on screen.
            DispatchQueue.main.async { onResult?(true) }
            return
        }
        ImageCache.shared.load(wanted) { loaded in
            guard wanted == url else { return }
            image = loaded
            loadedURL = wanted
            DispatchQueue.main.async { onResult?(loaded != nil) }
        }
    }
}

/// Plays an AVPlayer, filling its frame.
struct PlayerView: UIViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity = .resizeAspect

    func makeUIView(context: Context) -> PlayerUIView {
        let view = PlayerUIView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = gravity
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: PlayerUIView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
        view.playerLayer.videoGravity = gravity
    }

    final class PlayerUIView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

/// Animated (GIF) covers: a looping muted video drawn over the still once it can play.
final class LoopingVideo: ObservableObject {
    @Published private(set) var ready = false
    let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?
    private var status: NSKeyValueObservation?

    init(url: URL) {
        player.isMuted = true
        // Covers shouldn't keep the screen awake. Muted playback doesn't touch the app's audio session.
        player.preventsDisplaySleepDuringVideoPlayback = false
        let item = AVPlayerItem(url: url)
        looper = AVPlayerLooper(player: player, templateItem: item)
        status = player.observe(\.currentItem?.status, options: [.new]) { [weak self] player, _ in
            guard player.currentItem?.status == .readyToPlay else { return }
            DispatchQueue.main.async {
                self?.ready = true
                self?.player.play()
            }
        }
        player.play()
    }

    deinit {
        status?.invalidate()
        player.pause()
    }
}
#endif
