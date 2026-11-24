import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const plain = (x) => JSON.parse(JSON.stringify(x));
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "scripts", "garen-rules.js"), "utf8");

function makeActor({ dex = 10, int = 10, ability = "" } = {}) {
  const actor = {
    system: {
      attributes: { init: { ability } },
      abilities: { dex: { mod: dex }, int: { mod: int } },
    },
    rollOpts: [],
    getInitiativeRoll(opts) {
      actor.rollOpts.push(opts);
      return { fake: "roll", opts };
    },
  };
  return actor;
}

function setup({ isOwner = true, isGM = false, initiative = null, combatExists = true, combatantExists = true, choice = "normal", actor = makeActor(), onDialog = null, rollThrows = false, modules = {}, logs = [] } = {}) {
  const hooks = { on: [], once: [] };
  const calls = { warn: [], error: [], dialogs: [], rolled: [], cacheAtRoll: [] };
  const state = { combatExists, combatantExists };
  const combatant = { id: "cb1", name: "Byggr", isOwner, initiative, actor };
  const combat = {
    combatants: { get: (id) => (state.combatantExists && id === "cb1" ? combatant : undefined) },
    async rollInitiative(ids) {
      calls.rolled.push(ids);
      if (rollThrows) throw new Error("boom");
      calls.cacheAtRoll.push(actor._cachedInitiativeRoll);
    },
  };
  const context = {
    Hooks: {
      on: (name, fn) => hooks.on.push({ name, fn }),
      once: (name, fn) => hooks.once.push({ name, fn }),
    },
    CONFIG: { DND5E: { defaultAbilities: { initiative: "dex" } } },
    console: { log: (...a) => logs.push(a.join(" ")), error: () => {}, warn: () => {} },
    game: { modules: { get: (id) => modules[id] }, user: { isGM }, combats: { get: (id) => (state.combatExists && id === "c1" ? combat : undefined) } },
    ui: { notifications: { warn: (t) => calls.warn.push(t), error: (t) => calls.error.push(t) } },
    foundry: {
      applications: {
        api: {
          DialogV2: {
            async wait(options) {
              calls.dialogs.push(options);
              if (onDialog) await onDialog(state, combatant);
              return choice;
            },
          },
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  for (const h of hooks.once.filter((h) => h.name === "init")) h.fn();
  const find = (name) => hooks.on.find((h) => h.name === name)?.fn;
  return { hooks, calls, actor, combatant, state, find };
}

function makeButton() {
  const listeners = {};
  return {
    dataset: { combatId: "c1", combatantId: "cb1" },
    disabled: false,
    addEventListener: (type, fn) => (listeners[type] = fn),
    click: () => listeners.click({ preventDefault() {} }),
  };
}

function render(find, button) {
  const html = { querySelectorAll: (sel) => (sel === "button.ncs-initiative-roll" ? [button] : []) };
  find("renderChatMessageHTML")({}, html);
}

test("swaps in a higher intelligence", () => {
  const { find } = setup();
  const config = { data: { mod: 0 } };
  find("dnd5e.preConfigureInitiative")(makeActor({ dex: 0, int: 3 }), config);
  assert.equal(config.data.mod, 3);
});

test("keeps a higher or equal dexterity", () => {
  const { find } = setup();
  for (const [dex, int] of [[3, 1], [2, 2]]) {
    const config = { data: { mod: dex } };
    find("dnd5e.preConfigureInitiative")(makeActor({ dex, int }), config);
    assert.equal(config.data.mod, dex);
  }
});

test("leaves another chosen ability alone", () => {
  const { find } = setup();
  const config = { data: { mod: 0 } };
  find("dnd5e.preConfigureInitiative")(makeActor({ dex: 0, int: 5, ability: "wis" }), config);
  assert.equal(config.data.mod, 0);
});

test("the button rolls with the chosen advantage and clears the cache", async () => {
  for (const [choice, expected] of [["adv", { advantage: true }], ["dis", { disadvantage: true }]]) {
    const { find, calls, actor } = setup({ choice });
    const button = makeButton();
    render(find, button);
    await button.click();
    assert.equal(calls.dialogs[0].window.title, "Iniciativa de Byggr");
    assert.deepEqual(plain(calls.dialogs[0].buttons.map((b) => b.action)), ["dis", "normal", "adv"]);
    assert.equal(calls.dialogs[0].buttons[1].default, true);
    assert.equal(calls.dialogs[0].rejectClose, false);
    assert.deepEqual(plain(actor.rollOpts), [expected]);
    assert.deepEqual(plain(calls.rolled), [["cb1"]]);
    assert.deepEqual(plain(calls.cacheAtRoll[0]), { fake: "roll", opts: expected });
    assert.equal("_cachedInitiativeRoll" in actor, false);
    assert.equal(button.disabled, false);
  }
});

test("normal passes no advantage at all", async () => {
  const { find, actor } = setup({ choice: "normal" });
  const button = makeButton();
  render(find, button);
  await button.click();
  assert.deepEqual(plain(actor.rollOpts), [{}]);
  assert.equal(Object.keys(actor.rollOpts[0]).length, 0);
});

test("closing the dialog rolls nothing", async () => {
  const { find, calls, actor } = setup({ choice: null });
  const button = makeButton();
  render(find, button);
  await button.click();
  assert.deepEqual(plain(calls.rolled), []);
  assert.deepEqual(plain(actor.rollOpts), []);
  assert.deepEqual(calls.warn, []);
  assert.equal(button.disabled, false);
});

test("refuses a player who does not own the character", async () => {
  const { find, calls } = setup({ isOwner: false, isGM: false });
  const button = makeButton();
  render(find, button);
  await button.click();
  assert.deepEqual(calls.warn, ["Só o dono do personagem ou um mestre pode rolar esta iniciativa."]);
  assert.deepEqual(calls.dialogs, []);
  assert.deepEqual(plain(calls.rolled), []);
});

test("a gamemaster may roll for a character they do not own", async () => {
  const { find, calls } = setup({ isOwner: false, isGM: true });
  const button = makeButton();
  render(find, button);
  await button.click();
  assert.deepEqual(plain(calls.rolled), [["cb1"]]);
});

test("refuses a character that already rolled", async () => {
  const { find, calls } = setup({ initiative: 12 });
  const button = makeButton();
  render(find, button);
  await button.click();
  assert.deepEqual(calls.warn, ["A iniciativa de Byggr já foi rolada."]);
  assert.deepEqual(plain(calls.rolled), []);
  assert.equal(button.disabled, false);
});

test("refuses a combat that ended", async () => {
  for (const opts of [{ combatExists: false }, { combatantExists: false }]) {
    const { find, calls } = setup(opts);
    const button = makeButton();
    render(find, button);
    await button.click();
    assert.deepEqual(calls.warn, ["Este combate já terminou."]);
    assert.deepEqual(plain(calls.rolled), []);
  }
});

test("a second copy of the button for the same combatant does nothing while the first is in flight", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { find, calls, actor } = setup({ onDialog: () => gate });
  const first = makeButton();
  const second = makeButton();
  render(find, first);
  render(find, second);
  const p1 = first.click();
  await second.click();
  assert.deepEqual(calls.warn, ["A iniciativa de Byggr já está sendo rolada."]);
  assert.equal(calls.dialogs.length, 1);
  release();
  await p1;
  assert.deepEqual(plain(calls.rolled), [["cb1"]]);
  assert.equal(actor.rollOpts.length, 1);
  // Released afterwards: a later click is judged by the normal rules again.
  await second.click();
  assert.equal(calls.dialogs.length, 2);
});

test("the in flight mark is released when the dialog is closed", async () => {
  const { find, calls } = setup({ choice: null });
  const button = makeButton();
  render(find, button);
  await button.click();
  await button.click();
  assert.equal(calls.dialogs.length, 2);
  assert.deepEqual(calls.warn, []);
});

test("a combat deleted while the dialog is open rolls nothing", async () => {
  const { find, calls, actor } = setup({ onDialog: (state) => { state.combatExists = false; } });
  const button = makeButton();
  render(find, button);
  await button.click();
  assert.deepEqual(calls.warn, ["Este combate já terminou."]);
  assert.deepEqual(calls.rolled, []);
  assert.deepEqual(actor.rollOpts, []);
  assert.equal(button.disabled, false);
});

test("a combatant deleted while the dialog is open rolls nothing", async () => {
  const { find, calls } = setup({ onDialog: (state) => { state.combatantExists = false; } });
  const button = makeButton();
  render(find, button);
  await button.click();
  assert.deepEqual(calls.warn, ["Este combate já terminou."]);
  assert.deepEqual(calls.rolled, []);
});

test("a combatant whose actor vanished during the dialog rolls nothing", async () => {
  const { find, calls } = setup({ onDialog: (state, combatant) => { combatant.actor = null; } });
  const button = makeButton();
  render(find, button);
  await button.click();
  assert.deepEqual(calls.warn, ["Este combate já terminou."]);
  assert.deepEqual(calls.rolled, []);
  assert.deepEqual(calls.error, []);
  assert.equal(button.disabled, false);
});

test("a roll that throws shows an error, deletes the cache and enables the button", async () => {
  const { find, calls, actor } = setup({ rollThrows: true });
  const button = makeButton();
  render(find, button);
  const original = console.error;
  console.error = () => {};
  try {
    await button.click();
  } finally {
    console.error = original;
  }
  assert.deepEqual(calls.error, ["Não foi possível rolar a iniciativa de Byggr."]);
  assert.equal("_cachedInitiativeRoll" in actor, false);
  assert.equal(button.disabled, false);
  await button.click();
  assert.equal(calls.dialogs.length, 2);
});

// The skill roll button of Dungeon Guide's request (garen skills design, 2026-11-23): the player's click rolls the
// Garen skill as Caio's my-skill-system sheet does, through dnd5e's D20Roll.build.
function setupSkill({ isOwner = true, isGM = false, actorExists = true, skills = null, onBuild = null } = {}) {
  const hooks = { on: [], once: [] };
  const calls = { warn: [], error: [], built: [] };
  const actor = {
    id: "a1", name: "Chaos", isOwner,
    getRollData: () => ({ skills: skills ?? {
      prc: { value: 1, total: 5, mod: 5 },
      ouvir: { label: "Ouvir", value: 2, mod: 7, ability: "wis" },
      'atuacoes_Flauta "pã"': { label: 'Atuação (Flauta "pã")', value: 1, mod: 4, ability: "cha" },
    } }),
  };
  const context = {
    Hooks: {
      on: (name, fn) => hooks.on.push({ name, fn }),
      once: (name, fn) => hooks.once.push({ name, fn }),
    },
    CONFIG: {
      DND5E: { defaultAbilities: { initiative: "dex" } },
      Dice: { D20Roll: { async build(...args) { calls.built.push(args); if (onBuild) await onBuild(); return [{}]; } } },
    },
    ChatMessage: { getSpeaker: ({ actor }) => ({ actor: actor.id, alias: actor.name }) },
    game: { modules: { get: () => undefined }, user: { isGM }, actors: { get: (id) => (actorExists && id === "a1" ? actor : undefined) } },
    ui: { notifications: { warn: (t) => calls.warn.push(t), error: (t) => calls.error.push(t) } },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  for (const h of hooks.once.filter((h) => h.name === "init")) h.fn();
  const find = (name) => hooks.on.find((h) => h.name === name)?.fn;
  return { calls, actor, find };
}

function makeSkillButton(skill = "ouvir") {
  const listeners = {};
  return {
    dataset: { actorId: "a1", skill },
    disabled: false,
    addEventListener: (type, fn) => (listeners[type] = fn),
    click: () => listeners.click({ preventDefault() {} }),
  };
}

function renderSkill(find, button) {
  const html = { querySelectorAll: (sel) => (sel === "button.garen-skill-roll" ? [button] : []) };
  find("renderChatMessageHTML")({}, html);
}

test("the skill button rolls the Garen skill as Caio's sheet does", async () => {
  const { find, calls, actor } = setupSkill();
  const button = makeSkillButton();
  renderSkill(find, button);
  await button.click();
  assert.equal(calls.built.length, 1);
  const [config, dialog, message] = calls.built[0];
  assert.equal(config.subject, actor);
  assert.deepEqual(plain(config.rolls), [{ parts: ["@mod"], data: { mod: 7 }, options: {} }]);
  assert.deepEqual(plain(dialog), { options: { window: { title: "Perícia: Ouvir", subtitle: "Chaos" } } });
  assert.deepEqual(plain(message), { data: { flavor: "Perícia: Ouvir", speaker: { actor: "a1", alias: "Chaos" } } });
  assert.deepEqual(calls.warn, []);
  assert.equal(button.disabled, false);
});

test("a group entry with quotes in its name is found by its key", async () => {
  const { find, calls } = setupSkill();
  const button = makeSkillButton('atuacoes_Flauta "pã"');
  renderSkill(find, button);
  await button.click();
  assert.equal(calls.built[0][1].options.window.title, 'Perícia: Atuação (Flauta "pã")');
  assert.equal(calls.built[0][0].rolls[0].data.mod, 4);
});

test("a Gamemaster may roll it, anyone else is refused", async () => {
  const gm = setupSkill({ isOwner: false, isGM: true });
  const gmButton = makeSkillButton();
  renderSkill(gm.find, gmButton);
  await gmButton.click();
  assert.equal(gm.calls.built.length, 1);
  const other = setupSkill({ isOwner: false, isGM: false });
  const button = makeSkillButton();
  renderSkill(other.find, button);
  await button.click();
  assert.equal(other.calls.built.length, 0);
  assert.deepEqual(other.calls.warn, ["Só o dono do personagem ou um mestre pode rolar esta perícia."]);
});

test("a missing character or skill is refused with a notice", async () => {
  const gone = setupSkill({ actorExists: false });
  const button = makeSkillButton();
  renderSkill(gone.find, button);
  await button.click();
  assert.deepEqual(gone.calls.warn, ["Este personagem não existe mais."]);
  for (const key of ["voar", "prc"]) {
    const { find, calls } = setupSkill();
    const other = makeSkillButton(key);
    renderSkill(find, other);
    await other.click();
    assert.equal(calls.built.length, 0, key);
    assert.deepEqual(calls.warn, ["Chaos não tem esta perícia."], key);
  }
});

test("a second click while the roll's dialog is open rolls nothing more", async () => {
  let release;
  const waiting = new Promise((resolve) => (release = resolve));
  const { find, calls } = setupSkill({ onBuild: () => waiting });
  const button = makeSkillButton();
  renderSkill(find, button);
  const first = button.click();
  await button.click();
  release();
  await first;
  assert.equal(calls.built.length, 1);
  await button.click();
  assert.equal(calls.built.length, 2);
});

test("a roll that fails says so", async () => {
  const { find, calls } = setupSkill({ onBuild: () => { throw new Error("boom"); } });
  const button = makeSkillButton();
  renderSkill(find, button);
  await button.click();
  assert.deepEqual(calls.error, ["Não foi possível rolar Ouvir de Chaos."]);
});

// The ability check button of Dungeon Guide's request (ability rolls design, 2026-11-23): the player's click rolls the
// check through the actor's own dnd5e rollAbilityCheck, which opens its dialog for advantage and the roll mode.
function setupAbility({ isOwner = true, isGM = false, actorExists = true, onRoll = null } = {}) {
  const hooks = { on: [], once: [] };
  const calls = { warn: [], error: [], checks: [] };
  const actor = {
    id: "a1", name: "Chaos", isOwner,
    async rollAbilityCheck(config) { calls.checks.push(config); if (onRoll) await onRoll(); return [{}]; },
  };
  const context = {
    Hooks: {
      on: (name, fn) => hooks.on.push({ name, fn }),
      once: (name, fn) => hooks.once.push({ name, fn }),
    },
    CONFIG: { DND5E: { defaultAbilities: { initiative: "dex" },
      abilities: { str: {}, dex: {}, con: {}, int: {}, wis: {}, cha: {} } } },
    game: { modules: { get: () => undefined }, user: { isGM }, actors: { get: (id) => (actorExists && id === "a1" ? actor : undefined) } },
    ui: { notifications: { warn: (t) => calls.warn.push(t), error: (t) => calls.error.push(t) } },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  for (const h of hooks.once.filter((h) => h.name === "init")) h.fn();
  const find = (name) => hooks.on.find((h) => h.name === name)?.fn;
  return { calls, actor, find };
}

function makeAbilityButton(ability = "str") {
  const listeners = {};
  const event = { preventDefault() {}, shiftKey: true };
  return {
    event,
    dataset: { actorId: "a1", ability },
    disabled: false,
    addEventListener: (type, fn) => (listeners[type] = fn),
    click: () => listeners.click(event),
  };
}

function renderAbility(find, button) {
  const html = { querySelectorAll: (sel) => (sel === "button.garen-ability-roll" ? [button] : []) };
  find("renderChatMessageHTML")({}, html);
}

test("the ability button rolls the check through dnd5e", async () => {
  const { find, calls } = setupAbility();
  const button = makeAbilityButton();
  renderAbility(find, button);
  await button.click();
  assert.equal(calls.checks.length, 1);
  assert.equal(calls.checks[0].ability, "str");
  assert.equal(calls.checks[0].event, button.event);
  assert.deepEqual(calls.warn, []);
});

test("a Gamemaster may roll the check, anyone else is refused", async () => {
  const gm = setupAbility({ isOwner: false, isGM: true });
  const gmButton = makeAbilityButton();
  renderAbility(gm.find, gmButton);
  await gmButton.click();
  assert.equal(gm.calls.checks.length, 1);
  const other = setupAbility({ isOwner: false, isGM: false });
  const button = makeAbilityButton();
  renderAbility(other.find, button);
  await button.click();
  assert.equal(other.calls.checks.length, 0);
  assert.deepEqual(other.calls.warn, ["Só o dono do personagem ou um mestre pode rolar este teste."]);
});

test("a missing character or ability is refused with a notice", async () => {
  const gone = setupAbility({ actorExists: false });
  const button = makeAbilityButton();
  renderAbility(gone.find, button);
  await button.click();
  assert.deepEqual(gone.calls.warn, ["Este personagem não existe mais."]);
  const { find, calls } = setupAbility();
  const other = makeAbilityButton("luck");
  renderAbility(find, other);
  await other.click();
  assert.equal(calls.checks.length, 0);
  assert.deepEqual(calls.warn, ["Chaos não tem este atributo."]);
});

test("a second click while the check's dialog is open rolls nothing more", async () => {
  let release;
  const waiting = new Promise((resolve) => (release = resolve));
  const { find, calls } = setupAbility({ onRoll: () => waiting });
  const button = makeAbilityButton();
  renderAbility(find, button);
  const first = button.click();
  await button.click();
  release();
  await first;
  assert.equal(calls.checks.length, 1);
  await button.click();
  assert.equal(calls.checks.length, 2);
});

test("a check that fails says so", async () => {
  const { find, calls } = setupAbility({ onRoll: () => { throw new Error("boom"); } });
  const button = makeAbilityButton();
  renderAbility(find, button);
  const original = console.error;
  console.error = () => {};
  try {
    await button.click();
  } finally {
    console.error = original;
  }
  assert.deepEqual(calls.error, ["Não foi possível rolar o teste de Chaos."]);
});

test("the guard: with garen-initiative active, init registers nothing and logs one line naming it", () => {
  const logs = [];
  const { hooks } = setup({ modules: { "garen-initiative": { active: true } }, logs });
  assert.equal(hooks.on.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /garen-initiative/);
});

test("the guard: with garen-initiative present but inactive, init registers the hooks", () => {
  const { hooks } = setup({ modules: { "garen-initiative": { active: false } } });
  assert.ok(hooks.on.length >= 2);
});

// Foundry loads every module's plain scripts as script tags in one shared global scope. The old garen-initiative
// module's initiative.js declared these same top-level names, so garen-rules.js must not declare any at the top level.
const oldModuleStandIn = `
function garenInitiative() {}
const rollsInFlight = new Set();
function findCombatant() {}
async function rollInitiativeFromButton() {}
const skillRollsInFlight = new Set();
async function rollSkillFromButton() {}
const abilityRollsInFlight = new Set();
async function rollAbilityFromButton() {}
`;

for (const order of [["old", "new"], ["new", "old"]]) {
  test(`shared global scope: garen-rules.js loads ${order.join(" then ")} next to the old module's script without a clash`, () => {
    const hooks = [];
    const logs = [];
    const context = {
      Hooks: { on: (name) => hooks.push(name), once: (name, fn) => name === "init" && inits.push(fn) },
      CONFIG: { DND5E: { defaultAbilities: { initiative: "dex" } } },
      console: { log: (...a) => logs.push(a.join(" ")), error: () => {}, warn: () => {} },
      game: { modules: { get: (id) => (id === "garen-initiative" ? { active: true } : undefined) } },
    };
    const inits = [];
    vm.createContext(context);
    for (const which of order) vm.runInContext(which === "old" ? oldModuleStandIn : source, context);
    for (const fn of inits) fn();
    assert.equal(hooks.length, 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /garen-initiative/);
  });
}

test("module.json: version, scripts, socket, relationships, links", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, "..", "module.json"), "utf8"));
  assert.equal(manifest.version, "1.8.0");
  assert.deepEqual(manifest.scripts, ["scripts/defense-logic.js", "scripts/crit-damage.js", "scripts/thunderstruck.js", "scripts/garen-rules.js"]);
  assert.equal(manifest.socket, true);
  assert.ok(manifest.relationships.requires.some((r) => r.id === "lib-wrapper"));
  assert.deepEqual(manifest.relationships.conflicts, [{ id: "garen-initiative", type: "module", reason: "Merged into Custom Combat System 1.8.0" }]);
  const dnd5e = manifest.relationships.systems.find((s) => s.id === "dnd5e");
  assert.deepEqual(dnd5e.compatibility, { minimum: "6.0.0", verified: "6.0.6" });
  assert.deepEqual(manifest.compatibility, { minimum: "14", verified: "14.370" });
  assert.equal(manifest.url, "https://github.com/vcaparica/new-combat-system");
  assert.equal(manifest.manifest, "https://raw.githubusercontent.com/vcaparica/new-combat-system/refs/heads/main/module.json");
  assert.equal(manifest.download, "https://github.com/vcaparica/new-combat-system/archive/refs/tags/v1.8.0.zip");
});
