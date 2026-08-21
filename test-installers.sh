#!/usr/bin/env bash
#=============================================================================
# GigaHack MV/MZ — installer test suite
#-----------------------------------------------------------------------------
# The installer edits somebody else's js/plugins.js. If it gets that wrong the
# symptom is a red screen on next launch, or — worse, because it is silent —
# a game that boots normally with the menu simply absent. So every case gets a
# check, and the resulting file is PARSED, not merely grepped.
#
# Run: ./test-installers.sh
#=============================================================================
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$HERE/install/gigahack-install.sh"
BED="${TMPDIR:-/tmp}/gigahack-installer-tests.$$"
PASS=0; FAIL=0

pass() { PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; [ $# -gt 1 ] && printf '        %s\n' "$2"; }
check(){ if [ "$1" = 1 ]; then pass "$2"; else fail "$2" "${3:-}"; fi; }

cleanup() { rm -rf "$BED"; }
trap cleanup EXIT

#-----------------------------------------------------------------------------
# Fixtures — one per plugins.js shape seen in the wild.
#-----------------------------------------------------------------------------
mkgame() { # mkgame <dir> <MV|MZ> <plugins.js body>
	mkdir -p "$1/js/plugins" "$1/data"
	: > "$1/index.html"
	if [ "$2" = MZ ]; then : > "$1/js/rmmz_core.js"; else : > "$1/js/rpg_core.js"; fi
	printf '%s' "$3" > "$1/js/plugins.js"
}

build_bed() {
	rm -rf "$BED"; mkdir -p "$BED"
	mkgame "$BED/pretty-mz" MZ 'var $plugins =
[
{"name":"AlphaPlugin","status":true,"description":"","parameters":{}},
{"name":"BetaPlugin","status":false,"description":"","parameters":{}}
];
'
	mkgame "$BED/empty-mv" MV 'var $plugins = [];
'
	mkgame "$BED/trailing-comma" MV 'var $plugins = [
{"name":"AlphaPlugin","status":true,"description":"","parameters":{}},
];
'
	mkgame "$BED/minified" MZ 'var $plugins=[{"name":"A","status":true,"description":"","parameters":{}},{"name":"B","status":true,"description":"","parameters":{}}];'
	mkgame "$BED/crlf" MZ "$(printf 'var $plugins = [\r\n{"name":"A","status":true,"description":"","parameters":{}}\r\n];\r\n')"
	mkgame "$BED/no-final-newline" MV 'var $plugins = [
{"name":"A","status":true,"description":"","parameters":{}}
];'
	mkdir -p "$BED/deploy/www"; mkgame "$BED/deploy/www" MV 'var $plugins = [
{"name":"A","status":true,"description":"","parameters":{}}
];
'
	mkdir -p "$BED/Bundle.app/Contents/Resources/app.nw"
	mkgame "$BED/Bundle.app/Contents/Resources/app.nw" MV 'var $plugins = [
{"name":"A","status":true,"description":"","parameters":{}}
];
'
	# Not a game: js/ but no index.html.
	mkdir -p "$BED/notagame/js/plugins"; : > "$BED/notagame/js/plugins.js"
	# A game whose engine cannot be identified.
	mkdir -p "$BED/noengine/js/plugins"; : > "$BED/noengine/index.html"
	printf 'var $plugins = [];' > "$BED/noengine/js/plugins.js"
}

# Parse the produced plugins.js the way the engine does, and report the array.
parse() { # parse <plugins.js path> -> prints JSON array or exits nonzero
	node -e '
		var fs = require("fs");
		var src = fs.readFileSync(process.argv[1], "utf8");
		var $plugins;
		// Same evaluation the engine performs: a plain script defining a var.
		(0, eval)(src + ";;");
		if (typeof $plugins === "undefined") { console.error("no $plugins"); process.exit(2); }
		process.stdout.write(JSON.stringify($plugins));
	' "$1"
}

count_gh() { parse "$1" | node -e '
	var d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
		var a=JSON.parse(d);
		console.log(a.filter(p=>/^GigaHack_/.test(p.name)).length);
	});'; }

