// swift-tools-version:5.9
// The iOS SDK, at the top of the repository so apps can add it by URL:
//   https://github.com/lunasmedia/storyrings
import PackageDescription

let package = Package(
    name: "StoryRings",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "StoryRings", targets: ["StoryRings"]),
    ],
    targets: [
        // Pure Swift, no UI: must pass every case in /spec (Tests/StoryRingsCoreTests).
        .target(name: "StoryRingsCore", path: "packages/ios/Sources/StoryRingsCore"),
        // The story bar and viewer (SwiftUI, with a UIKit wrapper). iOS only.
        .target(
            name: "StoryRings",
            dependencies: ["StoryRingsCore"],
            path: "packages/ios/Sources/StoryRings",
            resources: [.copy("PrivacyInfo.xcprivacy")]
        ),
        .testTarget(
            name: "StoryRingsCoreTests", dependencies: ["StoryRingsCore"],
            path: "packages/ios/Tests/StoryRingsCoreTests"
        ),
        .testTarget(
            name: "StoryRingsTests", dependencies: ["StoryRings"],
            path: "packages/ios/Tests/StoryRingsTests"
        ),
    ]
)
