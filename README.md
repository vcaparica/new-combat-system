# Custom Combat System (1.8.0)

Módulo do Foundry 14 com dnd5e 6 (regras 2014) para a campanha de Garen. Faz o ataque contra defesa, as formas de ataque e de defesa, os críticos de Garen, o som Thunderstruck e, desde a versão 1.8.0, a iniciativa de Garen e os botões de rolagem que o Dungeon Guide manda aos jogadores. Exige o módulo lib-wrapper.

## As regras



O combate se inicia quando um personagem declara qualquer ação que implique em uma rolagem de ataque ou de resistência. Personagens que consigam pegar seus oponentes despreparados para o combate ganham um ponto de ação de surpresa que só pode ser usado imediatamente para fazer algo antes da Iniciativa.


## Iniciativa

Cada jogador rola 1d20 + o modificador de Destreza ou de Inteligência do personagem, o que for maior. Empates entre jogadores são decididos entre os empatantes, um deles deverá cair para o próximo número. Empates entre PC e NPC são desempatados comparando o maior atributo (não o modificador, mas o valor do atributo em si) dentre Destreza e Inteligência dos empatantes, e persistindo o empate o NPC cai para o próximo número. Alguns NPCs poderosos podem ter mais de uma Iniciativa. NPCs têm quantidades fixas de ações definidas e não usam o sistema de pontos de ação descrito mais abaixo.

Um personagem pode rolar iniciativa em modo de Ação Rápida. Um jogador em ação rápida soma sua proficiência na rolagem de iniciativa, mas tem apenas três pontos de ação no seu primeiro turno.

Ao longo da rodada, qualquer personagem que já tenha agido neste combate e ainda tenha ao menos 1 ponto de ação pode declarar que vai agir na próxima iniciativa livre. Se o começo do turno de outro personagem já foi anunciado então só é possível agir depois que ele estiver terminado. Se um personagem decide fazê-lo, seu valor de iniciativa é atualizado.


## Ataques e Defesas

O ataque continua funcionando como sempre, mas em vez de rolar contra uma CA o atacante rola para definir a dificuldade da defesa. O personagem sendo atacado, caso possa defender-se, faz uma rolagem de defesa, 1d20 + seu Defense Bonus (DB), onde a dificuldade é a rolagem de ataque e o empate é do atacante, ou seja, empate acerta. Seu Defense Bonus é calculado exatamente igual à sua antiga CA (CA deixa de existir), com a única diferença de que armaduras em vez de dar CA 11, 12, 13, até 18, dão +1, +2, +3, até +8, como acontece com escudos, que continuam funcionando do mesmo jeito.

Na prática, e é assim que o Foundry está sendo programado agora, o DB é sua antiga CA -10, e em vez de ser um valor para o atacante atingir ele agora é um bônus para atingir a rolagem do atacante.


## Ações em Combate

Cada jogador tem quatro pontos de ação por rodada, que são renovados sempre que seu turno começa. As ações com um * permitem um passo de 1 quadrado antes ou depois de acontecerem.


- Ataque* (1 ponto, Uma vez por turno): Realiza o número de ataques permitido por ação pela sua classe e nível. Cada ataque realizado pode ser normal ou ter uma das seguintes formas opcionais.
  1. Ataque Ofensivo: Aplica sua Proficiência como redutor na rolagem de ataque e sua Proficiência +1 como bônus no dano.
  2. Ataque Defensivo. Aplica sua Proficiência como redutor na rolagem de ataque e sua Proficiência como bônus na sua Defesa contra o próximo ataque sofrido.
  3. Ataque Preciso: Aplica sua Proficiência como bônus na rolagem de ataque e sua Proficiência +1 como redutor no dano.
  4. Ataque Total (3 pontos): Abre mão de toda a cautela para atacar com tudo que tem. Pode ser feito de duas formas.
      - Determinado: Aplica sua Proficiência como bônus na rolagem de ataque.
      - Violento: Aplica sua Proficiência como bônus na rolagem de dano.
      - Se um Ataque Total Violento com arma mão-leve reduzir a 0 PV seu alvo, e houver caminho livre entre o alvo morto e um segundo alvo adjacente e no alcance, o segundo alvo faz uma rolagem de defesa imediata contra a mesma rolagem de ataque.

- Defesa (varia): Realiza imediatamente uma rolagem de defesa após uma rolagem de ataque ser feita contra você. Pode ser normal (você precisa ter pelo menos 1 ponto de ação, mas ele não é gasto) ou ter uma das seguintes formas opcionais.
  - Ceder Terreno (1 ponto, não é gasto). Quando fizer sentido com o contexto de ataque, o defensor pode se mover um quadrado para trás (afastando-se do atacante) para ganhar +1 nessa rolagem de defesa.
  - Esquiva Acrobática (2 pontos). Quando fizer sentido com o contexto de ataque, o personagem sem armadura ou escudo pode se mover um quadrado para trás, afastando-se do atacante, para somar seus pontos de Acrobacia nessa rolagem de defesa.
  - Defesa Total (3 pontos). O personagem em defesa total pode se defender de tantos ataques quanto receba e soma sua Proficiência como bônus em todas as rolagens de defesa até seu próximo turno.

