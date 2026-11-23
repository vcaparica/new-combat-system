// The attack and defense flow of scripts/defense-logic.js, run in node:vm against the stand-ins of stand-ins.mjs and
// driven only from outside: the API, the hooks the module registers, the libWrapper wrappers it installs, the socket
// and the chat card's buttons.
import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { load, plain, flush, settled } from "./stand-ins.mjs";

// A promise of the module that never settles fails its test after five seconds instead of holding up the run.
const test = (name, fn) => nodeTest(name, { timeout: 5000 }, fn);

const MODULE = "new-combat-system";
const SOCKET = "module.new-combat-system";
const USERS = [
  { id: "victor", name: "Victor", isGM: true },
  { id: "dg", name: "DungeonGuide", isGM: true },
  { id: "pedro", name: "Pedro" },
  { id: "caio", name: "Caio" },
];

/**
 * Return to Garen in small, seen from the page of user (DungeonGuide's by default): on one scene, Goblin 2 and an Orc,
 * creatures nobody plays, both with armour class 13, and Jerinos, Pedro's character, with armour class 15 and 4 points
 * of Acrobacia. Goblin 2 has a Scimitar and the spell Ray of Frost; Jerinos has a Longsword. Every proficiency is 2.
 */
function world({ user = "dg", inactive = [], jerinosArmour = false, start = true, modules } = {}) {
  const users = USERS.map((u) => ({ ...u, active: !inactive.includes(u.id) }));
  const env = load(["scripts/defense-logic.js"], { userId: user, users, modules });
  const scene = env.addScene("scene1");
  const goblin = env.addActor({ id: "goblin", name: "Goblin", ac: 13, prof: 2 });
  const orc = env.addActor({ id: "orc", name: "Orc", ac: 13, prof: 2 });
  const jerinos = env.addActor({
    id: "jerinos", name: "Jerinos", type: "character", ac: 15, prof: 2, owners: ["pedro"], armor: jerinosArmour, acrobacia: 4,
  });
  const goblinToken = env.addToken(scene, { id: "tok-goblin", name: "Goblin 2", actor: goblin });
  const orcToken = env.addToken(scene, { id: "tok-orc", name: "Orc", actor: orc });
  const jerinosToken = env.addToken(scene, { id: "tok-jerinos", name: "Jerinos", actor: jerinos });
  const scimitar = env.addActivity(env.addItem(goblin, { id: "scimitar", name: "Scimitar" }), { id: "scimitar-attack" });
  const rayOfFrost = env.addActivity(
    env.addItem(goblin, { id: "ray-of-frost", name: "Ray of Frost", type: "spell", range: { value: 60 } }), { id: "ray-attack" });
  const longsword = env.addActivity(env.addItem(jerinos, { id: "longsword", name: "Longsword" }), { id: "longsword-attack" });
  if (start) env.start();
  return { env, scene, goblin, orc, jerinos, goblinToken, orcToken, jerinosToken, scimitar, rayOfFrost, longsword };
}

const requestOf = (message) => plain(message?.flags?.[MODULE]?.defenseRequest ?? null);

/** A complete pending request of the module's card: by default DungeonGuide's Goblin 2 attacking Jerinos. */
function request(overrides = {}) {
  return {
    attackerUserId: "dg",
    attackerActorId: "goblin",
    attackerTokenId: "tok-goblin",
    attackerName: "Goblin 2",
    itemId: "scimitar",
    itemName: "Scimitar",
    activityId: "scimitar-attack",
    sceneId: "scene1",
    targetTokenId: "tok-jerinos",
    targetName: "Jerinos",
    form: "normal",
    mods: { attack: 0, damage: 0, defense: 0 },
    status: "pending",
    ...overrides,
  };
}

/** Pedro's Jerinos attacking Goblin 2 with the Longsword. */
const jerinosAttacks = (overrides = {}) => request({
  attackerUserId: "pedro",
  attackerActorId: "jerinos",
  attackerTokenId: "tok-jerinos",
  attackerName: "Jerinos",
  itemId: "longsword",
  itemName: "Longsword",
  activityId: "longsword-attack",
  targetTokenId: "tok-goblin",
  targetName: "Goblin 2",
  ...overrides,
});

/** The module's card for the request, posted by its attacker's page and arriving on this one. */
function cardFrom(env, req, createOptions = {}) {
  return env.receiveMessage({
    author: req.attackerUserId,
    speaker: { scene: req.sceneId, actor: req.attackerActorId, token: req.attackerTokenId, alias: req.attackerName },
    content: `<div><p><strong>⚔️ ${req.attackerName} ataca ${req.targetName}!</strong></p>`
      + `<div class="ncs-defense-slot"><p>⏳ Aguardando a defesa de ${req.targetName}.</p></div></div>`,
    flags: { [MODULE]: { defenseRequest: req } },
  }, createOptions);
}

