# expo-rn example

A minimal Expo 57 / React Native 0.86 (New Architecture) app with the harness embedded
by [`expo-plugin/`](../../expo-plugin) (port `8794`, see `app.json`). One screen has a
`Pressable` with a `Text` inside, a `TextInput` echoed into `#status`, and a 30-row
`ScrollView` (`#list`, `#item-1` … `#item-30`). "Tiếp" goes to screen 2.

It's the target of `test/e2e-rn.test.ts`.

```sh
cd examples/expo-rn
npm install
npx expo prebuild -p ios          # the plugin adds the Debug-only pod + AppMCP.start
xcodebuild -workspace ios/ExpoRnExample.xcworkspace -scheme ExpoRnExample \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/build build

cd ../.. && npm run test:e2e:rn   # starts Metro, launch_app on the booted simulator, drives it
```

`ios/` is generated, so it's gitignored, as in any Expo app.
