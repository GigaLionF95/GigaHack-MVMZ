#!/usr/bin/env sh
#=============================================================================
# GigaHack MV/MZ — installer (macOS, Linux)
#-----------------------------------------------------------------------------
# Usage:
#   ./gigahack-install.sh [game-folder ...]     install or update
#   ./gigahack-install.sh --uninstall [folder]  remove cleanly
#   ./gigahack-install.sh --verify [folder]     check without changing anything
#   ./gigahack-install.sh --dry-run [folder]    show what would change
#
# With no folder, every RPG Maker MV/MZ game under the current directory and
# its parent is offered. Discovery, not a hardcoded list: a hardcoded list is
# wrong the moment a copy of the game exists that is not on it, and the
# failure has no symptom — the installer reports success for the folders it
# knows about while the copy actually being played keeps whatever it had.
#
# WHAT THIS TOUCHES
#   <root>/js/plugins/GigaHack_*.js   copied in (new files, ours)
#   <root>/js/plugins.js              one entry per module, appended between markers
#   <root>/js/plugins.js.gigahack-backup   the original, kept forever
#
# Nothing else is written, ever. --uninstall restores the file byte for byte.
#
# WHY IT APPENDS RATHER THAN PREPENDS
#   Every GigaHack alias must be outermost, or a plugin loading later wraps
#   ours and can intercept or undo what we do. Being last in plugins.js is
#   what guarantees that. The mod re-checks at runtime and says so when a
#   game update has changed it.
#=============================================================================
set -eu

VERSION="2.2.0"
BEGIN_MARK="// >>> GigaHack ${VERSION} BEGIN — installed automatically; edit at your own risk"
END_MARK="// <<< GigaHack END"
ANY_BEGIN="// >>> GigaHack"
BACKUP_SUFFIX=".gigahack-backup"

SRC="$(cd "$(dirname "$0")" && pwd)"

# Temp files this run is holding, so an interrupt does not leave them behind.
#
# It already has. A game folder on this machine still carries a 137KB
# plugins.js.gigahack-tmp10 and three empty .err files from a run that was
# killed between writing them and cleaning up — the normal paths all remove
# them, and none of the normal paths ran. Nothing looked for them afterwards
# either, so they sat there for weeks: litter in somebody else's game folder,
# which is the one place this script has no business leaving anything.
#
# Newline-separated, never space-separated. A game folder path has spaces in
# it, and word-splitting on space is how "A New Dawn 5.3.2 mac" became three
# targets, each confidently reported as not a game folder.
GH_TMPS=""
tmp_track() { GH_TMPS="$GH_TMPS$1
"; }
cleanup_tmps() {
	[ -n "$GH_TMPS" ] || return 0
	printf '%s' "$GH_TMPS" | while IFS= read -r f; do
		[ -n "$f" ] && rm -f "$f"
	done
}
trap cleanup_tmps EXIT INT TERM

# Everything a killed run of this script could have left beside plugins.js.
# One list, because verify reports them and uninstall removes them and two
# copies of a glob would drift.
strays_beside() {
	for f in "$1".gigahack-tmp* "$1".gigahack-ent* "$1".gigahack-strip*; do
		[ -e "$f" ] || continue
		printf '%s\n' "$f"
	done
}

# Find the payload by MANIFEST, never by the presence of js/plugins.
#
# Every RPG Maker game has a js/plugins folder, so testing for one cannot tell
# "the GigaHack release folder" from "the game somebody copied this script
# into". It used to, and the consequence was worse than a wrong guess: on a
# flat-layout game the installer adopted the GAME's own plugins folder as its
# payload and began backing up plugins.js before discovering it had nothing to
# install. manifest.json beside js/plugins/GigaHack_Core.js is unambiguous, and
# requiring both catches a half-extracted archive here instead of halfway
# through an install.
payload_at() {
	[ -f "$1/manifest.json" ] && [ -f "$1/js/plugins/GigaHack_Core.js" ]
}

PAYLOAD=""; MANIFEST=""
for cand in "$SRC" "$SRC/.." "$SRC/gigahack" "$SRC/../gigahack"; do
	if payload_at "$cand"; then
		root="$(cd "$cand" && pwd)"
		PAYLOAD="$root/js/plugins"
		MANIFEST="$root/manifest.json"
		break
	fi
done

if [ -z "$PAYLOAD" ]; then
	echo "" >&2
	echo "The GigaHack files are not next to this installer." >&2
	echo "" >&2
	echo "  This script is in:  $SRC" >&2
	echo "  It needs manifest.json and js/plugins/GigaHack_Core.js beside it." >&2
	echo "" >&2
	# Name the specific mistake. Anyone reaching this has almost certainly
	# copied the installer INTO their game, which is the one place it cannot
	# be — it has to keep its own files to copy FROM.
	if [ -f "$SRC/index.html" ] || [ -f "$SRC/js/plugins.js" ] || [ -f "$SRC/www/index.html" ]; then
		echo "  This folder looks like the GAME, not the GigaHack folder." >&2
		echo "  The installer does not go inside the game. Leave it where you unpacked" >&2
		echo "  it and run it from there — it will find this game on its own, or you" >&2
		echo "  can point it straight at one:" >&2
		echo "" >&2
		echo "      ./gigahack-install.sh \"$SRC\"" >&2
		echo "" >&2
	fi
	echo "  The unpacked folder should contain:" >&2
	echo "" >&2
	echo "      GigaHack-${VERSION}/" >&2
	echo "        manifest.json" >&2
	echo "        js/plugins/GigaHack_Core.js   (and the rest)" >&2
	echo "        profiles/" >&2
	echo "        gigahack-install.sh" >&2
	echo "" >&2
	exit 1
fi

MODE=install
TARGETS=""

for arg in "$@"; do
	case "$arg" in
		--uninstall) MODE=uninstall ;;
		--verify)    MODE=verify ;;
		--dry-run)   MODE=dryrun ;;
		--help|-h)
			sed -n '3,30p' "$0" | sed 's|^# \{0,1\}||'
			exit 0 ;;
		-*)
			echo "error: unknown option $arg" >&2; exit 1 ;;
		*)  TARGETS="$TARGETS
