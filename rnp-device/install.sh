#!/bin/bash
# Installs RNP Device for the current user:
#   ~/.rnp-device/rnp-device.sh        the handler (see that file)
#   ~/Applications/RNP Device.app      tiny AppleScript app macOS opens for rnp:// links
#
#   curl -fsSL https://raw.githubusercontent.com/notAryan10/react-native-playground-backend-webrtcDemo/main/rnp-device/install.sh | bash
#
# Uninstall: rm -rf ~/.rnp-device "$HOME/Applications/RNP Device.app"
#
# ponytail: unsigned, per-user prototype. For students, ship a signed and
# notarized app from GitHub Releases instead of curl | bash.
set -euo pipefail

RAW="${RNP_DEVICE_RAW:-https://raw.githubusercontent.com/notAryan10/react-native-playground-backend-webrtcDemo/main/rnp-device}"
DIR="$HOME/.rnp-device"
APP="$HOME/Applications/RNP Device.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

[ "$(uname)" = Darwin ] || { echo "RNP Device is macOS only." >&2; exit 1; }
mkdir -p "$DIR" "$HOME/Applications"

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/rnp-device.sh" ]; then
    cp "$here/rnp-device.sh" "$DIR/rnp-device.sh"
else
    curl -fsSL "$RAW/rnp-device.sh" -o "$DIR/rnp-device.sh"
fi
chmod +x "$DIR/rnp-device.sh"
[ -f "$DIR/config" ] || cat > "$DIR/config" <<'EOF'
# RNP Device settings (shell syntax). Uncomment to override.
# RNP_SDK="$HOME/Library/Android/sdk"
# RNP_AVD="Pixel_7"
# ANDROID_AVD_HOME="$HOME/.android/avd"
# RNP_ALLOWED_HOSTS="trycloudflare.com"
EOF

tmp="$(mktemp -d)"
cat > "$tmp/handler.applescript" <<'EOF'
on open location theURL
    set scriptPath to (POSIX path of (path to home folder)) & ".rnp-device/rnp-device.sh"
    do shell script "/bin/bash " & quoted form of scriptPath & " " & quoted form of theURL & " >/dev/null 2>&1 &"
end open location

on run
    display dialog "RNP Device is installed. Click Start Android in the playground to use it." buttons {"OK"} default button 1 with title "RNP Device"
end run
EOF
rm -rf "$APP"
osacompile -o "$APP" "$tmp/handler.applescript"
rm -rf "$tmp"

plist="$APP/Contents/Info.plist"
pb() { /usr/libexec/PlistBuddy -c "$1" "$plist" >/dev/null 2>&1 || true; }
pb "Set :CFBundleIdentifier com.rnp.device"
pb "Add :CFBundleIdentifier string com.rnp.device"
pb "Add :LSUIElement bool true"
pb "Delete :CFBundleURLTypes"
/usr/libexec/PlistBuddy \
    -c "Add :CFBundleURLTypes array" \
    -c "Add :CFBundleURLTypes:0 dict" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.rnp.device" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
    -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string rnp" \
    "$plist"
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
"$LSREGISTER" -f "$APP"

echo "RNP Device installed."
echo "  Handler: $DIR/rnp-device.sh   Settings: $DIR/config"
echo "  Logs:    ~/Library/Logs/rnp-device.log"
echo "Test it:   open 'rnp://start?pair=<token>&server=<orchestrator url>'"
