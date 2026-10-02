import AppKit
import ApplicationServices

enum WindowCatalog {
    static func list() -> [WindowRecord] {
        guard let entries = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
        return entries.compactMap { entry in
            guard let pid = entry[kCGWindowOwnerPID as String] as? Int32,
                  pid != ProcessInfo.processInfo.processIdentifier,
                  let number = entry[kCGWindowNumber as String] as? UInt32,
                  (entry[kCGWindowLayer as String] as? Int) == 0,
                  let raw = entry[kCGWindowBounds as String] as? [String: Double],
                  let x = raw["X"], let y = raw["Y"], let width = raw["Width"], let height = raw["Height"],
                  width > 1, height > 1,
                  let app = NSRunningApplication(processIdentifier: pid),
                  let launched = app.launchDate else { return nil }
            // PID + window number alone can be recycled after an app restarts.
            let generation = Int64(launched.timeIntervalSince1970 * 1000)
            return WindowRecord(
                id: "\(pid):\(number):\(generation)", pid: pid, windowNumber: number,
                application: app.localizedName ?? app.bundleIdentifier ?? "Application",
                title: entry[kCGWindowName as String] as? String ?? "",
                bounds: Bounds(x: x, y: y, width: width, height: height)
            )
        }
    }

    static func resolve(_ id: String) throws -> WindowRecord {
        guard let window = list().first(where: { $0.id == id }) else {
            throw ControlError("Target window is closed, minimized, hidden, or its app restarted. List windows again.")
        }
        return window
    }

    static func validate(_ observation: InputObservation, canRefresh: Bool = false) throws -> WindowRecord {
        let window = try resolve(observation.window.id)
        guard window.pid == observation.window.pid,
              window.windowNumber == observation.window.windowNumber else {
            throw ControlError("Target window identity changed; control stopped.")
        }
        if window.bounds != observation.window.bounds {
            throw ControlError(canRefresh
                ? "Target window moved or resized. No input was sent; use the new screenshot."
                : "Window moved during input; control stopped. Start a new session and check the existing text before continuing.",
                code: canRefresh ? "stale-observation" : nil)
        }
        guard observation.width > 0, observation.height > 0 else { throw ControlError("Invalid screenshot dimensions.") }
        return window
    }

    static func requireKeyboardWindow(_ window: WindowRecord, symbols: WindowEvents) throws {
        let app = AXUIElementCreateApplication(window.pid)
        AXUIElementSetMessagingTimeout(app, 1)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
              let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() else {
            throw ControlError("The app does not expose a verifiable keyboard window; background keyboard input is unsupported.")
        }
        var number: UInt32 = 0
        let element = unsafeBitCast(focused, to: AXUIElement.self)
        guard symbols.axWindow(element, &number) == .success, number == window.windowNumber else {
            throw ControlError("Keyboard focus belongs to another window in this app. Click the target window first.")
        }
    }
}
