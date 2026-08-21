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
	# The exit code is the contract; the summary line is for the reader.
	# Parsing the output for a count instead would pass a suite that printed
	# a summary and then failed on the way out.
	for e in mz mv mv-modded; do
		printf '  %-10s ' "$e"
		if ( cd gigahack-test && node run.js --engine="$e" ) > "/tmp/gigahack-suite-$e.txt" 2>&1; then
			grep -E 'checks passed' "/tmp/gigahack-suite-$e.txt" | tail -1
		else
			echo "FAILED"
			grep -E '^  FAIL' "/tmp/gigahack-suite-$e.txt" | head -10 | sed 's/^/    /'
			die "the browser suite failed on $e — full output in /tmp/gigahack-suite-$e.txt"
		fi
	done
else
	say "4. Browser suite — SKIPPED (--fast)"
fi

#-----------------------------------------------------------------------------
say "5. Installer suite"
./test-installers.sh > /tmp/gigahack-installer-out.txt 2>&1 || {
	tail -20 /tmp/gigahack-installer-out.txt; die "the installer suite failed"; }
tail -1 /tmp/gigahack-installer-out.txt | sed 's/^/  /'

#-----------------------------------------------------------------------------
say "6. Building archives"
rm -rf "$DIST"
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
cp README.md LICENSE "$STAGE/"
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

( cd "$DIST/staging" && tar czf "$DIST/GigaHack-MVMZ-$VERSION.tar.gz" "GigaHack-$VERSION" )
if command -v zip >/dev/null 2>&1; then
	( cd "$DIST/staging" && zip -qr "$DIST/GigaHack-MVMZ-$VERSION.zip" "GigaHack-$VERSION" )
fi

# The source archive: everything a contributor needs, nothing a player does.
tar czf "$DIST/GigaHack-MVMZ-$VERSION-source.tar.gz" \
	--exclude='.git' --exclude='dist' --exclude='node_modules' \
	--exclude='shots-*' --exclude='.DS_Store' \
	gigahack gigahack-test install docs README.md LICENSE \
	build-release.sh test-installers.sh publish.sh 2>/dev/null || true

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

"$PKG/gigahack-install.sh" "$BED/mzgame" "$BED/mvgame" > /tmp/gigahack-archive-install.txt 2>&1 || {
	cat /tmp/gigahack-archive-install.txt; die "installing from the archive failed"; }
grep -c "verified" /tmp/gigahack-archive-install.txt | sed 's/^/  verified installs: /'

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
