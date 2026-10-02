import AppKit
import ApplicationServices

@MainActor final class Helper {
    private let admission: InputAdmission
    private var selected: String?
    private var input: BackgroundInput?
    init(admission: InputAdmission) { self.admission = admission }

    func handle(_ request: Request) async {
        do {
            if request.kind == "shutdown" {
                reply(Response(id: request.id, result: ["stopped": true])); exit(0)
            }
            try admission.check()
            switch request.kind {
            case "probe":
                _ = try WindowEvents()
                reply(Response(id: request.id, result: ["mode": "background-window", "captureBackend": "macos-window"]))
            case "windows": reply(Response(id: request.id, result: WindowCatalog.list()))
            case "start":
                guard selected == nil, let id = request.windowId else { throw ControlError("Choose a window from computer_windows before starting.") }
                let window = try WindowCatalog.resolve(id)
                input = try BackgroundInput(admission: admission)
                selected = id
                reply(Response(id: request.id, result: window))
            case "capture":
                guard let selected else { throw ControlError("Window session is not started.") }
                let image = try await WindowCapture.capture(selected, admission: admission)
                reply(Response(id: request.id, result: image))
            case "action":
                guard let action = request.action, let frame = request.frame, let input,
                      selected == frame.window.id else { throw ControlError("Input does not belong to the selected window.") }
                try input.perform(action, observation: frame)
                reply(Response(id: request.id, result: ["dispatched": true]))
            default: throw ControlError("Unknown window command.")
            }
        } catch { reply(Response<Bool>(id: request.id, error: String(describing: error), errorCode: (error as? ControlError)?.code)) }
    }

    private func reply<T>(_ response: Response<T>) {
        do {
            var bytes = try JSONEncoder().encode(response); bytes.append(10)
            try FileHandle.standardOutput.write(contentsOf: bytes)
        } catch { admission.close(); exit(1) }
    }
}

@main enum Main {
    @MainActor static func main() async {
        // Initializing AppKit does not activate, show, or reorder any window.
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        let admission = InputAdmission()
        let helper = Helper(admission: admission)
        Task.detached {
            while let line = readLine() {
                guard line.utf8.count <= 32_768,
                      let request = try? JSONDecoder().decode(Request.self, from: Data(line.utf8)) else {
                    admission.close(); Task { @MainActor in exit(1) }; return
                }
                if request.kind == "shutdown" { admission.close() }
                Task { await helper.handle(request) }
            }
            admission.close(); Task { @MainActor in exit(0) }
        }
        // Keep the main run loop available to AppKit and ScreenCaptureKit.
        dispatchMain()
    }
}
