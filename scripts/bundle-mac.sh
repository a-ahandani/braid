#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo build --release
APP=target/Ramify.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp target/release/ramify "$APP/Contents/MacOS/ramify"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Ramify</string>
  <key>CFBundleDisplayName</key><string>Ramify</string>
  <key>CFBundleIdentifier</key><string>dev.ahandani.ramify</string>
  <key>CFBundleVersion</key><string>$(grep '^version' Cargo.toml | head -1 | cut -d'"' -f2)</string>
  <key>CFBundleShortVersionString</key><string>$(grep '^version' Cargo.toml | head -1 | cut -d'"' -f2)</string>
  <key>CFBundleExecutable</key><string>ramify</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
EOF
if [ -n "${RAMIFY_SIGN_IDENTITY:-}" ]; then
  codesign --force --deep --options runtime --timestamp --sign "$RAMIFY_SIGN_IDENTITY" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi
echo "Built $APP"
VERSION=$(grep '^version' Cargo.toml | head -1 | cut -d'"' -f2)
DMG="target/Ramify-$VERSION-macos-$(uname -m).dmg"
STAGE=target/dmg-stage
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname Ramify -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"
if [ -n "${RAMIFY_SIGN_IDENTITY:-}" ] && [ -n "${RAMIFY_NOTARY_PROFILE:-}" ]; then
  codesign --force --timestamp --sign "$RAMIFY_SIGN_IDENTITY" "$DMG"
  xcrun notarytool submit "$DMG" --keychain-profile "$RAMIFY_NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler staple "$APP"
fi
echo "Built $DMG"
if [ "${1:-}" = "--install" ]; then
  rm -rf /Applications/Ramify.app
  cp -R "$APP" /Applications/Ramify.app
  echo "Installed /Applications/Ramify.app"
fi
