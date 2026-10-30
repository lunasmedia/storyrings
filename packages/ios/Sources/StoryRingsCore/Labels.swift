/// Accessible labels, worded exactly like the other SDKs (spec/constants.json → labels).
public enum StoriesLabels {
    public static func openGroup(_ title: String, count: Int, seen: Bool) -> String {
        "\(title), \(count) \(count == 1 ? "story" : "stories")\(seen ? ", viewed" : "")"
    }
    public static func storyPosition(_ title: String, index: Int, total: Int) -> String {
        "\(title): story \(index + 1) of \(total)"
    }
    public static func viewer(_ title: String) -> String { "Stories: \(title)" }
    public static let close = "Close stories"
    public static let pause = "Pause"
    public static let play = "Play"
    public static let mute = "Mute"
    public static let unmute = "Unmute"
    public static let previous = "Previous story"
    public static let next = "Next story"
    public static let share = "Share story"
    public static let linkCopied = "Link copied"
    public static let shareFailed = "Couldn’t share this story"
    public static let bar = "Stories"
    public static let loading = "Loading stories"
}