last_is_gh() { parse "$1" | node -e '
	var d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
		var a=JSON.parse(d);
		console.log(a.length && /^GigaHack_/.test(a[a.length-1].name) ? 1 : 0);
	});'; }

first_is_original() { parse "$1" | node -e '
	var d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
		var a=JSON.parse(d);
		console.log(a.length && !/^GigaHack_/.test(a[0].name) ? 1 : 0);
	});'; }

order_ok() { parse "$1" | node -e '
	var d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
		var a=JSON.parse(d).filter(p=>/^GigaHack_/.test(p.name)).map(p=>p.name);
		// Load order is significant. Core must be first and Boot last, or
		// nothing works and alphabetical order would put Boot before Core.
		console.log(a[0]==="GigaHack_Core" && a[a.length-1]==="GigaHack_Boot" ? 1 : 0);
	});'; }

#=============================================================================
echo "GigaHack installer tests"
echo

[ -x "$INSTALLER" ] || { echo "installer not found or not executable: $INSTALLER"; exit 1; }
command -v node >/dev/null || { echo "node is required to parse the produced plugins.js"; exit 1; }

#-----------------------------------------------------------------------------
echo "-- install into every plugins.js shape"
build_bed
for g in pretty-mz empty-mv trailing-comma minified crlf no-final-newline \
         deploy/www Bundle.app/Contents/Resources/app.nw; do
	d="$BED/$g"
	out="$("$INSTALLER" "$d" 2>&1)"
	rc=$?
	label="${g%%/*}"
	check "$([ $rc -eq 0 ] && echo 1 || echo 0)" "$label: installer exits 0" "$out"
	if parse "$d/js/plugins.js" >/dev/null 2>&1; then
		pass "$label: the rewritten plugins.js still parses as JavaScript"
	else
		fail "$label: the rewritten plugins.js does NOT parse" "$(head -c 300 "$d/js/plugins.js")"
	fi
	check "$([ "$(count_gh "$d/js/plugins.js")" = 26 ] && echo 1 || echo 0)" "$label: all 26 modules are listed"
	check "$(last_is_gh "$d/js/plugins.js")" "$label: GigaHack is last, so its hooks are outermost"
	check "$(order_ok "$d/js/plugins.js")" "$label: Core is first and Boot is last within the block"
	check "$([ -f "$d/js/plugins.js.gigahack-backup" ] && echo 1 || echo 0)" "$label: the original plugins.js was backed up"
	n=$(ls "$d/js/plugins"/GigaHack_*.js 2>/dev/null | wc -l | tr -d ' ')
	check "$([ "$n" = 26 ] && echo 1 || echo 0)" "$label: 26 module files were copied"
	bad=$(find "$d/js/plugins" -name 'GigaHack_*.js' ! -perm -044 2>/dev/null | wc -l | tr -d ' ')
	check "$([ "$bad" = 0 ] && echo 1 || echo 0)" "$label: every module is world-readable (a file the game cannot read is invisible, not broken)"
done

# The pre-existing plugins must survive, in their original order.
check "$(first_is_original "$BED/pretty-mz/js/plugins.js")" "the game's own plugins still come first"
n=$(parse "$BED/pretty-mz/js/plugins.js" | node -e 'var d="";process.stdin.on("data",c=>d+=c).on("end",()=>{var a=JSON.parse(d);console.log(a.filter(p=>!/^GigaHack_/.test(p.name)).length)})')
check "$([ "$n" = 2 ] && echo 1 || echo 0)" "both of the game's own entries survived, including the disabled one"
st=$(parse "$BED/pretty-mz/js/plugins.js" | node -e 'var d="";process.stdin.on("data",c=>d+=c).on("end",()=>{var a=JSON.parse(d);var b=a.find(p=>p.name==="BetaPlugin");console.log(b&&b.status===false?1:0)})')
check "$st" "a disabled plugin stays disabled"

