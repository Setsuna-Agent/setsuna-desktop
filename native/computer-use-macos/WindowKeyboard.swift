import ApplicationServices

struct WindowKeystroke {
    let code: CGKeyCode
    var flags: CGEventFlags = []
}

enum WindowKeyboard {
    private static let codes: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
        "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
        "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35,
        "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
        "Enter": 36, "Tab": 48, "Space": 49, "Backspace": 51, "Escape": 53, "Home": 115,
        "PageUp": 116, "Delete": 117, "End": 119, "PageDown": 121,
        "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126,
    ]
    private static let modifiers: [String: CGEventFlags] = [
        "Meta": .maskCommand, "Control": .maskControl, "Alt": .maskAlternate, "Shift": .maskShift,
    ]

    static func stroke(_ action: InputAction) throws -> WindowKeystroke {
        guard let key = action.key, let code = codes[key] else { throw ControlError("Unsupported background key.") }
        let names = action.modifiers ?? []
        guard names.count <= 4, Set(names).count == names.count else { throw ControlError("Invalid background modifiers.") }
        var flags: CGEventFlags = []
        for name in names {
            guard let flag = modifiers[name] else { throw ControlError("Unsupported background modifier.") }
            flags.insert(flag)
        }
        return WindowKeystroke(code: code, flags: flags)
    }

    static func events(_ stroke: WindowKeystroke, text: String? = nil, pid: pid_t) throws -> (down: CGEvent, up: CGEvent) {
        guard let source = CGEventSource(stateID: .privateState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: stroke.code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: stroke.code, keyDown: false) else {
            throw ControlError("Cannot construct background keyboard event.")
        }
        source.localEventsSuppressionInterval = 0
        for event in [down, up] {
            if let text {
                let utf16 = Array(text.utf16)
                utf16.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: $0.baseAddress) }
            }
            event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        }
        // Modifiers live on the target event, never on the user's physical keyboard.
        down.flags = stroke.flags
        up.flags = []
        return (down, up)
    }
}
