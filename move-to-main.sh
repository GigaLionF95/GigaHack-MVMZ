#!/usr/bin/env bash
#=============================================================================
# Rename this repository's default branch from master to main.
#-----------------------------------------------------------------------------
#   ./move-to-main.sh              rename the branch
#   ./move-to-main.sh --fix-message  also correct the release commit's message
#   ./move-to-main.sh --dry-run    show what would happen, change nothing
#
# The branch rename by itself is safe and reversible: it renames the local
# branch, pushes it, points GitHub's default at it, and deletes the old remote
# branch. No commit is rewritten, so the v2.0.0 tag and the GitHub release keep
# pointing at exactly the object they already point at.
#
# --fix-message is a different kind of operation and is opt-in for that reason.
# See the warning it prints.
#
# Run this once. Afterwards, publish.sh pushes whatever branch you are on, so
# nothing recreates master.
#=============================================================================
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

OLD="master"
NEW="main"
FIX_MESSAGE=0
DRY=0

for a in "$@"; do
	case "$a" in
		--fix-message) FIX_MESSAGE=1 ;;
		--dry-run)     DRY=1 ;;
		-h|--help)     sed -n '3,20p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
		*) echo "unknown option: $a" >&2; exit 1 ;;
	esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then printf '   would run: %s\n' "$*"; else "$@"; fi; }
die()  { printf '\n%s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is not installed."
command -v gh  >/dev/null || die "The GitHub CLI is not installed. See https://cli.github.com"
gh auth status >/dev/null 2>&1 || die "Not logged in to GitHub. Run:  gh auth login"

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
[ -n "$REPO" ] || die "Could not work out which GitHub repository this is."
OWNER="${REPO%%/*}"
WHO="$(gh api user --jq .login)"
[ "$WHO" = "$OWNER" ] || die "gh is logged in as '$WHO' but $REPO belongs to '$OWNER'.
Run:  gh auth switch --user $OWNER"

CURRENT="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT" = "$NEW" ]; then
	echo "Already on $NEW."
elif [ "$CURRENT" != "$OLD" ]; then
	die "On branch '$CURRENT', expected '$OLD'. Switch to it first, or edit OLD in this script."
fi

# Only STAGED changes are a hazard. `git commit --amend -m` stages nothing new,
# so untracked files and unstaged edits cannot be swept into the release
# commit — and refusing on those would refuse on this very script, which is
# untracked the first time anyone runs it.
if [ "$FIX_MESSAGE" = 1 ] && ! git diff --cached --quiet; then
	git diff --cached --stat | head -10
	die "There are staged changes, and --fix-message amends the last commit.
Commit or unstage them first, or they will be folded into the release commit."
fi

say "Repository"
echo "  $REPO"
echo "  branch:  $CURRENT"
echo "  HEAD:    $(git rev-parse --short HEAD)  $(git log -1 --format=%s)"
echo "  tags:    $(git tag -l | tr '\n' ' ')"

#-----------------------------------------------------------------------------
if [ "$FIX_MESSAGE" = 1 ]; then
	say "Correcting the release commit message"
	cat <<'WARN'
  This REWRITES the commit that is already pushed. It is safe here only
  because this repository is new, has one commit on it, and nobody else has
  cloned it. If either of those has stopped being true, stop now.

  Two consequences worth knowing before you say yes:

    - the commit gets a new hash, so the push has to be forced
    - the v2.0.0 tag points at the OLD commit object, so it has to be moved
      and force-pushed too, and the GitHub release re-pointed with it

WARN
	printf '  Type "yes" to continue: '
	read -r ans
	[ "$ans" = "yes" ] || die "Left the commit message alone."

	VER="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' gigahack/manifest.json | head -1)"
	MSG="GigaHack MV/MZ $VER

A mod menu for any RPG Maker MV or MZ game. 26 modules, six tabs, an engine
capability table, a per-game profile system, a boot index, and a plugin
compatibility layer that names what is degrading a control and why.

1131 checks across stock MZ, stock MV and MV with a modelled third-party
plugin stack, plus 122 installer checks and a build lint. Verified live
against two real games."
	run git commit --amend -m "$MSG"
	echo "  amended to $(git rev-parse --short HEAD)"
fi

#-----------------------------------------------------------------------------
say "Renaming the local branch"
if [ "$CURRENT" = "$OLD" ]; then
	run git branch -m "$OLD" "$NEW"
	echo "  $OLD -> $NEW"
