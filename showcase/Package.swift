// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Showcase",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(path: "../swift-harness"),
    ],
    targets: [
        .executableTarget(
            name: "Showcase",
            dependencies: [.product(name: "AppMCPHarness", package: "swift-harness")]
        ),
    ]
)
