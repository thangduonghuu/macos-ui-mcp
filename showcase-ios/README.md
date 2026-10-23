# showcase-ios

A UIKit app for the iOS Simulator, shaped the way React Native looks to UIKit, so
the iOS harness can be tested end to end without a JS toolchain:

- one gesture recognizer on the root view decides what was pressed (like RN's
  `RCTSurfaceTouchHandler`), so only a real touch works;
- "Tiếp" (`#next`) is a plain `UIView` with a label inside (Pressable + Text), not a
  `UIControl`;
- the email field's "JS state" (`#status`) only updates when the delegate's
  `shouldChangeCharactersIn` and `.editingChanged` both fire;
- a 30-row scroll view (`#row-1` … `#row-30`);
- Screen 2 (`#screen2-title`) covers screen 1 instead of replacing it, like a
  navigation stack.

Plus a `UIButton` (`#reset`) and a registered `reset` action.

## Run it

```sh
./showcase-ios/build.sh      # plain swiftc, no Xcode project → build/ShowcaseIOS.app
npm run test:e2e:ios         # from the repo root: builds, installs on the booted simulator, asserts
```

Or by hand: `launch_app(path: "showcase-ios/build/ShowcaseIOS.app", simulator: "booted",
env: { SHOWCASE_PORT: "8790" })`. `SHOWCASE_PORT` defaults to `8790`.
