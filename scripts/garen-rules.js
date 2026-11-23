// Iniciativa de Garen: d20 mais o maior entre os modificadores de Destreza e Inteligência.
// Também cuida do botão "Rolar iniciativa" das mensagens do Dungeon Guide, e dos botões de rolar uma perícia de Garen
// (do my-skill-system, do Caio) ou um teste de atributo, que o Dungeon Guide sussurra ao jogador.

// Chamado pelo dnd5e ao montar qualquer rolagem de iniciativa (rastreador, ficha, Combat.rollInitiative).
function garenInitiative(actor, config) {
  const ability = actor?.system?.attributes?.init?.ability || CONFIG.DND5E.defaultAbilities.initiative;
  if (ability !== "dex") return;
  const dex = actor.system.abilities?.dex?.mod;
  const int = actor.system.abilities?.int?.mod;
  if (typeof int !== "number" || typeof dex !== "number" || int <= dex) return;
  if (config?.data) config.data.mod = int;
}

// Ids de combatentes cuja rolagem está em andamento. O botão aparece duas vezes na tela
// (registro do chat e notificação), então o estado desabilitado de um elemento não basta.
const rollsInFlight = new Set();

function findCombatant(button) {
  const combat = game.combats.get(button.dataset.combatId);
  const combatant = combat?.combatants.get(button.dataset.combatantId);
  return { combat, combatant };
}

async function rollInitiativeFromButton(button) {
  const key = button.dataset.combatantId;
  let { combat, combatant } = findCombatant(button);
  if (!combat || !combatant) {
    ui.notifications.warn("Este combate já terminou.");
    return;
  }
  if (rollsInFlight.has(key)) {
    ui.notifications.warn(`A iniciativa de ${combatant.name} já está sendo rolada.`);
    return;
  }
  rollsInFlight.add(key);
  try {
    if (combatant.initiative != null) {
      ui.notifications.warn(`A iniciativa de ${combatant.name} já foi rolada.`);
      return;
    }
    if (!(combatant.isOwner || game.user.isGM)) {
      ui.notifications.warn("Só o dono do personagem ou um mestre pode rolar esta iniciativa.");
      return;
    }

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: `Iniciativa de ${combatant.name}` },
      content: "<p>Como rolar a iniciativa?</p>",
      buttons: [
        { action: "dis", label: "Desvantagem" },
        { action: "normal", label: "Normal", default: true },
        { action: "adv", label: "Vantagem" },
      ],
      rejectClose: false,
    });
    if (!choice) return;

    // O diálogo espera uma pessoa: o combate, o combatente ou o personagem podem ter sumido.
    ({ combat, combatant } = findCombatant(button));
    const actor = combatant?.actor;
    if (!combat || !combatant || !actor) {
      ui.notifications.warn("Este combate já terminou.");
      return;
    }
    if (combatant.initiative != null) {
      ui.notifications.warn(`A iniciativa de ${combatant.name} já foi rolada.`);
      return;
    }

    // Sem valores falsos, para a vantagem de uma característica do personagem continuar combinando.
    const opts = choice === "adv" ? { advantage: true } : choice === "dis" ? { disadvantage: true } : {};
    try {
      actor._cachedInitiativeRoll = actor.getInitiativeRoll(opts);
      await combat.rollInitiative([combatant.id]);
    } catch (error) {
      console.error("new-combat-system | falha ao rolar iniciativa", error);
      ui.notifications.error(`Não foi possível rolar a iniciativa de ${combatant.name}.`);
    } finally {
      delete actor._cachedInitiativeRoll;
    }
  } finally {
    rollsInFlight.delete(key);
  }
}

// Perícias cuja rolagem está em andamento, por personagem e perícia: um segundo clique enquanto o diálogo do dnd5e
// está aberto não abre outro.
const skillRollsInFlight = new Set();