/** A ready canvas and a started combat on the Gamemaster's page, with Goblin 2 selected next to the Orc. */
function inCombat(w) {
  w.env.useCanvas(w.scene, {
    controlled: "tok-goblin",
    positions: { "tok-goblin": [0, 0], "tok-orc": [0, 1], "tok-jerinos": [4, 4] },
  });
  w.env.game.combat = {
    combatants: [
      { tokenId: "tok-goblin", name: "Goblin 2" },
      { tokenId: "tok-orc", name: "Orc" },
      { tokenId: "tok-jerinos", name: "Jerinos" },
    ],
  };
}

test("a tie is a hit", async () => {
  for (const [attackTotal, hit, verdict] of [[15, true, "ACERTOU"], [14, false, "ERROU"]]) {
    const w = world();
    const { api } = w.env;
    w.env.script.attacks.push({ total: attackTotal });
    w.env.script.d20.push(10); // Jerinos: 1d20 + 5 = 15
    const { requestId, result } = await api.attack({ activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken });
    await api.chooseDefense(requestId, "normal");
    const outcome = await result;
    assert.equal(outcome.status, "done");
    assert.equal(outcome.hit, hit, `${attackTotal} against 15`);
    assert.equal(outcome.defense.total, 15);
    const card = w.env.game.messages.get(requestId);
    assert.equal(requestOf(card).defense.hit, hit);
    assert.ok(card.content.includes(`O ataque <strong>${verdict}</strong>!`), card.content);
  }
});

test("a tie is a hit in the player's flow too", async () => {
  const w = world({ user: "victor" });
  inCombat(w);
  w.env.script.dialog = () => ({ tokenId: "tok-orc", form: "normal" });
  w.env.script.attacks.push({ total: 15 });
  w.env.script.d20.push(12); // the Orc: 1d20 + 3 = 15
  const rolling = w.scimitar.rollAttack();
  await flush();
  const card = w.env.game.messages.contents.at(-1);
  await w.env.render(card).querySelectorAll(".ncs-defense-btn")[0].click();
  await rolling;
  assert.equal(requestOf(card).defense.total, 15);
  assert.equal(requestOf(card).defense.hit, true);
  assert.ok(card.content.includes("O ataque <strong>ACERTOU</strong>!"), card.content);
});

test("attack posts the request card with the new fields", async () => {
  const w = world();
  const { api } = w.env;
  const { requestId, result } = await api.attack({
    activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken, form: "ofensivo",
  });
  const card = w.env.game.messages.get(requestId);
  assert.ok(card, "the card is the message the request id names");
  assert.deepEqual(requestOf(card), request({ form: "ofensivo", mods: { attack: -2, damage: 3, defense: 0 } }));
  assert.deepEqual(plain(api.request(card)), requestOf(card));
  assert.equal(api.request({ flags: {} }), null);
  assert.equal(api.request(null), null);
  assert.equal(card.author.id, "dg");
  assert.deepEqual(card.speaker, { scene: "scene1", actor: "goblin", token: "tok-goblin", alias: "Goblin 2" });
  assert.ok(card.content.includes("<strong>⚔️ Goblin 2 ataca Jerinos!</strong>"), card.content);
  assert.ok(card.content.includes("🗡️ Ataque Ofensivo (−2 ataque, +3 dano)"), card.content);
  assert.ok(card.content.includes('<div class="ncs-defense-slot"><p>⏳ Aguardando a defesa de Jerinos.</p></div>'), card.content);
  assert.equal(await settled(result), false, "the result waits for the defense");
  assert.equal(w.env.recorded.rollAttack.length, 0);
});

test("attack rolls after the defense with the form's attack modifier", async () => {
  const w = world();
  const { api } = w.env;
  inCombat(w); // a page with a canvas and a combat, where the module's own wrapper would otherwise ask for a target
  const message = { rollMode: "gmroll", data: { flags: { "dungeon-guide": { app: true } } } };
  const { requestId, result } = await api.attack({
    activity: w.scimitar,
    attacker: w.goblinToken,
    target: w.jerinosToken,
    form: "ofensivo",
    roll: { advantage: true, attackMode: "oneHanded", rolls: [{ parts: ["@bonus"] }] },
    message,
  });
  await flush();
  assert.equal(w.env.recorded.rollAttack.length, 0, "no roll before the defense");
  await api.chooseDefense(requestId, "normal");
  assert.equal((await result).status, "done");
  assert.equal(w.env.recorded.rollAttack.length, 1);
  const [call] = w.env.recorded.rollAttack;
  assert.equal(call.activity, w.scimitar);
  assert.deepEqual(plain(call.config.rolls[0].parts), ["-2", "@bonus"]);
  assert.equal(call.config.advantage, true);
  assert.equal(call.config.attackMode, "oneHanded");
  assert.equal(call.config.garenApi, true);
  assert.equal(call.config.garenRequestId, undefined, "the d20 hold of the player's flow never applies");
  assert.deepEqual(plain(call.dialog), { configure: false });
  assert.deepEqual(plain(call.message), message);
  assert.deepEqual(w.env.recorded.dialogs, [], "the module's wrapper passed the roll straight to dnd5e");
  assert.equal(call.rolls[0].evaluated, true);
});

