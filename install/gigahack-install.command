#!/usr/bin/env bash
# GigaHack MV/MZ installer - macOS double-click entry point.
#
# Finder runs a .command from the user's home directory, not from where the
# file lives, so the first thing this does is move to its own folder. Without
# that, discovery looks in the wrong place and reports "no game found" while
# sitting inside the game folder.
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
./gigahack-install.sh "$@"
status=$?
echo
echo "Press return to close this window."
read -r _
exit $status