echo
#-----------------------------------------------------------------------------
echo "-- idempotence: installing twice must not duplicate"
"$INSTALLER" "$BED/pretty-mz" >/dev/null 2>&1
"$INSTALLER" "$BED/pretty-mz" >/dev/null 2>&1
check "$([ "$(count_gh "$BED/pretty-mz/js/plugins.js")" = 26 ] && echo 1 || echo 0)" "three installs still leave exactly 26 entries"
check "$(last_is_gh "$BED/pretty-mz/js/plugins.js")" "still last after reinstalling"
orig=$(parse "$BED/pretty-mz/js/plugins.js" | node -e '
	var d=""; process.stdin.on("data",function(c){d+=c}).on("end",function(){
		var a=JSON.parse(d);
		console.log(a.filter(function(p){ return p && p.name==="AlphaPlugin" }).length);
	});')
check "$([ "$orig" = 1 ] && echo 1 || echo 0)" "the game's own plugin was not duplicated either" "found $orig copies"

# A hole in the array is the failure mode that reads as fine in a diff:
# `[{"A"},,{"B"}]` is legal, $plugins[1] is undefined, and PluginManager
# throws on plugin.name during boot. Assert there are none.
holes=$(parse "$BED/pretty-mz/js/plugins.js" | node -e '
	var d=""; process.stdin.on("data",function(c){d+=c}).on("end",function(){
		var a=JSON.parse(d);
		console.log(a.filter(function(p){ return !p || !p.name }).length);
	});')
check "$([ "$holes" = 0 ] && echo 1 || echo 0)" "the array has no holes after repeated installs" "found $holes"

echo
#-----------------------------------------------------------------------------
echo "-- the backup is the file as the GAME shipped it, not as we left it"
b="$BED/pretty-mz/js/plugins.js.gigahack-backup"
check "$(grep -c 'GigaHack' "$b" | grep -q '^0$' && echo 1 || echo 0)" "the backup contains no GigaHack entries after three installs"

echo
#-----------------------------------------------------------------------------
echo "-- uninstall restores the original byte for byte"
build_bed
cp "$BED/pretty-mz/js/plugins.js" "$BED/pristine.js"
"$INSTALLER" "$BED/pretty-mz" >/dev/null 2>&1
"$INSTALLER" --uninstall "$BED/pretty-mz" >/dev/null 2>&1
if cmp -s "$BED/pristine.js" "$BED/pretty-mz/js/plugins.js"; then
	pass "plugins.js is byte-identical to the original after uninstall"
else
	fail "plugins.js differs after uninstall" "$(diff "$BED/pristine.js" "$BED/pretty-mz/js/plugins.js" | head -5)"
fi
n=$(ls "$BED/pretty-mz/js/plugins"/GigaHack_*.js 2>/dev/null | wc -l | tr -d ' ')
check "$([ "$n" = 0 ] && echo 1 || echo 0)" "every module file was removed"
check "$([ ! -f "$BED/pretty-mz/js/plugins.js.gigahack-backup" ] && echo 1 || echo 0)" "the backup was consumed, not left behind"

echo
#-----------------------------------------------------------------------------
echo "-- uninstall with the backup deleted still leaves valid JavaScript"
build_bed
"$INSTALLER" "$BED/minified" >/dev/null 2>&1
rm -f "$BED/minified/js/plugins.js.gigahack-backup"
"$INSTALLER" --uninstall "$BED/minified" >/dev/null 2>&1
if parse "$BED/minified/js/plugins.js" >/dev/null 2>&1; then
	pass "plugins.js still parses after a backup-less uninstall"
else
	fail "plugins.js does not parse after a backup-less uninstall" "$(cat "$BED/minified/js/plugins.js")"
fi
check "$([ "$(count_gh "$BED/minified/js/plugins.js")" = 0 ] && echo 1 || echo 0)" "no GigaHack entries remain"
n=$(parse "$BED/minified/js/plugins.js" | node -e 'var d="";process.stdin.on("data",c=>d+=c).on("end",()=>{console.log(JSON.parse(d).length)})')
check "$([ "$n" = 2 ] && echo 1 || echo 0)" "the game's own two plugins survived"

echo
#-----------------------------------------------------------------------------
echo "-- verify catches the states that matter"
build_bed
"$INSTALLER" "$BED/pretty-mz" >/dev/null 2>&1
"$INSTALLER" --verify "$BED/pretty-mz" >/dev/null 2>&1
check "$([ $? -eq 0 ] && echo 1 || echo 0)" "a good install verifies clean"

# A module file the game cannot read. This is the failure with no symptom:
# existsSync needs only directory permission, so presence, size and checksum
# all report fine while every read fails and the module silently is not there.
chmod 000 "$BED/pretty-mz/js/plugins/GigaHack_Vars.js"
out=$("$INSTALLER" --verify "$BED/pretty-mz" 2>&1); rc=$?
if [ "$(id -u)" = 0 ]; then
	printf '  SKIP  unreadable-file detection (running as root, which can read anything)\n'
else
	check "$([ $rc -ne 0 ] && echo 1 || echo 0)" "verify fails when a module is present but unreadable"
	check "$(echo "$out" | grep -qi 'NOT READABLE' && echo 1 || echo 0)" "...and says so in those words"
	check "$(echo "$out" | grep -q 'chmod 644' && echo 1 || echo 0)" "...and names the command that fixes it"
fi
chmod 644 "$BED/pretty-mz/js/plugins/GigaHack_Vars.js"

# A missing module.
rm -f "$BED/pretty-mz/js/plugins/GigaHack_Forge.js"
out=$("$INSTALLER" --verify "$BED/pretty-mz" 2>&1); rc=$?
check "$([ $rc -ne 0 ] && echo 1 || echo 0)" "verify fails when a module file is missing"
check "$(echo "$out" | grep -q 'GigaHack_Forge' && echo 1 || echo 0)" "...and names which one"

# A game update that appended its own plugin after ours — the case where the
# mod is installed, loads, and is silently no longer outermost.
build_bed
"$INSTALLER" "$BED/pretty-mz" >/dev/null 2>&1
node -e '
	var fs=require("fs"), p=process.argv[1], s=fs.readFileSync(p,"utf8");
	var i=s.lastIndexOf("]");
	fs.writeFileSync(p, s.slice(0,i)+",\n{\"name\":\"LatePlugin\",\"status\":true,\"description\":\"\",\"parameters\":{}}\n"+s.slice(i));
' "$BED/pretty-mz/js/plugins.js"
out=$("$INSTALLER" --verify "$BED/pretty-mz" 2>&1); rc=$?
check "$([ $rc -ne 0 ] && echo 1 || echo 0)" "verify fails when a plugin was appended after GigaHack"
check "$(echo "$out" | grep -qi 'NOT LAST' && echo 1 || echo 0)" "...and says GigaHack is not last"
"$INSTALLER" "$BED/pretty-mz" >/dev/null 2>&1
check "$(last_is_gh "$BED/pretty-mz/js/plugins.js")" "re-running the installer puts GigaHack back at the end"
n=$(parse "$BED/pretty-mz/js/plugins.js" | node -e 'var d="";process.stdin.on("data",c=>d+=c).on("end",()=>{var a=JSON.parse(d);console.log(a.filter(p=>p.name==="LatePlugin").length)})')
check "$([ "$n" = 1 ] && echo 1 || echo 0)" "...without losing the plugin that had been appended"

# A game update that replaced plugins.js wholesale — GigaHack's entries gone,
# its module files still on disk.
build_bed
"$INSTALLER" "$BED/pretty-mz" >/dev/null 2>&1
printf 'var $plugins = [\n{"name":"AlphaPlugin","status":true,"description":"","parameters":{}}\n];\n' > "$BED/pretty-mz/js/plugins.js"
out=$("$INSTALLER" --verify "$BED/pretty-mz" 2>&1); rc=$?
check "$([ $rc -ne 0 ] && echo 1 || echo 0)" "verify fails when a game update replaced plugins.js"
check "$(echo "$out" | grep -qi 'does not list GigaHack' && echo 1 || echo 0)" "...and says the entries are gone"
check "$(echo "$out" | grep -qi 're-run this installer' && echo 1 || echo 0)" "...and names the fix"

echo
#-----------------------------------------------------------------------------
echo "-- refusals"
build_bed
out=$("$INSTALLER" "$BED/notagame" 2>&1); rc=$?
check "$([ $rc -ne 0 ] && echo 1 || echo 0)" "a folder that is not a game is refused"
check "$(echo "$out" | grep -qi 'index.html' && echo 1 || echo 0)" "...and says what it expected to find"

out=$("$INSTALLER" "$BED/noengine" 2>&1); rc=$?
check "$(echo "$out" | grep -qi 'does not look like an MV or MZ game' && echo 1 || echo 0)" "a game with no recognisable engine core is refused by name"

# Read-only install (Steam-style). Root ignores permissions, so skip there.
build_bed
if [ "$(id -u)" != 0 ]; then
	chmod a-w "$BED/empty-mv/js/plugins.js" "$BED/empty-mv/js/plugins"
	out=$("$INSTALLER" "$BED/empty-mv" 2>&1); rc=$?
	check "$([ $rc -ne 0 ] && echo 1 || echo 0)" "a read-only game folder is refused rather than half-installed"
	check "$(echo "$out" | grep -qi 'not writable' && echo 1 || echo 0)" "...and says which permission is missing"
	chmod u+w "$BED/empty-mv/js/plugins.js" "$BED/empty-mv/js/plugins"
else
	printf '  SKIP  read-only detection (running as root, which can write anything)\n'
fi

echo
#-----------------------------------------------------------------------------
echo "-- dry run changes nothing"
build_bed
before=$(cksum < "$BED/pretty-mz/js/plugins.js")
"$INSTALLER" --dry-run "$BED/pretty-mz" >/dev/null 2>&1
after=$(cksum < "$BED/pretty-mz/js/plugins.js")
check "$([ "$before" = "$after" ] && echo 1 || echo 0)" "--dry-run leaves plugins.js untouched"
n=$(ls "$BED/pretty-mz/js/plugins"/GigaHack_*.js 2>/dev/null | wc -l | tr -d ' ')
check "$([ "$n" = 0 ] && echo 1 || echo 0)" "--dry-run copies no module files"

echo
#-----------------------------------------------------------------------------
# On macOS most game folders have spaces in their names ("A New Dawn 5.3.2 mac"),
# and the default IFS splits on them: one target becomes three, each reported as
# "not a game folder" while the real one is never tried. The user sees three
# confident refusals and no install. Caught on the first real device run.
echo "-- a game folder with spaces in its name"
build_bed
mkgame "$BED/My Game 1.2 mac" MV 'var $plugins = [
{"name":"AlphaPlugin","status":true,"description":"","parameters":{}}
];
'
out=$("$INSTALLER" "$BED/My Game 1.2 mac" 2>&1); rc=$?
check "$([ $rc -eq 0 ] && echo 1 || echo 0)" "a path with spaces installs" "$out"
check "$([ "$(count_gh "$BED/My Game 1.2 mac/js/plugins.js")" = 26 ] && echo 1 || echo 0)" "...with all 26 modules"
check "$(echo "$out" | grep -qc 'not an RPG Maker' && echo 0 || echo 1)" "...and is not reported as three separate non-games"
out=$("$INSTALLER" --verify "$BED/My Game 1.2 mac" 2>&1); rc=$?
check "$([ $rc -eq 0 ] && echo 1 || echo 0)" "...and verifies clean"
out=$("$INSTALLER" --uninstall "$BED/My Game 1.2 mac" 2>&1)
check "$([ "$(count_gh "$BED/My Game 1.2 mac/js/plugins.js")" = 0 ] && echo 1 || echo 0)" "...and uninstalls"

echo
#-----------------------------------------------------------------------------
# Every check above passed on GNU awk and every one of them failed on macOS,
# because the installer passed a 28-line block through `awk -v` — which BSD
# awk, the awk macOS ships, rejects outright with "newline in string ... at
# source line 1". A suite that exercises one awk implementation is a suite that
# tests one machine.
#
# So: re-run a full install / verify / uninstall cycle under every awk this
# machine actually has. On a Mac that is BSD awk, which is the one that
# matters; on a Linux box it is usually gawk plus whatever else is installed.
# Nothing is skipped silently — each implementation found is named.
echo "-- portability across awk implementations"

# Static first, because it holds even where only one awk exists: multi-line
# data must never reach `awk -v`.
if grep -nE "awk +-v +[A-Za-z_]+=\"\\\$" "$INSTALLER" >/dev/null 2>&1; then
	OFFENDERS="$(grep -nE 'awk +-v +[A-Za-z_]+=' "$INSTALLER" | head -5)"
	fail "the installer passes a shell variable through awk -v" "$OFFENDERS
        BSD awk rejects a literal newline in a -v assignment. Read the data as a
        file with NR == FNR instead."
else
	pass "the installer never passes a shell variable through awk -v"
fi

SHIM="$BED/awkshim"
AWKS=""
for cand in awk gawk mawk original-awk busybox; do
	command -v "$cand" >/dev/null 2>&1 || continue
	# busybox is only interesting if it actually provides awk.
	if [ "$cand" = busybox ]; then
		busybox awk 'BEGIN{exit 0}' >/dev/null 2>&1 || continue
	fi
	AWKS="$AWKS $cand"
done

for a in $AWKS; do
	[ "$a" = awk ] && continue            # already covered by everything above
	mkdir -p "$SHIM"
	if [ "$a" = busybox ]; then
		printf '#!/bin/sh\nexec busybox awk "$@"\n' > "$SHIM/awk"
	else
		printf '#!/bin/sh\nexec %s "$@"\n' "$(command -v "$a")" > "$SHIM/awk"
	fi
	chmod +x "$SHIM/awk"

	build_bed
	if PATH="$SHIM:$PATH" "$INSTALLER" "$BED/pretty-mz" >/dev/null 2>&1; then
		ok=1
	else
		ok=0
	fi
	check "$ok" "$a: the installer completes"
	if [ "$ok" = 1 ]; then
		check "$([ "$(count_gh "$BED/pretty-mz/js/plugins.js")" = 26 ] && echo 1 || echo 0)" "$a: all 26 modules are listed"
		check "$(last_is_gh "$BED/pretty-mz/js/plugins.js")" "$a: GigaHack is last"
		holes=$(parse "$BED/pretty-mz/js/plugins.js" | node -e '
			var d=""; process.stdin.on("data",function(c){d+=c}).on("end",function(){
				console.log(JSON.parse(d).filter(function(p){ return !p || !p.name }).length);
			});')
		check "$([ "$holes" = 0 ] && echo 1 || echo 0)" "$a: no holes in the array"
		PATH="$SHIM:$PATH" "$INSTALLER" --uninstall "$BED/pretty-mz" >/dev/null 2>&1
		check "$([ "$(count_gh "$BED/pretty-mz/js/plugins.js")" = 0 ] && echo 1 || echo 0)" "$a: uninstall is clean"
	fi
	rm -rf "$SHIM"
done

if [ -z "$(echo $AWKS | sed 's/awk//g' | tr -d ' ')" ]; then
	printf '  NOTE  only one awk on this machine (%s) — the cross-implementation\n' "$(awk --version 2>&1 | head -1 | cut -c1-40)"
	printf '        checks could not run. Install original-awk (the BSD awk macOS\n'
	printf '        ships) to cover the case that broke every macOS install.\n'
fi

echo
#-----------------------------------------------------------------------------
echo "-- discovery finds games without being told where they are"
build_bed
out=$(cd "$BED" && "$INSTALLER" --dry-run 2>&1)
for want in pretty-mz empty-mv Bundle.app; do
	check "$(echo "$out" | grep -q "$want" && echo 1 || echo 0)" "discovery found $want"
done

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
