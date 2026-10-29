#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo build --release
APP=target/Braid.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp target/release/braid "$APP/Contents/MacOS/braid"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Braid</string>
  <key>CFBundleDisplayName</key><string>Braid</string>
  <key>CFBundleIdentifier</key><string>dev.ahandani.ramulus</string>
  <key>CFBundleVersion</key><string>$(grep '^version' Cargo.toml | head -1 | cut -d'"' -f2)</string>
  <key>CFBundleShortVersionString</key><string>$(grep '^version' Cargo.toml | head -1 | cut -d'"' -f2)</string>
  <key>CFBundleExecutable</key><string>braid</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
EOF
if [ -n "${BRAID_SIGN_IDENTITY:-}" ]; then
  codesign --force --deep --options runtime --timestamp --sign "$BRAID_SIGN_IDENTITY" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi
echo "Built $APP"
VERSION=$(grep '^version' Cargo.toml | head -1 | cut -d'"' -f2)
DMG="target/Braid-$VERSION-macos-$(uname -m).dmg"
STAGE=target/dmg-stage
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname Braid -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"
if [ -n "${BRAID_SIGN_IDENTITY:-}" ] && [ -n "${BRAID_NOTARY_PROFILE:-}" ]; then
  codesign --force --timestamp --sign "$BRAID_SIGN_IDENTITY" "$DMG"
  xcrun notarytool submit "$DMG" --keychain-profile "$BRAID_NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  xcrun stapler staple "$APP"
fi
echo "Built $DMG"
if [ "${1:-}" = "--install" ]; then
  rm -rf /Applications/Braid.app
  cp -R "$APP" /Applications/Braid.app
  echo "Installed /Applications/Braid.app"
fi
