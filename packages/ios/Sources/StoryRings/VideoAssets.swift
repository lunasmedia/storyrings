#if canImport(UIKit)
import AVFoundation

/// Videos loaded ahead of being played: the first story of each group (with the feed) and the
/// next story while one plays. Loading a video's details takes a few round trips to the server
/// before it can play, which is what kept the viewer on a spinner when a group opened.
/// Used from the main thread only.
final class VideoAssets {
    static let shared = VideoAssets()

    /// Most recent last; a handful is plenty (first stories of the visible groups, the next one).
    private var assets: [(url: String, asset: AVURLAsset)] = []
    private let limit = 8

    /// Starts loading `url`'s details (and the start of the video), if it isn't already.
    func preload(_ url: String) {
        _ = asset(for: url)
    }

    /// The video for `url`: the one loaded ahead if there is one, otherwise a new one.
    func asset(for url: String) -> AVURLAsset? {
        if let i = assets.firstIndex(where: { $0.url == url }) {
            let found = assets.remove(at: i)
            assets.append(found)
            return found.asset
        }
        guard let target = URL(string: url) else { return nil }
        let asset = AVURLAsset(url: target)
        asset.loadValuesAsynchronously(forKeys: ["playable", "duration", "tracks"]) {}
        assets.append((url, asset))
        if assets.count > limit { assets.removeFirst(assets.count - limit) }
        return asset
    }
}
#endif
