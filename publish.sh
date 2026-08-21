#!/usr/bin/env bash
# Publish GigaHack MV/MZ to GitHub: commit, push, tag, and cut the release.
#
#   ./publish.sh
#   ./publish.sh --fast     skip the browser suite (needs Playwright installed)
#
# Run this from inside this folder, on a machine logged in to GitHub. It does
# not carry any credentials of its own — it uses your git config and your `gh`
# login, so the commit is authored by you.
#
# It is safe to re-run: every step checks whether it has already been done.
set -euo pipefail

REPO="GigaLionF95/GigaHack-MVMZ"
TAG="v2.0.0"
TITLE="GigaHack MV/MZ 2.0.0"

# Arguments are passed straight through to build-release.sh. The only one that
# matters is --fast, which skips the browser suite when Playwright and its
# Chromium are not installed on this machine. Everything else still runs.
BUILD_ARGS="$*"

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()  { printf '\n%s\n' "$*" >&2; exit 1; }

# --- prerequisites ----------------------------------------------------------
command -v git >/dev/null || die "git is not installed."
command -v gh  >/dev/null || die "The GitHub CLI is not installed. See https://cli.github.com — or upload the archives by hand, see the end of this script."
gh auth status >/dev/null 2>&1 || die "Not logged in to GitHub. Run:  gh auth login"

# --- who are we publishing as? ----------------------------------------------
#
# Two separate identities, and getting one right does not get the other right:
#
#   · the account gh is logged in as decides whether the PUSH is allowed and
#     who creates the release
#   · git config user.email decides who GitHub shows as the commit AUTHOR
#
# A repo owned by an alt account will happily reject the push from the main
# one, and — more quietly — accept a push whose commits are attributed to the
# wrong person. Both are checked here, before anything is committed.
OWNER="${REPO%%/*}"
WHO="$(gh api user --jq .login 2>/dev/null || true)"
[ -n "$WHO" ] || die "Could not ask GitHub who you are. Try:  gh auth login"

if [ "$WHO" != "$OWNER" ]; then
	die "gh is logged in as '$WHO', but $REPO belongs to '$OWNER'.

  gh auth switch --user $OWNER     # if $OWNER is already added to gh
  gh auth login                    # otherwise, log in as $OWNER

Then run this script again. (Adding '$WHO' as a collaborator would also let the
push through, but the release would be published under '$WHO' rather than
'$OWNER'.)"
fi

# Make git use gh's credentials for github.com, so the push uses this account.
gh auth setup-git >/dev/null 2>&1 || true

# Commit author. The noreply address is the canonical form and is what GitHub
# matches against the account, so attribution works without publishing a real
# email. Set per-repository — your global identity is left alone.
NOREPLY="$(gh api user --jq .id)+$OWNER@users.noreply.github.com"
if [ "$(git config user.email 2>/dev/null || true)" != "$NOREPLY" ]; then
	git config user.name "$OWNER"
	git config user.email "$NOREPLY"
	echo "commit identity for this repo: $OWNER <$NOREPLY>"
fi

# --- 0. modes -----------------------------------------------------------------
#
# Restore the executable bit on every entry point before anything else.
#
# This is not a convenience. Git stores the executable bit, so committing a
# tree whose bits were stripped in transit — by a file-sync mount, a zip round
# trip, a Windows checkout — publishes an install-macos.command that does
# nothing when double-clicked, and there is no error to notice. The scripts
# below are invoked through `bash` for the same reason: so this script works
# even on the run where the bit is still missing.
step "Making sure the entry points are executable"
chmod +x publish.sh build-release.sh test-installers.sh \
         install/gigahack-install.sh \
         install/gigahack-install.command 2>/dev/null || true
# .bat and .ps1 are launched by Windows, which has no executable bit; carrying
# one only makes the diff noisy.
chmod -x install/gigahack-install.bat install/gigahack-install.ps1 2>/dev/null || true
git update-index --refresh >/dev/null 2>&1 || true