fi

# Fetch before pushing. A lease can only be taken on a ref git has already
# SEEN, and $NEW very often exists on the remote without existing locally:
# GitHub creates every new repository with a `main` branch, so pushing
# `master` to it leaves both, and nothing ever fetched origin/main. Then
# --force-with-lease refuses with
#
#     ! [rejected]  main -> main (stale info)
#
# which reads like a conflict and is really just git saying it has no idea
# what it would be overwriting. One fetch gives it one.
say "Fetching, so the push knows what is already there"
run git fetch origin

say "Pushing $NEW"
if git ls-remote --exit-code --heads origin "$NEW" >/dev/null 2>&1; then
	# $NEW already exists on the remote — GitHub's initial branch, or a
	# previous run of this script. Report what is about to be overwritten,
	# because "main already exists" is a thing worth knowing BEFORE it stops
	# existing in its old form.
	if [ "$(git rev-parse "origin/$NEW" 2>/dev/null || true)" != "$(git rev-parse HEAD)" ]; then
		echo "  origin/$NEW already exists at $(git rev-parse --short "origin/$NEW" 2>/dev/null || echo '?')"
		echo "  and is about to be replaced by $(git rev-parse --short HEAD)."
		if ! git merge-base --is-ancestor "origin/$NEW" HEAD 2>/dev/null; then
			echo "  Its commits are NOT in your history — GitHub's initial commit, most likely."
		fi
	fi
	run git push --force-with-lease -u origin "$NEW"
else
	# Genuinely new: nothing is being overwritten, so no force of any kind.
	run git push -u origin "$NEW"
fi

say "Pointing GitHub's default branch at $NEW"
if ! run gh repo edit "$REPO" --default-branch "$NEW"; then
	die "Could not change the default branch. $NEW is pushed and $OLD is untouched,
so nothing is broken — set the default by hand at
    https://github.com/$REPO/settings
and then re-run this script to clean up $OLD."
fi

say "Deleting the old remote branch"
# Ordered after the default has moved, because GitHub refuses to delete a
# default branch. Everything from here is cleanup: the rename has already
# succeeded, so a failure must NOT abort with a bare non-zero exit and leave
# the reader guessing which half happened.
if [ "$DRY" = 1 ]; then
	printf '   would run: git push origin --delete %s\n' "$OLD"
elif ! git ls-remote --exit-code --heads origin "$OLD" >/dev/null 2>&1; then
	echo "  origin/$OLD is already gone"
else
	# Confirm the default really moved before trying. gh can report success
	# while the change is still settling, and the delete then fails for a
	# reason that has nothing to do with the delete.
	DEFAULT="$(gh repo view "$REPO" --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null || true)"
	if [ "$DEFAULT" != "$NEW" ]; then
		echo "  GitHub still reports '$DEFAULT' as the default, so $OLD cannot be deleted yet."
		echo "  Nothing is broken — $NEW is pushed and carries the same commits. Re-run"
		echo "  this script in a moment to finish the cleanup."
	elif git push origin --delete "$OLD" 2>/dev/null; then
		git branch -dr "origin/$OLD" 2>/dev/null || true
		echo "  origin/$OLD deleted"
	else
		echo "  Could not delete origin/$OLD. $NEW is pushed and is the default, so"
		echo "  this is cosmetic — delete the old branch at"
		echo "      https://github.com/$REPO/branches"
	fi
fi

#-----------------------------------------------------------------------------
if [ "$FIX_MESSAGE" = 1 ]; then
	say "Moving the tag onto the amended commit"
	TAG="$(git tag -l | grep -E '^v[0-9]' | tail -1)"
	if [ -n "$TAG" ]; then
		run git tag -f -a "$TAG" -m "GigaHack MV/MZ ${TAG#v}"
		run git push --force origin "$TAG"
		echo "  $TAG now points at $(git rev-parse --short HEAD)"
		echo
		echo "  The GitHub release for $TAG follows the tag, so it is already"
		echo "  pointing at the new commit. Check it looks right:"
		echo "      gh release view $TAG --repo $REPO"
	else
		echo "  no version tag found — nothing to move"
	fi
fi

#-----------------------------------------------------------------------------
say "Done"
echo "  https://github.com/$REPO"
echo "  default branch: $NEW"
if [ "$DRY" = 1 ]; then
	echo
	echo "  (--dry-run: nothing above was actually done)"
fi