- Conjurar magia* (1 ponto; Uma vez por turno). Pode ser feito normalmente ou com uma das seguintes formas:
  - Conjuração Ofensiva. aplica sua Proficiência como bônus na sua próxima rolagem de ataque mágico ou na dificuldade para resistir à magia, e como redutor na sua próxima rolagem de defesa ou de resistência.
  - Conjuração Defensiva. Aplica sua Proficiência como redutor na rolagem de ataque mágico ou na dificuldade para resistir à magia. Aplica sua Proficiência como bônus na sua próxima rolagem de defesa ou jogada de resistência.

- Movimento (varia). Desloca o personagem pelo cenário do combate. Pode ser feito de diferentes formas:
  - Mudar Postura (1 ponto): De deitado para ajoelhado/agachado, de ajoelhado/agachado para em pé e vice-versa.
  - Movimento Rápido (1 ponto). Anda metade do deslocamento padrão de combate do personagem.
  - Movimento (2 pontos): Anda o deslocamento padrão de combate do personagem.
  - Disparar (3 pontos): Anda 2x o deslocamento padrão de combate do personagem.

- Apoio* (1 ponto): Ajuda um aliado que esteja em um quadrado adjacente, dando Vantagem em sua próxima rolagem de ataque ou de defesa.

- Finta* (1 ponto). Realiza uma rolagem de ataque normal contra uma rolagem de Sentir Motivação do alvo. Em caso de sucesso, não há dano, mas a Proficiência de quem fez a finta é aplicada como redutor na próxima rolagem de defesa do alvo.

- Mirar/Avaliar (1 ponto). Gasta um segundo observando cuidadosamente seu alvo antes de atacar. Se sua próxima ação for um ataque contra aquele alvo, soma +2 na rolagem.

- Habilidades de Classe* (1 ponto). Qualquer habilidade de classe que use originalmente uma action, bonus action ou reaction.

- Usar perícia* (Varia). Fazer uso físico ou mental de uma perícia. Pode tomar 1, 2 ou 3 pontos dependendo da complexidade da ação.


## Ataques de Oportunidade

Não existem mais ataques de oportunidade por deslocamento. Para fazer ataques de oportunidade é preciso ter ao menos 1 ponto de ação, mas ele não é gasto. O número de ataques de oportunidade que um personagem pode fazer por rodada é igual a 1 + seu modificador de Destreza, mínimo de 1. As seguintes ações geram ataque de oportunidade se feitas na área de ameaça de um inimigo:

- Conjurar Magia estando em corpo-a-corpo (a menos que em modo Defensivo).
- Fazer um ataque à distância estando em corpo-a-corpo.
- Beber uma poção, ler um pergaminho ou pegar um item do chão.
- Manipular objetos, como abrir uma porta ou pegar algo na mochila ou nos bolsos.
- Recarregar qualquer arma de distância.
- Fazer um ataque desarmado sem Proficiência contra um inimigo armado.
- Situações narrativas que o mestre considere adequadas.


## Garen Custom Rules

Até a versão 1.7.0 estas regras eram um módulo à parte, o garen-initiative, chamado Garen Custom Rules. Desde a versão 1.8.0 elas moram neste módulo, em scripts/garen-rules.js, e o garen-initiative deve ser desligado: se ele continuar ligado, este módulo não registra nada e escreve uma linha no console avisando, e o Manage Modules mostra o conflito.

1. Toda rolagem de iniciativa do mundo usa o maior entre os modificadores de Destreza e Inteligência, quando a habilidade de iniciativa é Destreza. Tudo o mais que o dnd5e soma continua valendo.
2. Na chamada de iniciativa do Dungeon Guide aparece o botão "Rolar iniciativa", com as opções Desvantagem, Normal e Vantagem.
3. O botão só funciona para o dono do personagem ou para um Gamemaster, e só enquanto o personagem ainda não tem iniciativa.
4. A classe do botão é "ncs-initiative-roll". Não a mude, pois a página do Dungeon Guide já a escreve.
5. Quando o mestre pede no Dungeon Guide a rolagem de uma perícia de Garen, a do módulo Skill Point System (my-skill-system) do Caio, chega ao jogador do personagem, sussurrada a ele e aos mestres, uma mensagem com o botão "Rolar" e o nome da perícia. O clique abre o diálogo de rolagem do dnd5e, com vantagem e desvantagem, e a rolagem vai ao chat como "Perícia: " e o nome, com o bônus que a ficha mostra naquele momento, igual a rolar pela ficha. Só o dono do personagem ou um mestre pode rolar. A classe desse botão é "garen-skill-roll", e ele leva data-actor-id e data-skill; não os mude, pois a página do Dungeon Guide já os escreve.
6. Quando o mestre aperta Enter numa linha de atributo da ficha de um personagem no Dungeon Guide, chega ao jogador do personagem, sussurrada a ele e aos mestres, a mensagem "Chaos: rolar teste de Força." com o botão "Rolar teste de Força". O clique rola o teste de atributo pelo próprio dnd5e, que abre o diálogo com vantagem, desvantagem e o modo de rolagem do jogador. Só o dono do personagem ou um mestre pode rolar, e um segundo clique com o diálogo aberto não abre outro. A classe desse botão é "garen-ability-roll", e ele leva data-actor-id e data-ability; não os mude, pois a página do Dungeon Guide já os escreve.

