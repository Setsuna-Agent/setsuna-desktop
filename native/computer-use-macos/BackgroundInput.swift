import AppKit
import ApplicationServices

final class BackgroundInput {
    private let events: WindowEvents
    private let admission: InputAdmission
    init(admission: InputAdmission) throws { self.admission = admission; events = try WindowEvents() }

    func perform(_ action: InputAction, observation: InputObservation) throws {
        try admission.check()
        guard AXIsProcessTrusted() else { throw ControlError("Accessibility permission is required.") }
        let window = try WindowCatalog.validate(observation, canRefresh: true)
        let keyboard = action.kind == "key" || action.kind == "type"
        let route = try events.prepare(window, keyboard: keyboard)
        usleep(50_000)
        try admission.check()
        _ = try WindowCatalog.validate(observation, canRefresh: true)
        if keyboard { try WindowCatalog.requireKeyboardWindow(window, symbols: events) }
        switch action.kind {
        case "click": try click(local: WindowGeometry.point(action, observation), route: route)
        case "scroll":
            guard let amount = action.amount, (1...10).contains(amount),
                  action.direction == "up" || action.direction == "down" else { throw ControlError("Invalid scroll action.") }
            let local = try WindowGeometry.point(action, observation)
            for _ in 0..<amount {
                try admission.check()
                guard let source = CGEventSource(stateID: .privateState),
                      let event = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1,
                                          wheel1: action.direction == "up" ? 80 : -80, wheel2: 0, wheel3: 0) else {
                    throw ControlError("Cannot construct background scroll event.")
                }
                event.location = CGPoint(x: window.bounds.x + local.x, y: window.bounds.y + local.y)
                source.localEventsSuppressionInterval = 0
                events.stamp(event, route: route, local: local)
                events.post(window.pid, event)
                usleep(10_000)
            }
        case "type":
            guard let text = action.text, !text.isEmpty, text.utf16.count <= 2000 else { throw ControlError("Invalid input text.") }
            for character in text {
                try admission.check()
                // Verify the exact app/window again between characters; never type
                // into a recycled process or a sibling window that gained focus.
                _ = try WindowCatalog.validate(observation)
                try WindowCatalog.requireKeyboardWindow(window, symbols: events)
                try key(WindowKeystroke(code: 0), text: String(character), route: route)
            }
        case "key":
            try key(WindowKeyboard.stroke(action), text: nil, route: route)
        default: throw ControlError("Unsupported background action.")
        }
    }

    private func click(local: CGPoint, route: WindowEvents.Route) throws {
        // Construct both halves before posting, so a failure cannot leave a button down.
        let move = try events.mouseEvent(.mouseMoved, local: local, route: route)
        let primer = CGPoint(x: -1, y: -1)
        let primerDown = try events.mouseEvent(.leftMouseDown, local: primer, route: route)
        let primerUp = try events.mouseEvent(.leftMouseUp, local: primer, route: route)
        primerDown.location = primer; primerUp.location = primer
        let down = try events.mouseEvent(.leftMouseDown, local: local, route: route)
        let up = try events.mouseEvent(.leftMouseUp, local: local, route: route)
        try admission.check()
        // Chromium needs a target-local move and an off-window primer. All five
        // events stay on the PID route; no HID tap or hardware cursor warp exists.
        for event in [move, primerDown, primerUp, down, up] {
            event.timestamp = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
            events.post(route.window.pid, event); usleep(8_000)
        }
    }

    private func key(_ stroke: WindowKeystroke, text: String?, route: WindowEvents.Route) throws {
        let (down, up) = try WindowKeyboard.events(stroke, text: text, pid: route.window.pid)
        try admission.check()
        down.postToPid(route.window.pid); usleep(4_000); up.postToPid(route.window.pid)
        usleep(4_000)
    }
}
