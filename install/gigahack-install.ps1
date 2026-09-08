<#
=============================================================================
 GigaHack MV/MZ — installer (Windows)
-----------------------------------------------------------------------------
 Usage:
   .\gigahack-install.ps1 [-Path <game folder>] [-Uninstall] [-Verify] [-DryRun]

 With no -Path, every RPG Maker MV/MZ game under the current folder and its
 parent is offered. Discovery, not a hardcoded list: a hardcoded list is wrong
 the moment a copy of the game exists that is not on it, and that failure has
 no symptom — the installer reports success for the folders it knows about
 while the copy actually being played keeps whatever it had.

 WHAT THIS TOUCHES
   <root>\js\plugins\GigaHack_*.js         copied in (new files, ours)
   <root>\js\plugins.js                    26 entries appended between markers
   <root>\js\plugins.js.gigahack-backup    the original, kept forever

 Nothing else is written, ever. -Uninstall restores the file byte for byte.

 WHY IT APPENDS RATHER THAN PREPENDS
   Every GigaHack alias must be outermost, or a plugin loading later wraps
   ours and can intercept or undo what we do. Being last in plugins.js is what
   guarantees that. The mod re-checks at runtime and says so when a game
   update has changed it.
=============================================================================
#>
[CmdletBinding()]
param(
    [string[]] $Path,
    [switch] $Uninstall,
    [switch] $Verify,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
$Version      = '2.2.0'
$BeginMark    = "// >>> GigaHack $Version BEGIN - installed automatically; edit at your own risk"
$AnyBegin     = '// >>> GigaHack'
$EndMark      = '// <<< GigaHack END'
$BackupSuffix = '.gigahack-backup'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find the payload by MANIFEST, never by the presence of js\plugins.
#
# Every RPG Maker game has a js\plugins folder, so testing for one cannot tell
# "the GigaHack release folder" from "the game the user dropped this script
# into". It used to, and the consequence was worse than a wrong guess: on a
# flat-layout game the installer adopted the GAME's own plugins folder as its
# payload, backed up plugins.js — actually modifying the game — and only then
# failed on the missing manifest, leaving a stray backup behind.
#
# manifest.json sitting next to js\plugins\GigaHack_Core.js is unambiguous.
# Both are required, so a half-copied folder is caught here rather than
# halfway through an install.
function Test-Payload ($dir) {
    if (-not $dir) { return $false }
    return (Test-Path (Join-Path $dir 'manifest.json')) -and
           (Test-Path (Join-Path $dir 'js\plugins\GigaHack_Core.js'))
}

$Payload = $null; $Manifest = $null
foreach ($cand in @(
    $Here,                                  # the release folder, script beside the payload
    (Join-Path $Here '..'),                 # one level up
    (Join-Path $Here 'gigahack'),           # a source checkout, run from the repo root
    (Join-Path $Here '..\gigahack')         # a source checkout, run from install\
)) {
    if (Test-Payload $cand) {
        $root     = (Resolve-Path $cand).Path
        $Payload  = Join-Path $root 'js\plugins'
        $Manifest = Join-Path $root 'manifest.json'
        break
    }
}

if (-not $Payload) {
    Write-Host ''
    Write-Host 'The GigaHack files are not next to this installer.'
    Write-Host ''
    Write-Host "  This script is in:  $Here"
    Write-Host '  It needs manifest.json and js\plugins\GigaHack_Core.js beside it.'
    Write-Host ''

    # The specific mistake, named. Anyone who lands here has almost certainly
    # copied the installer INTO their game, which is the one place it must not
    # be — the installer has to keep its own files to copy FROM.
    $looksLikeGame = (Test-Path (Join-Path $Here 'index.html')) -or
                     (Test-Path (Join-Path $Here 'js\plugins.js')) -or
                     (Test-Path (Join-Path $Here 'www\index.html'))
    if ($looksLikeGame) {
        Write-Host '  This folder looks like the GAME, not the GigaHack folder.'
        Write-Host '  The installer does not go inside the game. Leave it in the folder'
        Write-Host '  you unzipped, and run it from there — it will find this game on its'
        Write-Host '  own, or you can point it straight at one:'
        Write-Host ''
        Write-Host "      .\gigahack-install.ps1 -Path `"$Here`""
        Write-Host ''
    }

    Write-Host '  The unzipped folder should contain:'
    Write-Host ''
    Write-Host "      GigaHack-$Version\"
    Write-Host '        manifest.json'
    Write-Host '        js\plugins\GigaHack_Core.js   (and the rest)'
    Write-Host '        profiles\'
    Write-Host '        gigahack-install.bat'
    Write-Host '        gigahack-install.ps1'
    Write-Host ''
    Write-Host '  If those are missing, the zip did not unpack fully — some tools extract'
    Write-Host '  only the top-level files. Unzip it again with Windows Explorer or 7-Zip.'
    Write-Host ''
    exit 1
}

$script:Ok = 0; $script:Failed = 0; $script:Skipped = 0
function Say  ($m) { Write-Host $m }
function Step ($m) { Write-Host "  $m" }
function Bad  ($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

#-----------------------------------------------------------------------------
# Module list — read from the manifest so the installer and the mod can never
# disagree about what a complete install is. Load order is significant, so a
# missing manifest is a refusal, not a guess: alphabetical order would load
# Boot before Core and nothing would work.
#-----------------------------------------------------------------------------
function Get-Modules {
    if (-not (Test-Path $Manifest)) {
        Write-Error "$Manifest is missing and load order cannot be guessed."
        exit 1
    }
    $json = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json
    return @($json.modules | ForEach-Object { $_.name })
}

#-----------------------------------------------------------------------------
# Discovery
#-----------------------------------------------------------------------------
function Test-GameRoot ($dir) {
    return (Test-Path (Join-Path $dir 'index.html')) -and
           (Test-Path (Join-Path $dir 'js\plugins.js')) -and
           (Test-Path (Join-Path $dir 'js\plugins') -PathType Container)
}

function Get-Engine ($dir) {
    if (Test-Path (Join-Path $dir 'js\rmmz_core.js')) { return 'MZ' }
    if (Test-Path (Join-Path $dir 'js\rpg_core.js'))  { return 'MV' }
    return 'unknown'
}

function Find-Games ($base) {
    $out = New-Object System.Collections.Generic.List[string]
    $candidates = @($base)
    Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $candidates += $_.FullName
        $candidates += (Join-Path $_.FullName 'www')
    }
    $candidates += (Join-Path $base 'www')
    foreach ($c in $candidates) {
        if ((Test-Path $c -PathType Container) -and (Test-GameRoot $c)) {
            $full = (Resolve-Path $c).Path
            if (-not $out.Contains($full)) { $out.Add($full) }
        }
    }
    return $out
}

#-----------------------------------------------------------------------------
# plugins.js surgery
#
# The file is `var $plugins = [ {...}, {...} ];`. It is not parsed as
# JavaScript — a game may have reformatted or minified it, and a parser that
# is wrong about one game is worse than no parser. Instead: strip any previous
# GigaHack block, find the LAST ']' (which closes the array on every real
# plugins.js whatever the formatting), look at the last significant character
# before it to decide whether a separating comma is needed, and insert there.
#-----------------------------------------------------------------------------
function Remove-Block ($text) {
    # Removes the block AND the separating comma in front of it. Dropping the
    # comma is not tidiness: `[{"A"},,{"B"}]` is a legal array literal with a
    # HOLE in it, PluginManager reads plugin.name off the undefined slot and
    # throws during boot - a red screen, from a file that looks fine in a diff.
    #
    # This also normalises CRLF to LF across the whole file. JavaScript does
    # not care, and preserving them would mean detecting and reapplying the
    # original ending per line for no benefit. The shell installer preserves
    # them; this one does not, and that is the only behavioural difference
    # between the two.
    $lines = $text -split "`r?`n", 0
    $out = New-Object System.Collections.Generic.List[string]
    $inBlock = $false
    $prev = $null
    foreach ($line in $lines) {
        if ($line -match '^//\s*>>>\s*GigaHack') {
            if ($null -ne $prev) {
                # The comma may be on its own line (formatted) or at the end of
                # the preceding line (minified).
                $prev = $prev -replace ',[ \t\r]*$', ''
                if ($prev -match '^[ \t\r]*$') { $prev = $null }
            }
            $inBlock = $true
            continue
        }
        if ($inBlock) {
            if ($line -match '^//\s*<<<\s*GigaHack END') { $inBlock = $false }
            continue
        }
        if ($null -ne $prev) { $out.Add($prev) }
        $prev = $line
    }
    if ($null -ne $prev) { $out.Add($prev) }
    return ($out -join "`n")
}

function New-Entries {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine($BeginMark)
    $mods = Get-Modules
    for ($i = 0; $i -lt $mods.Count; $i++) {
        $line = '{"name":"' + $mods[$i] + '","status":true,"description":"GigaHack ' + $Version + '","parameters":{}}'
        if ($i -lt $mods.Count - 1) { $line += ',' }
        [void]$sb.AppendLine($line)
    }
    [void]$sb.Append($EndMark)
    return $sb.ToString()
}

function Add-Block ($text, $entries) {
    $pos = $text.LastIndexOf(']')
    if ($pos -lt 0) { throw 'NO_ARRAY' }
    $head = $text.Substring(0, $pos)
    $tail = $text.Substring($pos)

    $sep = $null
    for ($i = $head.Length - 1; $i -ge 0; $i--) {
        $c = $head[$i]
        if ($c -eq ' ' -or $c -eq "`t" -or $c -eq "`n" -or $c -eq "`r") { continue }
        if     ($c -eq '}') { $sep = ",`n" }   # a plugin precedes us
        elseif ($c -eq ',') { $sep = "`n" }    # trailing comma already there
        elseif ($c -eq '[') { $sep = "`n" }    # empty array
        else { throw "ODD_CHAR:$c" }
        break
    }
    if ($null -eq $sep) { throw 'NO_ARRAY' }
    # The newline before $tail is load-bearing: the END marker is a line
    # comment, so without it the closing "];" lands on the commented line and
    # the whole array disappears.
    return $head + $sep + $entries + "`n" + $tail
}

#-----------------------------------------------------------------------------
# Operations
#-----------------------------------------------------------------------------
function Invoke-Verify ($root, $quiet) {
    $eng = Get-Engine $root
    if (-not $quiet) { Say "$root  [$eng]" }
    $mods = Get-Modules
    $missing = @(); $n = 0
    foreach ($m in $mods) {
        $n++
        $f = Join-Path $root "js\plugins\$m.js"
        if (-not (Test-Path $f)) { $missing += $m; continue }
        try { [void][System.IO.File]::ReadAllBytes($f) }
        catch {
            # A file the game cannot READ is invisible, not broken: an
            # existence check needs only directory permission, so presence,
            # size and checksum all report fine while every read fails.
            Bad "present but NOT READABLE by the game: $m"
            $missing += $m
        }
    }
    $pj = Join-Path $root 'js\plugins.js'
    $text = Get-Content -Raw -Encoding UTF8 $pj
    $listed = $text.Contains($AnyBegin)
    $last = $true
    if ($listed) {
        $after = $text.Substring($text.IndexOf($EndMark) + $EndMark.Length)
        if ($after -match '"name"') { $last = $false }
    }
    if ($missing.Count) { Bad ("missing or unreadable: " + ($missing -join ', ')) }
    if (-not $listed) {
        Bad 'js\plugins.js does not list GigaHack.'
        Bad 'If the game was updated it may have replaced that file - re-run this installer.'
    } elseif (-not $last) {
        Bad 'GigaHack is listed but NOT LAST in js\plugins.js.'
        Bad 'Plugins after it wrap our hooks and can undo what the menu does. Re-run this installer.'
    }
    if (-not $missing.Count -and $listed -and $last) {
        if (-not $quiet) { Step "ok - $n modules present and readable, listed last in js\plugins.js" }
        return $true
    }
    return $false
}

function Invoke-Install ($root, $dry) {
    $eng = Get-Engine $root
    Say "$root  [$eng]"
    if ($eng -eq 'unknown') {
        Bad 'no js\rpg_core.js or js\rmmz_core.js - this does not look like an MV or MZ game.'
        $script:Skipped++; return
    }
    $pj = Join-Path $root 'js\plugins.js'
    $pluginsDir = Join-Path $root 'js\plugins'

    try { $probe = Join-Path $pluginsDir '.gigahack-write-probe'
          [System.IO.File]::WriteAllText($probe, 'ok'); Remove-Item $probe -Force }
    catch {
        Bad 'js\plugins\ is not writable.'
        Bad 'A Steam install may need the game folder made writable first, or copy the game elsewhere.'
        $script:Failed++; return
    }

    # Back up the original ONCE, and never overwrite that backup - the point of
    # it is to hold the file as the game shipped it, and a second run would
    # otherwise capture our own edit as the "original".
    $backup = $pj + $BackupSuffix
    if (-not (Test-Path $backup)) {
        if ($dry) { Step 'would back up js\plugins.js' }
        else { Copy-Item $pj $backup -Force; Step "backed up js\plugins.js -> plugins.js$BackupSuffix" }
    } else { Step 'backup already exists (kept from the first install)' }

    $mods = Get-Modules
    foreach ($m in $mods) {
        $src = Join-Path $Payload "$m.js"
        if (-not (Test-Path $src)) { Bad "payload is incomplete: $m.js is missing from $Payload"; $script:Failed++; return }
        if (-not $dry) { Copy-Item $src (Join-Path $pluginsDir "$m.js") -Force }
    }
    Step (($(if ($dry) {'would copy'} else {'copied'})) + " $($mods.Count) modules into js\plugins\")

    $text = Get-Content -Raw -Encoding UTF8 $pj
    try { $new = Add-Block (Remove-Block $text) (New-Entries) }
    catch {
        switch -Wildcard ($_.Exception.Message) {
            '*NO_ARRAY*'  { Bad 'js\plugins.js has no "]" - it is not the array this expects. Left untouched.' }
            '*ODD_CHAR*'  { Bad "js\plugins.js ends in a shape this installer does not recognise ($($_.Exception.Message)). Left untouched." }
            default       { Bad "could not rewrite js\plugins.js: $($_.Exception.Message)" }
        }
        Bad "Add the entries by hand, or restore plugins.js$BackupSuffix and report this."
        $script:Failed++; return
    }

    # Sanity-check BEFORE replacing anything. A plugins.js that does not parse
    # is a red screen on next launch.
    $got = ([regex]::Matches($new, '"GigaHack_')).Count
    if (-not $new.Contains('$plugins')) { Bad 'the rewritten js\plugins.js lost its $plugins declaration. Left untouched.'; $script:Failed++; return }
    if ($got -ne $mods.Count) { Bad "the rewritten js\plugins.js has $got GigaHack entries, expected $($mods.Count). Left untouched."; $script:Failed++; return }

    if ($dry) { Step "would write js\plugins.js with $($mods.Count) entries appended at the end" }
    else {
        # UTF-8 with no BOM. A BOM before `var $plugins` is a parse error in
        # some NW.js builds, and the file looks perfectly normal in an editor.
        [System.IO.File]::WriteAllText($pj, $new, (New-Object System.Text.UTF8Encoding $false))
        Step "js\plugins.js updated - $($mods.Count) entries, appended last"
        if (Invoke-Verify $root $true) { Step 'verified' }
        else { Bad 'verification failed after install - run with -Verify for detail'; $script:Failed++; return }
    }
    $script:Ok++
}

function Invoke-Uninstall ($root) {
    Say $root
    $pj = Join-Path $root 'js\plugins.js'
    $mods = Get-Modules
    $n = 0
    foreach ($m in $mods) {
        $f = Join-Path $root "js\plugins\$m.js"
        if (Test-Path $f) { Remove-Item $f -Force; $n++ }
    }
    Step "removed $n module files"
    $backup = $pj + $BackupSuffix
    if (Test-Path $backup) {
        Copy-Item $backup $pj -Force; Remove-Item $backup -Force
        Step 'js\plugins.js restored from the backup, byte for byte'
    } else {
        $text = Get-Content -Raw -Encoding UTF8 $pj
        if ($text.Contains($AnyBegin)) {
            [System.IO.File]::WriteAllText($pj, (Remove-Block $text), (New-Object System.Text.UTF8Encoding $false))
            Step 'GigaHack entries removed from js\plugins.js (no backup was present)'
        } else { Step 'js\plugins.js had no GigaHack entries' }
    }
    $script:Ok++
}

#-----------------------------------------------------------------------------
# Main
#-----------------------------------------------------------------------------
Say "GigaHack $Version installer"
Say ''

$roots = New-Object System.Collections.Generic.List[string]
if ($Path) {
    foreach ($p in $Path) {
        if (-not (Test-Path $p -PathType Container)) { Bad "$p does not exist."; $script:Skipped++; continue }
        if (Test-GameRoot $p) { $roots.Add((Resolve-Path $p).Path) }
        else {
            $found = Find-Games (Resolve-Path $p).Path
            if ($found.Count) { $found | ForEach-Object { $roots.Add($_) } }
            else {
                Bad "$p is not an RPG Maker MV/MZ game folder, and none was found inside it."
                Bad 'Expected index.html, js\plugins.js and js\plugins\ together.'
                $script:Skipped++
            }
        }
    }
} else {
    (Find-Games (Get-Location).Path)        | ForEach-Object { if (-not $roots.Contains($_)) { $roots.Add($_) } }
    $parent = Split-Path -Parent (Get-Location).Path
    if ($parent) {
        (Find-Games $parent) | ForEach-Object { if (-not $roots.Contains($_)) { $roots.Add($_) } }
    }
}

if (-not $roots.Count) {
    Say 'No RPG Maker MV/MZ game folder found.'
    Say ''
    Say 'Run this from inside the game folder, or pass the path:'
    Say '    .\gigahack-install.ps1 -Path "C:\Games\YourGame"'
    Say ''
    Say 'The game folder is the one holding index.html next to js\.'
    exit 1
}

foreach ($root in $roots) {
    if     ($Uninstall) { Invoke-Uninstall $root }
    elseif ($Verify)    { if (Invoke-Verify $root) { $script:Ok++ } else { $script:Failed++ } }
    else                { Invoke-Install $root ([bool]$DryRun) }
    Say ''
}

$mode = if ($Uninstall) {'uninstall'} elseif ($Verify) {'verify'} elseif ($DryRun) {'dry run'} else {'install'}
Say "$($mode): $script:Ok ok, $script:Failed failed, $script:Skipped skipped"
if (-not $Uninstall -and -not $Verify -and -not $DryRun -and $script:Ok -gt 0) {
    Say ''
    Say 'Launch the game and press the menu key - the default is derived from'
    Say "which keys the game's own plugins have already claimed, and the boot"
    Say 'log names it. If nothing happens, open the developer console and look'
    Say 'for lines beginning [GigaHack].'
}
if ($script:Failed -gt 0) { exit 1 }
