import AppKit

enum Router {
    /// Entry point from `HTTPServer`. Hops to the main thread once; every AppKit
    /// access below then runs on main with no further dispatching.
    static func handle(_ request: HTTPRequest) -> HTTPResponse {
        if Thread.isMainThread { return route(request) }
        return DispatchQueue.main.sync { route(request) }
    }

    private static func route(_ request: HTTPRequest) -> HTTPResponse {
        switch (request.method, request.path) {
        case ("GET", "/windows"):
            return .json(["windows": WindowInfo.all().map(\.dictionary)])

        case ("GET", "/tree"):
            guard let window = WindowInfo.resolve(id: request.query["window"]) else {
                return .json(["error": "no matching window"], status: 404)
            }
            let root = window.window.contentView ?? NSView()
            return .json(["window": window.dictionary, "tree": ViewTree.node(for: root)])

        case ("GET", "/snapshot"):
            guard let window = WindowInfo.resolve(id: request.query["window"]) else {
                return .json(["error": "no matching window"], status: 404)
            }
            let target: NSView
            if let nodeId = request.query["node"],
               let found = ViewTree.find(nodeId, in: window.window.contentView) {
                target = found
            } else {
                target = window.window.contentView ?? NSView()
            }
            guard let png = Snapshot.png(of: target) else {
                return .json(["error": "render failed"], status: 500)
            }
            return .png(png)

        case ("POST", "/tap"):
            return action(request) { body in
                guard let id = body["node"] as? String,
                      let view = ViewTree.find(id, in: nil) else { return (false, "no such node") }
                Actions.tap(view)
                return (true, nil)
            }

        case ("POST", "/setText"):
            return action(request) { body in
                guard let id = body["node"] as? String, let text = body["text"] as? String,
                      let view = ViewTree.find(id, in: nil) else { return (false, "no such node") }
                return Actions.setText(view, text) ? (true, nil) : (false, "not a text control")
            }

        case ("POST", "/action"):
            return action(request) { body in
                guard let name = body["name"] as? String else { return (false, "missing name") }
                guard let hook = AppMCP.action(named: name) else { return (false, "no such action") }
                hook()
                return (true, nil)
            }

        default:
            return .notFound()
        }
    }

    private static func action(
        _ request: HTTPRequest,
        _ body: ([String: Any]) -> (ok: Bool, detail: String?)
    ) -> HTTPResponse {
        let json = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any] ?? [:]
        let result = body(json)
        var out: [String: Any] = ["ok": result.ok]
        if let detail = result.detail { out["detail"] = detail }
        return .json(out)
    }
}