$arg" ;;
	esac
done

#-----------------------------------------------------------------------------
# Module list — read from the manifest so the installer and the mod can never
# disagree about what a complete install is.
#-----------------------------------------------------------------------------
modules() {
	if [ -f "$MANIFEST" ]; then
		sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\(GigaHack_[A-Za-z]*\)".*/\1/p' "$MANIFEST"
	else
		# Fall back to the files on disk in the order the manifest would give.
		# Alphabetical order is WRONG here — load order is significant — so if
		# the manifest is missing we refuse rather than guess.
		echo "error: $MANIFEST is missing and load order cannot be guessed." >&2
		echo "       Alphabetical order would load Boot before Core and nothing would work." >&2
		exit 1
	fi
}

#-----------------------------------------------------------------------------
# Discovery
#
# A folder is a game root when it holds index.html and js/plugins.js. Both are
# required: js/ alone matches a source checkout, and index.html alone matches
# a web page. The engine is read from which core file is present.
#-----------------------------------------------------------------------------
engine_of() {
	if [ -f "$1/js/rmmz_core.js" ]; then echo MZ
	elif [ -f "$1/js/rpg_core.js" ]; then echo MV
	else echo unknown
	fi
}

game_root_p() {
	[ -f "$1/index.html" ] && [ -f "$1/js/plugins.js" ] && [ -d "$1/js/plugins" ]
}

discover() {
	base="$1"
	# Plain layout, www/ deploy, and macOS .app bundles, to a sane depth.
	for cand in \
		"$base" \
		"$base"/* \
		"$base"/*/www \
		"$base"/www \
		"$base"/*.app/Contents/Resources/app.nw \
		"$base"/*/*.app/Contents/Resources/app.nw \
		"$base"/*.app/Contents/Resources/app.nw/www \
		"$base"/*/*.app/Contents/Resources/app.nw/www
	do
		[ -d "$cand" ] || continue
		if game_root_p "$cand"; then
			( cd "$cand" && pwd )
		fi
	done
}

