#!/bin/sh
# Builds ShowcaseIOS.app for the iOS Simulator with plain swiftc (no Xcode project):
# the harness as a static library + module, then the app linked against it.
set -eu
cd "$(dirname "$0")"

SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
TARGET="$(uname -m)-apple-ios16.0-simulator"
FLAGS="-sdk $SDK -target $TARGET -Onone -g -D DEBUG"
OUT=build
APP=$OUT/ShowcaseIOS.app

rm -rf "$OUT"
mkdir -p "$APP" "$OUT/modules"

xcrun --sdk iphonesimulator swiftc $FLAGS -parse-as-library -emit-library -static \
  -module-name AppMCPHarness -emit-module -emit-module-path "$OUT/modules/AppMCPHarness.swiftmodule" \
  -o "$OUT/libAppMCPHarness.a" ../swift-harness/Sources/AppMCPHarness/*.swift

xcrun --sdk iphonesimulator swiftc $FLAGS -parse-as-library -I "$OUT/modules" -L "$OUT" -lAppMCPHarness \
  -o "$APP/ShowcaseIOS" Sources/*.swift

cp Info.plist "$APP/"
codesign --force --sign - "$APP"
echo "built $APP"