test("the defense roll's formula, total and dice reach the card and the result", async () => {
  // Pedro's page attacks Goblin 2 through the API; a Gamemaster's page chooses Ceder Terreno for it over the socket.
  const w = world({ user: "pedro" });
  const { api } = w.env;
  w.env.script.attacks.push({ total: 12 });
  w.env.script.d20.push(7);
  const { requestId, result } = await api.attack({ activity: w.longsword, attacker: w.jerinosToken, target: w.goblinToken });
  w.env.socketReceive({ requestId, form: "ceder", userId: "dg" });
  const outcome = await result;
  const defense = { form: "ceder", name: "Ceder Terreno", total: 11, formula: "1d20 + 3 + 1", hit: true, dice: [[7, true]] };
  assert.deepEqual(plain(outcome.defense), defense);
  assert.equal(outcome.defenseRoll.total, 11);
  assert.equal(outcome.defenseRoll.formula, "1d20 + 3 + 1");
  const card = w.env.game.messages.get(requestId);
  assert.deepEqual(requestOf(card).defense, defense);
  assert.ok(card.content.includes("🛡️ Defesa (Ceder Terreno): <strong>11</strong>"), card.content);
  assert.ok(card.content.includes("(1d20 + 3 + 1)"), card.content);
  assert.ok(card.content.includes("↩️ Goblin 2 recua 1 quadrado, afastando-se de Jerinos."), card.content);
});

test("chooseDefense from another page goes over the socket", async () => {
  const w = world({ user: "pedro" });
  const { api } = w.env;
  const card = cardFrom(w.env, request());
  const before = w.env.notices().length;
  const { acknowledged } = await api.chooseDefense(card.id, "ceder");
  assert.deepEqual(w.env.recorded.emitted, [{ name: SOCKET, payload: { requestId: card.id, form: "ceder", userId: "pedro" } }]);
  assert.equal(await settled(acknowledged), false, "nothing confirmed yet");
  w.env.remoteUpdate(card, { flags: { [MODULE]: { defenseRequest: { status: "chosen" } } } }, "dg");
  assert.equal(await settled(acknowledged), true, "confirmed as soon as the card left pending, with no wait");
  assert.equal(await acknowledged, true);

  // A card whose attacker's page never answers: false after ten seconds, not before, and no warning.
  const silent = cardFrom(w.env, request());
  const late = (await api.chooseDefense(silent.id, "normal")).acknowledged;
  await w.env.clock.advance(9999);
  assert.equal(await settled(late), false);
  await w.env.clock.advance(1);
  assert.equal(await late, false);
  assert.equal(w.env.notices().length, before + 1, "only the second card's own arrival notice");
});

test("chooseDefense refuses, sending nothing", async () => {
  const cases = [
    { why: "not pending", user: "pedro", req: request({ status: "chosen" }), form: "normal",
      error: "That attack is no longer waiting for a defense." },
    { why: "no such card", user: "pedro", id: "missing", form: "normal",
      error: "That attack is no longer waiting for a defense." },
    { why: "target gone", user: "dg", req: jerinosAttacks({ targetTokenId: "tok-gone", targetName: "Goblin" }), form: "normal",
      error: "Goblin is no longer on the scene." },
    { why: "unknown form", user: "pedro", req: request(), form: "parry", error: "That is not a defense." },
    { why: "esquiva in armour", user: "pedro", armour: true, req: request(), form: "esquiva",
      error: "Esquiva Acrobática needs no armour and no shield." },
    { why: "attacker away", user: "dg", inactive: ["pedro"], req: jerinosAttacks(), form: "normal",
      error: "Pedro is not connected, so the defense has nowhere to go." },
    { why: "not the owner", user: "caio", req: request(), form: "normal",
      error: "Only the defender's owner or a Gamemaster can choose this defense." },
  ];
  for (const c of cases) {
    const w = world({ user: c.user, inactive: c.inactive, jerinosArmour: c.armour });
    const id = c.req ? cardFrom(w.env, c.req).id : c.id;
    const notices = w.env.notices().length;
    await assert.rejects(w.env.api.chooseDefense(id, c.form), { message: c.error }, c.why);
    assert.deepEqual(w.env.recorded.emitted, [], c.why);
    assert.deepEqual(w.env.recorded.updates, [], c.why);
    assert.equal(w.env.notices().length, notices, c.why);
  }
});