#-----------------------------------------------------------------------------
# plugins.js surgery
#
# The file is `var $plugins = [ {...}, {...} ];`. We do not parse it as
# JavaScript — a game may have reformatted or minified it, and a parser that
# is wrong about one game is worse than no parser. Instead:
#
#   1. Strip any previous GigaHack block, between its markers.
#   2. Find the LAST ']' in the file. That closes the array on every real
#      plugins.js, whatever the formatting.
#   3. Look at the last non-space character before it to decide whether a
#      separating comma is needed.
#   4. Insert our entries there.
#
# Step 3 is the whole trick, and it has three cases: '}' (a plugin precedes
# us, add a comma), ',' (a trailing comma is already there, add none), and
# '[' (the array is empty, add none).
#-----------------------------------------------------------------------------
strip_block() {
	# $1 = file. Removes the GigaHack block AND the separating comma we put in
	# front of it.
	#
	# Dropping the comma is not tidiness. `[{"A"},,{"B"}]` is a legal array
	# literal with a HOLE in it: $plugins[1] is undefined, PluginManager reads
	# `plugin.name` off it and throws during boot — a red screen, from a file
	# that looks fine in a diff. It happens on every reinstall and every
	# uninstall, which is to say on the two paths a user is most likely to
	# take after something already went wrong.
	#
	# The comma may be on its own line (a formatted plugins.js) or at the end
	# of the preceding line (a minified one), so each line is held back until
	# the next is read and the comma is stripped from the held line.
	awk '
		{
			if ($0 ~ /^\/\/ >>> GigaHack/) {
				sub(/,[ \t\r]*$/, "", prev)
				if (prev ~ /^[ \t\r]*$/) havePrev = 0
				inblock = 1
				next
			}
			if (inblock) {
				if ($0 ~ /^\/\/ <<< GigaHack END/) inblock = 0
				next
			}
			if (havePrev) print prev
			prev = $0; havePrev = 1
		}
		END { if (havePrev) print prev }
	' "$1"
}

build_entries() {
	# Emits the block, without a leading comma; the caller adds one if needed.
	printf '%s\n' "$BEGIN_MARK"
	first=1
	modules | while IFS= read -r m; do
		[ -n "$m" ] || continue
		if [ "$first" -eq 1 ]; then first=0; else printf ',\n'; fi
		printf '{"name":"%s","status":true,"description":"GigaHack %s","parameters":{}}' "$m" "$VERSION"
	done
	printf '\n%s\n' "$END_MARK"
}

insert_block() {
	# $1 = a file holding the entries block
	# $2 = a file holding the stripped plugins.js
	# Writes the new file to stdout.
	#
	# The entries arrive as a FILE, not through `awk -v`. Passing them as a
	# variable works on GNU awk and fails on every other implementation:
	# BSD awk — which is what macOS ships as /usr/bin/awk — rejects a literal
	# newline inside a -v assignment outright, with
	#
	#     awk: newline in string // >>> GigaHack 2.0.... at source line 1
	#
	# and exits 2. The installer then refused to touch plugins.js, correctly,
	# and every macOS install failed. Reading two files with NR == FNR is
	# portable across gawk, BSD awk, mawk and busybox awk alike.
	#
	# awk is used at all — rather than sed or shell — because the whole file is
	# read into one string, so the last ']' is unambiguous even on a minified
	# single-line plugins.js.
	awk '
		NR == FNR { entries = entries $0 "\n"; next }
		{ buf = buf $0 "\n" }
		END {
			# Find the last "]" in the file.
			pos = 0
			for (i = length(buf); i > 0; i--) {
				if (substr(buf, i, 1) == "]") { pos = i; break }
			}
			if (pos == 0) {
				print "GIGAHACK_NO_ARRAY" > "/dev/stderr"
				exit 3
			}
			head = substr(buf, 1, pos - 1)
			tail = substr(buf, pos)

			# Last significant character before the "]".
			sep = ""
			for (i = length(head); i > 0; i--) {
				c = substr(head, i, 1)
				if (c == " " || c == "\t" || c == "\n" || c == "\r") continue
				if (c == "}") sep = ",\n"          # a plugin precedes us
				else if (c == ",") sep = "\n"      # trailing comma already there
				else if (c == "[") sep = "\n"      # empty array
				else {
					print "GIGAHACK_ODD_CHAR:" c > "/dev/stderr"
					exit 4
				}
				break
			}
			# `entries` already ends in a newline, having been read line by
			# line. That newline is load-bearing: the END marker is a line
			# comment, so without it the closing "];" lands on the commented
			# line and the whole array disappears while the file still looks
			# right in a diff.
			printf "%s%s%s%s", head, sep, entries, tail
		}
	' "$1" "$2"
}

