// Stand-ins for the parts of Foundry VTT 14 and dnd5e 6 that the module's scripts touch, so that the scripts run
// unchanged inside node:vm. load() runs scripts in one context, which is one page's view of a world: its user, the
// world's users, scenes with their token documents, actors with their items and activities, the chat messages, the
// settings, the socket, the modules, the notifications, the dialogs, the rolls, libWrapper and a clock the test moves.
// What other pages do reaches it through receiveMessage, remoteUpdate and socketReceive, as Foundry's server would
// deliver it.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The module's folder, which the script paths given to load() are read from. */
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A JSON copy, so that objects made inside the context compare with the test's own literals. */
export const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/** Lets every promise chain run until it waits on something else: the context shares Node's microtask queue. */
export async function flush(turns = 10) {
  for (let i = 0; i < turns; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Whether a promise has settled by now, without waiting for it. */
export async function settled(promise) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  await flush();
  return done;
}

/** Foundry's Collection: a Map with the array methods the module calls on it. */
export class Collection extends Map {
  get contents() {
    return [...this.values()];
  }

  filter(fn) {
    return this.contents.filter(fn);
  }

  find(fn) {
    return this.contents.find(fn);
  }

  some(fn) {
    return this.contents.some(fn);
  }

  map(fn) {
    return this.contents.map(fn);
  }

  getByType(type) {
    return this.contents.filter((entry) => entry.type === type);
  }
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Foundry's update of a document's data: nested objects merge key by key, anything else is replaced. */
function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(target[key])) mergeInto(target[key], value);
    else target[key] = value;
  }
  return target;
}

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (c) => ENTITIES[c]);
const unescapeHTML = (text) => String(text)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
const camel = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** "button.class" or ".class", the only selectors the module's scripts use. */
function parseSelector(selector) {
  const match = /^([a-z]+)?\.([\w-]+)$/i.exec(selector);
  if (!match) throw new Error(`The stand-in DOM reads only "tag.class" and ".class" selectors, not ${selector}`);
  return { tag: match[1]?.toUpperCase() ?? null, className: match[2] };
}

/** Enough of an HTML element for the chat cards' buttons: children, classes, data, style, attributes and clicks. */
export class Element {
  constructor(tagName, { className = "", dataset = {} } = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.dataset = { ...dataset };
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.textContent = "";
    this.disabled = false;
    this.type = "";
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  querySelectorAll(selector) {
    const { tag, className } = parseSelector(selector);
    return [...this.descendants()].filter((node) =>
      (!tag || node.tagName === tag) && node.className.split(/\s+/).includes(className));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /** Every text of this element and the elements in it, in document order. */
  get texts() {
    return [this.textContent, ...[...this.descendants()].map((node) => node.textContent)].filter(Boolean);
  }

  /** A click as a browser makes it: nothing on a disabled element. Gives what the listeners give, to be awaited. */
  click() {
    if (this.disabled) return Promise.resolve([]);
    const event = { type: "click", target: this, currentTarget: this, preventDefault() {} };
    return Promise.all((this.listeners.click ?? []).map((fn) => fn(event)));
  }
}

/** A chat message's HTML as the chat log renders it: the defense slot and every button its content holds. */
function renderContent(content) {
  const root = new Element("div", { className: "chat-message message" });
  const text = String(content ?? "");
  if (text.includes('class="ncs-defense-slot"')) root.append(new Element("div", { className: "ncs-defense-slot" }));
  for (const [, attributes] of text.matchAll(/<button\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, unescapeHTML(v)]));
    const dataset = {};
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith("data-")) dataset[camel(key.slice(5))] = value;
    root.append(new Element("button", { className: attrs.class ?? "", dataset }));
  }
  return root;
}

const ABILITIES = { str: {}, dex: {}, con: {}, int: {}, wis: {}, cha: {} };