test("cancelAttack", async () => {
  const w = world();
  const { api } = w.env;
  const { requestId, result } = await api.attack({ activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken });
  assert.equal(await api.cancelAttack(requestId), true);
  const card = w.env.game.messages.get(requestId);
  assert.equal(requestOf(card).status, "cancelled");
  assert.ok(card.content.includes("<p>🚫 Ataque cancelado.</p>"), card.content);
  assert.deepEqual(plain(await result), { status: "cancelled" });
  assert.equal(w.env.recorded.rollAttack.length, 0);
  assert.equal(await api.cancelAttack(requestId), false, "no longer waiting");
  assert.equal(await api.cancelAttack("missing"), false);

  // Another page's attack is not this page's to cancel.
  const others = cardFrom(w.env, jerinosAttacks());
  assert.equal(await api.cancelAttack(others.id), false);
  assert.equal(requestOf(others).status, "pending");

  // Once the defense is chosen, the attack goes on.
  const second = await api.attack({ activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken });
  await api.chooseDefense(second.requestId, "normal");
  assert.equal(await api.cancelAttack(second.requestId), false);
  assert.equal((await second.result).status, "done");
  assert.deepEqual(w.env.notices(), ["Jerinos ataca Goblin 2: escolha a defesa no chat."], "only the other page's card notified");
});

test("responders", () => {
  const env = load(["scripts/defense-logic.js"], {
    userId: "dg",
    users: [
      { id: "victor", name: "Victor", isGM: true },
      { id: "dg", name: "DungeonGuide", isGM: true },
      { id: "pedro", name: "Pedro" },
      { id: "caio", name: "Caio", active: false },
      { id: "leticia", name: "Letícia" },
      { id: "norbert", name: "Norbert" },
    ],
  });
  const jerinos = env.addActor({ id: "jerinos", name: "Jerinos", owners: ["leticia", "caio", "pedro", "victor"] });
  const goblin = env.addActor({ id: "goblin", name: "Goblin" });
  env.start();
  assert.deepEqual(plain(env.api.responders(jerinos)), ["pedro", "leticia"]);
  assert.deepEqual(plain(env.api.responders(goblin)), []);
  assert.throws(() => env.api.responders(undefined), { message: "That is not an actor." });
});

test("a spell attacks only in the normal form", async () => {
  const w = world();
  const { api } = w.env;
  await assert.rejects(
    api.attack({ activity: w.rayOfFrost, attacker: w.goblinToken, target: w.jerinosToken, form: "ofensivo" }),
    { message: "A spell attacks only in the normal form." },
  );
  assert.deepEqual(w.env.recorded.created, []);
  const { requestId } = await api.attack({ activity: w.rayOfFrost, attacker: w.goblinToken, target: w.jerinosToken });
  const sent = requestOf(w.env.game.messages.get(requestId));
  assert.equal(sent.form, "normal");
  assert.equal(sent.itemName, "Ray of Frost");
});

test("attack refuses what it cannot run, posting nothing", async () => {
  const w = world();
  const elsewhere = { id: "tok-far", name: "Far", actor: w.orc, parent: { id: "scene2" } };
  const statue = w.env.addToken(w.scene, { id: "tok-statue", name: "Statue", actor: null });
  const base = { activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken };
  const cases = [
    [{ ...base, form: "furioso" }, "That is not an attack form."],
    [{ ...base, activity: { type: "save", id: "save" } }, "That is not an attack activity."],
    [{ ...base, attacker: undefined }, "The attacker must be a token on a scene."],
    [{ ...base, target: elsewhere }, "The target must be a token on the attacker's scene."],
    [{ ...base, target: w.goblinToken }, "A token cannot attack itself."],
    [{ ...base, target: statue }, "The target has no actor."],
  ];
  for (const [args, message] of cases) await assert.rejects(w.env.api.attack(args), { message });
  assert.deepEqual(w.env.recorded.created, []);
});

