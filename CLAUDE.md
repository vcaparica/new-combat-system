# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Custom Combat System 1.8.0, a Foundry VTT 14 module for dnd5e 6 (2014 rules) used by the Garen campaign. It is plain browser JavaScript with no build step. It needs the lib-wrapper module. Player-visible texts are in Portuguese, the code comments and this file in English.

## The four scripts

module.json loads them in this order.

1. scripts/defense-logic.js: attack against defense. Wraps dnd5e's attack roll, posts the defense request card, the attack forms and defense forms, the defender's buttons, the socket, the hold of the attack's d20 until the defense is chosen, cancelling, and the sweep of interrupted requests. A tie is the attacker's: an attack hits when its total is equal to or higher than the defense. It also sets game.modules.get("new-combat-system").api, frozen, in the ready hook.
2. scripts/crit-damage.js: Garen's critical damage, an even die count halved with the maximum bonus.
3. scripts/thunderstruck.js: the Thunderstruck sound for one player's critical with one weapon.
4. scripts/garen-rules.js: Garen Custom Rules, merged in from the old garen-initiative module. It holds the initiative rule on dnd5e.preConfigureInitiative and answers the three chat buttons. When garen-initiative is active in the world it registers nothing and logs one line; module.json also lists garen-initiative under conflicts.

## The API and Dungeon Guide

The API is game.modules.get("new-combat-system").api: version, attackForms, formModifiers, defenseOptions, defenseBonus, responders, request, attack, chooseDefense and cancelAttack. It is absent when lib-wrapper is off. Dungeon Guide, the GM's app, depends on it, so a change in a signature, a result shape or an error sentence is a change for that app too. The player's flow and the API use the same inner functions.

## Texts and classes that must not change

Dungeon Guide writes these in chat messages, so do not rename or reword them: the player-visible Portuguese texts, and the button classes ncs-initiative-roll, garen-skill-roll and garen-ability-roll with their data attributes (data-combat-id and data-combatant-id, data-actor-id and data-skill, data-actor-id and data-ability).

## Tests

They need no Foundry: they run the scripts through node:vm with stand-ins. From the module folder run:

    node --test "tests/*.test.mjs"

The quoted glob matters, because node --test tests/ fails on Node 24. tests/stand-ins.mjs serves the defense and API tests; tests/garen-rules.test.mjs is self-contained with its own stand-ins and also checks module.json. Run them before every commit.

## The fork and releases

github.com/vcaparica/new-combat-system is a fork of Caio's repository and the only origin. Caio's repository is not a remote; do not add it. Never push without being asked. Commit messages are plain English in the imperative and end with a blank line and the Co-Authored-By line.

To release version X.Y.Z:

1. Work on a branch such as release-X.Y.Z and run the tests.
2. Set version and download in module.json, the download being https://github.com/vcaparica/new-combat-system/archive/refs/tags/vX.Y.Z.zip.
3. Merge into main, tag vX.Y.Z on main and push the tag.
4. Create a GitHub release of the same name.

The manifest field points at module.json on main, which is how Foundry finds updates.