/**
 * Runs the scripts at sourcePaths, relative to the module's folder, in one new context, and gives the test the
 * environment: env.context, env.game, env.recorded (what the scripts did), env.script (what dnd5e, the dice and the
 * dialogs answer next), env.clock and helpers to build the world, start the module and act for other pages.
 *
 * options: userId, the page's user (the first user by default); users, [{id, name, isGM, active}]; modules, {id: {active,
 * version}} added to lib-wrapper and new-combat-system, both active; settings, {"module.key": value}; globals, anything
 * the context should hold beyond the stand-ins, or in place of one.
 */
export function load(sourcePaths, options = {}) {
  const recorded = {
    hooks: [],
    notifications: [],
    dialogs: [],
    created: [],
    updates: [],
    refused: [],
    emitted: [],
    socketHandlers: [],
    wrappers: [],
    rollAttack: [],
    rollDamage: [],
    evaluated: [],
    rolls: [],
    settings: [],
    console: [],
  };
  const script = { attacks: [], d20: [], dialog: null, rollAttack: null };
  let sequence = 0;
  const nextId = (prefix) => `${prefix}${(sequence += 1)}`;

  // The clock: setTimeout and clearTimeout in the context only run when the test moves it.
  const clock = {
    now: 0,
    timers: [],
    setTimeout(fn, ms = 0, ...args) {
      const id = nextId("timer");
      clock.timers.push({ id, at: clock.now + Number(ms || 0), fn, args });
      return id;
    },
    clearTimeout(id) {
      clock.timers = clock.timers.filter((timer) => timer.id !== id);
    },
    /** Moves the clock on by ms, running each timer due on the way, in time order, and what it starts. */
    async advance(ms) {
      const until = clock.now + ms;
      for (;;) {
        const due = clock.timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock.timers = clock.timers.filter((timer) => timer !== due);
        clock.now = due.at;
        due.fn(...due.args);
        await flush();
      }
      clock.now = until;
      await flush();
    },
  };

  // Hooks, as Foundry runs them: callAll calls every handler of a name in the order registered, once handlers once.
  let handlers = [];
  const Hooks = {
    on(name, fn) {
      const id = nextId("hook");
      handlers.push({ id, name, fn, once: false });
      recorded.hooks.push({ name, fn, once: false });
      return id;
    },
    once(name, fn) {
      const id = nextId("hook");
      handlers.push({ id, name, fn, once: true });
      recorded.hooks.push({ name, fn, once: true });
      return id;
    },
    off(name, key) {
      handlers = handlers.filter((h) => !(h.name === name && (h.id === key || h.fn === key)));
    },
    callAll(name, ...args) {
      for (const handler of handlers.filter((h) => h.name === name)) {
        if (handler.once) Hooks.off(name, handler.id);
        handler.fn(...args);
      }
      return true;
    },
  };

  const users = new Collection();
  for (const spec of options.users ?? [{ id: "gm", name: "Gamemaster", isGM: true }]) {
    users.set(spec.id, { id: spec.id, name: spec.name ?? spec.id, isGM: spec.isGM === true, active: spec.active !== false });
  }
  const user = users.get(options.userId ?? users.contents[0].id);
  if (!user) throw new Error(`No user ${options.userId} among the users`);

  const modules = new Collection();
  const moduleSpecs = {
    "lib-wrapper": { active: true },
    "new-combat-system": { active: true, version: "1.8.0" },
    ...(options.modules ?? {}),
  };
  for (const [id, spec] of Object.entries(moduleSpecs)) modules.set(id, { id, ...spec });

  const settingValues = new Map(Object.entries(options.settings ?? {}));
  const registeredSettings = new Map();

  const game = {
    user,
    users,
    modules,
    actors: new Collection(),
    scenes: new Collection(),
    messages: new Collection(),
    combats: new Collection(),
    combat: null,
    settings: {
      register(module, key, config) {
        registeredSettings.set(`${module}.${key}`, config);
        recorded.settings.push({ module, key, config });
      },
      get(module, key) {
        const id = `${module}.${key}`;
        if (settingValues.has(id)) return settingValues.get(id);
        if (registeredSettings.has(id)) return registeredSettings.get(id).default;
        throw new Error(`${id} is not a registered game setting`);
      },
    },
    socket: {
      on(name, fn) {
        recorded.socketHandlers.push({ name, fn });
      },
      emit(name, payload) {
        recorded.emitted.push({ name, payload: plain(payload) });
      },
    },
  };

  const notify = (type) => (text) => {
    recorded.notifications.push({ type, text });
    return { type, text };
  };
  const ui = { notifications: { info: notify("info"), warn: notify("warn"), error: notify("error") } };

  // A chat message: its author is the User, as message.author is in Foundry 14; its data is a copy, as the server's.
  function makeMessage({ id, author, speaker = {}, content = "", flags = {} }) {
    const message = {
      id: id ?? nextId("message"),
      author: users.get(author) ?? null,
      speaker: plain(speaker),
      content,
      flags: plain(flags) ?? {},
      async update(changes, updateOptions = {}) {
        // The server refuses a message that was deleted, and anyone but its author and the Gamemasters.
        const refusal = !game.messages.has(message.id)
          ? `ChatMessage ${message.id} does not exist`
          : message.author?.id !== game.user.id && !game.user.isGM
            ? `${game.user.name} lacks permission to update ChatMessage ${message.id}`
            : null;
        if (refusal) {
          recorded.refused.push({ id: message.id, changes: plain(changes), reason: refusal });
          throw new Error(refusal);
        }
        await Promise.resolve();
        return applyUpdate(message, changes, updateOptions, game.user.id);
      },
    };
    return message;
  }

  function applyUpdate(message, changes, updateOptions, userId) {
    const copy = plain(changes);
    mergeInto(message, copy);
    recorded.updates.push({ id: message.id, changes: copy, userId });
    Hooks.callAll("updateChatMessage", message, copy, updateOptions, userId);
    return message;
  }

  const ChatMessage = {
    async create(data, createOptions = {}) {
      await Promise.resolve();
      const message = makeMessage({ ...data, author: data.author ?? game.user.id });
      game.messages.set(message.id, message);
      recorded.created.push({ message, data: plain(data), options: plain(createOptions) });
      Hooks.callAll("createChatMessage", message, createOptions, game.user.id);
      return message;
    },
    getSpeaker({ scene, actor, token, alias } = {}) {
      return {
        scene: token?.parent?.id ?? scene?.id ?? null,
        actor: actor?.id ?? token?.actor?.id ?? null,
        token: token?.id ?? null,
        alias: alias ?? token?.name ?? actor?.name ?? null,
      };
    },
  };

  // Foundry's Roll for a formula of one d20 and whole numbers: the d20 shows the next face of script.d20, 10 when
  // none is left, and the total adds the numbers.
  class Roll {
    constructor(formula, data = {}) {
      this.formula = formula;
      this.data = data;
      this.evaluated = false;
      recorded.rolls.push(this);
    }

    async evaluate() {
      const face = script.d20.length ? script.d20.shift() : 10;
      const modifier = [...this.formula.matchAll(/([+-])\s*(\d+)\b(?!d)/g)]
        .reduce((sum, [, sign, number]) => sum + (sign === "-" ? -1 : 1) * Number(number), 0);
      this.total = face + modifier;
      this.dice = [{ faces: 20, number: 1, results: [{ result: face, active: true }] }];
      this.evaluated = true;
      return this;
    }
  }

  // dnd5e's D20Roll for an attack: its total is the next of script.attacks, {total, isCritical, d20}, when it is
  // evaluated. buildEvaluate, which libWrapper may wrap, evaluates the rolls.
  class D20Roll {
    constructor(formula, data = {}, rollOptions = {}) {
      this.formula = formula;
      this.data = data;
      this.options = rollOptions;
      this.evaluated = false;
    }

    async evaluate() {
      const next = script.attacks.length ? script.attacks.shift() : { total: 10 };
      this.total = next.total;
      this.isCritical = next.isCritical === true;
      this.isFumble = next.isFumble === true;
      this.dice = [{ faces: 20, number: 1, results: [{ result: next.d20 ?? 10, active: true }] }];
      this.evaluated = true;
      recorded.evaluated.push(this);
      return this;
    }

    static async buildEvaluate(rolls, config = {}, message = {}) {
      for (const roll of rolls) await roll.evaluate();
    }
  }

  // dnd5e's attack activity. rollAttack builds one attack roll from config.rolls[0].parts, evaluates it through
  // CONFIG.Dice.D20Roll.buildEvaluate and gives the rolls, or null when none is left. script.rollAttack(call), when
  // set, runs first: what it gives, other than undefined, is given instead, and what it throws is thrown.
  class AttackActivity {
    constructor(data) {
      Object.assign(this, data);
    }

    async rollAttack(config = {}, dialog = {}, message = {}) {
      const call = { activity: this, config, dialog, message, rolls: null };
      recorded.rollAttack.push(call);
      if (script.rollAttack) {
        const answer = await script.rollAttack(call);
        if (answer !== undefined) return answer;
      }
      const parts = config.rolls?.[0]?.parts ?? [];
      const advantageMode = config.advantage ? 1 : config.disadvantage ? -1 : 0;
      const rolls = [new D20Roll(["1d20", ...parts].join(" + "), {}, { advantageMode })];
      call.rolls = rolls;
      await context.CONFIG.Dice.D20Roll.buildEvaluate(rolls, config, message);
      return rolls.length ? rolls : null;
    }

    async rollDamage(config = {}, dialog = {}, message = {}) {
      recorded.rollDamage.push({ activity: this, config, dialog, message });
      return [];
    }
  }

  // libWrapper: the wrapper takes the place of the target, called with the original bound to the same this.
  const libWrapper = {
    register(moduleId, target, fn, type) {
      recorded.wrappers.push({ moduleId, target, fn, type });
      const keys = target.split(".");
      const owner = keys.slice(0, -1).reduce((object, key) => object[key], context);
      const key = keys.at(-1);
      const original = owner[key];
      owner[key] = function wrapper(...args) {
        return fn.call(this, original.bind(this), ...args);
      };
    },
  };

  const record = (level) => (...args) => recorded.console.push({ level, args });

  const context = {
    Hooks,
    game,
    ui,
    ChatMessage,
    Roll,
    libWrapper,
    canvas: { ready: false },
    CONFIG: {
      DND5E: {
        abilities: ABILITIES,
        defaultAbilities: { initiative: "dex" },
        activityTypes: { attack: { documentClass: AttackActivity } },
      },
      Dice: { D20Roll },
    },
    foundry: {
      utils: { escapeHTML, deepClone: (value) => structuredClone(value) },
      applications: {
        api: {
          DialogV2: {
            async wait(dialogOptions) {
              recorded.dialogs.push(dialogOptions);
              return script.dialog ? script.dialog(dialogOptions) : null;
            },
          },
        },
      },
    },
    document: { createElement: (tagName) => new Element(tagName) },
    console: { log: record("log"), info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    ...(options.globals ?? {}),
  };
  vm.createContext(context);
  for (const sourcePath of sourcePaths) {
    const filename = path.join(ROOT, sourcePath);
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  }

  const env = {
    context,
    game,
    recorded,
    script,
    clock,
    Hooks,

    /** The module's API, once the ready hook has set it. */
    get api() {
      return game.modules.get("new-combat-system")?.api;
    },

    init() {
      Hooks.callAll("init");
    },

    ready() {
      Hooks.callAll("ready");
    },

    start() {
      env.init();
      env.ready();
      return env;
    },

    addScene(id) {
      const scene = { id, name: id, tokens: new Collection() };
      game.scenes.set(id, scene);
      return scene;
    },

    /** An actor: owners are the ids of the users who own it besides the Gamemasters, as Foundry's ownership is. */
    addActor({ id, name = id, type = "npc", ac = 10, prof = 2, owners = [], armor = false, shield = false, acrobacia = null } = {}) {
      const actor = {
        id,
        name,
        type,
        owners: [...owners],
        system: {
          attributes: {
            ac: { value: ac, equippedArmor: armor ? { name: "Armour" } : null, equippedShield: shield ? { name: "Shield" } : null },
            prof,
          },
        },
        flags: acrobacia === null ? {} : { "my-skill-system": { skills: { acrobacia } } },
        items: new Collection(),
        testUserPermission(someone, level) {
          return level === "OWNER" && (someone?.isGM === true || actor.owners.includes(someone?.id));
        },
        get isOwner() {
          return actor.testUserPermission(game.user, "OWNER");
        },
      };
      game.actors.set(id, actor);
      return actor;
    },

    /** A token document on the scene; Foundry's token ids are the ids of its canvas tokens too. */
    addToken(scene, { id, name, actor }) {
      const token = { id, name, actor, parent: scene, documentName: "Token" };
      scene.tokens.set(id, token);
      return token;
    },

    addItem(actor, { id, name = id, type = "weapon", range = {} }) {
      const item = {
        id,
        name,
        type,
        actor,
        system: { range: { value: 5, long: null, reach: null, ...range }, activities: new Collection() },
      };
      actor.items.set(id, item);
      return item;
    },

    addActivity(item, { id }) {
      const activity = new context.CONFIG.DND5E.activityTypes.attack.documentClass({
        id, type: "attack", item, actor: item.actor, range: {},
      });
      item.system.activities.set(id, activity);
      return activity;
    },

    /**
     * A ready canvas showing the scene: positions gives each token's square as [row, column], squares are 100 pixels
     * and 5 feet, and controlled is the id of the token the user has selected.
     */
    useCanvas(scene, { positions = {}, controlled = null } = {}) {
      const placeables = scene.tokens.contents.map((doc) => {
        const [i, j] = positions[doc.id] ?? [0, 0];
        return {
          id: doc.id,
          name: doc.name,
          actor: doc.actor,
          document: { ...doc, getOccupiedGridSpaceOffsets: () => [{ i, j }] },
          center: { x: j * 100 + 50, y: i * 100 + 50 },
        };
      });
      context.canvas = {
        ready: true,
        scene,
        tokens: {
          controlled: placeables.filter((p) => p.id === controlled),
          placeables,
          get: (id) => placeables.find((p) => p.id === id),
        },
        grid: {
          getCenterPoint: ({ i, j }) => ({ x: j * 100 + 50, y: i * 100 + 50 }),
          measurePath: ([a, b]) => ({ distance: (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / 100) * 5 }),
        },
      };
      return context.canvas;
    },

    /** A message another user's page made, as it arrives on this page. */
    receiveMessage(data, createOptions = {}) {
      const message = makeMessage(data);
      game.messages.set(message.id, message);
      Hooks.callAll("createChatMessage", message, createOptions, data.author);
      return message;
    },

    /** A change another user's page made to a message, as it arrives on this page. */
    remoteUpdate(message, changes, userId) {
      return applyUpdate(message, changes, {}, userId);
    },

    /** A message deleted, by this page's user or another's, as every page sees it: gone, then the hook. */
    deleteMessage(message, userId = game.user.id) {
      game.messages.delete(message.id);
      Hooks.callAll("deleteChatMessage", message, {}, userId);
    },

    /** What another page sent on a socket channel, as this page's handlers receive it. */
    socketReceive(payload, channel = "module.new-combat-system") {
      for (const handler of recorded.socketHandlers.filter((h) => h.name === channel)) handler.fn(plain(payload));
    },

    /** The message as the chat log shows it on this page: its HTML, after every renderChatMessageHTML hook. */
    render(message) {
      const html = renderContent(message.content);
      Hooks.callAll("renderChatMessageHTML", message, html, {});
      return html;
    },

    /** The texts of the notifications shown so far, of one type or all. */
    notices(type = null) {
      return recorded.notifications.filter((n) => !type || n.type === type).map((n) => n.text);
    },
  };
  return env;
}