test("the player's flow keeps working", async () => {
  const w = world({ user: "victor" });
  const { env } = w;
  inCombat(w);
  env.script.dialog = () => ({ tokenId: "tok-orc", form: "defensivo" });
  env.script.attacks.push({ total: 9 });
  env.script.d20.push(10); // the Orc: 1d20 + 3 = 13
  const rolling = w.scimitar.rollAttack();
  await flush();

  // The target dialog, with the targets in reach only.
  assert.equal(env.recorded.dialogs.length, 1);
  const [dialog] = env.recorded.dialogs;
  assert.equal(dialog.window.title, "Escolha o Alvo");
  assert.ok(dialog.content.includes("Orc"), dialog.content);
  assert.ok(!dialog.content.includes("Jerinos"), "Jerinos is out of reach");
  assert.deepEqual(plain(dialog.buttons.map((b) => b.action)),
    ["normal", "ofensivo", "defensivo", "preciso", "determinado", "violento", "cancel"]);

  // The card, posted before any die, with the new fields; the d20 held.
  const card = env.game.messages.contents.at(-1);
  assert.deepEqual(requestOf(card), request({
    attackerUserId: "victor", targetTokenId: "tok-orc", targetName: "Orc", form: "defensivo",
    mods: { attack: -2, damage: 0, defense: 2 },
  }));
  assert.deepEqual(env.notices(), ["Goblin 2 ataca Orc: escolha a defesa no chat."]);
  assert.equal(env.recorded.rollAttack.length, 1);
  assert.equal(env.recorded.rollAttack[0].config.garenRequestId, card.id);
  assert.deepEqual(plain(env.recorded.rollAttack[0].config.rolls[0].parts), ["-2"]);
  assert.equal(env.recorded.evaluated.length, 0, "no d20 before the defense");

  // The Gamemaster's page shows the Orc's defenses and the attacker's Cancel button; Defesa Total is chosen.
  const html = env.render(card);
  const buttons = html.querySelectorAll(".ncs-defense-btn");
  assert.deepEqual(buttons.map((b) => b.dataset.form), ["normal", "ceder", "esquiva", "total"]);
  assert.ok(html.querySelector(".ncs-cancel-attack-btn"));
  await buttons[3].click();
  const rolls = await rolling;
  assert.equal(rolls.length, 1);
  assert.equal(rolls[0].total, 9);
  const done = requestOf(card);
  assert.equal(done.status, "done");
  assert.deepEqual(done.defense, { form: "total", name: "Defesa Total", total: 15, formula: "1d20 + 3 + 2", hit: false, dice: [[10, true]] });
  assert.ok(card.content.includes("O ataque <strong>ERROU</strong>!"), card.content);
  assert.ok(card.content.includes("🛡️ Some <strong>+2</strong> na Defesa de Goblin 2 contra o próximo ataque sofrido."), card.content);
  assert.ok(card.content.includes("🛡️ A Defesa Total de Orc vale até o próximo turno"), card.content);
  assert.deepEqual(env.notices(), ["Goblin 2 ataca Orc: escolha a defesa no chat."]);
});

test("the attacker's Cancel button still ends a player's attack without a roll", async () => {
  const w = world({ user: "victor" });
  const { env } = w;
  inCombat(w);
  env.script.dialog = () => ({ tokenId: "tok-orc", form: "normal" });
  const rolling = w.scimitar.rollAttack();
  await flush();
  const card = env.game.messages.contents.at(-1);
  await env.render(card).querySelector(".ncs-cancel-attack-btn").click();
  assert.equal(await rolling, null);
  assert.equal(requestOf(card).status, "cancelled");
  assert.ok(card.content.includes("<p>🚫 Ataque cancelado.</p>"), card.content);
  assert.equal(env.recorded.evaluated.length, 0);
  assert.deepEqual(env.notices(), ["Goblin 2 ataca Orc: escolha a defesa no chat."]);
});

test("the card's defense buttons on the defender's page send the choice and warn as before", async () => {
  const w = world({ user: "pedro" });
  const { env } = w;
  const card = cardFrom(env, request());
  assert.deepEqual(env.notices(), ["Goblin 2 ataca Jerinos: escolha a defesa no chat."]);
  const html = env.render(card);
  const slot = html.querySelector(".ncs-defense-slot");
  assert.equal(slot.texts[0], "Jerinos, escolha a defesa:");
  assert.equal(html.querySelector(".ncs-cancel-attack-btn"), null, "only the attacker's page cancels");
  await html.querySelectorAll(".ncs-defense-btn")[1].click();
  assert.deepEqual(env.recorded.emitted, [{ name: SOCKET, payload: { requestId: card.id, form: "ceder", userId: "pedro" } }]);
  assert.deepEqual(slot.texts, ["🛡️ Defesa enviada. Aguardando a rolagem de Goblin 2."]);
  await env.clock.advance(10000);
  assert.deepEqual(env.notices("warn"),
    ["A defesa não chegou a Goblin 2. A página de quem atacou pode ter sido recarregada: refaçam o ataque."]);
  assert.equal(html.querySelectorAll(".ncs-defense-btn").length, 4, "the buttons are back");

  // An attacker who is not connected: warned, nothing sent, the buttons drawn again.
  const away = world({ user: "pedro", inactive: ["dg"] });
  const awayCard = cardFrom(away.env, request());
  const awayHtml = away.env.render(awayCard);
  await awayHtml.querySelectorAll(".ncs-defense-btn")[0].click();
  assert.deepEqual(away.env.notices("warn"), ["DungeonGuide está desconectado: a defesa não tem para onde ir. Refaçam o ataque."]);
  assert.deepEqual(away.env.recorded.emitted, []);
  assert.equal(awayHtml.querySelectorAll(".ncs-defense-btn").length, 4);

  // Esquiva in armour: the reason, and nothing sent.
  const armoured = world({ user: "pedro", jerinosArmour: true });
  const armouredHtml = armoured.env.render(cardFrom(armoured.env, request()));
  await armouredHtml.querySelectorAll(".ncs-defense-btn")[2].click();
  assert.deepEqual(armoured.env.notices("warn"), ["Esquiva Acrobática: indisponível com armadura ou escudo."]);
  assert.deepEqual(armoured.env.recorded.emitted, []);
});

