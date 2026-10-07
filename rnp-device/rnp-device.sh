#!/bin/bash
# RNP Device: macOS handler for rnp://start?pair=<token>&server=<orchestrator>.
#
# Boots an Android emulator from the local Android SDK (Android Studio need not
# be open), installs the RNP app if it is missing, and opens it with the
# pairing token. The app redeems the token itself; no workspace logic here.
#
# Optional overrides in ~/.rnp-device/config (sourced as shell):
#   RNP_SDK=/path/to/android/sdk      default: $ANDROID_HOME, ~/Library/Android/sdk
#   RNP_AVD=Pixel_7                    default: first AVD from `emulator -list-avds`
#   ANDROID_AVD_HOME=/path/to/avds     default: ~/.android/avd
#   RNP_ALLOWED_HOSTS="trycloudflare.com example.com"   orchestrator host suffixes

LOG="$HOME/Library/Logs/rnp-device.log"
exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') $*"

CONF="$HOME/.rnp-device/config"
[ -f "$CONF" ] && . "$CONF"

PKG=com.notaryan.webrtcmobile
SDK="${RNP_SDK:-${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
ALLOWED_HOSTS="${RNP_ALLOWED_HOSTS:-trycloudflare.com}"
APK_CACHE="$HOME/.rnp-device/rnp.apk"
[ -n "${ANDROID_AVD_HOME:-}" ] && export ANDROID_AVD_HOME

notify() {
    echo "$1"
    osascript -e "display notification \"$1\" with title \"RNP Device\"" >/dev/null 2>&1
}
fail() { notify "$1"; exit 1; }
urldecode() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }

# --- parse and validate the link (it comes from any web page) ---
url="${1:-}"
case "$url" in rnp://start\?*) ;; *) fail "Unsupported link: $url" ;; esac
token="" server=""
IFS='&' read -ra kvs <<< "${url#*\?}"
for kv in "${kvs[@]}"; do
    case "$kv" in
        pair=*) token="${kv#pair=}" ;;
        server=*) server="$(urldecode "${kv#server=}")" ;;
    esac
done
[[ "$token" =~ ^[0-9a-f]{32}$ ]] || fail "Invalid pairing token"
[[ "$server" =~ ^https://([a-z0-9.-]+)/?$ ]] || fail "Invalid server: $server"
host="${BASH_REMATCH[1]}"
server="${server%/}"
ok=""
for h in $ALLOWED_HOSTS; do [[ "$host" == "$h" || "$host" == *".$h" ]] && ok=1; done
[ -n "$ok" ] || fail "Server $host is not allowed (RNP_ALLOWED_HOSTS in $CONF)"

[ -x "$ADB" ] || fail "adb not found at $ADB. Install the Android SDK (Android Studio) or set RNP_SDK."
[ -x "$EMU" ] || fail "Android emulator not found at $EMU."

# --- reuse a running emulator, else boot one ---
running() { "$ADB" devices | awk '$1 ~ /^emulator-[0-9]+$/ && $2 == "device" { print $1; exit }'; }
serial="$(running)"
if [ -z "$serial" ]; then
    avd="${RNP_AVD:-$("$EMU" -list-avds 2>/dev/null | head -1)}"
    [ -n "$avd" ] || fail "No Android emulator found. Create one in Android Studio > Device Manager."
    notify "Starting Android ($avd). The first launch can take a minute."
    nohup "$EMU" -avd "$avd" -no-boot-anim >>"$HOME/Library/Logs/rnp-device-emulator.log" 2>&1 &
    for _ in $(seq 1 60); do serial="$(running)"; [ -n "$serial" ] && break; sleep 3; done
    [ -n "$serial" ] || fail "The emulator did not start. See ~/Library/Logs/rnp-device-emulator.log"
fi
for _ in $(seq 1 90); do
    [ "$("$ADB" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
    sleep 2
done
echo "device $serial booted"

# --- install the RNP app if missing (APK source is the orchestrator's config) ---
# ponytail: install-if-missing only; updating needs a version check against /apk.
if [ -z "$("$ADB" -s "$serial" shell pm path "$PKG" 2>/dev/null)" ]; then
    notify "Installing the RNP app..."
    curl -fsSL "$server/apk" -o "$APK_CACHE.tmp" && mv "$APK_CACHE.tmp" "$APK_CACHE" \
        || fail "Could not download the RNP app from $server/apk"
    "$ADB" -s "$serial" install -r "$APK_CACHE" || fail "Installing the RNP app failed"
fi

# Best effort: pre-approve screen capture so Android skips its "Start now"
# prompt. Not every Android version honours it.
"$ADB" -s "$serial" shell appops set "$PKG" PROJECT_MEDIA allow >/dev/null 2>&1

enc_server="$(printf '%s' "$server" | sed 's|:|%3A|g; s|/|%2F|g')"
"$ADB" -s "$serial" shell am start -a android.intent.action.VIEW \
    -d "'rnp://pair?token=$token&server=$enc_server'" "$PKG" >/dev/null \
    || fail "Could not open the RNP app"
notify "Android is ready. Pairing with your playground..."
