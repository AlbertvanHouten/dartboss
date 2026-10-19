#!/bin/sh
# Writes the Android launcher icons from the same artwork as the web and iOS icons (macOS: needs swift and sips).
#   ic_launcher / ic_launcher_round  48dp legacy icons (Android 7), from web/icons/icon-1024.png
#   ic_launcher_foreground           108dp adaptive layer (Android 8+), the board kept inside the safe zone
set -e
res=android/app/src/main/res
fg=$(mktemp -d)/fg.png
swift scripts/make-icons.swift mask 432 "$fg"
for d in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  dir=$res/mipmap-${d%%:*}; px=$(echo "$d" | cut -d: -f2); fpx=${d##*:}
  sips -z "$px" "$px" web/icons/icon-1024.png --out "$dir/ic_launcher.png" >/dev/null
  sips -z "$px" "$px" web/icons/maskable-512.png --out "$dir/ic_launcher_round.png" >/dev/null
  sips -z "$fpx" "$fpx" "$fg" --out "$dir/ic_launcher_foreground.png" >/dev/null
done
echo "wrote Android launcher icons in $res"