test("the card's result for 1.7.0 readers", async () => {
  const w = world();
  const { api } = w.env;
  w.env.script.attacks.push({ total: 17, isCritical: true });
  w.env.script.d20.push(7); // Jerinos: 1d20 + 5 = 12
  const { requestId, result } = await api.attack({
    activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken, form: "preciso",
  });
  await api.chooseDefense(requestId, "normal");
  const outcome = await result;
  const card = w.env.game.messages.get(requestId);
  const defense = { form: "normal", name: "Normal", total: 12, formula: "1d20 + 5", hit: true, dice: [[7, true]] };
  assert.deepEqual(requestOf(card), {
    ...request({ form: "preciso", mods: { attack: 2, damage: -3, defense: 0 } }),
    status: "done",
    attackTotal: 17,
    attackFormula: "1d20 + 2",
    isCritical: true,
    defense,
  });
  assert.equal(outcome.status, "done");
  assert.equal(outcome.hit, true);
  assert.equal(outcome.isCritical, true);
  assert.equal(outcome.form, "preciso");
  assert.deepEqual(plain(outcome.mods), { attack: 2, damage: -3, defense: 0 });
  assert.deepEqual(plain(outcome.defense), defense);
  assert.equal(outcome.attackRoll.total, 17);
  assert.equal(outcome.defenseRoll.total, 12);
  for (const text of [
    "<strong>⚔️ Goblin 2 atacou Jerinos!</strong>",
    "🗡️ Ataque Preciso (+2 ataque, −3 dano)",
    "🎲 Ataque: <strong>17</strong>",
    "(1d20 + 2)",
    "🛡️ Defesa (Normal): <strong>12</strong>",
    "O ataque <strong>ACERTOU</strong>!",
    'data-actor-id="goblin" data-item-id="scimitar" data-activity-id="scimitar-attack" data-critical="true" data-damage-bonus="-3"',
    "🎲 Rolar Dano",
  ]) assert.ok(card.content.includes(text), text);
});

test("the API's own calls show no dialog and no notification on its page", async () => {
  // DungeonGuide is a Gamemaster, so the Orc's defense is its own to choose.
  const w = world();
  const { api } = w.env;
  const { requestId, result } = await api.attack({ activity: w.scimitar, attacker: w.goblinToken, target: w.orcToken, form: "defensivo" });
  const { acknowledged } = await api.chooseDefense(requestId, "total");
  assert.equal(await acknowledged, true, "this page is the attacker's: the choice is taken at once");
  assert.equal((await result).status, "done");
  await assert.rejects(api.chooseDefense(requestId, "normal"), { message: "That attack is no longer waiting for a defense." });
  assert.equal(await api.cancelAttack(requestId), false);
  await w.env.clock.advance(10000);
  assert.deepEqual(w.env.notices(), []);
  assert.deepEqual(w.env.recorded.dialogs, []);
});

test("another page still tells the defender to choose when the card came from the API", () => {
  const w = world({ user: "pedro" });
  cardFrom(w.env, request(), { [MODULE]: { api: true } });
  assert.deepEqual(w.env.notices(), ["Goblin 2 ataca Jerinos: escolha a defesa no chat."]);
});

test("a roll that fails rejects the result and cancels the card, silently", async () => {
  const w = world();
  const { api } = w.env;
  w.env.script.rollAttack = () => {
    throw new Error("dnd5e could not roll");
  };
  const { requestId, result } = await api.attack({ activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken });
  await api.chooseDefense(requestId, "normal");
  await assert.rejects(result, { message: "dnd5e could not roll" });
  assert.equal(requestOf(w.env.game.messages.get(requestId)).status, "cancelled");
  assert.deepEqual(w.env.notices(), []);
});

