# showcase

A minimal AppKit app that links `AppMCPHarness`. It exists so `macos-ui-mcp` can be
tested against a real running app instead of only a mock.

The window has three addressable controls:

| id | kind | behavior |
|---|---|---|
| `#status` | label | shows `Welcome`, then `Saved: <email>` after Save |
| `#email` | text field | |
| `#save` | button | sets `#status` to `Saved: <email>` |

Plus one registered action: `reset` — clears the field and the status.

## Run it

```sh
swift build --package-path showcase
SHOWCASE_PORT=8790 ./showcase/.build/debug/Showcase
```

Then point `macos-ui-mcp` at `http://127.0.0.1:8790` and call the tools, or:

```sh
npm run test:e2e        # from the repo root — builds this, launches it, asserts
```

Runs as an `.accessory` app: no Dock icon, doesn't steal focus. Terminates cleanly on
SIGTERM. `SHOWCASE_PORT` defaults to `8790`.

Needs a logged-in macOS GUI session — AppKit needs the window server.
