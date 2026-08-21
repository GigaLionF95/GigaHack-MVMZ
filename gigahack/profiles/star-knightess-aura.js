//=============================================================================
// GigaHack MV/MZ — game profile: Star Knightess Aura
//-----------------------------------------------------------------------------
// A profile is never required. GigaHack runs on this game with nothing here at
// all: it will compute the Forge id bases from the database, detect the "--"
// section convention, and derive its hotkeys from Input.keyMapper. What this
// file adds is the knowledge the engine cannot supply — which of 1400
// variables a player actually cares about, that the game has a Steam app id,
// and how to reach two features its own plugins provide.
//
// Everything here is optional and independently so. Delete any field and the
// computed default takes over.
//
// To install: drop this file in js/plugins/ and add an entry for it in
// js/plugins.js AFTER GigaHack_Profile and BEFORE GigaHack_Boot. The installer
// does not add profiles automatically — a profile is a claim about a specific
// game, and installing one on the wrong game would be worse than having none.
//=============================================================================

/*:
 * @target MZ
 * @plugindesc GigaHack profile — Star Knightess Aura
 * @author gigahack
 * @help GigaHack_Profile_SKA.js — requires GigaHack_Profile
 */

(function ($) {
    'use strict';
    if (!$ || !$.profile) {
        console.error('[GigaHack] profile system missing — the Star Knightess profile was not registered');
        return;
    }

    $.profile.register({
        id: 'ska',
        name: 'Star Knightess Aura',

        /* -----------------------------------------------------------------
           Matching.

           Title first, because it is the thing the player would recognise and
           the thing a translation patch is least likely to change beyond
           recognition. The database shape is a secondary signal, so a
           retitled build still matches: this game has 1400 variables and 1100
           switches, which together are distinctive enough.

           Deliberately NOT matched on: the version string, the plugin list,
           or a file checksum. All three change with every patch, and a profile
           that stops matching after an update fails silently — the player just
           sees the pinned variables quietly disappear.
           -------------------------------------------------------------- */
        match: function (ctx) {
            if (ctx.title && /star\s*knightess/i.test(ctx.title)) return true;
            if (ctx.engine !== 'MZ') return false;
            var c = ctx.counts;
            return c.variables === 1401 && c.switches === 1101 && c.items === 701;
        },

        /* -----------------------------------------------------------------
           Quick-access variables.

           Resolved by NAME, never by id. A game patch that shifts ids then
           degrades to "not found" — which the panel says out loud — instead
           of confidently editing the wrong variable, which is the failure a
           cheat menu can least afford.
           -------------------------------------------------------------- */
        quickVarsTitle: 'Aura',
        quickVars: [
            'corruption', 'maxCorruption', 'corruptionSpeed',
            'willpower', 'maxWillpower', 'willpowerBonus',
            'lewdness', 'vice', 'promise',
            'day', 'timeSlot', 'dayCorruption',
            'gainedLevels', 'enhancementLevel', 'weaponLevel',
            'glassesCorruption', 'costume', 'mentalChanges', 'killedBosses'
        ],

        /* -----------------------------------------------------------------
           Forge id bases.

           Omitted on purpose. The computed defaults land on 1001 for most
           kinds and 2001 for skills — which is exactly what 1.x hardcoded
           after reading this game's data files by hand. Pinning them here
           would freeze today's numbers against a future patch that adds
           content, which is the failure the computation exists to avoid.
           -------------------------------------------------------------- */

        /* -----------------------------------------------------------------
           Section headers.

           Also omitted. This game uses the "-- Title" convention and the
           detector finds it. Stating it here would only matter if detection
           were wrong, and if detection is wrong on this game it is wrong on
           many, which is a bug to fix rather than paper over per game.
           -------------------------------------------------------------- */

        /* -----------------------------------------------------------------
           Gallery filter.

           The switch tables mix player-facing unlocks with the game's own
           state machine (event chains, control flags). Without a filter the
           panel offers all of it, which is honest but not useful. This is the
           vocabulary that separates the two HERE; it is English and
           genre-specific, which is exactly why it belongs in a profile and
           not in the module.
           -------------------------------------------------------------- */
        galleryFilter: /unlock|scene|gallery|recollect|achievement|ending|epilogue|quest|location|tutorial/i,

        /* -----------------------------------------------------------------
           Steam.

           The app id is the one linked from the game's own title menu. The
           achievements are NOT listed: the Steam module enumerates them from
           the platform API, and falls back to scanning event commands. Both
           are better than a table, because both stay correct when the game
           adds an achievement.

           The stats below cannot be discovered — they are integers the game's
           own script accumulates toward an unlock, and nothing in the data
           files says which threshold belongs to which achievement.
           -------------------------------------------------------------- */
        steamAppId: 1827650,
        steamStats: [
            { id: 'ROPE_SOLD',        goal: 50,    of: 'THIS_WORTHLESS' },
            { id: 'SLIME_DAMAGE',     goal: 9999,  of: 'MIGHTY_AURO' },
            { id: 'ENEMIES_AMBUSHED', goal: 50,    of: 'BACKDOOR_ENTRY' },
            { id: 'MONEY_GAINED',     goal: 50000, of: 'GOLD_HOARDER' }
        ],

        /* -----------------------------------------------------------------
           Adapters.

           Each teaches GigaHack about one feature this game's own plugins
           provide. Every one feature-detects and returns false when the
           plugin is absent, so a build of the game without it does not get a
           panel that cannot work.
           -------------------------------------------------------------- */
        adapters: {

            /* The message backlog. Game_Message is core; the backlog is not —
               it is a plugin keeping its own array on Game_System. */
            backlog: {
                available: function () {
                    return typeof $gameSystem !== 'undefined' && !!$gameSystem &&
                           Array.isArray($gameSystem._backlogs);
                },
                read: function () {
                    return ($gameSystem && $gameSystem._backlogs) ? $gameSystem._backlogs.slice() : [];
                },
                restore: function (lines) {
                    if (!$gameSystem) return false;
                    $gameSystem._backlogs = lines.slice();
                    return true;
                },
                clear: function () {
                    if (!$gameSystem) return false;
                    $gameSystem._backlogs = [];
                    $gameSystem._lastSpeaker = null;
                    return true;
                },
                max: function () {
                    return ($gameSystem && $gameSystem._maxStorableLogs) || 0;
                },
                setMax: function (n) {
                    if (!$gameSystem) return false;
                    $gameSystem._maxStorableLogs = Math.max(0, Math.floor(n) || 0);
                    return true;
                },
                open: function () {
                    if (typeof Scene_BackLog === 'undefined') return false;
                    SceneManager.push(Scene_BackLog);
                    return true;
                },
                /* Speaker headers in this game are written with text colour
                   14. The Text module can detect the recurring index on its
                   own; declaring it skips the guesswork on a short log. */
                speakerColor: function () { return 14; }
            },

            /* Ironman: a mode restricting saving to one dedicated slot, with
               a penalty for reloading. Entirely a plugin concept. */
            ironman: {
                name: function () { return 'Ironman'; },
                enabled: function () {
                    return !!(typeof $gameSystem !== 'undefined' && $gameSystem &&
                              typeof $gameSystem.isIronmanEnabled === 'function' &&
                              $gameSystem.isIronmanEnabled());
                },
                slot: function () {
                    return ($gameSystem && $gameSystem._ironmanSaveID) || null;
                },
                /* Lift the reload penalty for this session. The two flags are
                   the plugin's own; writing them is the only way in, and it
                   is why this lives in a profile rather than the Save module. */
                relax: function (on) {
                    if (!$gameSystem) return false;
                    $gameSystem._checkIronmanFlag = !on;
                    $gameSystem._ironmanSaveFlag = !on;
                    return true;
                },
                /* Mark a savefile row that was written in ironman mode. */
                marks: function (info) {
                    return !!(info && info.ironman);
                }
            },

            /* The mod loader this game ships. It rewrites asset URLs so a mod
               can override a base-game file; anything GigaHack loads by URL
               has to go through it or it will read the unmodded original. */
            modLoader: {
                updateURL: function (url) {
                    if (typeof AuraMZ === 'undefined' || !AuraMZ ||
                        !AuraMZ.ModLoader || typeof AuraMZ.ModLoader.updateURL !== 'function') {
                        return url;
                    }
                    return AuraMZ.ModLoader.updateURL(url);
                }
            }
        },

        /* Shown in the About panel, so a user can see what the profile
           claimed and judge whether it is still true of their build. */
        notes: [
            'Forge id bases and the "--" section convention are computed, not pinned — a patch that adds content will not collide.',
            'Steam achievements are enumerated from the platform API; only the four accumulating stats are listed here, because nothing in the data files records their thresholds.',
            'The backlog and ironman panels appear only when this build actually ships those plugins.'
        ]
    });

})(window.GigaHack);