test("dnd5e making no roll, or the target leaving the scene, cancels the attack", async () => {
  const noRoll = world();
  noRoll.env.script.rollAttack = () => null;
  const first = await noRoll.env.api.attack({ activity: noRoll.scimitar, attacker: noRoll.goblinToken, target: noRoll.jerinosToken });
  await noRoll.env.api.chooseDefense(first.requestId, "normal");
  assert.deepEqual(plain(await first.result), { status: "cancelled" });
  assert.equal(requestOf(noRoll.env.game.messages.get(first.requestId)).status, "cancelled");
  assert.deepEqual(noRoll.env.notices(), []);

  const gone = world();
  gone.env.script.rollAttack = () => {
    gone.scene.tokens.delete("tok-jerinos"); // and dnd5e rolls on
  };
  const second = await gone.env.api.attack({ activity: gone.scimitar, attacker: gone.goblinToken, target: gone.jerinosToken });
  await gone.env.api.chooseDefense(second.requestId, "normal");
  assert.deepEqual(plain(await second.result), { status: "cancelled" });
  assert.equal(requestOf(gone.env.game.messages.get(second.requestId)).status, "cancelled");
  assert.equal(gone.env.recorded.rolls.length, 0, "no defense rolled");
  assert.deepEqual(gone.env.notices(), []);
});

test("an attack whose card is deleted before the defense ends cancelled, touching nothing", async () => {
  const w = world();
  const { api } = w.env;
  const { requestId, result } = await api.attack({ activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken });
  w.env.deleteMessage(w.env.game.messages.get(requestId), "victor"); // Victor clears the card from the chat
  assert.equal(await settled(result), true, "the result settles once the card is gone");
  assert.deepEqual(plain(await result), { status: "cancelled" });
  assert.equal(w.env.recorded.rollAttack.length, 0);
  assert.deepEqual(w.env.recorded.updates, []);
  assert.deepEqual(w.env.recorded.refused, [], "no update tried on the deleted card");
  assert.equal(await api.cancelAttack(requestId), false);
  await assert.rejects(api.chooseDefense(requestId, "normal"), { message: "That attack is no longer waiting for a defense." });
  assert.deepEqual(w.env.notices(), []);
});

test("a card deleted once the defense is chosen is not written to, and the attack still finishes", async () => {
  const w = world();
  const { api } = w.env;
  const { requestId, result } = await api.attack({ activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken });
  w.env.script.rollAttack = () => {
    w.env.deleteMessage(w.env.game.messages.get(requestId), "victor"); // while dnd5e rolls, and it rolls on
  };
  await api.chooseDefense(requestId, "normal");
  assert.equal((await result).status, "done");
  assert.deepEqual(w.env.recorded.refused, [], "the result was not written to the deleted card");
  assert.deepEqual(w.env.recorded.updates.map((u) => u.changes.flags[MODULE].defenseRequest.status), ["chosen"]);
});

test("the player's attack whose card is deleted ends without an error", async () => {
  const w = world({ user: "victor" });
  const { env } = w;
  inCombat(w);
  env.script.dialog = () => ({ tokenId: "tok-orc", form: "normal" });
  const rolling = w.scimitar.rollAttack();
  await flush();
  env.deleteMessage(env.game.messages.contents.at(-1));
  assert.equal(await settled(rolling), true, "the held roll ends once the card is gone");
  assert.equal(await rolling, null);
  assert.equal(env.recorded.evaluated.length, 0, "the held d20 never rolled");
  assert.deepEqual(env.recorded.refused, [], "no update tried on the deleted card");
  assert.deepEqual(env.notices(), ["Goblin 2 ataca Orc: escolha a defesa no chat."]);
  assert.deepEqual(env.recorded.console.filter((entry) => entry.level === "error"), []);
});

test("a player's card deleted just after the defense was chosen leaves the attack to roll", async () => {
  const w = world({ user: "victor" });
  const { env } = w;
  inCombat(w);
  env.script.dialog = () => ({ tokenId: "tok-orc", form: "normal" });
  const rolling = w.scimitar.rollAttack();
  await flush();
  const card = env.game.messages.contents.at(-1);
  const choosing = env.render(card).querySelectorAll(".ncs-defense-btn")[0].click();
  env.deleteMessage(card); // the choice was taken first, so the deletion cancels nothing
  await choosing;
  const rolls = await rolling;
  assert.equal(rolls?.length, 1, "the attack rolled");
  assert.equal(env.recorded.rolls.length, 1, "the defense rolled");
  assert.deepEqual(env.recorded.refused, [], "nothing written to the deleted card");
  assert.deepEqual(env.notices(), ["Goblin 2 ataca Orc: escolha a defesa no chat."]);
});