#-----------------------------------------------------------------------------
# Per-root operations
#-----------------------------------------------------------------------------
ok=0; failed=0; skipped=0

say()  { printf '%s\n' "$*"; }
step() { printf '  %s\n' "$*"; }
bad()  { printf '  ! %s\n' "$*" >&2; }

do_verify() {
	root="$1"
	eng="$(engine_of "$root")"
	say "$root  [$eng]"

	missing=""; unreadable=""; n=0
	for m in $(modules); do
		n=$((n + 1))
		f="$root/js/plugins/$m.js"
		if [ ! -f "$f" ]; then
			missing="$missing $m"
		elif [ ! -r "$f" ]; then
			# A file the game cannot READ is invisible, not broken: existsSync
			# needs only directory permission, so presence, size and checksum
			# all report fine while every read fails and the module silently
			# does not exist.
			unreadable="$unreadable $m"
		fi
	done

	listed=0
	if grep -q "$ANY_BEGIN" "$root/js/plugins.js" 2>/dev/null; then listed=1; fi

	last=1
	if [ "$listed" -eq 1 ]; then
		# Is our block genuinely last? Anything after the END marker that
		# looks like a plugin entry means a game update appended to the file.
		if sed -n "/$(printf '%s' "$END_MARK" | sed 's/[][\.*^$/]/\\&/g')/,\$p" "$root/js/plugins.js" \
			| grep -q '"name"'; then last=0; fi
	fi

	# Anything a killed run left beside plugins.js. It does not stop the game
	# — PluginManager reads plugins.js and nothing else — so nothing would ever
	# have said so, which is exactly why it is said here.
	strays="$(strays_beside "$root/js/plugins.js")"
	nstray=0
	if [ -n "$strays" ]; then nstray="$(printf '%s\n' "$strays" | grep -c .)"; fi

	if [ -n "$missing" ]; then bad "missing:$missing"; fi
	if [ -n "$unreadable" ]; then
		bad "present but NOT READABLE by the game:$unreadable"
		bad "fix: chmod 644 $root/js/plugins/GigaHack_*.js"
	fi
	if [ "$listed" -eq 0 ]; then
		bad "js/plugins.js does not list GigaHack."
		bad "If the game was updated it may have replaced that file — re-run this installer."
	elif [ "$last" -eq 0 ]; then
		bad "GigaHack is listed but NOT LAST in js/plugins.js."
		bad "Plugins after it wrap our hooks and can undo what the menu does. Re-run this installer."
	fi

	if [ "$nstray" -gt 0 ]; then
		step "$nstray leftover file(s) from an interrupted run are sitting in js/ — harmless to the"
		step "game, and removed by:  $0 --uninstall \"$root\"   (or delete them by hand)"
		printf '%s\n' "$strays" | while IFS= read -r f; do [ -n "$f" ] && step "  $f"; done
	fi

	if [ -z "$missing" ] && [ -z "$unreadable" ] && [ "$listed" -eq 1 ] && [ "$last" -eq 1 ]; then
		step "ok — $n modules present and readable, listed last in js/plugins.js"
		return 0
	fi
	return 1
}

