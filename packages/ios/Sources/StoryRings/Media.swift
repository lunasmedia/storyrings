#if canImport(UIKit)
import AVFoundation
import CryptoKit
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
            DispatchQueue.main.async { self.finish(url, image) }
        }.resume()
    }

    /// A video's first frame, cached like an image under ``frameKey(_:)``. Only the start of the
    /// video is fetched. Calls back on the main thread with the frame, or nil if it couldn't load.
    func loadFrame(_ url: String, completion: @escaping (UIImage?) -> Void) {
        let key = Self.frameKey(url)
        if let image = cached(key) { return completion(image) }
        guard let target = URL(string: url) else { return completion(nil) }
        if waiting[key] != nil {
            waiting[key]!.append(completion)
            return
        }
        waiting[key] = [completion]
        let file = Self.frameFile(url)
        let screen = Self.screenPixels
        DispatchQueue.global(qos: .userInitiated).async {
            // Saved by an earlier launch: shows at once, with nothing fetched.
            if let file, let data = try? Data(contentsOf: file), let saved = UIImage(data: data) {
                let image = saved.preparingForDisplay() ?? saved
                return DispatchQueue.main.async { self.finish(key, image) }
            }
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: target))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = screen
            generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: .zero)]) { _, cg, _, _, _ in
                let image = cg.map { UIImage(cgImage: $0) }
                if let image, let file { Self.save(image, to: file) }
                DispatchQueue.main.async { self.finish(key, image) }
            }
        }
    }

    /// Video frames are kept on disk too (in Caches, which iOS can clear), so cards show their
    /// stills at once on later launches instead of fetching the video's start again. A file's
    /// name is its URL's hash: media URLs change whenever their content does.
    private static let framesDirectory: URL? = FileManager.default
        .urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent("StoryRingsFrames", isDirectory: true)

    private static func frameFile(_ url: String) -> URL? {
        let hash = SHA256.hash(data: Data(url.utf8)).map { String(format: "%02x", $0) }.joined()
        return framesDirectory?.appendingPathComponent("\(hash).jpg")
    }

    private static func save(_ image: UIImage, to file: URL) {
        guard let data = image.jpegData(compressionQuality: 0.85) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }

    /// The cache key of a video's first frame.
    static func frameKey(_ url: String) -> String { "frame:" + url }

    private func finish(_ key: String, _ image: UIImage?) {
        if let image, let cg = image.cgImage {
            let cost = cg.bytesPerRow * cg.height
            (cost <= Self.smallBytes ? small : large).setObject(image, forKey: key as NSString, cost: cost)
        }
        waiting.removeValue(forKey: key)?.forEach { $0(image) }
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
    /// `url` is a video: show its first frame.
    var videoFrame = false
    var onResult: ((Bool) -> Void)?

    @State private var image: UIImage?
    @State private var loadedURL: String?

    private var key: String { videoFrame ? ImageCache.frameKey(url) : url }

    var body: some View {
        let shown = loadedURL == url ? image : ImageCache.shared.cached(key)
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
        if let cached = ImageCache.shared.cached(key) {
            image = cached
            loadedURL = wanted
            // After this frame, once it's on screen.
            DispatchQueue.main.async { onResult?(true) }
            return
        }
        let done: (UIImage?) -> Void = { loaded in
            guard wanted == url else { return }
            image = loaded
            loadedURL = wanted
            DispatchQueue.main.async { onResult?(loaded != nil) }
        }
        if videoFrame { ImageCache.shared.loadFrame(wanted, completion: done) } else { ImageCache.shared.load(wanted, completion: done) }
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
/// Energized style: a story video playing once, muted, from the start.
final class PreviewVideo: ObservableObject {
    @Published private(set) var ready = false
    let player: AVPlayer
    private var status: NSKeyValueObservation?

    init(url: URL) {
        player = AVPlayer(url: url)
        player.isMuted = true
        player.preventsDisplaySleepDuringVideoPlayback = false
        status = player.observe(\.currentItem?.status, options: [.new]) { [weak self] player, _ in
            guard player.currentItem?.status == .readyToPlay else { return }
            DispatchQueue.main.async { self?.ready = true }
        }
        player.play()
    }

    deinit {
        status?.invalidate()
        player.pause()
    }
}
#endif