test("the API gives the attack forms, their modifiers, the defenses and the defense bonus", () => {
  const w = world({ jerinosArmour: true });
  const { api } = w.env;
  assert.ok(Object.isFrozen(api));
  assert.equal(api.version, "1.8.0");
  assert.ok(Object.isFrozen(api.attackForms));
  assert.ok(api.attackForms.every((form) => Object.isFrozen(form)));
  assert.deepEqual(plain(api.attackForms), [
    { key: "normal", name: "Normal", title: "Ataque Normal" },
    { key: "ofensivo", name: "Ofensivo", title: "Ataque Ofensivo" },
    { key: "defensivo", name: "Defensivo", title: "Ataque Defensivo" },
    { key: "preciso", name: "Preciso", title: "Ataque Preciso" },
    { key: "determinado", name: "Determinado", title: "Ataque Total Determinado" },
    { key: "violento", name: "Violento", title: "Ataque Total Violento" },
  ]);
  assert.deepEqual(plain(api.formModifiers("ofensivo", 2)), { attack: -2, damage: 3, defense: 0 });
  assert.deepEqual(plain(api.formModifiers("defensivo", 3)), { attack: -3, damage: 0, defense: 3 });
  assert.deepEqual(plain(api.formModifiers("violento", "2")), { attack: 0, damage: 2, defense: 0 });
  assert.deepEqual(plain(api.formModifiers("preciso", null)), { attack: 0, damage: -1, defense: 0 });
  assert.throws(() => api.formModifiers("furioso", 2), { message: "That is not an attack form." });
  assert.deepEqual(plain(api.defenseOptions(w.jerinos)), [
    { form: "normal", name: "Normal", cost: "1 ponto, não gasto", bonus: 0, effect: "1d20 + 5", unavailable: false },
    { form: "ceder", name: "Ceder Terreno", cost: "1 ponto, não gasto", bonus: 1, effect: "+1, recua 1 quadrado", unavailable: false },
    { form: "esquiva", name: "Esquiva Acrobática", cost: "2 pontos", bonus: 0, effect: "indisponível com armadura ou escudo",
      unavailable: true },
    { form: "total", name: "Defesa Total", cost: "3 pontos", bonus: 2, effect: "+2 até o próximo turno", unavailable: false },
  ]);
  assert.deepEqual(plain(api.defenseOptions(w.goblin)[2]),
    { form: "esquiva", name: "Esquiva Acrobática", cost: "2 pontos", bonus: 0, effect: "+0 Acrobacia, recua 1 quadrado", unavailable: false });
  assert.equal(api.defenseBonus(w.goblin), 3);
  assert.equal(api.defenseBonus(w.jerinos), 5);
  assert.throws(() => api.defenseOptions(null), { message: "That is not an actor." });
  assert.throws(() => api.defenseBonus({}), { message: "That is not an actor." });
});

test("without libWrapper the module stays off and has no API", () => {
  const w = world({ modules: { "lib-wrapper": { active: false } } });
  assert.equal(w.env.api, undefined);
  assert.deepEqual(w.env.recorded.wrappers, []);
  assert.deepEqual(w.env.notices("warn"), ["The 'libWrapper' module is required for Custom Defense Bonus to function correctly."]);
});

test("a page that comes back marks its own waiting attacks interrupted", async () => {
  const w = world({ start: false });
  const { env } = w;
  const pending = cardFrom(env, request());
  const chosen = cardFrom(env, request({ status: "chosen" }));
  const finished = cardFrom(env, request({ status: "cancelled" }));
  const others = cardFrom(env, jerinosAttacks());
  env.start();
  await flush();
  assert.equal(requestOf(pending).status, "interrupted");
  assert.equal(requestOf(chosen).status, "interrupted");
  assert.equal(requestOf(finished).status, "cancelled");
  assert.equal(requestOf(others).status, "pending");
  assert.ok(pending.content.includes(
    "⚠️ Ataque interrompido: a página de Goblin 2 foi recarregada antes da rolagem. Refaçam o ataque."), pending.content);
});

test("the result's damage button rolls with the form's damage, which joins the first damage part", async () => {
  const w = world();
  const { api } = w.env;
  w.env.script.attacks.push({ total: 20, isCritical: true });
  const { requestId, result } = await api.attack({ activity: w.scimitar, attacker: w.goblinToken, target: w.jerinosToken, form: "ofensivo" });
  await api.chooseDefense(requestId, "normal");
  await result;
  await w.env.render(w.env.game.messages.get(requestId)).querySelector(".damage-roll-btn").click();
  assert.equal(w.env.recorded.rollDamage.length, 1);
  const [call] = w.env.recorded.rollDamage;
  assert.equal(call.activity, w.scimitar);
  assert.equal(call.config.isCritical, true);
  assert.equal(call.config.garenDamageBonus, 3);

  const config = { garenDamageBonus: 3, rolls: [{ parts: ["1d6 + 2"] }, { parts: ["1d4"] }] };
  w.env.Hooks.callAll("dnd5e.preRollDamageV2", config);
  assert.deepEqual(plain(config.rolls), [{ parts: ["1d6 + 2", "3"] }, { parts: ["1d4"] }]);
  const untouched = { rolls: [{ parts: ["1d6"] }] };
  w.env.Hooks.callAll("dnd5e.preRollDamageV2", untouched);
  assert.deepEqual(plain(untouched.rolls), [{ parts: ["1d6"] }]);
});
