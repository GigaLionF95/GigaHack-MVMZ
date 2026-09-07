#!/usr/bin/env bash
#=============================================================================
# GigaHack MV/MZ — release builder
#-----------------------------------------------------------------------------
# Produces the archives, then INSTALLS FROM THE ARCHIVES into throwaway game
# folders and verifies the result. Building an archive and testing the source
# tree checks the wrong thing: what ships is the archive, and the two differ
# the moment a file is missing from the packing list.
#
#   ./build-release.sh            build, test, verify
#   ./build-release.sh --fast     skip the browser suite (lint + installers only)
#=============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' gigahack/manifest.json | head -1)"
[ -n "$VERSION" ] || { echo "could not read the version from gigahack/manifest.json"; exit 1; }

DIST="$HERE/dist"
DIST_LOG="$HERE/dist/logs"
FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }

#-----------------------------------------------------------------------------
say "GigaHack $VERSION"

#-----------------------------------------------------------------------------
say "1. Lint"
node gigahack-test/lint.js || die "lint failed — fix before releasing"

#-----------------------------------------------------------------------------
say "2. Manifest and disk agree"
node -e '
	var fs = require("fs"), path = require("path");
	var m = JSON.parse(fs.readFileSync("gigahack/manifest.json", "utf8"));
	var want = m.modules.map(function (x) { return x.name + ".js"; });
	var have = fs.readdirSync("gigahack/js/plugins").filter(function (f) { return /^GigaHack_.*\.js$/.test(f); });
	var missing = want.filter(function (f) { return have.indexOf(f) < 0; });
	var extra = have.filter(function (f) { return want.indexOf(f) < 0; });
	if (missing.length) { console.error("manifest names files that are not on disk: " + missing.join(", ")); process.exit(1); }
	if (extra.length) {
		// An extra file is the dangerous direction: it will not be listed in
		// plugins.js, so it never loads, and nothing says so.
		console.error("on disk but not in the manifest (would never load): " + extra.join(", "));
		process.exit(1);
	}
	console.log("  " + want.length + " modules, manifest and disk agree");
' || die "manifest check failed"

