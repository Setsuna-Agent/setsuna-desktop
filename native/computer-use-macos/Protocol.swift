import Foundation

struct ControlError: Error, CustomStringConvertible {
    let description: String
    let code: String?
    init(_ message: String, code: String? = nil) { description = message; self.code = code }
}

struct Bounds: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct WindowRecord: Codable {
    let id: String
    let pid: Int32
    let windowNumber: UInt32
    let application: String
    let title: String
    let bounds: Bounds
}

struct InputAction: Decodable {
    let kind: String
    let x: Double?
    let y: Double?
    let text: String?
    let key: String?
    let modifiers: [String]?
    let direction: String?
    let amount: Int?
}

struct InputObservation: Decodable {
    let window: WindowRecord
    let width: Int
    let height: Int
}

struct Request: Decodable {
    let id: Int
    let kind: String
    let windowId: String?
    let action: InputAction?
    let frame: InputObservation?
}

struct Response<T: Encodable>: Encodable {
    let id: Int
    var result: T? = nil
    var error: String? = nil
    var errorCode: String? = nil
}

// The stdin reader revokes input even while the main thread is dispatching a
// long string. A gesture checks admission before its down/up pair, never inside it.
final class InputAdmission: @unchecked Sendable {
    private let lock = NSLock()
    private var closed = false
    func close() { lock.lock(); closed = true; lock.unlock() }
    func check() throws {
        lock.lock(); let stopped = closed; lock.unlock()
        if stopped { throw ControlError("Window input cancelled.") }
    }
}