do_install() {
	root="$1"; dry="$2"
	eng="$(engine_of "$root")"
	say "$root  [$eng]"

	if [ "$eng" = unknown ]; then
		bad "no js/rpg_core.js or js/rmmz_core.js — this does not look like an MV or MZ game."
		skipped=$((skipped + 1)); return 1
	fi

	pj="$root/js/plugins.js"
	if [ ! -w "$pj" ] || [ ! -w "$root/js/plugins" ]; then
		bad "js/plugins.js or js/plugins/ is not writable."
		bad "A Steam install may need the game folder made writable first, or copy the game elsewhere."
		failed=$((failed + 1)); return 1
	fi

	# 1. Back up the original ONCE, and never overwrite that backup — the
	#    point of it is to hold the file as the game shipped it, and a second
	#    run would otherwise capture our own edit as the "original".
	if [ ! -f "$pj$BACKUP_SUFFIX" ]; then
		if [ "$dry" = 1 ]; then step "would back up js/plugins.js"
		else cp "$pj" "$pj$BACKUP_SUFFIX"; step "backed up js/plugins.js -> plugins.js$BACKUP_SUFFIX"; fi
	else
		step "backup already exists (kept from the first install)"
	fi

	# 2. Copy the modules.
	n=0
	for m in $(modules); do
		src="$PAYLOAD/$m.js"
		if [ ! -f "$src" ]; then
			bad "payload is incomplete: $m.js is missing from $PAYLOAD"
			failed=$((failed + 1)); return 1
		fi
		if [ "$dry" != 1 ]; then
			cp "$src" "$root/js/plugins/$m.js"
			# 644 explicitly. Two modules once shipped mode 600 owned by root;
			# every check passed and every read failed.
			chmod 644 "$root/js/plugins/$m.js"
		fi
		n=$((n + 1))
	done
	step "$([ "$dry" = 1 ] && echo would copy || echo copied) $n modules into js/plugins/"

	# 3. Rewrite plugins.js.
	tmp="$pj.gigahack-tmp$$"
	ent="$pj.gigahack-ent$$"
	strip="$pj.gigahack-strip$$"
	tmp_track "$tmp"; tmp_track "$tmp.err"; tmp_track "$ent"; tmp_track "$strip"
	build_entries > "$ent"
	strip_block "$pj" > "$strip"
	if ! insert_block "$ent" "$strip" > "$tmp" 2>"$tmp.err"; then
		err="$(cat "$tmp.err" 2>/dev/null || true)"
		rm -f "$tmp" "$tmp.err" "$ent" "$strip"
		case "$err" in
			*GIGAHACK_NO_ARRAY*)
				bad "js/plugins.js has no ']' — it is not the array this expects. Left untouched." ;;
			*GIGAHACK_ODD_CHAR*)
				bad "js/plugins.js ends in a shape this installer does not recognise ($err). Left untouched." ;;
			*)  bad "could not rewrite js/plugins.js: $err" ;;
		esac
		bad "Add the GigaHack entries by hand — manifest.json lists them, in order — or restore plugins.js$BACKUP_SUFFIX and report this."
		failed=$((failed + 1)); return 1
	fi
	rm -f "$tmp.err" "$ent" "$strip"

	# 4. Sanity-check the result BEFORE replacing anything. A plugins.js that
	#    does not parse is a red screen on next launch.
	if ! grep -q '\$plugins' "$tmp"; then
		rm -f "$tmp"
		bad "the rewritten js/plugins.js lost its \$plugins declaration. Left untouched."
		failed=$((failed + 1)); return 1
	fi
	got="$(grep -c '"GigaHack_' "$tmp" || true)"
	want="$(modules | grep -c . )"
	if [ "$got" -ne "$want" ]; then
		rm -f "$tmp"
		bad "the rewritten js/plugins.js has $got GigaHack entries, expected $want. Left untouched."
		failed=$((failed + 1)); return 1
	fi

	if [ "$dry" = 1 ]; then
		step "would write js/plugins.js with $want entries appended at the end"
		rm -f "$tmp"
	else
		mv "$tmp" "$pj"
		chmod 644 "$pj"
		step "js/plugins.js updated — $want entries, appended last"
	fi

	if [ "$dry" != 1 ]; then
		do_verify "$root" >/dev/null 2>&1 && step "verified" || { bad "verification failed after install — run --verify for detail"; failed=$((failed + 1)); return 1; }
	fi
	ok=$((ok + 1))
	return 0
}

