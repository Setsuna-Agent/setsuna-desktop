import CoreGraphics

enum WindowGeometry {
    static func captureSize(_ bounds: Bounds) -> (width: Int, height: Int) {
        // One pixel per point avoids exposing Retina-sized images beside logical
        // window geometry. Large windows are still bounded by the capture budget.
        let scale = min(1, 2048 / max(bounds.width, bounds.height))
        return (max(1, Int((bounds.width * scale).rounded())), max(1, Int((bounds.height * scale).rounded())))
    }

    static func point(_ action: InputAction, _ observation: InputObservation) throws -> CGPoint {
        guard observation.width > 0, observation.height > 0,
              let x = action.x, let y = action.y, x.isFinite, y.isFinite,
              x >= 0, y >= 0, x < Double(observation.width), y < Double(observation.height) else {
            throw ControlError("Input coordinate is outside the window screenshot.")
        }
        return CGPoint(x: x * observation.window.bounds.width / Double(observation.width),
                       y: y * observation.window.bounds.height / Double(observation.height))
    }
}
