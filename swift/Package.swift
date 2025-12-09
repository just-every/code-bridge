// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CodeBridgeClient",
    platforms: [.iOS(.v14), .macOS(.v12)],
    products: [
        .library(name: "CodeBridgeClient", targets: ["CodeBridgeClient"]),
        .executable(name: "CodeBridgeExample", targets: ["CodeBridgeExample"])
    ],
    targets: [
        .target(name: "CodeBridgeClient"),
        .executableTarget(name: "CodeBridgeExample", dependencies: ["CodeBridgeClient"]),
        .testTarget(
            name: "CodeBridgeClientTests",
            dependencies: ["CodeBridgeClient"]
        )
    ]
)