// Rola a perícia como a ficha do my-skill-system rola (rollCustomSkill, que é privada ao módulo do Caio): d20 mais o
// bônus final que o módulo calcula em getRollData, com o diálogo do dnd5e para vantagem e desvantagem.
async function rollSkillFromButton(button, event) {
  const { actorId, skill: key } = button.dataset;
  const actor = game.actors.get(actorId);
  if (!actor) {
    ui.notifications.warn("Este personagem não existe mais.");
    return;
  }
  if (!(actor.isOwner || game.user.isGM)) {
    ui.notifications.warn("Só o dono do personagem ou um mestre pode rolar esta perícia.");
    return;
  }
  const skill = actor.getRollData()?.skills?.[key];
  if (!skill || typeof skill.label !== "string" || !skill.label) {
    ui.notifications.warn(`${actor.name} não tem esta perícia.`);
    return;
  }
  const flight = `${actorId}|${key}`;
  if (skillRollsInFlight.has(flight)) return;
  skillRollsInFlight.add(flight);
  const title = `Perícia: ${skill.label}`;
  try {
    await CONFIG.Dice.D20Roll.build(
      { event, subject: actor, rolls: [{ parts: ["@mod"], data: { mod: skill.mod || 0 }, options: {} }] },
      { options: { window: { title, subtitle: actor.name } } },
      { data: { flavor: title, speaker: ChatMessage.getSpeaker({ actor }) } }
    );
  } catch (error) {
    console.error("new-combat-system | falha ao rolar perícia", error);
    ui.notifications.error(`Não foi possível rolar ${skill.label} de ${actor.name}.`);
  } finally {
    skillRollsInFlight.delete(flight);
  }
}

// Testes de atributo cuja rolagem está em andamento, por personagem e atributo: um segundo clique enquanto o diálogo
// do dnd5e está aberto não abre outro.
const abilityRollsInFlight = new Set();

// Rola o teste de atributo que o Dungeon Guide pediu, pelo próprio rollAbilityCheck do dnd5e, que abre o diálogo com
// vantagem, desvantagem e o modo de rolagem do jogador.
async function rollAbilityFromButton(button, event) {
  const { actorId, ability } = button.dataset;
  const actor = game.actors.get(actorId);
  if (!actor) {
    ui.notifications.warn("Este personagem não existe mais.");
    return;
  }
  if (!(actor.isOwner || game.user.isGM)) {
    ui.notifications.warn("Só o dono do personagem ou um mestre pode rolar este teste.");
    return;
  }
  if (!ability || !Object.hasOwn(CONFIG.DND5E.abilities ?? {}, ability)) {
    ui.notifications.warn(`${actor.name} não tem este atributo.`);
    return;
  }
  const flight = `${actorId}|ability|${ability}`;
  if (abilityRollsInFlight.has(flight)) return;
  abilityRollsInFlight.add(flight);
  try {
    await actor.rollAbilityCheck({ ability, event });
  } catch (error) {
    console.error("new-combat-system | falha ao rolar teste de atributo", error);
    ui.notifications.error(`Não foi possível rolar o teste de ${actor.name}.`);
  } finally {
    abilityRollsInFlight.delete(flight);
  }
}

Hooks.once("init", () => {
  // Garen Custom Rules lived in its own module until 1.8.0; with that module still on, it answers the buttons, so this one stays out.
  if (game.modules.get("garen-initiative")?.active) {
    console.log("new-combat-system | garen-initiative is active, so Garen Custom Rules of this module registers nothing. Switch garen-initiative off.");
    return;
  }
  Hooks.on("dnd5e.preConfigureInitiative", garenInitiative);

  Hooks.on("renderChatMessageHTML", (message, html) => {
    for (const button of html.querySelectorAll("button.ncs-initiative-roll")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        button.disabled = true;
        try {
          await rollInitiativeFromButton(button);
        } finally {
          button.disabled = false;
        }
      });
    }
    for (const button of html.querySelectorAll("button.garen-skill-roll")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        await rollSkillFromButton(button, event);
      });
    }
    for (const button of html.querySelectorAll("button.garen-ability-roll")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        await rollAbilityFromButton(button, event);
      });
    }
  });
});
