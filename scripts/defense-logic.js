// Ported to Foundry 14 and dnd5e 6: attacks now live on activities, not items.
// O arquivo inteiro fica dentro de uma função para que as funções auxiliares não virem
// globais do navegador, compartilhadas com os scripts de outros módulos.
(() => {
  const MODULE_ID = "new-combat-system";
  const SOCKET = `module.${MODULE_ID}`;
  // Versão da API do módulo, game.modules.get("new-combat-system").api, que o Dungeon Guide usa.
  const API_VERSION = "1.8.0";
  // Tempo para o computador de quem atacou confirmar que recebeu a defesa escolhida.
  const ACK_TIMEOUT_MS = 10000;
  const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

  // Formas de ataque do PDF "Novos sistemas de Garen" (v1.6). Os modificadores são
  // múltiplos da Proficiência de quem ataca. O bônus de Defesa do Defensivo não é
  // guardado: o card só lembra a mesa de somá-lo no próximo ataque sofrido.
  const ATTACK_FORMS = {
    normal: { name: "Normal", title: "Ataque Normal" },
    ofensivo: { name: "Ofensivo", title: "Ataque Ofensivo" },
    defensivo: { name: "Defensivo", title: "Ataque Defensivo" },
    preciso: { name: "Preciso", title: "Ataque Preciso" },
    determinado: { name: "Determinado", title: "Ataque Total Determinado" },
    violento: { name: "Violento", title: "Ataque Total Violento" },
  };

  function getFormModifiers(form, prof) {
    switch (form) {
      case "ofensivo": return { attack: -prof, damage: prof + 1, defense: 0 };
      case "defensivo": return { attack: -prof, damage: 0, defense: prof };
      case "preciso": return { attack: prof, damage: -(prof + 1), defense: 0 };
      case "determinado": return { attack: prof, damage: 0, defense: 0 };
      case "violento": return { attack: 0, damage: prof, defense: 0 };
      default: return { attack: 0, damage: 0, defense: 0 };
    }
  }

  // Sinal de menos tipográfico, que leitores de tela leem como "menos".
  function signed(value) {
    return value < 0 ? `−${-value}` : `+${value}`;
  }

  function describeModifiers(mods, separator = ", ") {
    const parts = [];
    if (mods.attack) parts.push(`${signed(mods.attack)} ataque`);
    if (mods.damage) parts.push(`${signed(mods.damage)} dano`);
    if (mods.defense) parts.push(`${signed(mods.defense)} defesa`);
    return parts.join(separator);
  }

  // ---------------------------------------------------------------------------
  // Defesa
  //
  // Ordem pedida pela mesa: quem ataca escolhe a forma de ataque, quem defende escolhe a
  // forma de defesa, e só então os dados rolam. O atacante publica um card de pedido;
  // quem defende escolhe nos botões do card (o mestre, se o alvo for NPC; o dono, se for
  // personagem de jogador); a escolha chega ao computador do atacante pelo socket do
  // módulo, que rola ataque e defesa e transforma o mesmo card no resultado.
  //
  // Pontos de ação não são contados nem descontados, o botão só mostra o custo. O recuo
  // de Ceder Terreno e da Esquiva não move o token: o card lembra a mesa. A Defesa Total
  // vale só na rolagem em que foi escolhida; nos ataques seguintes o defensor a escolhe
  // de novo.
  // ---------------------------------------------------------------------------
  const DEFENSE_FORMS = {
    normal: { name: "Normal", cost: "1 ponto, não gasto" },
    ceder: { name: "Ceder Terreno", cost: "1 ponto, não gasto" },
    esquiva: { name: "Esquiva Acrobática", cost: "2 pontos" },
    total: { name: "Defesa Total", cost: "3 pontos" },
  };

  // "1d20 + 5 + 1", omitindo zeros e escrevendo negativos como subtração.
  function rollFormula(...modifiers) {
    const terms = modifiers.filter(Boolean).map((m) => (m < 0 ? `- ${-m}` : `+ ${m}`));
    return ["1d20", ...terms].join(" ");
  }

  // Defense Bonus de Garen: a antiga CA menos 10.
  function getDefenseBonus(actor) {
    return (Number(actor.system.attributes?.ac?.value) || 10) - 10;
  }

  function getDefenseOptions(actor) {
    const prof = Number(actor.system.attributes?.prof) || 0;
    // Pontos crus de Acrobacia do Skill Point System (my-skill-system), lidos direto das
    // flags para não depender de aquele módulo estar ativo. Sem pontos, soma zero.
    const acrobacia = Number(actor.flags?.["my-skill-system"]?.skills?.acrobacia) || 0;
    // A Esquiva exige estar sem armadura e sem escudo; o dnd5e marca os equipados na CA.
    const ac = actor.system.attributes?.ac ?? {};
    const armored = Boolean(ac.equippedArmor || ac.equippedShield);
    const options = [
      { form: "normal", bonus: 0, effect: rollFormula(getDefenseBonus(actor)), unavailable: false },
      { form: "ceder", bonus: 1, effect: "+1, recua 1 quadrado", unavailable: false },
      armored
        ? { form: "esquiva", bonus: 0, effect: "indisponível com armadura ou escudo", unavailable: true }
        : { form: "esquiva", bonus: acrobacia, effect: `${signed(acrobacia)} Acrobacia, recua 1 quadrado`, unavailable: false },
      { form: "total", bonus: prof, effect: `${signed(prof)} até o próximo turno`, unavailable: false },
    ];
    return options.map((option) => ({ ...option, ...DEFENSE_FORMS[option.form] }));
  }

  // O token atacado, procurado na cena do ataque para funcionar mesmo se quem defende
  // estiver olhando outra cena.
  function getDefenderToken(request) {
    return game.scenes?.get(request.sceneId)?.tokens?.get(request.targetTokenId) ?? null;
  }

  // Quem deve responder: os jogadores conectados donos do alvo, na ordem de game.users. Sem
  // nenhum (NPC ou jogador ausente), o mestre. O mestre vê os botões sempre, como reserva.
  function getResponders(actor) {
    return game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  }

  function isExpectedResponder(actor, user = game.user) {
    const players = getResponders(actor);
    if (players.length) return players.some((u) => u.id === user.id);
    return Boolean(user.isGM);
  }

  const getRequest = (message) => message?.flags?.[MODULE_ID]?.defenseRequest ?? null;

  function formLine(request) {
    if (request.form === "normal" || !ATTACK_FORMS[request.form]) return "";
    const effect = describeModifiers({ ...request.mods, defense: 0 });
    return `<p>🗡️ ${ATTACK_FORMS[request.form].title}${effect ? ` (${effect})` : ""}</p>`;
  }

  const cardFrame = (inner) =>
    `<div style="border:1px solid #999; border-radius:6px; padding:8px; margin:4px 0;">${inner}</div>`;

  // Card do pedido, um texto por estado. No estado "pending" os botões de defesa entram
  // na renderização, só para quem pode responder; os outros veem o aviso de espera.
  // Nenhum estado antes do resultado mostra a forma de defesa escolhida.
  function buildRequestContent(request) {
    const attacker = esc(request.attackerName);
    const target = esc(request.targetName);
    const status = {
      pending: `<div class="ncs-defense-slot"><p>⏳ Aguardando a defesa de ${target}.</p></div>`,
      chosen: `<p>🛡️ ${target} escolheu a defesa. Aguardando a rolagem de ${attacker}.</p>`,
      cancelled: "<p>🚫 Ataque cancelado.</p>",
      interrupted: `<p>⚠️ Ataque interrompido: a página de ${attacker} foi recarregada antes da rolagem. Refaçam o ataque.</p>`,
    }[request.status] ?? "";
    return cardFrame(`<p><strong>⚔️ ${attacker} ataca ${target}!</strong></p>${formLine(request)}${status}`);
  }

  function buildResultContent(request, option) {
    const attacker = esc(request.attackerName);
    const target = esc(request.targetName);
    const { defense } = request;
    // O veredito vem pronto em defense.hit: pelas regras de Garen, o empate é do atacante, ou seja, empate acerta.
    const verdict = defense.hit ? "✅ O ataque <strong>ACERTOU</strong>!" : "❌ O ataque <strong>ERROU</strong>!";
    let notes = "";
    if (option.form === "ceder" || option.form === "esquiva") {
      notes += `<p>↩️ ${target} recua 1 quadrado, afastando-se de ${attacker}.</p>`;
    }
    if (option.form === "total") {
      notes += `<p>🛡️ A Defesa Total de ${target} vale até o próximo turno: nos próximos ataques, escolha Defesa Total de novo, sem gastar pontos.</p>`;
    }
    if (request.mods?.defense) {
      notes += `<p>🛡️ Some <strong>${signed(request.mods.defense)}</strong> na Defesa de ${attacker} contra o próximo ataque sofrido.</p>`;
    }
    return cardFrame(`
      <p><strong>⚔️ ${attacker} atacou ${target}!</strong></p>
      ${formLine(request)}
      <p>🎲 Ataque: <strong>${request.attackTotal}</strong> <span style="opacity:0.7">(${esc(request.attackFormula)})</span></p>
      <p>🛡️ Defesa (${esc(option.name)}): <strong>${defense.total}</strong> <span style="opacity:0.7">(${esc(defense.formula)})</span></p>
      <p>${verdict}</p>
      ${notes}
      <button type="button" class="damage-roll-btn" data-actor-id="${esc(request.attackerActorId)}" data-item-id="${esc(request.itemId)}" data-activity-id="${esc(request.activityId)}" data-critical="${request.isCritical === true}" data-damage-bonus="${Number(request.mods?.damage) || 0}">🎲 Rolar Dano</button>
    `);
  }

  // Só o autor (quem atacou) e o mestre podem editar o card; por isso todas as
  // mudanças de estado acontecem no computador de quem atacou. Um card apagado, que não
  // está mais em game.messages, não é tocado: não há mais o que editar.
  async function updateRequest(message, request, content = buildRequestContent(request)) {
    if (!game.messages.get(message.id)) return null;
    return message.update({ content, flags: { [MODULE_ID]: { defenseRequest: request } } });
  }

  // Esperas abertas neste computador: uma por ataque em andamento, até a defesa chegar.
  const waits = new Map();

  function createWait(requestId) {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    const wait = { promise, resolve, choice: null };
    waits.set(requestId, wait);
    return wait;
  }

  // O pedido de um ataque, como o card o guarda. Os tokens são os do canvas (fluxo do jogador) ou TokenDocuments
  // (API), e os nomes são os dos tokens, para distinguir cinco goblins com a mesma ficha. Um token que não é do
  // atacante não dá nome nem id: attackerTokenId fica nulo.
  function makeRequest(activity, attackerToken, targetToken, sceneId, form, mods) {
    const ownToken = attackerToken?.actor?.id === activity.actor.id ? attackerToken : null;
    return {
      attackerUserId: game.user.id,
      attackerActorId: activity.actor.id,
      attackerTokenId: ownToken?.id ?? null,
      attackerName: ownToken?.name || activity.actor.name,
      itemId: activity.item.id,
      itemName: activity.item.name ?? null,
      activityId: activity.id,
      sceneId,
      targetTokenId: targetToken.id,
      targetName: targetToken.name || targetToken.actor.name,
      form,
      mods,
      status: "pending",
    };
  }

  // O modificador de ataque da forma entra como primeira parte da primeira rolagem configurada.
  function withAttackModifier(config, attack) {
    if (!attack) return config;
    const [first = {}, ...rest] = config.rolls ?? [];
    return { ...config, rolls: [{ ...first, parts: [String(attack), ...(first.parts ?? [])] }, ...rest] };
  }

  // Publica o card do pedido, antes de qualquer dado, e abre neste computador a espera pela defesa.
  async function postRequest(request, speaker, options = {}) {
    const message = await ChatMessage.create({
      author: game.user.id,
      speaker,
      content: buildRequestContent(request),
      flags: { [MODULE_ID]: { defenseRequest: request } },
    }, options);
    return { message, wait: createWait(message.id) };
  }

  // Cada dado de uma rolagem como [resultado, contou], para quem lê o card sem a rolagem.
  function diceOf(roll) {
    const dice = [];
    for (const term of roll.dice ?? []) {
      for (const die of term.results ?? []) dice.push([die.result, die.active !== false && die.discarded !== true]);
    }
    return dice;
  }

  // Rola a defesa escolhida e transforma o card no resultado. Sem o alvo na cena, não rola nada e devolve null.
  async function rollDefense(message, request, attackRoll, choice) {
    const defender = getDefenderToken(request)?.actor;
    if (!defender) return null;
    const options = getDefenseOptions(defender);
    const option = options.find((o) => o.form === choice.form && !o.unavailable) ?? options[0];
    const formula = rollFormula(getDefenseBonus(defender), option.bonus);
    const defenseRoll = await new Roll(formula).evaluate();
    // Pelas regras de Garen, o empate é do atacante, ou seja, empate acerta.
    const hit = attackRoll.total >= defenseRoll.total;
    const done = {
      ...request,
      status: "done",
      attackTotal: attackRoll.total,
      attackFormula: attackRoll.formula,
      isCritical: attackRoll.isCritical === true,
      defense: { form: option.form, name: option.name, total: defenseRoll.total, formula, hit, dice: diceOf(defenseRoll) },
    };
    console.log("[new-combat-system] Defesa de", request.targetName, option.form, defenseRoll.total, "contra", attackRoll.total);
    await updateRequest(message, done, buildResultContent(done, option));
    return { request: done, defenseRoll };
  }

  // Computador de quem atacou: recebe a defesa escolhida, confere quem escolheu e marca
  // o card como "escolhida", o que serve de confirmação para quem defendeu.
  async function receiveChoice({ requestId, form, userId }) {
    const wait = waits.get(requestId);
    if (!wait || wait.choice) return;
    const message = game.messages.get(requestId);
    const request = getRequest(message);
    if (request?.status !== "pending") return;
    const defender = getDefenderToken(request)?.actor;
    const user = game.users.get(userId);
    if (!defender || !user || !defender.testUserPermission(user, "OWNER")) return;
    const option = getDefenseOptions(defender).find((o) => o.form === form);
    if (!option || option.unavailable) return;
    // Reservada antes de qualquer espera, para que uma segunda escolha seja ignorada.
    wait.choice = { form, userId };
    console.log("[new-combat-system] Defesa escolhida para", request.targetName, form);
    try {
      await updateRequest(message, { ...request, status: "chosen" });
    } finally {
      wait.resolve(wait.choice);
    }
  }

  // Desiste de um ataque deste computador que ainda espera a defesa. Devolve se desistiu.
  async function cancelAttack(message) {
    const wait = waits.get(message?.id);
    const request = getRequest(message);
    if (!wait || wait.choice || request?.status !== "pending") return false;
    wait.choice = { cancelled: true };
    try {
      await updateRequest(message, { ...request, status: "cancelled" });
    } finally {
      wait.resolve(wait.choice);
    }
    return true;
  }

  // Leva a escolha ao computador de quem atacou: direto, quando é este; senão, pelo socket do módulo, cuja
  // mensagem receiveChoice recebe lá. Os botões do card e a API mandam por aqui.
  function sendChoice(requestId, request, form) {
    const payload = { requestId, form, userId: game.user.id };
    if (request.attackerUserId === game.user.id) {
      receiveChoice(payload).catch((err) => console.error("[new-combat-system] A defesa falhou:", err));
    } else {
      game.socket.emit(SOCKET, payload);
    }
  }

  // Computador de quem defende: manda a escolha e confere se ela chegou.
  function chooseDefense(message, request, form, html) {
    if (request.attackerUserId !== game.user.id) {
      const attackerUser = game.users.get(request.attackerUserId);
      if (!attackerUser?.active) {
        ui.notifications.warn(`${attackerUser?.name ?? "Quem atacou"} está desconectado: a defesa não tem para onde ir. Refaçam o ataque.`);
        return false;
      }
    }
    sendChoice(message.id, request, form);
    setTimeout(() => {
      const current = game.messages.get(message.id);
      if (getRequest(current)?.status !== "pending") return;
      ui.notifications.warn(`A defesa não chegou a ${request.attackerName}. A página de quem atacou pode ter sido recarregada: refaçam o ataque.`);
      renderDefenseSlot(current, getRequest(current), html);
    }, ACK_TIMEOUT_MS);
    return true;
  }

  // Preenche o espaço da defesa no card do pedido, de acordo com quem está vendo.
  function renderDefenseSlot(message, request, html) {
    const slot = html.querySelector?.(".ncs-defense-slot");
    if (!slot || request.status !== "pending") return;
    const paragraph = (text) => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    };
    const nodes = [];
    const defender = getDefenderToken(request)?.actor;

    if (!defender) {
      nodes.push(paragraph(`${request.targetName} não está mais na cena: a defesa não pode ser escolhida.`));
    } else if (!defender.isOwner) {
      nodes.push(paragraph(`⏳ Aguardando a defesa de ${request.targetName}.`));
    } else {
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", `Defesa de ${request.targetName}`);
      Object.assign(group.style, { display: "flex", flexWrap: "wrap", gap: "4px" });
      const options = getDefenseOptions(defender);
      const buttons = options.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ncs-defense-btn";
        button.dataset.form = option.form;
        // Um dado por linha; o leitor de tela lê as linhas em sequência.
        button.textContent = option.unavailable
          ? `${option.name}\n${option.effect}`
          : `${option.name}\n${option.effect}\n${option.cost}`;
        Object.assign(button.style, {
          flex: "1 1 45%", height: "auto", whiteSpace: "pre-line", lineHeight: "1.3", padding: "0.25rem 0.5rem",
        });
        // Indisponível continua no Tab, para o leitor de tela anunciar o motivo; o
        // atributo disabled tiraria o botão da navegação por teclado.
        if (option.unavailable) {
          button.setAttribute("aria-disabled", "true");
          Object.assign(button.style, { opacity: "0.5", cursor: "not-allowed" });
        }
        return button;
      });
      buttons.forEach((button, i) => {
        const option = options[i];
        button.addEventListener("click", (event) => {
          event.preventDefault();
          if (option.unavailable) {
            ui.notifications.warn(`${option.name}: ${option.effect}.`);
            return;
          }
          for (const b of buttons) b.disabled = true;
          if (chooseDefense(message, request, option.form, html)) {
            slot.replaceChildren(paragraph(`🛡️ Defesa enviada. Aguardando a rolagem de ${request.attackerName}.`));
          } else {
            renderDefenseSlot(message, request, html);
          }
        });
      });
      group.append(...buttons);
      nodes.push(paragraph(`${request.targetName}, escolha a defesa:`), group);
    }

    // Quem atacou pode desistir enquanto espera, se este computador ainda guarda o ataque.
    if (request.attackerUserId === game.user.id && waits.has(message.id)) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "ncs-cancel-attack-btn";
      cancel.textContent = "Cancelar ataque";
      cancel.addEventListener("click", (event) => {
        event.preventDefault();
        cancel.disabled = true;
        cancelAttack(message).catch((err) => console.error("[new-combat-system] O cancelamento falhou:", err));
      });
      nodes.push(cancel);
    }
    slot.replaceChildren(...nodes);
  }

  // ---------------------------------------------------------------------------
  // API para o Dungeon Guide: game.modules.get("new-combat-system").api
  //
  // O fluxo do jogador sem janelas e sem avisos na tela, que funciona sem canvas e sem game.combat, como na página
  // do app do mestre. O card, a espera, a escolha da defesa, o cancelamento e o resultado são as mesmas funções
  // internas do fluxo do jogador. Cada função confere os argumentos e, quando recusa, lança um Error com uma frase em
  // inglês, a língua do app.
  // ---------------------------------------------------------------------------

  function checkedActor(actor) {
    if (!actor?.system || typeof actor.testUserPermission !== "function") throw new Error("That is not an actor.");
    return actor;
  }

  // Ataque sem janela: confere os argumentos, publica o card do pedido como runAttack e devolve logo o id do card e a
  // promessa do resultado, que segue sozinha quando a defesa chegar.
  async function apiAttack({ activity, attacker, target, form = "normal", roll = {}, message = {} } = {}) {
    if (activity?.type !== "attack" || typeof activity.rollAttack !== "function" || !activity.item || !activity.actor) {
      throw new Error("That is not an attack activity.");
    }
    if (!Object.hasOwn(ATTACK_FORMS, form)) throw new Error("That is not an attack form.");
    // Magias só têm o ataque normal, como no diálogo.
    if (activity.item.type === "spell" && form !== "normal") throw new Error("A spell attacks only in the normal form.");
    const sceneId = attacker?.parent?.id;
    if (!attacker?.id || !sceneId) throw new Error("The attacker must be a token on a scene.");
    if (!target?.id || target.parent?.id !== sceneId) throw new Error("The target must be a token on the attacker's scene.");
    if (target.id === attacker.id) throw new Error("A token cannot attack itself.");
    if (!target.actor) throw new Error("The target has no actor.");

    const prof = Number(activity.actor.system.attributes?.prof) || 0;
    const request = makeRequest(activity, attacker, target, sceneId, form, getFormModifiers(form, prof));
    const speaker = ChatMessage.getSpeaker({ token: attacker, actor: activity.actor });
    // A marca nas opções da criação cala, só na página que publicou, o aviso de pedido novo (ver createChatMessage).
    const { message: card, wait } = await postRequest(request, speaker, { [MODULE_ID]: { api: true } });
    const result = finishApiAttack(activity, card, request, wait, roll ?? {}, message ?? {});
    return { requestId: card.id, result };
  }

  // O resto do ataque da API, em segundo plano: espera a defesa; rola o ataque pelo dnd5e sem janela, com a marca
  // garenApi, que faz o wrapper de rollAttack deste módulo passar a rolagem direto ao dnd5e; rola a defesa e escreve o
  // resultado no card. Cancelado, sem rolagem do dnd5e ou sem o alvo na cena, termina "cancelled"; um erro deixa o
  // card cancelado e rejeita.
  async function finishApiAttack(activity, card, request, wait, roll, messageConfig) {
    const choice = await wait.promise;
    waits.delete(card.id);
    if (choice.cancelled) return { status: "cancelled" };
    const cancel = () => updateRequest(card, { ...request, status: "cancelled" });
    try {
      const config = withAttackModifier({ ...roll, garenApi: true }, request.mods.attack);
      const attackRolls = await activity.rollAttack(config, { configure: false }, messageConfig);
      const attackRoll = Array.isArray(attackRolls) ? attackRolls[0] : attackRolls;
      const finished = attackRoll ? await rollDefense(card, request, attackRoll, choice) : null;
      if (!finished) {
        await cancel();
        return { status: "cancelled" };
      }
      const { defense, isCritical } = finished.request;
      return {
        status: "done",
        attackRoll,
        defenseRoll: finished.defenseRoll,
        hit: defense.hit,
        isCritical,
        form: request.form,
        mods: request.mods,
        defense,
      };
    } catch (err) {
      await cancel().catch(() => {});
      throw err;
    }
  }

  // A escolha de um botão de defesa do card, para quem chama a API, com as mesmas condições e uma frase para cada
  // recusa. acknowledged diz se o computador de quem atacou recebeu a escolha.
  async function apiChooseDefense(messageId, form) {
    const message = game.messages.get(messageId);
    const request = getRequest(message);
    if (request?.status !== "pending") throw new Error("That attack is no longer waiting for a defense.");
    const defender = getDefenderToken(request)?.actor;
    if (!defender) throw new Error(`${request.targetName} is no longer on the scene.`);
    if (!defender.testUserPermission(game.user, "OWNER")) {
      throw new Error("Only the defender's owner or a Gamemaster can choose this defense.");
    }
    const option = getDefenseOptions(defender).find((o) => o.form === form);
    if (!option) throw new Error("That is not a defense.");
    if (option.unavailable) throw new Error(`${option.name} needs no armour and no shield.`);
    if (request.attackerUserId !== game.user.id) {
      const attackerUser = game.users.get(request.attackerUserId);
      if (!attackerUser?.active) {
        throw new Error(`${attackerUser?.name ?? "The attacker"} is not connected, so the defense has nowhere to go.`);
      }
    }
    const acknowledged = acknowledgement(message.id);
    sendChoice(message.id, request, form);
    return { acknowledged };
  }

  // true assim que o card deixa "pending"; false se ele ainda espera quando acaba o prazo de ACK_TIMEOUT_MS, porque a
  // página de quem atacou pode ter sido recarregada.
  function acknowledgement(messageId) {
    return new Promise((resolve) => {
      let hook = null;
      let timer = null;
      const settle = (value) => {
        Hooks.off("updateChatMessage", hook);
        clearTimeout(timer);
        resolve(value);
      };
      hook = Hooks.on("updateChatMessage", (message) => {
        if (message.id === messageId && getRequest(message)?.status !== "pending") settle(true);
      });
      timer = setTimeout(() => settle(getRequest(game.messages.get(messageId))?.status !== "pending"), ACK_TIMEOUT_MS);
    });
  }

  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "filterByRange", {
      name: "Filter targets by weapon range",
      hint: "Only show targets within weapon range in the target selection dialog. Targets beyond normal range but within long range are marked with disadvantage.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });

    // Botões dos cards: dano no resultado, defesa no pedido. Registrado no init porque o
    // chat já renderiza as mensagens antigas antes do ready.
    Hooks.on("renderChatMessageHTML", (message, html) => {
      for (const btn of html.querySelectorAll(".damage-roll-btn")) {
        btn.addEventListener("click", async (event) => {
          event.preventDefault();
          const { actorId, itemId, activityId, critical } = btn.dataset;
          const item = game.actors.get(actorId)?.items.get(itemId);
          if (!item) {
            ui.notifications.warn("Arma não encontrada para rolar dano.");
            return;
          }
          const activity = item.system.activities?.get(activityId)
            ?? item.system.activities?.getByType("attack")?.[0];
          if (!activity?.rollDamage) {
            ui.notifications.warn("Ataque não encontrado para rolar dano.");
            return;
          }
          const garenDamageBonus = Number(btn.dataset.damageBonus) || 0;
          try {
            await activity.rollDamage({ event, isCritical: critical === "true", garenDamageBonus });
          } catch (err) {
            console.error("[new-combat-system] A rolagem de dano falhou:", err);
            ui.notifications.error(`Rolagem de dano falhou: ${err?.message ?? err}. Detalhes no console (F12).`);
          }
        });
      }

      const request = getRequest(message);
      if (request) renderDefenseSlot(message, request, html);
    });

    // Pedido novo: avisa na tela quem deve responder.
    Hooks.on("createChatMessage", (message, options, userId) => {
      const request = getRequest(message);
      if (request?.status !== "pending") return;
      // O card que a API publicou não avisa a página que o publicou: a API não mostra avisos.
      if (options?.[MODULE_ID]?.api && userId === game.user.id) return;
      const defender = getDefenderToken(request)?.actor;
      if (defender && isExpectedResponder(defender)) {
        ui.notifications.info(`${request.attackerName} ataca ${request.targetName}: escolha a defesa no chat.`);
      }
    });

    // Soma o modificador de dano da forma de ataque à primeira parte do dano, para que
    // ele herde o tipo de dano da arma. Esse hook roda em toda rolagem de dano do mundo;
    // só age quando a rolagem veio do botão "Rolar Dano" do nosso card.
    Hooks.on("dnd5e.preRollDamageV2", (config) => {
      const bonus = config.garenDamageBonus;
      if (!Number.isFinite(bonus) || bonus === 0) return;
      const firstRoll = config.rolls?.[0];
      if (!firstRoll) return;
      firstRoll.parts = [...(firstRoll.parts ?? []), String(bonus)];
    });
  });

  Hooks.once("ready", () => {
    console.log("Custom Defense Bonus system with button loaded");

    if (!game?.modules?.get("lib-wrapper")?.active) {
      ui.notifications.warn(
        "The 'libWrapper' module is required for Custom Defense Bonus to function correctly."
      );
      return;
    }

    // Escolhas de defesa vindas de outros computadores. Só o computador de quem atacou
    // tem a espera correspondente; os outros ignoram.
    game.socket.on(SOCKET, (payload) => {
      receiveChoice(payload ?? {}).catch((err) => console.error("[new-combat-system] A defesa falhou:", err));
    });

    // Card apagado enquanto o ataque deste computador ainda esperava a defesa: a espera termina como um
    // cancelamento, e nenhum dos dois fluxos tenta mais editar o card (ver updateRequest).
    Hooks.on("deleteChatMessage", (message) => {
      const wait = waits.get(message?.id);
      if (!wait || wait.choice) return;
      wait.choice = { cancelled: true };
      wait.resolve(wait.choice);
    });

    // Ataques deste usuário que ficaram esperando quando a página foi recarregada não têm
    // mais como rolar: o card passa a dizer isso em vez de mostrar botões mortos.
    for (const message of game.messages?.contents ?? []) {
      const request = getRequest(message);
      if (!request || !["pending", "chosen"].includes(request.status)) continue;
      if (request.attackerUserId !== game.user.id || message.author?.id !== game.user.id) continue;
      updateRequest(message, { ...request, status: "interrupted" })
        .catch((err) => console.error("[new-combat-system] Não foi possível encerrar o pedido:", err));
    }

    // Centros dos quadrados ocupados pelo token. getOccupiedGridSpaceOffsets repete
    // cada quadrado por nível de profundidade, por isso a deduplicação em i,j.
    function getOccupiedPoints(token) {
      const cells = new Map();
      for (const offset of token.document.getOccupiedGridSpaceOffsets()) {
        const key = `${offset.i},${offset.j}`;
        if (cells.has(key)) continue;
        const { x, y } = canvas.grid.getCenterPoint(offset);
        cells.set(key, { x, y });
      }
      return cells.size ? [...cells.values()] : [token.center];
    }

    // Distância entre os quadrados mais próximos, para que tokens grandes possam ser
    // atacados a partir da borda. Medir de centro a centro exigia estar sobre o alvo.
    function getGridDistance(tokenA, tokenB) {
      let min = Infinity;
      for (const a of getOccupiedPoints(tokenA)) {
        for (const b of getOccupiedPoints(tokenB)) {
          min = Math.min(min, canvas.grid.measurePath([a, b]).distance);
        }
      }
      return min;
    }

    function getAttackRange(activity) {
      const weapon = activity.item.system.range ?? {};
      const own = activity.range ?? {};
      // Armas guardam alcance no item, a não ser que a atividade o substitua; magias usam a atividade
      const source = activity.item.type === "weapon" && !own.override ? weapon : own;
      const reach = weapon.reach || own.reach || 0;
      const normal = source.value || reach || 5;
      const long = source.long && source.long > normal ? source.long : null;
      return { normal: Math.max(normal, reach), long };
    }

    function buildTargetDialogContent(combatants, withForms) {
      const radios = combatants
        .map((c, i) => {
          const distLabel = `(${Math.round(c.distance)}ft)`;
          const disadvLabel = c.disadvantage ? ' <span style="color:#e74c3c; font-weight:bold;">⚠️ desvantagem</span>' : "";
          return `<label style="display:block; margin:4px 0; cursor:pointer;">
              <input type="radio" name="target" value="${c.tokenId}" ${i === 0 ? "checked" : ""}/>
              ${esc(c.name)} <span style="opacity:0.7">${distLabel}</span>${disadvLabel}
            </label>`;
        })
        .join("");
      const formsHint = withForms
        ? `<p style="margin-top:8px;"><strong>Escolha o tipo de ataque.</strong> Determinado e Violento são Ataque Total (3 pontos de ação).</p>`
        : "";
      return `<p><strong>Escolha o alvo:</strong></p>${radios}${formsHint}`;
    }

    function getSelectedTarget(button) {
      return button.form.elements.target?.value
        ?? button.form.querySelector('input[name="target"]:checked')?.value ?? null;
    }

    // Botões do diálogo. Magias só têm o ataque normal, porque as formas de conjuração
    // do PDF são outras. Armas e ataques naturais ganham as seis formas: quatro na
    // primeira linha (ataque) e duas na segunda (Ataque Total), mais Cancelar.
    function buildAttackButtons(withForms, prof) {
      const cancel = {
        action: "cancel",
        icon: "fa-solid fa-xmark",
        label: "Cancelar",
        callback: () => null,
      };
      if (!withForms) {
        return [
          {
            action: "normal",
            icon: "fa-solid fa-crosshairs",
            label: "Atacar",
            default: true,
            callback: (event, button) => ({ tokenId: getSelectedTarget(button), form: "normal" }),
          },
          cancel,
        ];
      }
      // Um efeito por linha no rótulo; alignSelf iguala a altura dos botões da mesma linha.
      const buttonStyle = (basis) => ({
        flex: `1 1 ${basis}`, alignSelf: "stretch", height: "auto", padding: "0.25rem 0.5rem", textAlign: "center",
      });
      const formButton = (form, basis) => {
        const effect = describeModifiers(getFormModifiers(form, prof), "\n");
        return {
          action: form,
          label: effect ? `${ATTACK_FORMS[form].name}\n${effect}` : ATTACK_FORMS[form].name,
          default: form === "normal",
          style: buttonStyle(basis),
          callback: (event, button) => ({ tokenId: getSelectedTarget(button), form }),
        };
      };
      return [
        formButton("normal", "22%"),
        formButton("ofensivo", "22%"),
        formButton("defensivo", "22%"),
        formButton("preciso", "22%"),
        formButton("determinado", "30%"),
        formButton("violento", "30%"),
        { ...cancel, style: buttonStyle("30%") },
      ];
    }

    // Fluxo completo de um ataque, chamado com this = atividade de ataque.
    async function runAttack(wrapped, args) {
      console.log("[new-combat-system] Ataque de", this.actor?.name, "com", this.item?.name);

      // Sem encounter ativo ou sem cena: ataque segue normalmente
      if (!game.combat || !canvas?.ready) {
        return wrapped(...args);
      }

      // Identifica o token do atacante
      const attackerToken =
        canvas.tokens.controlled[0] ||
        canvas.tokens.placeables.find((t) => t.actor?.id === this.actor.id);

      const filterByRange = game.settings.get(MODULE_ID, "filterByRange");
      const attackRange = getAttackRange(this);
      const maxRange = attackRange.long || attackRange.normal;

      // Coleta combatentes válidos (exclui o atacante, exige token no canvas)
      let validCombatants = game.combat.combatants
        .filter((c) => {
          const token = canvas.tokens.get(c.tokenId);
          if (!token) return false;
          if (attackerToken && token.id === attackerToken.id) return false;
          return true;
        })
        .map((c) => {
          const token = canvas.tokens.get(c.tokenId);
          const distance = attackerToken ? getGridDistance(attackerToken, token) : 0;
          const disadvantage = attackRange.long ? distance > attackRange.normal && distance <= attackRange.long : false;
          return { tokenId: c.tokenId, name: c.name, distance, disadvantage };
        });

      if (filterByRange && attackerToken) {
        validCombatants = validCombatants.filter((c) => c.distance <= maxRange);
      }

      if (validCombatants.length === 0) {
        ui.notifications.warn(filterByRange ? "Nenhum alvo ao alcance." : "Nenhum alvo disponível no combate.");
        return null;
      }

      // Dialog de seleção de alvo e tipo de ataque
      const withForms = this.item.type !== "spell";
      const prof = Number(this.actor.system.attributes?.prof) || 0;
      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: "Escolha o Alvo" },
        position: withForms ? { width: 520 } : {},
        content: buildTargetDialogContent(validCombatants, withForms),
        buttons: buildAttackButtons(withForms, prof),
        rejectClose: false,
      });

      // Cancelou ou fechou: não ataca
      const selectedTokenId = choice?.tokenId;
      if (!selectedTokenId) return null;
      const form = ATTACK_FORMS[choice.form] ? choice.form : "normal";
      const mods = getFormModifiers(form, prof);
      console.log("[new-combat-system] Alvo", selectedTokenId, "forma", form, mods);

      const targetToken = canvas.tokens.get(selectedTokenId);
      if (!targetToken?.actor) {
        ui.notifications.warn("Alvo não encontrado no mapa: o ataque não foi feito.");
        return null;
      }

      // Modificador de ataque da forma entra na primeira rolagem configurada. args[0]
      // pode chegar indefinido (clique na ficha) ou com { event } (botão do card).
      if (mods.attack) args[0] = withAttackModifier(args[0] ?? {}, mods.attack);

      // Pedido de defesa, publicado antes de qualquer dado.
      const request = makeRequest(this, attackerToken, targetToken, canvas.scene?.id, form, mods);
      const { message, wait } = await postRequest(request, ChatMessage.getSpeaker({ actor: this.actor }));

      // O dnd5e mostra a janela de rolagem normalmente; o wrapper de buildEvaluate segura
      // a avaliação do d20 até a defesa ser escolhida (ver o registro abaixo).
      args[0] = { ...(args[0] ?? {}), garenRequestId: message.id };
      let attackRolls;
      try {
        attackRolls = await wrapped(...args);
      } catch (err) {
        waits.delete(message.id);
        await updateRequest(message, { ...request, status: "cancelled" }).catch(() => {});
        throw err;
      }
      console.log("[new-combat-system] dnd5e devolveu", attackRolls?.length ?? 0, "rolagem(ns) de ataque");

      // Sem rolagem: quem atacou cancelou no card, fechou a janela do dnd5e ou outro
      // módulo cancelou.
      const attackRoll = attackRolls?.[0];
      if (!attackRoll) {
        waits.delete(message.id);
        if (getRequest(message)?.status !== "cancelled") {
          await updateRequest(message, { ...request, status: "cancelled" });
        }
        if (!wait.choice?.cancelled) {
          ui.notifications.info("Ataque sem rolagem: a janela de rolagem do dnd5e foi fechada ou outro módulo cancelou o ataque.");
        }
        return attackRolls ?? null;
      }

      // A escolha normalmente já chegou, porque a rolagem esperou por ela. Se outro
      // módulo pulou a espera, aguarda aqui; nesse caso o total do ataque já apareceu.
      const defenseChoice = wait.choice ?? await wait.promise;
      waits.delete(message.id);
      if (defenseChoice.cancelled) return attackRolls;

      if (!(await rollDefense(message, request, attackRoll, defenseChoice))) {
        ui.notifications.warn("Alvo não encontrado na cena: a defesa não foi rolada.");
        await updateRequest(message, { ...request, status: "cancelled" });
      }
      return attackRolls;
    }

    // Wrapper do ataque. O dnd5e chama rollAttack depois de usar a arma sem esperar o
    // resultado nem tratar erro, então uma exceção aqui ficaria só no console. O
    // try/catch leva o erro para a tela, para a mesa saber que o ataque falhou.
    libWrapper.register(
      MODULE_ID,
      "CONFIG.DND5E.activityTypes.attack.documentClass.prototype.rollAttack",
      async function (wrapped, ...args) {
        // A rolagem da API (config.garenApi) vai direto ao dnd5e: a API já publicou o card e esperou a defesa, e
        // trata ela mesma os erros, sem avisos na tela.
        if (args[0]?.garenApi === true) return wrapped(...args);
        try {
          return await runAttack.call(this, wrapped, args);
        } catch (err) {
          console.error("[new-combat-system] O ataque falhou:", err);
          ui.notifications.error(`Ataque falhou: ${err?.message ?? err}. Detalhes no console (F12).`);
          return null;
        }
      },
      "MIXED"
    );

    // Segunda etapa da rolagem do dnd5e (configurar, avaliar, publicar). Quando a rolagem
    // é um ataque nosso, espera a defesa antes de avaliar o d20, para que ninguém veja o
    // total antes de escolher. Cancelado no card, esvazia a lista de rolagens e o dnd5e
    // encerra o ataque sem rolar. Qualquer outra rolagem do mundo passa direto.
    libWrapper.register(
      MODULE_ID,
      "CONFIG.Dice.D20Roll.buildEvaluate",
      async function (wrapped, rolls, config = {}, message = {}) {
        const wait = waits.get(config?.garenRequestId);
        if (!wait || !rolls?.length) return wrapped(rolls, config, message);
        const defenseChoice = await wait.promise;
        if (defenseChoice.cancelled) {
          rolls.splice(0);
          return;
        }
        return wrapped(rolls, config, message);
      },
      "MIXED"
    );

    // A API do Dungeon Guide, depois dos wrappers, de que o ataque dela depende.
    const ncsModule = game.modules.get(MODULE_ID);
    if (ncsModule) {
      ncsModule.api = Object.freeze({
        version: API_VERSION,
        attackForms: Object.freeze(
          Object.entries(ATTACK_FORMS).map(([key, { name, title }]) => Object.freeze({ key, name, title }))
        ),
        formModifiers(form, prof) {
          if (!Object.hasOwn(ATTACK_FORMS, form)) throw new Error("That is not an attack form.");
          return getFormModifiers(form, Number(prof) || 0);
        },
        defenseOptions: (actor) => getDefenseOptions(checkedActor(actor)),
        defenseBonus: (actor) => getDefenseBonus(checkedActor(actor)),
        responders: (actor) => getResponders(checkedActor(actor)).map((u) => u.id),
        request: (message) => getRequest(message),
        attack: apiAttack,
        chooseDefense: apiChooseDefense,
        cancelAttack: async (messageId) => cancelAttack(game.messages.get(messageId)),
      });
    }
  });
})();
