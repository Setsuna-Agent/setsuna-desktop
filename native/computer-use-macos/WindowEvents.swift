// Target-only focus records and mouse routing adapted from BackgroundComputerUse
// (MIT, Anupam Batra), revision 52116acfe0f2f57174f5e0166881abe944cb6eeb.
// See LICENSE and README.md. Never send the previous app a defocus record.
import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Darwin

final class WindowEvents {
    typealias Post = @convention(c) (pid_t, CGEvent) -> Void
    typealias SetInteger = @convention(c) (CGEvent, UInt32, Int64) -> Void
    typealias SetLocation = @convention(c) (CGEvent, CGPoint) -> Void
    typealias MainConnection = @convention(c) () -> Int32
    typealias WindowOwner = @convention(c) (Int32, UInt32, UnsafeMutablePointer<Int32>) -> Int32
    typealias ConnectionPSN = @convention(c) (Int32, UnsafeMutablePointer<ProcessSerialNumber>) -> Int32
    typealias ProcessPSN = @convention(c) (pid_t, UnsafeMutablePointer<ProcessSerialNumber>) -> Int32
    typealias PostRecord = @convention(c) (UnsafeRawPointer, UnsafePointer<UInt8>) -> Int32
    typealias AXWindow = @convention(c) (AXUIElement, UnsafeMutablePointer<UInt32>) -> AXError

    let post: Post
    let setInteger: SetInteger
    let setLocation: SetLocation
    let mainConnection: MainConnection
    let windowOwner: WindowOwner
    let connectionPSN: ConnectionPSN
    let processPSN: ProcessPSN
    let postRecord: PostRecord
    let axWindow: AXWindow

    init() throws {
        guard dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY) != nil else {
            throw ControlError("Background window input is unavailable on this macOS version.")
        }
        post = try Self.load("SLEventPostToPid")
        setInteger = try Self.load("SLEventSetIntegerValueField")
        setLocation = try Self.load("CGEventSetWindowLocation")
        mainConnection = try Self.load("CGSMainConnectionID")
        windowOwner = try Self.load("CGSGetWindowOwner")
        connectionPSN = try Self.load("CGSGetConnectionPSN")
        processPSN = try Self.load("GetProcessForPID")
        postRecord = try Self.load("SLPSPostEventRecordTo")
        axWindow = try Self.load("_AXUIElementGetWindow")
    }

    private static func load<T>(_ name: String) throws -> T {
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else {
            throw ControlError("Background input symbol \(name) is unavailable; global input will not be used.")
        }
        return unsafeBitCast(symbol, to: T.self)
    }

    struct Route {
        let window: WindowRecord
        let owner: Int32
        let psn: ProcessSerialNumber
        var packedPSN: Int64 { (Int64(psn.highLongOfPSN) << 32) | Int64(psn.lowLongOfPSN) }
    }

    func prepare(_ window: WindowRecord, keyboard: Bool) throws -> Route {
        var owner: Int32 = 0
        var psn = ProcessSerialNumber()
        var expectedPSN = ProcessSerialNumber()
        guard windowOwner(mainConnection(), window.windowNumber, &owner) == 0,
              connectionPSN(owner, &psn) == 0, processPSN(window.pid, &expectedPSN) == 0,
              psn.highLongOfPSN == expectedPSN.highLongOfPSN,
              psn.lowLongOfPSN == expectedPSN.lowLongOfPSN else { throw ControlError("Target window routing is unavailable or its owner changed.") }
        let route = Route(window: window, owner: owner, psn: psn)
        var focus = [UInt8](repeating: 0, count: 0xF8)
        focus[0x04] = 0xF8; focus[0x08] = 0x0D; focus[0x8A] = 0x01
        try sendRecord(focus, route: route)
        if keyboard {
            var keyWindow = [UInt8](repeating: 0, count: 0x100)
            keyWindow[0x04] = 0xF8; keyWindow[0x3A] = 0x10
            for index in 0x20..<0x30 { keyWindow[index] = 0xFF }
            for phase: UInt8 in [1, 2] { keyWindow[0x08] = phase; try sendRecord(keyWindow, route: route) }
        }
        return route
    }

    private func sendRecord(_ template: [UInt8], route: Route) throws {
        var record = template
        let wid = route.window.windowNumber
        for index in 0..<4 { record[0x3C + index] = UInt8((wid >> (index * 8)) & 0xFF) }
        var psn = route.psn
        let status = withUnsafePointer(to: &psn) { pointer in
            record.withUnsafeBufferPointer { postRecord(UnsafeRawPointer(pointer), $0.baseAddress!) }
        }
        guard status == 0 else { throw ControlError("Target-only window preparation failed.") }
    }

    func stamp(_ event: CGEvent, route: Route, local: CGPoint) {
        let window = route.window
        event.flags = []
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(window.pid))
        event.setIntegerValueField(.eventTargetProcessSerialNumber, value: route.packedPSN)
        setLocation(event, local)
        for (field, value): (UInt32, Int64) in [
            (40, Int64(window.pid)), (51, Int64(window.windowNumber)),
            (52, Int64(route.owner)), (85, Int64(route.owner)),
            (91, Int64(window.windowNumber)), (92, Int64(window.windowNumber)),
        ] {
            setInteger(event, field, value)
            if let field = CGEventField(rawValue: field) { event.setIntegerValueField(field, value: value) }
        }
    }

    func mouseEvent(_ type: NSEvent.EventType, local: CGPoint, route: Route) throws -> CGEvent {
        guard let nsEvent = NSEvent.mouseEvent(
            with: type, location: local, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: Int(route.window.windowNumber), context: nil, eventNumber: 1,
            clickCount: type == .mouseMoved ? 0 : 1, pressure: type == .leftMouseDown ? 1 : 0
        ), let event = nsEvent.cgEvent else { throw ControlError("Cannot construct background pointer event.") }
        let bounds = route.window.bounds
        event.location = CGPoint(x: bounds.x + local.x, y: bounds.y + local.y)
        event.setIntegerValueField(.mouseEventSubtype, value: 3)
        event.setIntegerValueField(.mouseEventButtonNumber, value: 0)
        event.setIntegerValueField(.mouseEventClickState, value: type == .mouseMoved ? 0 : 1)
        stamp(event, route: route, local: local)
        if type == .leftMouseDown, let field = CGEventField(rawValue: 108) {
            event.setIntegerValueField(field, value: 1)
        }
        return event
    }
}
