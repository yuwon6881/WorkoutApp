#!/usr/bin/env bash
# Installs the Wear APK on a booted Wear OS emulator, launches it at normal and large text sizes,
# keeps a screenshot of each first screen, and fails if the app crashed or is not running.
# Usage: emulator-smoke.sh <app-debug.apk> <output-folder>
set -euo pipefail

apk="$1"
out="$2"
package="com.workoutapp.wear"
mkdir -p "$out"

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'
adb install -r "$apk"
adb logcat -c

launch() {
    local name="$1"
    adb shell am force-stop "$package"
    adb shell am start -W -n "$package/.MainActivity"
    # Entrance animations and the first frame settle well within this.
    sleep 6
    adb exec-out screencap -p > "$out/$name.png"
    if ! adb shell pidof "$package" > /dev/null; then
        echo "The Wear app is not running after launch ($name)." >&2
        adb logcat -d > "$out/logcat.txt"
        exit 1
    fi
}

launch launch
adb shell settings put system font_scale 1.3
launch launch-large-text
adb shell settings put system font_scale 1.0

adb logcat -d > "$out/logcat.txt"
# Only this app's crashes count; system processes on a cold emulator are not under test.
if grep -A2 "FATAL EXCEPTION" "$out/logcat.txt" | grep -q "Process: $package" || grep -q "ANR in $package" "$out/logcat.txt"; then
    echo "The Wear app crashed or stopped responding on the emulator." >&2
    exit 1
fi
echo "Wear app launched cleanly; screenshots in $out."