# --- 1. build and verify the archives ---------------------------------------
#
# Built here rather than committed: dist/ is reproducible, and an archive in
# git that does not match the source it claims to come from is worse than no
# archive at all.
step "Building the release archives"
bash ./build-release.sh $BUILD_ARGS

VER="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' gigahack/manifest.json | head -1)"
[ "v$VER" = "$TAG" ] || die "gigahack/manifest.json says $VER but this script is set to publish $TAG. Fix one of them."

# The version is also baked into GigaHack_Core.js and into the installers'
# marker comments. If they drift, an install writes markers a later version
# cannot find, and the reinstall duplicates its block instead of replacing it.
CORE_VER="$(sed -n "s/.*\$\.version *= *'\([^']*\)'.*/\1/p" gigahack/js/plugins/GigaHack_Core.js | head -1)"
[ "$CORE_VER" = "$VER" ] || die "GigaHack_Core.js says $CORE_VER but the manifest says $VER."
INST_VER="$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' install/gigahack-install.sh | head -1)"
[ "$INST_VER" = "$VER" ] || die "the installer says $INST_VER but the manifest says $VER."
PS_VER="$(sed -n "s/^\\\$Version *= *'\([^']*\)'.*/\1/p" install/gigahack-install.ps1 | head -1)"
[ "$PS_VER" = "$VER" ] || die "the PowerShell installer says $PS_VER but the manifest says $VER."

# --- 2. commit --------------------------------------------------------------
step "Committing"
git add -A
if git diff --cached --quiet; then
    echo "Nothing to commit — the tree already matches HEAD."
else
    git commit -m "GigaHack MV/MZ $VER

A mod menu for any RPG Maker MV or MZ game. 26 modules, six tabs, an engine
capability table, a per-game profile system, a boot index, and a plugin
compatibility layer that names what is degrading a control and why.

1131 checks across stock MZ, stock MV and MV with a modelled third-party
plugin stack, plus 122 installer checks and a build lint. Verified live
against two real games."
fi

# A commit made by an earlier run under the wrong identity is still local — the
# push is what failed — so re-author it rather than leaving the wrong name on
# the release commit forever.
if git log -1 --format=%s 2>/dev/null | grep -q '^GigaHack ' &&
   [ "$(git log -1 --format=%ae)" != "$NOREPLY" ]; then
	git commit --amend --reset-author --no-edit
	echo "re-authored the existing commit as $OWNER"
fi

# --- 3. push ----------------------------------------------------------------
step "Pushing to $REPO"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
git push -u origin "$BRANCH"

# --- 4. tag -----------------------------------------------------------------
step "Tagging $TAG"
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Tag $TAG already exists locally."
else
    git tag -a "$TAG" -m "$TITLE"
fi
git push origin "$TAG"

# --- 5. release -------------------------------------------------------------
step "Creating the release"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    echo "Release $TAG already exists — uploading the archives to it instead."
    gh release upload "$TAG" \
        dist/GigaHack-MVMZ-"$VER".zip \
        dist/GigaHack-MVMZ-"$VER".tar.gz \
        dist/GigaHack-MVMZ-"$VER"-source.tar.gz \
        dist/SHA256SUMS \
        --repo "$REPO" --clobber
else
    gh release create "$TAG" \
        dist/GigaHack-MVMZ-"$VER".zip \
        dist/GigaHack-MVMZ-"$VER".tar.gz \
        dist/GigaHack-MVMZ-"$VER"-source.tar.gz \
        dist/SHA256SUMS \
        --repo "$REPO" \
        --title "$TITLE" \
        --notes-file RELEASE-NOTES.md
fi

printf '\n\033[1mDone.\033[0m\n'
echo "  https://github.com/$REPO"
echo "  https://github.com/$REPO/releases/tag/$TAG"
echo
echo "If you would rather attach the archives by hand, they are in dist/:"
ls -1 dist/ | sed 's/^/    /'