do_uninstall() {
	root="$1"
	say "$root"
	pj="$root/js/plugins.js"
	n=0
	for m in $(modules); do
		[ -f "$root/js/plugins/$m.js" ] && { rm -f "$root/js/plugins/$m.js"; n=$((n + 1)); }
	done
	step "removed $n module files"

	if [ -f "$pj$BACKUP_SUFFIX" ]; then
		cp "$pj$BACKUP_SUFFIX" "$pj"
		rm -f "$pj$BACKUP_SUFFIX"
		step "js/plugins.js restored from the backup, byte for byte"
	elif grep -q "$ANY_BEGIN" "$pj" 2>/dev/null; then
		# strip_block already removes the separating comma, so there is no
		# second cleanup pass. There was one, and it used a backreference in
		# awk's sub() — awk has no capture groups, so it wrote the literal
		# text "]\1" into plugins.js and the game would not boot.
		tmp="$pj.gigahack-tmp$$"
		tmp_track "$tmp"
		strip_block "$pj" > "$tmp"
		mv "$tmp" "$pj"
		step "GigaHack entries removed from js/plugins.js (no backup was present)"
	else
		step "js/plugins.js had no GigaHack entries"
	fi

	# And anything an interrupted run left behind, which nothing else removes.
	nstray=0
	strays_beside "$pj" | while IFS= read -r f; do [ -n "$f" ] && rm -f "$f"; done
	nstray="$(strays_beside "$pj" | grep -c . || true)"
	if [ "$nstray" -ne 0 ]; then
		bad "$nstray leftover file(s) beside js/plugins.js could not be removed"
	fi
	ok=$((ok + 1))
}

#-----------------------------------------------------------------------------
# Main
#-----------------------------------------------------------------------------
say "GigaHack $VERSION installer"
say ""

roots=""
if [ -n "$TARGETS" ]; then
	# Newline-only IFS for this loop. The default splits on spaces too, so a
	# game folder with a space in its name — which on macOS is most of them —
	# is torn into three targets, each reported as "not a game folder" while
	# the real one is never tried. The user sees three confident refusals and
	# no install.
	SAVED_IFS="$IFS"; IFS='
'
	for t in $TARGETS; do
		[ -n "$t" ] || continue
		if game_root_p "$t"; then
			roots="$roots
$(cd "$t" && pwd)"
		else
			found="$(discover "$t")"
			if [ -n "$found" ]; then roots="$roots
$found"
			else
				bad "$t is not an RPG Maker MV/MZ game folder, and none was found inside it."
				bad "Expected index.html, js/plugins.js and js/plugins/ together."
				skipped=$((skipped + 1))
			fi
		fi
	done
	IFS="$SAVED_IFS"
else
	roots="$(discover ".")
$(discover "..")"
fi

# Dedupe, preserving order.
roots="$(printf '%s\n' "$roots" | awk 'NF && !seen[$0]++')"

if [ -z "$roots" ]; then
	say "No RPG Maker MV/MZ game folder found."
	say ""
	say "Run this from inside the game folder, or pass the path:"
	say "    $0 /path/to/the/game"
	say ""
	say "The game folder is the one holding index.html next to js/."
	say "On macOS that is usually inside the app bundle:"
	say "    YourGame.app/Contents/Resources/app.nw"
	exit 1
fi

printf '%s\n' "$roots" | while IFS= read -r r; do :; done   # no-op; keeps sh happy
OLDIFS="$IFS"; IFS='
'
for root in $roots; do
	[ -n "$root" ] || continue
	case "$MODE" in
		install)   do_install   "$root" 0 || true ;;
		dryrun)    do_install   "$root" 1 || true ;;
		uninstall) do_uninstall "$root"   || true ;;
		verify)    do_verify    "$root" && ok=$((ok + 1)) || failed=$((failed + 1)) ;;
	esac
	say ""
done
IFS="$OLDIFS"

say "$MODE: $ok ok, $failed failed, $skipped skipped"
if [ "$MODE" = install ] && [ "$ok" -gt 0 ]; then
	say ""
	say "Launch the game and press the menu key — the default is derived from"
	say "which keys the game's own plugins have already claimed, and the boot"
	say "log names it. If nothing happens, open the developer console and look"
	say "for lines beginning [GigaHack]."
fi
[ "$failed" -eq 0 ]