## Dungeon Guide

O Dungeon Guide, o aplicativo do mestre, usa a API do módulo, que fica em game.modules.get("new-combat-system").api. Ela só existe com o lib-wrapper ligado. Cada função confere seus argumentos e, quando recusa, lança um Error com uma frase em inglês; nenhuma mostra diálogo nem notificação.

1. version: o texto "1.8.0".
2. attackForms: as seis formas de ataque na ordem do diálogo, normal, ofensivo, defensivo, preciso, determinado e violento, cada uma com seu nome e seu título.
3. formModifiers(form, prof): devolve os modificadores de ataque, de dano e de defesa da forma, para a proficiência dada.
4. defenseOptions(actor): as opções de defesa do personagem, cada uma com forma, nome, custo, bônus, efeito e se está indisponível.
5. defenseBonus(actor): o Defense Bonus do ator, a classe de armadura menos 10.
6. responders(actor): os ids dos usuários conectados que não são mestres e são donos do ator, na ordem de game.users. Vazio quer dizer que os mestres escolhem a defesa.
7. request(message): uma cópia do pedido de defesa guardado no card, ou null; mudar a cópia não muda o card.
8. attack({activity, attacker, target, form, roll, message}): faz o ataque do módulo sem diálogo. O activity é uma atividade de ataque do dnd5e; atacante e alvo são TokenDocuments da mesma cena. Posta o card de pedido de defesa e devolve o id do card e uma promessa com o resultado. O resultado diz "done", com as rolagens de ataque e de defesa, se acertou, se foi crítico, a forma, os modificadores e o objeto defense, com form, name, total, formula, hit e dice, ou "cancelled", quando o ataque foi cancelado, o card foi apagado enquanto esperava, o dnd5e não rolou ou o alvo saiu da cena. A promessa é rejeitada se algo falhar.
9. chooseDefense(messageId, form): faz o que o clique no botão de defesa do card faz, para o usuário que chama. Devolve uma promessa que vira um objeto {acknowledged}, em que acknowledged é por sua vez uma promessa: true quando o card deixa de esperar, ou false depois de 10 segundos sem isso. Lança erro se o pedido não espera mais, se o alvo saiu da cena, se o usuário não pode escolher, se a forma é desconhecida ou indisponível, ou se o atacante não está conectado.
10. cancelAttack(messageId): cancela um ataque pendente desta página, como o botão Cancelar do card. Devolve true se cancelou e false se o ataque não é desta página ou já não espera.

## Testes

Os testes não precisam do Foundry. Na pasta do módulo, rode:

    node --test "tests/*.test.mjs"

Com aspas, porque no Node 24 o comando node --test tests/ falha.

## Lançamentos

Este repositório é um fork do repositório do Caio, feito pelo Victor, e o fork é a única origem: o repositório do Caio não é um remote. Para fazer um lançamento de X.Y.Z:

1. Trabalhe numa branch, como release-X.Y.Z. Ponha a versão nova no module.json, na tag do endereço do campo download (https://github.com/vcaparica/new-combat-system/archive/refs/tags/vX.Y.Z.zip) e em API_VERSION, em scripts/defense-logic.js, uma segunda cópia da versão que um aumento futuro pode esquecer.
2. Rode os testes e faça o commit.
3. Junte a branch na main.
4. Crie a tag vX.Y.Z.
5. Envie a main e a tag. O campo manifest aponta para o module.json da main, então enviar só a tag deixa o Foundry sem ver o lançamento.
6. Crie no GitHub um release de mesmo nome.
7. Confira que o endereço do manifest responde a versão nova e que o endereço do download responde um zip.

O Foundry instala e atualiza o módulo pelo campo manifest do module.json. O arquivo .gitattributes tira do zip o que o Foundry não precisa (tests, CLAUDE.md, .gitignore), de modo que ele leva só module.json, README.md, lang, scripts e sounds.


## Sons Customizados ⚡

O sistema suporta tocar sons customizados em eventos específicos (como críticos).

### Thunderstruck
Toca um som especial quando um jogador específico acerta um crítico com uma arma específica.

**Configuração:**
1. Coloque o arquivo de áudio em `sounds/thunderstruck.mp3`
2. Edite `scripts/thunderstruck.js` e configure o nome do personagem e da arma
3. Ajuste volume e outras opções conforme necessário

Ver `sounds/README.md` para instruções detalhadas.
