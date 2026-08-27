// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AppMCPHarness",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "AppMCPHarness", targets: ["AppMCPHarness"]),
    ],
    targets: [
        .target(name: "AppMCPHarness"),
    ]
)
