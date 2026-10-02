import AppKit
import ScreenCaptureKit

struct WindowImage: Encodable {
    struct Metadata: Encodable { let backend = "macos-window"; let sourceWindowId: String }
    let scope = "window"
    let window: WindowRecord
    let width: Int
    let height: Int
    let dataUrl: String
    let size: Int
    let capture: Metadata
}

enum WindowCapture {
    @MainActor static func capture(_ id: String, admission: InputAdmission) async throws -> WindowImage {
        try admission.check()
        guard CGPreflightScreenCaptureAccess() else { throw ControlError("Screen Recording permission is required.") }
        let before = try WindowCatalog.resolve(id)
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        try admission.check()
        guard let source = content.windows.first(where: {
            $0.windowID == before.windowNumber && $0.owningApplication?.processID == before.pid
        }) else { throw ControlError("Target window cannot be captured.") }
        let filter = SCContentFilter(desktopIndependentWindow: source)
        let config = SCStreamConfiguration()
        let size = WindowGeometry.captureSize(before.bounds)
        config.width = size.width
        config.height = size.height
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        config.ignoreGlobalClipSingleWindow = true
        config.scalesToFit = true
        config.captureResolution = .nominal
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        try admission.check()
        let after = try WindowCatalog.resolve(id)
        guard before.bounds == after.bounds else { throw ControlError("Window moved during capture; control stopped. Start a new session to capture again.") }
        guard abs(Double(image.width) / Double(image.height) - after.bounds.width / after.bounds.height) <= 2 / Double(image.height),
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]),
              png.count > 0, png.count <= 18_000_000 else { throw ControlError("Window screenshot encoding or geometry is invalid.") }
        return WindowImage(window: after, width: image.width, height: image.height,
                           dataUrl: "data:image/png;base64,\(png.base64EncodedString())", size: png.count,
                           capture: .init(sourceWindowId: id))
    }
}
