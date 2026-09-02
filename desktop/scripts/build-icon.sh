#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
desktop_dir=$(dirname -- "$script_dir")
source_svg="$desktop_dir/assets/icon.svg"
output_png="$desktop_dir/assets/icon.png"
output_icns="$desktop_dir/assets/icon.icns"
node "$script_dir/render-icon.mjs" "$source_svg" "$output_png" "$output_icns"