#-----------------------------------------------------------------------------
say "3. Every module parses"
n=0
for f in gigahack/js/plugins/*.js gigahack/profiles/*.js; do
	node --check "$f" || die "$f does not parse"
	n=$((n + 1))
done
echo "  $n files parse"

#-----------------------------------------------------------------------------
if [ "$FAST" -eq 0 ]; then
	say "4. Browser suite, all three engines"

	# Preflight. The suite drives a real Chromium through Playwright, and on a
	# fresh clone neither is present. Without this check the first thing the
	# maintainer sees is the word FAILED and nothing else — which is exactly
	# the silent failure this project exists to avoid, committed by its own
	# build script.
	MISSING=""
	( cd gigahack-test && node -e "require.resolve('playwright')" ) >/dev/null 2>&1 || MISSING="module"
	if [ -z "$MISSING" ]; then
		# The module can be installed while its browser binary is not; that
		# fails later and differently, so check it separately.
		( cd gigahack-test && node -e "
			var p = require('playwright');
			var exe = p.chromium.executablePath();
			require('fs').accessSync(exe);
		" ) >/dev/null 2>&1 || MISSING="browser"
	fi
	if [ -n "$MISSING" ]; then
		echo
		if [ "$MISSING" = "module" ]; then
			echo "  The test suite's dependencies are not installed."
			echo
			echo "      cd gigahack-test && npm install && npx playwright install chromium"
		else
			echo "  Playwright is installed but its Chromium binary is not."
			echo
			echo "      cd gigahack-test && npx playwright install chromium"
		fi
		echo
		echo "  That download is a few hundred megabytes and only needs doing once."
		echo
		echo "  To build and publish without running the browser suite:"
		echo
		echo "      ./build-release.sh --fast"
		echo
		echo "  The lint, the manifest check, the parse check and the 101 installer"
		echo "  checks all still run under --fast. Only the 1131 browser checks are"
		echo "  skipped, so know what you are choosing before you choose it."
		die "the browser suite cannot run"
	fi

	# The exit code is the contract; the summary line is for the reader.
	# Parsing the output for a count instead would pass a suite that printed
	# a summary and then failed on the way out.
	for e in mz mv mv-modded; do
		printf '  %-10s ' "$e"
		LOG="$DIST_LOG/suite-$e.txt"
		mkdir -p "$DIST_LOG"
		if ( cd gigahack-test && node run.js --engine="$e" ) > "$LOG" 2>&1; then
			grep -E 'checks passed' "$LOG" | tail -1
		else
			echo "FAILED"
			echo
			# Show the failing checks when there are any, and the raw tail when
			# there are not — a crash produces no FAIL lines at all, and the
			# earlier version of this printed nothing in that case.
			if grep -qE '^  FAIL' "$LOG"; then
				grep -E '^  FAIL' "$LOG" | head -10 | sed 's/^/    /'
			else
				tail -25 "$LOG" | sed 's/^/    /'
			fi
			echo
			die "the browser suite failed on $e — full output in $LOG"
		fi
	done
else
	say "4. Browser suite — SKIPPED (--fast)"
	echo "  The lint, manifest, parse and installer checks still run."
	echo "  Not run: 1131 browser checks across three engines."
fi

#-----------------------------------------------------------------------------
say "5. Installer suite"
mkdir -p "$DIST_LOG"
./test-installers.sh > "$DIST_LOG/installers.txt" 2>&1 || {
	grep -E '^  FAIL' "$DIST_LOG/installers.txt" | head -10 | sed 's/^/    /'
	tail -5 "$DIST_LOG/installers.txt" | sed 's/^/    /'
	die "the installer suite failed — full output in $DIST_LOG/installers.txt"; }
tail -1 "$DIST_LOG/installers.txt" | sed 's/^/  /'

#-----------------------------------------------------------------------------
say "6. Building archives"
# Keep the logs written by steps 4 and 5 — clearing DIST wholesale here used to
# delete the very file the failure message had just pointed at.
find "$DIST" -mindepth 1 -maxdepth 1 ! -name logs -exec rm -rf {} + 2>/dev/null || true
mkdir -p "$DIST/staging"
STAGE="$DIST/staging/GigaHack-$VERSION"
mkdir -p "$STAGE"

# The payload the installer expects beside itself: js/plugins, manifest.json,
# profiles, and the installer scripts.
mkdir -p "$STAGE/js"
cp -R gigahack/js/plugins "$STAGE/js/plugins"
cp gigahack/manifest.json "$STAGE/"
cp -R gigahack/profiles "$STAGE/profiles"
cp install/gigahack-install.sh install/gigahack-install.command \
   install/gigahack-install.ps1 install/gigahack-install.bat "$STAGE/"
cp README.md LICENSE NOTICE.md "$STAGE/"
mkdir -p "$STAGE/docs"
cp docs/FUNCTIONS.md "$STAGE/docs/" 2>/dev/null || true
cp gigahack-test/verify-live.js "$STAGE/" 2>/dev/null || true

# 644 on every plugin, explicitly. Two modules once shipped mode 600 owned by
# root: every existence check passed, every read failed, and the modules were
# simply absent with no error anywhere.
chmod 644 "$STAGE"/js/plugins/*.js "$STAGE"/profiles/*.js "$STAGE"/manifest.json
chmod 755 "$STAGE"/gigahack-install.sh "$STAGE"/gigahack-install.command

# Verify readability as the game would: open every file, do not just stat it.
node -e '
	var fs = require("fs"), path = require("path"), dir = process.argv[1];
	var bad = [];
	["js/plugins", "profiles"].forEach(function (sub) {
		var d = path.join(dir, sub);
		if (!fs.existsSync(d)) return;
		fs.readdirSync(d).forEach(function (f) {
			if (!/\.js$/.test(f)) return;
			try { var s = fs.readFileSync(path.join(d, f), "utf8"); if (!s.length) bad.push(f + " (empty)"); }
			catch (e) { bad.push(f + " (" + e.code + ")"); }
		});
	});
	if (bad.length) { console.error("unreadable or empty in the staged payload: " + bad.join(", ")); process.exit(1); }
' "$STAGE" || die "staged payload verification failed"

# A tar header carries the BUILD ACCOUNT'S name, and `tar tvzf` prints it in
# the first line without extracting anything. Scrubbing the working tree does
# nothing about it, because the leak is in the metadata rather than in any
# file — so an archive built on a personal machine publishes that account name
# to everyone who downloads it. These flags neutralise ownership; bsdtar and
# GNU tar spell it differently, so both are offered and the first that works
# is used. The zip format stores no owner by default and needs nothing.
TAR_ANON=""
if tar --uid 0 --gid 0 --uname '' --gname '' -cf /dev/null -T /dev/null 2>/dev/null; then
	TAR_ANON="--uid 0 --gid 0 --uname  --gname "          # bsdtar (macOS)
	TAR_ANON_SET=1
elif tar --owner=0 --group=0 --numeric-owner -cf /dev/null -T /dev/null 2>/dev/null; then
	TAR_ANON="--owner=0 --group=0 --numeric-owner"        # GNU tar
	TAR_ANON_SET=1
else
	echo "  WARNING: this tar takes neither bsdtar's --uname nor GNU tar's --owner." >&2
	echo "  The archives will carry the build account's name in every header." >&2
fi

anon_tar() {   # anon_tar <output> <args...>
	local out="$1"; shift
	if tar --uid 0 --gid 0 --uname '' --gname '' -czf "$out" "$@" 2>/dev/null; then return 0; fi
	if tar --owner=0 --group=0 --numeric-owner -czf "$out" "$@" 2>/dev/null; then return 0; fi
	tar -czf "$out" "$@"
}

( cd "$DIST/staging" && anon_tar "$DIST/GigaHack-MVMZ-$VERSION.tar.gz" "GigaHack-$VERSION" )
if command -v zip >/dev/null 2>&1; then
	( cd "$DIST/staging" && zip -qr "$DIST/GigaHack-MVMZ-$VERSION.zip" "GigaHack-$VERSION" )
fi

# The source archive: everything a contributor needs, nothing a player does.
anon_tar "$DIST/GigaHack-MVMZ-$VERSION-source.tar.gz" \
	--exclude='.git' --exclude='dist' --exclude='node_modules' \
	--exclude='shots-*' --exclude='.DS_Store' \
	gigahack gigahack-test install docs README.md LICENSE NOTICE.md \
	build-release.sh test-installers.sh publish.sh || true

# The leak is invisible in a diff and invisible in the file list, so it is
# checked rather than trusted: the build fails here rather than publishing a
# name nobody meant to publish.
for a in "$DIST/GigaHack-MVMZ-$VERSION.tar.gz" "$DIST/GigaHack-MVMZ-$VERSION-source.tar.gz"; do
	[ -f "$a" ] || continue
	OWNERS="$(tar tvzf "$a" | awk '{print $2}' | sort -u | tr '\n' ' ')"
	case "$OWNERS" in
		*[!0\ ]*) die "archive $a carries owner names in its headers: $OWNERS
This publishes the build account to everyone who downloads it. See anon_tar above." ;;
	esac
done

ls -la "$DIST"/*.tar.gz "$DIST"/*.zip 2>/dev/null | sed 's/^/  /'

#-----------------------------------------------------------------------------
say "7. Install FROM the archive and verify"
# This is the step that catches a file missing from the packing list. The
# source tree would install fine; the archive is what ships.
BED="$(mktemp -d)"
trap 'rm -rf "$BED"' EXIT
tar xzf "$DIST/GigaHack-MVMZ-$VERSION.tar.gz" -C "$BED"
PKG="$BED/GigaHack-$VERSION"

mkgame() {
	mkdir -p "$1/js/plugins" "$1/data"
	: > "$1/index.html"
	if [ "$2" = MZ ]; then : > "$1/js/rmmz_core.js"; else : > "$1/js/rpg_core.js"; fi
	printf 'var $plugins = [\n{"name":"AlphaPlugin","status":true,"description":"","parameters":{}}\n];\n' > "$1/js/plugins.js"
}
mkgame "$BED/mzgame" MZ
mkgame "$BED/mvgame" MV

"$PKG/gigahack-install.sh" "$BED/mzgame" "$BED/mvgame" > "$DIST_LOG/archive-install.txt" 2>&1 || {
	cat "$DIST_LOG/archive-install.txt"; die "installing from the archive failed"; }
grep -c "verified" "$DIST_LOG/archive-install.txt" | sed 's/^/  verified installs: /'

for g in mzgame mvgame; do
	node -e '
		var fs = require("fs"), p = process.argv[1], src = fs.readFileSync(p, "utf8"), $plugins;
		(0, eval)(src);
		var holes = $plugins.filter(function (x) { return !x || !x.name; }).length;
		var gh = $plugins.filter(function (x) { return /^GigaHack_/.test(x.name); });
		if (holes) { console.error("the array has " + holes + " hole(s)"); process.exit(1); }
		if (!gh.length) { console.error("no GigaHack entries"); process.exit(1); }
		if ($plugins[$plugins.length - 1].name !== "GigaHack_Boot") { console.error("GigaHack is not last"); process.exit(1); }
		console.log("  " + process.argv[2] + ": " + $plugins.length + " entries, " + gh.length + " GigaHack, last is " + $plugins[$plugins.length - 1].name);
	' "$BED/$g/js/plugins.js" "$g" || die "$g: the installed plugins.js is wrong"
done

"$PKG/gigahack-install.sh" --uninstall "$BED/mzgame" > /dev/null 2>&1
node -e '
	var fs = require("fs"), src = fs.readFileSync(process.argv[1], "utf8"), $plugins;
	(0, eval)(src);
	if ($plugins.filter(function (x) { return /^GigaHack_/.test(x.name); }).length) { console.error("uninstall left entries behind"); process.exit(1); }
	console.log("  uninstall from the archive is clean");
' "$BED/mzgame/js/plugins.js" || die "uninstall from the archive failed"

#-----------------------------------------------------------------------------
say "8. Checksums"
( cd "$DIST" && shasum -a 256 *.tar.gz *.zip 2>/dev/null > SHA256SUMS || sha256sum *.tar.gz *.zip 2>/dev/null > SHA256SUMS )
cat "$DIST/SHA256SUMS" | sed 's/^/  /'

rm -rf "$DIST/staging"

say "Done — dist/ holds the release for GigaHack $VERSION"
