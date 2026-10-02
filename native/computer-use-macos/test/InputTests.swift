import ApplicationServices
import Foundation

func action(_ json: String) throws -> InputAction { try JSONDecoder().decode(InputAction.self, from: Data(json.utf8)) }
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

@main enum InputTests {
    static func main() throws {
        // Construct and inspect events only. Never post input, start an application,
        // capture a screen or request OS permissions from this test executable.
        let shortcut = try WindowKeyboard.stroke(action(#"{"kind":"key","key":"n","modifiers":["Meta","Shift"]}"#))
        let pair = try WindowKeyboard.events(shortcut, pid: 42)
        check(pair.down.getIntegerValueField(.keyboardEventKeycode) == 45, "Cmd+Shift+N keycode")
        check(pair.down.flags == [.maskCommand, .maskShift], "target-only shortcut flags")
        check(pair.up.flags.isEmpty, "modifier release")
        check(pair.down.type == .keyDown && pair.up.type == .keyUp, "complete key pair")
        for event in [pair.down, pair.up] { check(event.getIntegerValueField(.eventTargetUnixProcessID) == 42, "bound PID") }
        let enter = try WindowKeyboard.stroke(action(#"{"kind":"key","key":"Enter"}"#))
        check(enter.code == 36 && enter.flags.isEmpty, "no modifier leakage into subsequent input")
        do {
            _ = try WindowKeyboard.stroke(action(#"{"kind":"key","key":"n","modifiers":["Meta","Meta"]}"#))
            fatalError("duplicate modifier accepted")
        } catch is ControlError {}

        let bounds = Bounds(x: 615, y: 274, width: 1000, height: 660)
        let size = WindowGeometry.captureSize(bounds)
        check(size.width == 1000 && size.height == 660, "Retina-independent screenshot dimensions")
        let window = WindowRecord(id: "1:2:3", pid: 1, windowNumber: 2, application: "Fixture", title: "", bounds: bounds)
        let point = try WindowGeometry.point(action(#"{"kind":"click","x":734,"y":488}"#), InputObservation(window: window, width: 2000, height: 1320))
        check(point.x == 367 && point.y == 244, "one pixel-to-point conversion without screen origin")
        let wide = Bounds(x: -500, y: 20, width: 4096, height: 2048)
        let wideSize = WindowGeometry.captureSize(wide)
        check(wideSize.width == 2048 && wideSize.height == 1024, "large-window capture budget")
        do {
            _ = try WindowGeometry.point(action(#"{"kind":"click","x":2000,"y":0}"#), InputObservation(window: window, width: 2000, height: 1320))
            fatalError("outside pixel accepted")
        } catch is ControlError {}
        print("Native keyboard event and screenshot coordinate checks passed (no input dispatched).")
    }
}
