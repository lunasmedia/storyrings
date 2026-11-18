#if canImport(UIKit)
import AVFoundation

/// The viewer's sound. iOS's default audio session stays quiet while the phone's silent switch is
/// on, so unmuted videos played without sound on many phones. While a viewer is open and unmuted,
/// the app plays sound like a video player (heard on silent, pausing other apps' audio); muted or
/// closed, it gives the sound back (other apps' audio resumes) and restores the app's own audio
/// settings. Muted card previews never change it. Used from the main thread only.
enum StoryAudio {
    private static var saved: (category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)?

    static func setPlaying(_ on: Bool) {
        let session = AVAudioSession.sharedInstance()
        if on {
            guard saved == nil else { return }
            saved = (session.category, session.mode, session.categoryOptions)
            try? session.setCategory(.playback, mode: .moviePlayback)
            try? session.setActive(true)
        } else if let previous = saved {
            saved = nil
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            try? session.setCategory(previous.category, mode: previous.mode, options: previous.options)
        }
    }
}
#endif
