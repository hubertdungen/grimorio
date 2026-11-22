// «✨ Epificar nomes»: nomes épicos para decks, sem rede e sem custos. analyse() lê o deck com o que a app já sabe
// (comandantes, tribo dominante, estratégias, universo, cores, combos) e suggest() enche modelos de frases com bancos de
// vocabulário por tema, na língua pedida (pt, en, es, de, zh). Determinístico por deck + semente («🎲 Outros» = semente+1).
// Bancos: a = adjetivos, n = nomes, p = complementos («of …»), r = títulos do comandante; tudo separado por «|».
// pt/es: «m:Domínio» / «f:Procissão» (género; «mp»/«fp» plurais; «:Roma» sem artigo; «=sem Fim» já com a preposição),
// adjetivo «Assombrado/a» = masculino/feminino. de: nomes com artigo («das Geisterreich») e complementos já no genitivo.
import { deckTribe, deckIdentity, CNAME, NEPH } from './data.js'
import { ARCH, archScore } from './archetypes.js'
import { VOC, setOriginals, setGroup, norm } from './vocab.js'

const B = (en, pt, es, de, zh) => ({ en, pt, es, de, zh })
const T = (a, n, p, r = '') => ({ a, n, p, r })
const D = (n, p, r = '') => ({ n, p, r })
const BANK = {
  ghost: B(T('Haunted|Spectral|Phantom|Wailing|Restless|Ghostly', 'Dominion|Requiem|Procession|Veil|Choir|Vigil', 'the Fallen|the Restless Dead|the Pale Veil|Lost Souls|the Hollow Moon', 'Keeper|Shepherd'),
    T('Assombrado/a|Espectral|Fantasma|Errante|Inquieto/a|Fantasmagórico/a', 'm:Domínio|m:Réquiem|f:Procissão|m:Véu|m:Coro|f:Vigília', 'mp:Caídos|mp:Mortos Inquietos|m:Véu Pálido|fp:Almas Perdidas|f:Lua Oca'),
    T('Embrujado/a|Espectral|Fantasma|Errante|Inquieto/a', 'm:Dominio|m:Réquiem|f:Procesión|m:Velo|m:Coro', 'mp:Caídos|fp:Almas Perdidas|m:Velo Pálido'),
    D('das Geisterreich|das Requiem|die Prozession|der Schleier|der Geisterchor', 'der Gefallenen|der ruhelosen Toten|der verlorenen Seelen|des bleichen Schleiers'),
    T('幽魂|鬼影|亡灵|幽冥', '领域|安魂曲|队列|帷幕|合唱', '亡者|失落之魂|苍白帷幕')),
  pirate: B(T('Dread|Plundering|Black-Sailed|Cutthroat|Salt-Stained', 'Armada|Plunder|Fleet|Mutiny|Corsairs|Bounty', "the Seven Seas|the Black Tide|Sunken Gold|the Kraken's Wake", 'Admiral|Captain|Scourge'),
    T('Temível|Saqueador/a|Sanguinário/a|Corsário/a|Maldito/a', 'f:Armada|m:Saque|f:Frota|m:Motim|m:Tesouro|f:Abordagem', 'mp:Sete Mares|f:Maré Negra|m:Ouro Afundado|m:Rasto do Kraken', 'Almirante|Flagelo'),
    T('Temible|Saqueador/a|Maldito/a|Sanguinario/a', 'f:Armada|m:Saqueo|f:Flota|m:Motín|m:Tesoro', 'mp:Siete Mares|f:Marea Negra|m:Oro Hundido', 'Almirante'),
    D('die Armada|die Beute|die Flotte|die Meuterei|der Schatz', 'der sieben Meere|der schwarzen Flut|des versunkenen Goldes', 'Admiral|Kapitän'),
    T('恐怖|掠夺|黑帆|血色', '舰队|宝藏|叛变|海盗团', '七海|黑潮|沉金', '提督|船长')),
  ninja: B(T('Silent|Crimson|Hidden|Masked|Shadowed', 'Shadow|Clan|Ambush|Blade|Strike', 'the Crimson Moon|the Silent Blade|the Hidden Leaf|a Thousand Shadows'),
    T('Silencioso/a|Carmesim|Oculto/a|Mascarado/a|Sombrio/a', 'f:Sombra|m:Clã|f:Emboscada|f:Lâmina|m:Golpe', 'f:Lua Carmesim|f:Lâmina Silenciosa|f:Folha Oculta|fp:Mil Sombras'),
    T('Silencioso/a|Carmesí|Oculto/a|Enmascarado/a|Sombrío/a', 'f:Sombra|m:Clan|f:Emboscada|f:Hoja|m:Golpe', 'f:Luna Carmesí|f:Hoja Silenciosa|fp:Mil Sombras'),
    D('der Schatten|der Clan|der Hinterhalt|die Klinge', 'des Blutmonds|der stillen Klinge|der tausend Schatten'),
    T('无声|赤红|隐秘|暗影', '之刃|忍团|伏击|影', '血月|无声之刃|千影')),
  rogue: B(T('Hidden|Silent|Poisoned|Cloaked|Deadly', 'Brotherhood|Creed|Conspiracy|Guild|Contract', 'Shadows|the Hidden Blade|the Silent Knife|Whispers', 'Blade|Shadow'),
    T('Oculto/a|Silencioso/a|Envenenado/a|Encapuzado/a|Letal', 'f:Irmandade|m:Credo|f:Conspiração|f:Guilda|m:Contrato', 'fp:Sombras|f:Lâmina Oculta|f:Faca Silenciosa|mp:Sussurros', 'Lâmina|Sombra'),
    T('Oculto/a|Silencioso/a|Envenenado/a|Encapuchado/a|Letal', 'f:Hermandad|m:Credo|f:Conspiración|m:Gremio|m:Contrato', 'fp:Sombras|f:Hoja Oculta|mp:Susurros', 'Sombra'),
    D('die Bruderschaft|das Kredo|die Verschwörung|die Gilde|der Kontrakt', 'der Schatten|der verborgenen Klinge|des Flüsterns', 'Klinge'),
    T('隐秘|无声|淬毒|斗篷', '兄弟会|信条|密谋|公会|契约', '暗影|袖剑|低语')),
  vampire: B(T('Crimson|Bloodthirsty|Nocturnal|Sanguine|Eternal', 'Court|Feast|Covenant|Bloodline|Dynasty', 'the Eternal Night|the Blood Moon|Crimson Thirst|the Old Blood', 'Lord|Sovereign'),
    T('Carmesim|Sedento/a|Noturno/a|Sanguinário/a|Eterno/a', 'f:Corte|m:Banquete|f:Linhagem|f:Dinastia|m:Pacto', 'f:Noite Eterna|f:Lua de Sangue|f:Sede Carmesim|m:Sangue Antigo'),
    T('Carmesí|Sediento/a|Nocturno/a|Sanguinario/a|Eterno/a', 'f:Corte|m:Banquete|m:Linaje|f:Dinastía|m:Pacto', 'f:Noche Eterna|f:Luna de Sangre|f:Sed Carmesí'),
    D('der Blutadel|das Bankett|die Blutlinie|die Dynastie|der Pakt', 'der ewigen Nacht|des Blutmonds|des alten Blutes'),
    T('血色|嗜血|永夜|猩红', '宫廷|盛宴|血脉|王朝|契约', '永夜|血月|古血')),
  undead: B(T('Rotting|Shambling|Undying|Ravenous|Plague-Ridden', 'Horde|Legion|Harvest|Uprising|Crypt', 'the Grave|the Endless Dead|Rot|the Last Dawn'),
    T('Apodrecido/a|Cambaleante|Imortal|Faminto/a|Pestilento/a', 'f:Horda|f:Legião|f:Colheita|f:Revolta|f:Cripta', 'f:Sepultura|mp:Mortos sem Fim|f:Podridão|f:Última Aurora'),
    T('Putrefacto/a|Tambaleante|Inmortal|Hambriento/a', 'f:Horda|f:Legión|f:Cosecha|f:Cripta', 'f:Tumba|mp:Muertos sin Fin|f:Última Aurora'),
    D('die Horde|die Legion|die Ernte|der Aufstand|die Gruft', 'des Grabes|der endlosen Toten|der letzten Dämmerung'),
    T('腐朽|蹒跚|不死|饥饿', '尸潮|军团|收割|墓穴', '坟墓|无尽亡者|最后黎明')),
  dragon: B(T('Ancient|Burning|Scaled|Thundering|Primordial', 'Dominion|Hoard|Brood|Ascendancy|Wrath', 'the Elder Wyrms|Ash and Fire|the Endless Sky|the Dragonlords', 'Lord|Sovereign'),
    T('Ancestral|Ardente|Escamoso/a|Trovejante|Primordial', 'm:Domínio|m:Tesouro|f:Ninhada|f:Ascensão|f:Ira', 'mp:Dragões Anciões|m:Céu sem Fim|mp:Senhores Dragões|f:Chama Eterna'),
    T('Ancestral|Ardiente|Atronador/a|Primordial', 'm:Dominio|m:Tesoro|f:Nidada|f:Ira', 'mp:Dragones Ancianos|m:Cielo sin Fin|f:Llama Eterna'),
    D('das Drachenreich|der Hort|die Brut|der Zorn', 'der alten Drachen|des endlosen Himmels|der ewigen Flamme'),
    T('远古|燃烧|雷鸣|原初', '领域|宝藏|龙巢|怒火', '古龙|无尽苍穹|永恒之焰')),
  elf: B(T('Verdant|Sylvan|Evergreen|Wild|Moonlit', 'Grove|Kindred|Canopy|Court|Song|Bloom', 'the Deep Woods|the Elder Trees|Ten Thousand Leaves'),
    T('Verdejante|Silvestre|Perene|Selvagem|Enluarado/a', 'm:Bosque|f:Estirpe|f:Copa|f:Corte|m:Canto', 'f:Floresta Profunda|fp:Árvores Anciãs|fp:Dez Mil Folhas'),
    T('Verde|Silvestre|Perenne|Salvaje', 'f:Arboleda|m:Linaje|m:Dosel|f:Corte|m:Canto', 'm:Bosque Profundo|mp:Árboles Ancianos'),
    D('der Hain|die Sippe|das Blätterdach|der Hof|das Lied', 'der tiefen Wälder|der alten Bäume'),
    T('翠绿|森林|常青|月光', '林地|族群|树冠|宫廷|歌谣', '深林|古树|万叶')),
  goblin: B(T('Raucous|Reckless|Explosive|Cackling|Ramshackle', 'Mob|Riot|Horde|Mayhem|Warband', 'Chaos|the Big Boom|a Thousand Sparks', 'Boss|Warchief'),
    T('Ruidoso/a|Imprudente|Explosivo/a|Desengonçado/a', 'f:Turba|m:Motim|f:Horda|f:Balbúrdia|m:Bando', 'm:Caos|m:Grande Estrondo|fp:Mil Faíscas', 'Chefe'),
    T('Ruidoso/a|Temerario/a|Explosivo/a', 'f:Turba|m:Motín|f:Horda|m:Caos|f:Banda', 'm:Caos|m:Gran Estallido|fp:Mil Chispas', 'Jefe'),
    D('der Mob|der Aufruhr|die Horde|das Chaos|die Bande', 'des Chaos|des großen Knalls|der tausend Funken', 'Boss|Kriegshäuptling'),
    T('喧闹|鲁莽|爆炸|狂笑', '暴民|暴动|部落|混乱', '混沌|大爆炸|千星火花', '头目')),
  angel: B(T('Radiant|Exalted|Celestial|Holy|Golden', 'Host|Choir|Ascension|Judgment|Grace', 'the Dawn|Heaven|the Silver Light|Seraphs', 'Herald|Voice'),
    T('Radiante|Exaltado/a|Celestial|Sagrado/a|Dourado/a', 'f:Hoste|m:Coro|f:Ascensão|m:Juízo|f:Graça', 'f:Aurora|m:Céu|f:Luz Prateada|mp:Serafins'),
    T('Radiante|Exaltado/a|Celestial|Sagrado/a|Dorado/a', 'f:Hueste|m:Coro|f:Ascensión|m:Juicio|f:Gracia', 'm:Alba|m:Cielo|f:Luz Plateada|mp:Serafines'),
    D('das Heer|der Chor|der Aufstieg|das Urteil|die Gnade', 'der Morgenröte|des Himmels|des silbernen Lichts|der Seraphim'),
    T('光辉|崇高|天界|神圣|金色', '天军|圣歌|飞升|审判|恩典', '黎明|天堂|银光|炽天使')),
  demon: B(T('Infernal|Damned|Wicked|Hellbound|Sinister', 'Pact|Bargain|Inferno|Covenant|Abyss', 'the Pit|Sin|Seven Hells|Broken Oaths', 'Lord'),
    T('Infernal|Maldito/a|Perverso/a|Condenado/a|Sinistro/a', 'm:Pacto|m:Acordo|m:Inferno|f:Aliança|m:Abismo', 'm:Poço|m:Pecado|mp:Sete Infernos|mp:Juramentos Quebrados'),
    T('Infernal|Maldito/a|Perverso/a|Condenado/a|Siniestro/a', 'm:Pacto|m:Trato|m:Infierno|f:Alianza|m:Abismo', 'm:Pozo|m:Pecado|mp:Siete Infiernos'),
    D('der Pakt|der Handel|das Inferno|der Bund|der Abgrund', 'der Hölle|der Sünde|der sieben Höllen|der gebrochenen Schwüre'),
    T('地狱|诅咒|邪恶|堕落', '契约|交易|炼狱|盟约|深渊', '深坑|罪孽|七层地狱|破誓')),
  tide: B(T('Rising|Tidal|Sunken|Abyssal|Storm-Tossed', 'Tide|Tempest|Current|Undertow|Maelstrom', 'the Deep|the Drowned Throne|the Endless Sea|Salt and Storm', 'Voice'),
    T('Crescente|Revolto/a|Submerso/a|Abissal|Tempestuoso/a', 'f:Maré|f:Tempestade|f:Corrente|m:Remoinho|m:Turbilhão', 'fp:Profundezas|m:Trono Afogado|m:Mar sem Fim'),
    T('Creciente|Revuelto/a|Sumergido/a|Abisal|Tempestuoso/a', 'f:Marea|f:Tempestad|f:Corriente|m:Remolino|f:Vorágine', 'fp:Profundidades|m:Trono Ahogado|m:Mar sin Fin'),
    D('die Flut|der Sturm|die Strömung|der Strudel|die Tiefe', 'der Tiefe|des versunkenen Throns|des endlosen Meeres'),
    T('涌动|潮汐|沉没|深渊|风暴', '浪潮|风暴|洋流|漩涡|深海', '深海|沉没王座|无尽之海')),
  arcane: B(T('Arcane|Eldritch|Runic|Astral|Mystic', 'Tempest|Grimoire|Conclave|Convergence|Codex', 'the Arcane|Forbidden Words|the Infinite Library|Starlight', 'Archmage'),
    T('Arcano/a|Místico/a|Rúnico/a|Astral|Proibido/a', 'f:Tempestade|m:Grimório|m:Conclave|f:Convergência|m:Códice', 'mp:Arcanos|fp:Palavras Proibidas|f:Biblioteca Infinita|f:Luz das Estrelas'),
    T('Arcano/a|Místico/a|Rúnico/a|Astral|Prohibido/a', 'f:Tempestad|m:Grimorio|m:Cónclave|f:Convergencia|m:Códice', 'mp:Arcanos|fp:Palabras Prohibidas|f:Biblioteca Infinita'),
    D('der Zaubersturm|das Grimoire|das Konklave|die Konvergenz|der Kodex', 'des Arkanen|der verbotenen Worte|der unendlichen Bibliothek|des Sternenlichts', 'Erzmagier'),
    T('奥术|秘法|符文|星界|神秘', '风暴|魔典|议会|汇流|法典', '奥秘|禁言|无尽书库|星光', '大法师')),
  knight: B(T('Valiant|Oathbound|Iron|Gallant|Sworn', 'Crusade|Order|Vanguard|Oath|Charge', 'the Realm|the Silver Oath|Honor|the Crown', 'Champion'),
    T('Valoroso/a|Leal|de Ferro|Galante|Sagrado/a', 'f:Cruzada|f:Ordem|f:Vanguarda|m:Juramento|f:Investida', 'm:Reino|m:Juramento de Prata|f:Honra|f:Coroa'),
    T('Valeroso/a|Leal|de Hierro|Galante|Sagrado/a', 'f:Cruzada|f:Orden|f:Vanguardia|m:Juramento|f:Carga', 'm:Reino|m:Juramento de Plata|m:Honor|f:Corona'),
    D('der Kreuzzug|der Orden|die Vorhut|der Eid|der Ansturm', 'des Reiches|des silbernen Eides|der Ehre|der Krone', 'Champion'),
    T('英勇|誓约|钢铁|高贵', '十字军|骑士团|先锋|誓言|冲锋', '王国|银誓|荣耀|王冠', '冠军')),
  legion: B(T('Invincible|Imperial|Eternal|Iron|Unbroken', 'Legion|Imperium|Phalanx|Triumph|Cohort', 'Rome|the Eagle|the Eternal City|the Seven Hills', 'Imperator|Legate'),
    T('Invicto/a|Imperial|Eterno/a|de Ferro|Inquebrável', 'f:Legião|m:Império|f:Falange|m:Triunfo|f:Coorte', ':Roma|f:Águia|f:Cidade Eterna|fp:Sete Colinas', 'Imperator'),
    T('Invicto/a|Imperial|Eterno/a|de Hierro|Inquebrantable', 'f:Legión|m:Imperio|f:Falange|m:Triunfo|f:Cohorte', ':Roma|f:Ciudad Eterna|fp:Siete Colinas', 'Imperator'),
    D('die Legion|das Imperium|die Phalanx|der Triumph|die Kohorte', 'Roms|des Adlers|der Ewigen Stadt|der sieben Hügel', 'Imperator|Legat'),
    T('不败|帝国|永恒|钢铁', '军团|帝国|方阵|凯旋', '罗马|雄鹰|永恒之城|七丘', '统帅')),
  horde: B(T('Endless|Swarming|Countless|Gathering|Unstoppable', 'Horde|Swarm|Host|Multitude|March', 'the Many|Ten Thousand|the Endless March', 'Herald|Voice'),
    T('Infindável|Fervilhante|Incontável|Imparável', 'f:Horda|m:Enxame|f:Hoste|f:Multidão|f:Marcha', 'mp:Muitos|mp:Dez Mil|f:Marcha sem Fim'),
    T('Infinito/a|Incontable|Imparable', 'f:Horda|m:Enjambre|f:Hueste|f:Multitud|f:Marcha', 'mp:Muchos|mp:Diez Mil|f:Marcha sin Fin'),
    D('die Horde|der Schwarm|das Heer|die Menge|der Marsch', 'der Vielen|der Zehntausend|des endlosen Marsches'),
    T('无尽|蜂拥|无数|势不可挡', '大军|虫群|军势|洪流', '万众|无尽行军')),
  dino: B(T('Primal|Thundering|Colossal|Prehistoric|Savage', 'Stampede|Rampage|Roar|Extinction|Jungle', 'the Lost World|Teeth and Claws|the Sun Empire|the Primal Age'),
    T('Primitivo/a|Trovejante|Colossal|Pré-histórico/a|Feroz', 'm:Estouro|f:Fúria|m:Rugido|f:Extinção|f:Selva', 'm:Mundo Perdido|m:Império do Sol|f:Era Primordial'),
    T('Primitivo/a|Atronador/a|Colosal|Prehistórico/a|Feroz', 'f:Estampida|m:Rugido|f:Extinción|f:Selva|f:Furia', 'm:Mundo Perdido|m:Imperio del Sol|f:Era Primordial'),
    D('die Stampede|das Toben|das Brüllen|das Aussterben|der Dschungel', 'der verlorenen Welt|des Sonnenimperiums|der Urzeit'),
    T('原始|雷鸣|巨型|史前|野蛮', '狂奔|暴走|咆哮|灭绝|丛林', '失落世界|太阳帝国|洪荒时代')),
  wilds: B(T('Primal|Untamed|Verdant|Wild|Overgrown', 'Wilds|Awakening|Bloom|Stampede|Heartwood', 'the Wild|Roots and Stone|the World Tree|the Green Heart', 'Warden|Voice'),
    T('Primordial|Indomado/a|Verdejante|Selvagem|Exuberante', 'f:Natureza|m:Despertar|m:Florescer|m:Estouro|m:Cerne', 'f:Natureza Selvagem|f:Árvore do Mundo|m:Coração Verde|fp:Raízes Profundas'),
    T('Primordial|Indómito/a|Verde|Salvaje|Exuberante', 'm:Despertar|m:Florecer|f:Estampida|m:Corazón', 'f:Naturaleza Salvaje|m:Árbol del Mundo|m:Corazón Verde'),
    D('die Wildnis|das Erwachen|die Blüte|die Stampede|das Kernholz', 'der Wildnis|des Weltenbaums|des grünen Herzens'),
    T('原始|野性|翠绿|蛮荒', '荒野|觉醒|绽放|狂奔', '荒野|世界之树|绿色之心')),
  faerie: B(T('Fae|Whispering|Moonlit|Glimmering|Mischievous', 'Court|Revel|Glamour|Mischief|Dream', 'the Faerie Court|Midsummer Night|Moonlight|Thorns'),
    T('Feérico/a|Sussurrante|Enluarado/a|Cintilante|Travesso/a', 'f:Corte|f:Folia|m:Encanto|f:Travessura|m:Sonho', 'f:Corte das Fadas|f:Noite de São João|m:Luar|mp:Espinhos'),
    T('Feérico/a|Susurrante|Centelleante|Travieso/a', 'f:Corte|f:Juerga|m:Encanto|f:Travesura|m:Sueño', 'f:Corte Feérica|f:Noche de San Juan|f:Luz de Luna'),
    D('der Feenhof|das Gelage|der Zauber|der Schabernack|der Traum', 'des Feenhofs|der Mittsommernacht|des Mondlichts|der Dornen'),
    T('妖精|低语|月光|闪烁|顽皮', '宫廷|狂欢|魅惑|恶作剧|梦境', '妖精宫廷|仲夏夜|月光|荆棘')),
  wolf: B(T('Howling|Feral|Moonstruck|Savage|Hungry', 'Hunt|Pack|Howl|Bloodmoon', 'the Full Moon|the Wild Hunt|the Night', 'Alpha'),
    T('Uivante|Feroz|Lunático/a|Selvagem|Faminto/a', 'f:Caçada|f:Alcateia|m:Uivo|f:Lua', 'f:Lua Cheia|f:Caçada Selvagem|f:Noite', 'Alfa'),
    T('Aullante|Feroz|Salvaje|Hambriento/a', 'f:Cacería|f:Manada|m:Aullido|f:Luna', 'f:Luna Llena|f:Cacería Salvaje|f:Noche', 'Alfa'),
    D('die Jagd|das Rudel|das Heulen|der Mond', 'des Vollmonds|der Wilden Jagd|der Nacht', 'Alpha'),
    T('嚎叫|野性|月狂|凶猛', '狩猎|狼群|嚎叫|血月', '满月|狂猎|黑夜', '头狼')),
  cat: B(T('Prowling|Graceful|Golden|Nine-Lived|Feline', 'Pride|Prowl|Pounce|Claw', 'Nine Lives|the Savannah|the Golden Mane'),
    T('Furtivo/a|Gracioso/a|Dourado/a|Felino/a', 'm:Bando|m:Salto|f:Garra|f:Espreita', 'fp:Sete Vidas|f:Savana|f:Juba Dourada'),
    T('Sigiloso/a|Grácil|Dorado/a|Felino/a', 'f:Manada|m:Salto|f:Garra|m:Acecho', 'fp:Siete Vidas|f:Sabana|f:Melena Dorada'),
    D('das Rudel|der Sprung|die Kralle|die Pirsch', 'der neun Leben|der Savanne|der goldenen Mähne'),
    T('潜行|优雅|金色|猫', '狮群|潜伏|猛扑|利爪', '九命|草原|金鬃')),
  rat: B(T('Scurrying|Gnawing|Teeming|Plague|Hidden', 'Swarm|Nest|Mischief|Burrow|Hoard', 'the Sewers|the Underground|the Thousand Tails'),
    T('Roedor/a|Fervilhante|Pestilento/a|Oculto/a', 'm:Enxame|m:Ninho|f:Praga|f:Toca', 'mp:Esgotos|m:Subsolo|fp:Mil Caudas'),
    T('Escurridizo/a|Roedor/a|Pestilente', 'm:Enjambre|m:Nido|f:Plaga|f:Madriguera', 'fp:Cloacas|m:Subsuelo|fp:Mil Colas'),
    D('der Schwarm|das Nest|die Plage|der Bau', 'der Kanalisation|des Untergrunds|der tausend Schwänze'),
    T('窜动|啃噬|成群|瘟疫', '鼠群|巢穴|瘟疫|地洞', '下水道|地底|千尾')),
  machine: B(T('Iron|Clockwork|Brass|Living|Mechanical', 'Engine|Foundry|Assembly|Protocol|Machine|Forge', 'Steel|the Great Machine|Gears and Gold|the Iron Heart', 'Architect|Engineer'),
    T('Mecânico/a|de Ferro|de Latão|Vivo/a|Incansável', 'm:Motor|f:Fundição|f:Montagem|m:Protocolo|f:Máquina|f:Forja', 'm:Aço|f:Grande Máquina|m:Coração de Ferro|=de Engrenagens e Ouro'),
    T('Mecánico/a|de Hierro|de Latón|Vivo/a|Incansable', 'm:Motor|f:Fundición|m:Ensamblaje|m:Protocolo|f:Máquina|f:Forja', 'm:Acero|f:Gran Máquina|m:Corazón de Hierro'),
    D('der Motor|die Gießerei|die Montage|das Protokoll|die Maschine|die Schmiede', 'des Stahls|der großen Maschine|des eisernen Herzens', 'Architekt'),
    T('钢铁|发条|黄铜|活体|机械', '引擎|铸造厂|装配|协议|机器|熔炉', '钢铁|伟大机器|铁之心', '建筑师')),
  shifter: B(T('Shifting|Boundless|Many-Faced|Mirrored|Mutable', 'Masquerade|Metamorphosis|Mirror|Legion|Guise', 'a Thousand Forms|Many Faces|the Endless Mask|Every Shape', 'Master'),
    T('Mutável|Ilimitado/a|Multiforme|Espelhado/a', 'f:Mascarada|f:Metamorfose|m:Espelho|f:Legião|m:Disfarce', 'fp:Mil Formas|fp:Muitas Faces|f:Máscara sem Fim'),
    T('Mutable|Ilimitado/a|Multiforme', 'f:Mascarada|f:Metamorfosis|m:Espejo|f:Legión|m:Disfraz', 'fp:Mil Formas|mp:Mil Rostros|f:Máscara sin Fin'),
    D('die Maskerade|die Metamorphose|der Spiegel|die Legion|die Verkleidung', 'der tausend Gestalten|der vielen Gesichter|der endlosen Maske'),
    T('变幻|无界|千面|镜像', '假面舞会|蜕变|镜像|军团', '千形|千面|无尽假面', '之主')),
  void: B(T('Ravenous|Endless|Hollow|Titanic|Unknowable', 'Void|Hunger|Brood|Annihilation|Abyss', 'the Void|the Blind Eternities|Oblivion|the Hungering Dark'),
    T('Voraz|Infindável|Oco/a|Titânico/a|Insondável', 'm:Vazio|f:Fome|f:Ninhada|f:Aniquilação|m:Abismo', 'm:Vazio|fp:Eternidades Cegas|m:Esquecimento|f:Escuridão Faminta'),
    T('Voraz|Infinito/a|Hueco/a|Titánico/a|Insondable', 'm:Vacío|f:Hambre|f:Nidada|f:Aniquilación|m:Abismo', 'm:Vacío|fp:Eternidades Ciegas|m:Olvido'),
    D('die Leere|der Hunger|die Brut|die Vernichtung|der Abgrund', 'der Leere|der blinden Ewigkeiten|des Vergessens'),
    T('贪婪|无尽|空洞|泰坦|不可知', '虚空|饥渴|巢群|湮灭|深渊', '虚空|盲目永恒|遗忘')),
  sky: B(T('Soaring|Windborne|Skyward|Feathered|Storm-Winged', 'Flight|Skies|Gale|Murmuration|Aerie', 'the Open Sky|the Four Winds|Feathers'),
    T('Alado/a|Celeste|Emplumado/a|Planante', 'm:Voo|m:Vendaval|m:Ninho|m:Bando', 'm:Céu Aberto|mp:Quatro Ventos|fp:Penas'),
    T('Alado/a|Celeste|Emplumado/a', 'm:Vuelo|m:Vendaval|m:Nido|f:Bandada', 'm:Cielo Abierto|mp:Cuatro Vientos'),
    D('der Flug|der Sturmwind|der Horst|der Schwarm', 'des offenen Himmels|der vier Winde|der Federn'),
    T('翱翔|御风|天空|羽翼', '飞翔|狂风|鹰巢|鸟群', '苍穹|四方之风|羽毛')),
  grave: B(T('Grim|Unhallowed|Ashen|Deathless|Forsaken', 'Requiem|Grave|Crypt|Resurrection|Elegy|Ossuary', 'the Fallen|the Grave|Bones and Ash|the Unburied|the Last Breath', 'Keeper|Herald'),
    T('Sinistro/a|Profano/a|Imortal|Esquecido/a|Fúnebre', 'm:Réquiem|f:Sepultura|f:Cripta|f:Ressurreição|f:Elegia|m:Ossário', 'mp:Caídos|f:Sepultura|=dos Ossos e das Cinzas|mp:Insepultos|m:Último Suspiro'),
    T('Siniestro/a|Profano/a|Inmortal|Olvidado/a|Fúnebre', 'm:Réquiem|f:Tumba|f:Cripta|f:Resurrección|f:Elegía|m:Osario', 'mp:Caídos|f:Tumba|=de Huesos y Ceniza|m:Último Aliento'),
    D('das Requiem|das Grab|die Gruft|die Auferstehung|die Elegie|das Beinhaus', 'der Gefallenen|des Grabes|aus Knochen und Asche|des letzten Atems'),
    T('阴森|亵渎|灰烬|不朽|被遗弃', '安魂曲|坟墓|墓穴|复活|挽歌|骨堂', '亡者|坟墓|白骨灰烬|最后一息')),
  blood: B(T('Bloody|Crimson|Gilded|Sacrificial|Decadent', 'Feast|Masquerade|Sacrifice|Bargain|Gala|Tithe', 'Blood|the Altar|the Last Toast|Ashes', 'Host|Patron'),
    T('Sangrento/a|Carmesim|Dourado/a|Sacrificial|Decadente', 'm:Banquete|f:Mascarada|m:Sacrifício|m:Acordo|m:Dízimo', 'm:Sangue|m:Altar|m:Último Brinde|fp:Cinzas'),
    T('Sangriento/a|Carmesí|Dorado/a|Decadente', 'm:Banquete|f:Mascarada|m:Sacrificio|m:Trato|m:Diezmo', 'f:Sangre|m:Altar|m:Último Brindis|fp:Cenizas'),
    D('das Festmahl|die Maskerade|das Opfer|der Handel|der Zehnt', 'des Blutes|des Altars|des letzten Toasts|der Asche'),
    T('血腥|猩红|镀金|献祭|颓废', '盛宴|假面舞会|献祭|交易|什一税', '鲜血|祭坛|最后祝酒|灰烬')),
  weave: B(T('Woven|Enchanted|Gilded|Inked|Fated', 'Tapestry|Weave|Loom|Enchantment|Thread|Scripture', 'Fate|the Golden Thread|Dreams|the Endless Loom|Ink and Starlight', 'Architect|Weaver|Scribe'),
    T('Tecido/a|Encantado/a|Dourado/a|Escrito/a|Predestinado/a', 'f:Tapeçaria|f:Trama|m:Tear|m:Encantamento|m:Fio|f:Escritura', 'm:Destino|m:Fio Dourado|mp:Sonhos|m:Tear sem Fim|=de Tinta e Luz Estelar'),
    T('Tejido/a|Encantado/a|Dorado/a|Escrito/a', 'm:Tapiz|m:Tejido|m:Telar|m:Encantamiento|m:Hilo|f:Escritura', 'm:Destino|m:Hilo Dorado|mp:Sueños|m:Telar sin Fin'),
    D('der Wandteppich|das Gewebe|der Webstuhl|der Zauber|der Faden|die Schrift', 'des Schicksals|des goldenen Fadens|der Träume|des endlosen Webstuhls', 'Architekt|Weber'),
    T('编织|魔法|镀金|墨染|命定', '挂毯|织网|织机|结界|丝线|经文', '命运|金线|梦境|无尽织机', '织者|建筑师')),
  dominion: B(T('Absolute|Iron|Silent|Unyielding|Cold', 'Dominion|Decree|Throne|Edict|Order|Tyranny', 'Silence|the Iron Crown|the Last Word|No Return', 'Sovereign|Tyrant|Arbiter'),
    T('Absoluto/a|de Ferro|Silencioso/a|Inflexível|Gélido/a', 'm:Domínio|m:Decreto|m:Trono|m:Édito|f:Ordem|f:Tirania', 'm:Silêncio|f:Coroa de Ferro|f:Última Palavra|=sem Retorno'),
    T('Absoluto/a|de Hierro|Silencioso/a|Inflexible|Gélido/a', 'm:Dominio|m:Decreto|m:Trono|m:Edicto|f:Orden|f:Tiranía', 'm:Silencio|f:Corona de Hierro|f:Última Palabra'),
    D('die Herrschaft|das Dekret|der Thron|das Edikt|die Ordnung|die Tyrannei', 'der Stille|der eisernen Krone|des letzten Wortes', 'Tyrann|Richter'),
    T('绝对|钢铁|沉默|不屈|冷酷', '统治|法令|王座|敕令|秩序|暴政', '沉默|铁冠|最后之言', '暴君|仲裁者')),
  war: B(T('Relentless|Thunderous|Blazing|Savage|Unbroken', 'Onslaught|Warpath|Charge|Conquest|Fury|Blitz', 'War|the Red Dawn|Iron and Blood|No Mercy', 'Warlord|Champion'),
    T('Implacável|Furioso/a|Flamejante|Selvagem|Indomável', 'f:Investida|f:Carga|f:Conquista|f:Fúria|m:Assalto', 'f:Guerra|f:Aurora Vermelha|=de Ferro e Sangue|=sem Piedade'),
    T('Implacable|Furioso/a|Llameante|Salvaje|Indomable', 'f:Embestida|f:Carga|f:Conquista|f:Furia|m:Asalto', 'f:Guerra|f:Aurora Roja|=de Hierro y Sangre|=sin Piedad'),
    D('der Ansturm|der Kriegspfad|die Attacke|die Eroberung|der Zorn', 'des Krieges|der roten Dämmerung|aus Eisen und Blut|ohne Gnade', 'Kriegsherr'),
    T('无情|狂怒|烈焰|野蛮|不屈', '猛攻|战途|冲锋|征服|怒火|闪击', '战争|赤色黎明|铁与血', '军阀')),
  champion: B(T('Unstoppable|Chosen|Gilded|Lone|Legendary', 'Crusade|Ascension|Trial|Duel|Armory', 'the Last Stand|a Thousand Blades|Glory', 'Champion|Blade'),
    T('Imparável|Escolhido/a|Dourado/a|Solitário/a|Lendário/a', 'f:Cruzada|f:Ascensão|f:Provação|m:Duelo|m:Arsenal', 'f:Última Resistência|fp:Mil Lâminas|f:Glória', 'Lâmina'),
    T('Imparable|Elegido/a|Dorado/a|Solitario/a|Legendario/a', 'f:Cruzada|f:Ascensión|f:Prueba|m:Duelo|m:Arsenal', 'f:Última Resistencia|fp:Mil Espadas|f:Gloria', 'Espada'),
    D('der Kreuzzug|der Aufstieg|die Prüfung|das Duell|die Rüstkammer', 'des letzten Gefechts|der tausend Klingen|des Ruhmes', 'Champion|Klinge'),
    T('势不可挡|天选|镀金|孤独|传奇', '远征|飞升|试炼|决斗|武库', '最后坚守|千刃|荣耀', '冠军')),
  infinite: B(T('Infinite|Endless|Perfect|Inevitable|Recursive', 'Loop|Engine|Gambit|Paradox|Equation|Spiral', 'Infinity|No End|the Perfect Loop|Inevitability', 'Architect|Master'),
    T('Infinito/a|Infindável|Perfeito/a|Inevitável|Recursivo/a', 'm:Ciclo|m:Motor|m:Estratagema|m:Paradoxo|f:Equação|f:Espiral', 'm:Infinito|=sem Fim|m:Ciclo Perfeito|f:Inevitabilidade'),
    T('Infinito/a|Perfecto/a|Inevitable|Recursivo/a', 'm:Bucle|m:Motor|m:Gambito|f:Paradoja|f:Ecuación|f:Espiral', 'm:Infinito|=sin Fin|m:Bucle Perfecto'),
    D('die Schleife|der Motor|das Gambit|das Paradox|die Gleichung|die Spirale', 'der Unendlichkeit|ohne Ende|der perfekten Schleife'),
    T('无限|无尽|完美|必然|递归', '循环|引擎|妙手|悖论|方程|螺旋', '无限|无尽|完美循环')),
  dawn: B(T('Radiant|Blessed|Golden|Hallowed|Sunlit', 'Dawn|Sanctuary|Benediction|Covenant|Light|Grace', 'the Dawn|the Sun|Endless Light|the First Light', 'Herald|Voice'),
    T('Radiante|Abençoado/a|Dourado/a|Sagrado/a|Solar', 'f:Aurora|m:Santuário|f:Bênção|f:Aliança|f:Luz|f:Graça', 'f:Aurora|m:Sol|f:Luz sem Fim|f:Primeira Luz'),
    T('Radiante|Bendito/a|Dorado/a|Sagrado/a|Solar', 'f:Aurora|m:Santuario|f:Bendición|f:Alianza|f:Luz|f:Gracia', 'f:Aurora|m:Sol|f:Luz sin Fin|f:Primera Luz'),
    D('die Morgenröte|das Heiligtum|der Segen|der Bund|das Licht|die Gnade', 'der Morgenröte|der Sonne|des ewigen Lichts|des ersten Lichts'),
    T('光辉|蒙福|金色|神圣|阳光', '黎明|圣所|祝福|盟约|圣光|恩典', '黎明|太阳|永恒之光|初光')),
  abyss: B(T('Bottomless|Drowning|Forgotten|Silent|Endless', 'Abyss|Oblivion|Erasure|Undertow', 'Forgetting|Empty Pages|the Deep|Lost Memories'),
    T('Insondável|Afogado/a|Esquecido/a|Silencioso/a', 'm:Abismo|m:Esquecimento|m:Apagamento|m:Remoinho', 'm:Esquecimento|fp:Páginas Vazias|fp:Profundezas|fp:Memórias Perdidas'),
    T('Insondable|Ahogado/a|Olvidado/a|Silencioso/a', 'm:Abismo|m:Olvido|m:Remolino', 'm:Olvido|fp:Páginas Vacías|fp:Profundidades|mp:Recuerdos Perdidos'),
    D('der Abgrund|das Vergessen|die Auslöschung|der Sog', 'des Vergessens|der leeren Seiten|der Tiefe|verlorener Erinnerungen'),
    T('无底|溺亡|被遗忘|沉默', '深渊|遗忘|抹除|暗流', '遗忘|空白书页|深海|失落记忆')),
  pantheon: B(T('Divine|Gathered|Celestial|Allied|Ascendant', 'Pantheon|Council|Alliance|Conclave|Gathering', 'the Gods|the Multiverse|the Planes|Sparks', 'Herald'),
    T('Divino/a|Celestial|Aliado/a|Ascendente', 'm:Panteão|m:Conselho|f:Aliança|m:Conclave|f:Reunião', 'mp:Deuses|m:Multiverso|mp:Planos|fp:Centelhas'),
    T('Divino/a|Celestial|Aliado/a|Ascendente', 'm:Panteón|m:Consejo|f:Alianza|m:Cónclave|f:Reunión', 'mp:Dioses|m:Multiverso|mp:Planos|fp:Chispas'),
    D('das Pantheon|der Rat|die Allianz|das Konklave|die Versammlung', 'der Götter|des Multiversums|der Ebenen|der Funken'),
    T('神圣|集结|天界|同盟|升腾', '万神殿|议会|联盟|秘会|集会', '众神|多元宇宙|诸位面|火花')),
  mirage: B(T('Flickering|Mirrored|Phantom|Shimmering|Twin', 'Mirage|Reflection|Echo|Illusion|Mirror', 'Mirrors|Echoes|the Twin Moons|Now and Again'),
    T('Bruxuleante|Espelhado/a|Fantasma|Cintilante|Gémeo/a', 'f:Miragem|m:Reflexo|m:Eco|f:Ilusão|m:Espelho', 'mp:Espelhos|mp:Ecos|fp:Luas Gémeas'),
    T('Parpadeante|Espejado/a|Fantasma|Centelleante|Gemelo/a', 'm:Espejismo|m:Reflejo|m:Eco|f:Ilusión|m:Espejo', 'mp:Espejos|mp:Ecos|fp:Lunas Gemelas'),
    D('die Fata Morgana|das Spiegelbild|das Echo|die Illusion|der Spiegel', 'der Spiegel|der Echos|der Zwillingsmonde'),
    T('闪烁|镜像|幻影|微光|孪生', '海市蜃楼|倒影|回响|幻象|镜子', '镜中|回响|双月')),
  growth: B(T('Ever-Growing|Mighty|Swelling|Towering|Blooming', 'Growth|Ascension|Evolution|Bloom|Might', 'Strength|the Endless Climb|Giants|the Ancient Oak'),
    T('Crescente|Poderoso/a|Imponente|Florescente', 'm:Crescimento|f:Ascensão|f:Evolução|m:Florescer|m:Poder', 'f:Força|f:Escalada sem Fim|mp:Gigantes|m:Carvalho Antigo'),
    T('Creciente|Poderoso/a|Imponente|Floreciente', 'm:Crecimiento|f:Ascensión|f:Evolución|m:Poder', 'f:Fuerza|mp:Gigantes|m:Roble Antiguo'),
    D('das Wachstum|der Aufstieg|die Evolution|die Blüte|die Macht', 'der Stärke|des endlosen Aufstiegs|der Riesen|der alten Eiche'),
    T('茁壮|强大|膨胀|高耸|绽放', '成长|飞升|进化|绽放|力量', '力量|无尽攀登|巨人|根源')),
  thief: B(T('Stolen|Larcenous|Borrowed|Gilded|Sly', 'Heist|Larceny|Gambit|Grift|Swindle|Bounty', 'Thieves|Borrowed Power|Stolen Crowns'),
    T('Roubado/a|Emprestado/a|Dourado/a|Astuto/a', 'm:Golpe|m:Furto|m:Estratagema|m:Esquema|f:Burla|m:Saque', 'mp:Ladrões|m:Poder Emprestado|fp:Coroas Roubadas'),
    T('Robado/a|Prestado/a|Dorado/a|Astuto/a', 'm:Golpe|m:Hurto|m:Gambito|f:Estafa|m:Botín', 'mp:Ladrones|m:Poder Prestado|fp:Coronas Robadas'),
    D('der Coup|der Diebstahl|das Gambit|der Schwindel|die Beute', 'der Diebe|geliehener Macht|gestohlener Kronen'),
    T('窃取|贪婪|借来|镀金|狡猾', '劫案|盗窃|妙手|骗局|赏金', '盗贼|借来之力|失窃王冠')),
  time: B(T('Timeless|Eternal|Endless|Second', 'Chronicle|Eternity|Hour|Age|Clockwork|Paradox', 'Time|the Endless Hour|Tomorrow|Ages', 'Master|Keeper'),
    T('Intemporal|Eterno/a|Infindável', 'f:Crónica|f:Eternidade|f:Hora|f:Era|m:Paradoxo', 'm:Tempo|f:Hora sem Fim|m:Amanhã|fp:Eras'),
    T('Atemporal|Eterno/a|Infinito/a', 'f:Crónica|f:Eternidad|f:Hora|f:Era|f:Paradoja', 'm:Tiempo|f:Hora sin Fin|m:Mañana|fp:Eras'),
    D('die Chronik|die Ewigkeit|die Stunde|das Zeitalter|das Paradox', 'der Zeit|der endlosen Stunde|von Morgen|der Zeitalter'),
    T('永恒|无尽|不朽', '编年史|永恒|时刻|纪元|悖论', '时间|无尽之时|明日|万古')),
  plague: B(T('Toxic|Corrupted|Festering|Blighted|Phyrexian', 'Plague|Blight|Contagion|Corruption|Compleation', 'Phyrexia|the Glistening Oil|Rot|the Ninth Sphere'),
    T('Tóxico/a|Corrompido/a|Purulento/a|Pestilento/a|Phyrexiano/a', 'f:Praga|f:Peste|m:Contágio|f:Corrupção|f:Completação', ':Phyrexia|m:Óleo Cintilante|f:Podridão'),
    T('Tóxico/a|Corrupto/a|Purulento/a|Pestilente|Pirexiano/a', 'f:Plaga|f:Peste|m:Contagio|f:Corrupción', ':Phyrexia|m:Aceite Brillante|f:Podredumbre'),
    D('die Plage|die Fäulnis|die Ansteckung|die Verderbnis|die Vervollkommnung', 'Phyrexias|des glänzenden Öls|der Fäulnis'),
    T('剧毒|腐化|溃烂|枯萎|非瑞克西亚', '瘟疫|枯萎|传染|腐化|完化', '非瑞克西亚|闪光油|腐朽')),
  flame: B(T('Burning|Blazing|Molten|Searing|Scorched', 'Inferno|Wildfire|Pyre|Blaze|Eruption|Firestorm', 'Fire|Ash and Ember|the Burning Sky|Embers', 'Herald'),
    T('Ardente|Flamejante|Abrasador/a|Calcinado/a', 'm:Inferno|m:Incêndio|f:Pira|f:Labareda|f:Erupção', 'm:Fogo|fp:Brasas|m:Céu em Chamas|fp:Cinzas Ardentes'),
    T('Ardiente|Llameante|Abrasador/a|Calcinado/a', 'm:Infierno|m:Incendio|f:Pira|f:Llamarada|f:Erupción', 'm:Fuego|fp:Brasas|m:Cielo en Llamas'),
    D('das Inferno|der Flächenbrand|der Scheiterhaufen|die Glut|der Ausbruch|der Feuersturm', 'des Feuers|aus Asche und Glut|des brennenden Himmels'),
    T('燃烧|烈焰|熔岩|灼热|焦土', '炼狱|野火|火葬堆|烈焰|喷发|火风暴', '烈火|灰烬余烬|燃烧天空')),
  apocalypse: B(T('Final|Cataclysmic|Ruinous|Last|Scorched', 'Apocalypse|Reckoning|Cataclysm|Judgment|Doom|Ruin', 'the End|the Last Day|Ashes|Nothing Left'),
    T('Final|Cataclísmico/a|Derradeiro/a', 'm:Apocalipse|m:Cataclismo|m:Juízo|f:Perdição|f:Ruína', 'm:Fim|m:Último Dia|fp:Cinzas'),
    T('Final|Cataclísmico/a|Postrero/a', 'm:Apocalipsis|m:Cataclismo|m:Juicio|f:Perdición|f:Ruina', 'm:Fin|m:Último Día|fp:Cenizas'),
    D('die Apokalypse|die Abrechnung|der Kataklysmus|das Gericht|das Verhängnis|der Untergang', 'des Endes|des letzten Tages|der Asche'),
    T('终末|灾变|毁灭|最后', '天启|清算|浩劫|审判|末日|废墟', '终焉|最后之日|灰烬')),
  mind: B(T('Whispering|Shattered|Hollow|Silent|Maddening', 'Torment|Whisper|Nightmare|Madness|Silence', 'the Mind|Broken Thoughts|Empty Hands|Madness'),
    T('Sussurrante|Estilhaçado/a|Oco/a|Silencioso/a|Enlouquecedor/a', 'm:Tormento|m:Sussurro|m:Pesadelo|f:Loucura|m:Silêncio', 'f:Mente|mp:Pensamentos Quebrados|fp:Mãos Vazias|f:Loucura'),
    T('Susurrante|Destrozado/a|Hueco/a|Silencioso/a|Enloquecedor/a', 'm:Tormento|m:Susurro|f:Pesadilla|f:Locura|m:Silencio', 'f:Mente|mp:Pensamientos Rotos|fp:Manos Vacías'),
    D('die Qual|das Flüstern|der Albtraum|der Wahnsinn|die Stille', 'des Geistes|zerbrochener Gedanken|leerer Hände|des Wahnsinns'),
    T('低语|破碎|空洞|沉默|疯狂', '折磨|低语|梦魇|疯狂|沉默', '心灵|破碎思绪|空手|疯狂')),
  fortress: B(T('Impregnable|Walled|Silent|Peaceful|Unassailable', 'Fortress|Bastion|Sanctuary|Citadel|Haven', 'Peace|the Unbroken Wall|Patience|Stone'),
    T('Inexpugnável|Amuralhado/a|Pacífico/a|Inabalável', 'f:Fortaleza|m:Bastião|m:Santuário|f:Cidadela|m:Refúgio', 'f:Paz|f:Muralha Intacta|f:Paciência|f:Pedra'),
    T('Inexpugnable|Amurallado/a|Pacífico/a|Inquebrantable', 'f:Fortaleza|m:Bastión|m:Santuario|f:Ciudadela|m:Refugio', 'f:Paz|f:Muralla Intacta|f:Paciencia|f:Piedra'),
    D('die Festung|die Bastion|das Heiligtum|die Zitadelle|der Hafen', 'des Friedens|der ungebrochenen Mauer|der Geduld|aus Stein'),
    T('坚不可摧|高墙|宁静|和平', '堡垒|棱堡|圣所|城塞|港湾', '和平|不破之墙|耐心|磐石')),
  feast: B(T('Generous|Bountiful|Merry|Golden|Shared', 'Feast|Festival|Banquet|Bounty|Gathering|Harvest', 'Friends|Plenty|the Long Table|Good Fortune'),
    T('Generoso/a|Farto/a|Alegre|Dourado/a|Partilhado/a', 'm:Banquete|m:Festival|f:Festa|f:Fartura|f:Colheita', 'mp:Amigos|f:Fartura|f:Mesa Comprida|f:Boa Sorte'),
    T('Generoso/a|Abundante|Alegre|Dorado/a|Compartido/a', 'm:Banquete|m:Festival|f:Fiesta|f:Abundancia|f:Cosecha', 'mp:Amigos|f:Abundancia|f:Mesa Larga|f:Buena Fortuna'),
    D('das Festmahl|das Festival|das Bankett|die Fülle|die Ernte', 'der Freunde|des Überflusses|der langen Tafel|des Glücks'),
    T('慷慨|丰饶|欢乐|金色|共享', '盛宴|节日|宴会|丰收|聚会', '朋友|丰盛|长桌|好运')),
  shadow: B(T('Shadowed|Midnight|Veiled|Obsidian|Whispering', 'Shadow|Eclipse|Conspiracy|Night|Shroud', 'Shadows|the Long Night|the Black Moon|Secrets'),
    T('Sombrio/a|da Meia-Noite|Velado/a|de Obsidiana|Sussurrante', 'f:Sombra|m:Eclipse|f:Conspiração|f:Noite|m:Manto', 'fp:Sombras|f:Longa Noite|f:Lua Negra|mp:Segredos'),
    T('Sombrío/a|de Medianoche|Velado/a|de Obsidiana|Susurrante', 'f:Sombra|m:Eclipse|f:Conspiración|f:Noche|m:Manto', 'fp:Sombras|f:Larga Noche|f:Luna Negra|mp:Secretos'),
    D('der Schatten|die Finsternis|die Verschwörung|die Nacht|der Schleier', 'der Schatten|der langen Nacht|des schwarzen Mondes|der Geheimnisse'),
    T('暗影|午夜|隐秘|黑曜|低语', '暗影|日蚀|密谋|长夜|帷幕', '阴影|漫漫长夜|黑月|秘密')),
  prism: B(T('Prismatic|Chromatic|Radiant|Kaleidoscopic|Unified', 'Convergence|Spectrum|Prism|Confluence|Harmony', 'the Spectrum|Every Hue|the Five Suns|Unity'),
    T('Prismático/a|Cromático/a|Radiante|Caleidoscópico/a|Unificado/a', 'f:Convergência|m:Espectro|m:Prisma|f:Confluência|f:Harmonia', 'm:Espectro|fp:Cinco Cores|mp:Cinco Sóis|f:Unidade'),
    T('Prismático/a|Cromático/a|Radiante|Caleidoscópico/a', 'f:Convergencia|m:Espectro|m:Prisma|f:Confluencia|f:Armonía', 'm:Espectro|mp:Cinco Colores|mp:Cinco Soles|f:Unidad'),
    D('die Konvergenz|das Spektrum|das Prisma|der Zusammenfluss|die Harmonie', 'des Spektrums|der fünf Farben|der fünf Sonnen|der Einheit'),
    T('棱彩|多彩|光辉|万花筒|统合', '汇聚|光谱|棱镜|合流|和谐', '光谱|五色|五日|统一')),
  epic: B(T('Eternal|Ancient|Gilded|Forsaken|Radiant|Untold', 'Dominion|Crusade|Covenant|Saga|Gambit|Legacy', 'Fate|the Ages|Kings|Ten Thousand Suns|Legends'),
    T('Eterno/a|Ancestral|Dourado/a|Esquecido/a|Radiante|Lendário/a', 'm:Domínio|f:Cruzada|f:Aliança|f:Saga|m:Estratagema|m:Legado', 'm:Destino|fp:Eras|mp:Reis|mp:Dez Mil Sóis|fp:Lendas'),
    T('Eterno/a|Ancestral|Dorado/a|Olvidado/a|Radiante|Legendario/a', 'm:Dominio|f:Cruzada|f:Alianza|f:Saga|m:Gambito|m:Legado', 'm:Destino|fp:Eras|mp:Reyes|fp:Leyendas'),
    D('die Herrschaft|der Kreuzzug|der Bund|die Saga|das Gambit|das Vermächtnis', 'des Schicksals|der Zeitalter|der Könige|der Legenden'),
    T('永恒|远古|镀金|被遗忘|光辉|传奇', '统治|远征|盟约|史诗|妙手|遗产', '命运|万古|诸王|传说')),
}
// títulos do comandante que servem a qualquer um (em pt/es sem género: «Voz», «Profeta», «Mestre»)
const ROLES = { en: 'Master|Herald|Keeper|Lord|Voice|Architect', pt: 'Mestre|Arauto|Voz|Flagelo|Profeta|Guia', es: 'Voz|Azote|Profeta|Guía', de: 'Meister|Herr|Hüter|Stimme|Herold', zh: '之主|之声|守护者|先知' }
// a tribo no plural: en, pt, es, de, zh (as outras só em inglês)
const TRIBES = {
  Spirit: 'Spirits|Espíritos|Espíritus|Geister|幽灵', Pirate: 'Pirates|Piratas|Piratas|Piraten|海盗', Ninja: 'Ninjas|Ninjas|Ninjas|Ninjas|忍者',
  Rogue: 'Rogues|Ladinos|Pícaros|Schurken|盗贼', Assassin: 'Assassins|Assassinos|Asesinos|Assassinen|刺客', Vampire: 'Vampires|Vampiros|Vampiros|Vampire|吸血鬼',
  Zombie: 'Zombies|Zombies|Zombis|Zombies|灵俑', Dragon: 'Dragons|Dragões|Dragones|Drachen|龙', Elf: 'Elves|Elfos|Elfos|Elfen|精灵', Goblin: 'Goblins|Goblins|Trasgos|Goblins|鬼怪',
  Angel: 'Angels|Anjos|Ángeles|Engel|天使', Demon: 'Demons|Demónios|Demonios|Dämonen|恶魔', Merfolk: 'Merfolk|Tritões|Tritones|Meervolk|人鱼',
  Wizard: 'Wizards|Feiticeiros|Hechiceros|Zauberer|法师', Knight: 'Knights|Cavaleiros|Caballeros|Ritter|骑士', Soldier: 'Soldiers|Soldados|Soldados|Soldaten|士兵',
  Dinosaur: 'Dinosaurs|Dinossauros|Dinosaurios|Dinosaurier|恐龙', Faerie: 'Faeries|Fadas|Hadas|Feen|妖精', Werewolf: 'Werewolves|Lobisomens|Hombres Lobo|Werwölfe|狼人',
  Wolf: 'Wolves|Lobos|Lobos|Wölfe|狼', Cat: 'Cats|Gatos|Gatos|Katzen|猫', Rat: 'Rats|Ratazanas|Ratas|Ratten|老鼠', Squirrel: 'Squirrels|Esquilos|Ardillas|Eichhörnchen|松鼠',
  Warrior: 'Warriors|Guerreiros|Guerreros|Krieger|战士', Cleric: 'Clerics|Clérigos|Clérigos|Kleriker|僧侣', Eldrazi: 'Eldrazi|Eldrazi|Eldrazi|Eldrazi|奥札奇',
  Dwarf: 'Dwarves|Anões|Enanos|Zwerge|矮人', Robot: 'Robots|Robôs|Robots|Roboter|机器人', Construct: 'Constructs|Constructos|Constructos|Konstrukte|构装体',
  Bird: 'Birds|Aves|Aves|Vögel|鸟', Hydra: 'Hydras|Hidras|Hidras|Hydren|九头蛇', Elemental: 'Elementals|Elementais|Elementales|Elementare|元素', Samurai: 'Samurai|Samurais|Samuráis|Samurai|武士',
  Sliver: 'Slivers|Slivers|Slivers|Slivers|裂片妖',
}
const LANGI = { en: 0, pt: 1, es: 2, de: 3, zh: 4 }
// tipo de criatura → tema
const TRIBE_THEME = {
  Spirit: 'ghost', Shade: 'ghost', Specter: 'ghost', Wraith: 'ghost', Pirate: 'pirate', Ninja: 'ninja', Samurai: 'ninja', Rogue: 'rogue', Assassin: 'rogue',
  Vampire: 'vampire', Noble: 'blood', Zombie: 'undead', Skeleton: 'undead', Dragon: 'dragon', Elf: 'elf', Druid: 'wilds', Goblin: 'goblin', Angel: 'angel', Cleric: 'dawn', Monk: 'dawn',
  Demon: 'demon', Devil: 'demon', Merfolk: 'tide', Kraken: 'tide', Octopus: 'tide', Serpent: 'tide', Leviathan: 'tide', Wizard: 'arcane', Shaman: 'flame', Knight: 'knight',
  Soldier: 'legion', Ally: 'legion', Warrior: 'war', Giant: 'war', Minotaur: 'war', Orc: 'war', Sliver: 'horde', Saproling: 'horde', Fungus: 'horde', Insect: 'horde',
  Dinosaur: 'dino', Beast: 'wilds', Hydra: 'wilds', Elemental: 'wilds', Treefolk: 'wilds', Ooze: 'growth', Faerie: 'faerie', Werewolf: 'wolf', Wolf: 'wolf', Cat: 'cat',
  Rat: 'rat', Squirrel: 'rat', Robot: 'machine', Construct: 'machine', Golem: 'machine', Thopter: 'machine', Myr: 'machine', Artificer: 'machine', Shapeshifter: 'shifter',
  Eldrazi: 'void', Bird: 'sky', Phyrexian: 'plague', Inkling: 'weave', Nightmare: 'mind', Horror: 'mind', Halfling: 'feast', Citizen: 'feast', Advisor: 'dominion',
}
// estratégia (archetypes.js) → tema e o nome em inglês do arquétipo («Izzet Tempo», «Murktide Tempo»)
const ARCH_THEME = { reanimator: 'grave', graveyard: 'grave', aristocrats: 'blood', enchantress: 'weave', spellslinger: 'arcane', storm: 'arcane', tokens: 'horde',
  control: 'dominion', stax: 'dominion', aggro: 'war', voltron: 'champion', combo: 'infinite', ramp: 'wilds', landfall: 'wilds', lifegain: 'dawn', mill: 'abyss',
  superfriends: 'pantheon', blink: 'mirage', copy: 'mirage', counters: 'growth', steal: 'thief', extraturn: 'time', infect: 'plague', burn: 'flame', wipe: 'apocalypse',
  discard: 'mind', pillowfort: 'fortress', grouphug: 'feast', artifacts: 'machine', tempo: 'tide' }
const ARCH_NAME = { control: 'Control', burn: 'Burn', wipe: 'Wrath', stax: 'Stax', aggro: 'Aggro', tempo: 'Tempo', midrange: 'Midrange', combo: 'Combo', mill: 'Mill',
  discard: 'Discard', voltron: 'Voltron', aristocrats: 'Aristocrats', tokens: 'Tokens', reanimator: 'Reanimator', spellslinger: 'Spells', lifegain: 'Lifegain', landfall: 'Landfall',
  blink: 'Blink', counters: 'Counters', superfriends: 'Superfriends', grouphug: 'Group Hug', pillowfort: 'Pillowfort', storm: 'Storm', ramp: 'Ramp', artifacts: 'Artifacts',
  enchantress: 'Enchantress', graveyard: 'Graveyard', steal: 'Thieves', copy: 'Clones', extraturn: 'Time Walk', infect: 'Infect' }
const COLOR_THEME = { W: 'dawn', U: 'tide', B: 'shadow', R: 'flame', G: 'wilds', UB: 'shadow', WUBRG: 'prism' }
// Universes Beyond: tema e frases da franquia (em inglês, como as cartas); [regex nos nomes do comandante/cartas-chave, frase]
const UNI = {
  bot: ['machine', [[/megatron/i, 'Decepticons, All Hail Megatron!'], [/megatron/i, 'Megatron: Peace Through Tyranny'], [/optimus/i, 'Optimus Prime: Freedom Is the Right of All Sentient Beings'],
    [/optimus/i, 'Autobots, Roll Out!'], [null, 'More Than Meets the Eye'], [null, 'Till All Are One'], [null, '{L}: Robots in Disguise']]],
  acr: ['rogue', [[null, '{L} and the Brotherhood of Shadows'], [null, 'Nothing Is True, Everything Is Permitted'], [null, 'Requiescat in Pace'], [null, 'We Work in the Dark to Serve the Light'], [null, '{L}: Leap of Faith']]],
  ltr: ['epic', [[null, 'One Ring to Rule Them All'], [null, 'Not All Who Wander Are Lost'], [null, '{L} and the Fellowship of the Ring'], [/sauron|nazg|witch-king/i, 'The Eye of Sauron'],
    [/sauron|nazg|witch-king/i, 'The Shadow of Mordor'], [/gandalf/i, 'Gandalf: You Shall Not Pass!'], [/frodo|samwise|bilbo|merry|pippin/i, 'There and Back Again']]],
  '40k': ['war', [[null, 'In the Grim Darkness of the Far Future'], [null, 'The Emperor Protects'], [null, '{L}: For the Emperor!'], [/abaddon|khorne|be'lakor/i, 'Blood for the Blood God!'],
    [/ghazghkull/i, 'WAAAGH!'], [/szarekh|imotekh|trazyn/i, 'The Silent King Awakens'], [/swarmlord|hive tyrant|tyranid/i, 'The Great Devourer']]],
  spm: ['rogue', [[null, 'With Great Power'], [null, 'Your Friendly Neighborhood {L}'], [/venom|carnage/i, 'We Are Venom']]],
  marvel: ['champion', [[null, 'Avengers Assemble!'], [null, "{L}: Earth's Mightiest Heroes"], [null, 'Excelsior!']]],
  who: ['time', [[null, 'Allons-y!'], [null, 'Wibbly-Wobbly, Timey-Wimey'], [null, '{L} and the Blue Box'], [/dalek/i, 'Exterminate!']]],
  pip: ['war', [[null, 'War. War Never Changes.'], [null, '{L}: Welcome to the Wasteland'], [null, 'Vault Dwellers of the Wasteland']]],
  fin: ['arcane', [[null, '{L} and the Warriors of Light'], [null, 'Crystals of Light'], [null, 'Limit Break!'], [/sephiroth/i, 'One-Winged Angel']]],
  tla: ['wilds', [[null, 'Water, Earth, Fire, Air'], [null, '{L}: Master of the Four Elements'], [/zuko|azula|ozai/i, 'The Fire Nation Attacks']]],
  rex: ['dino', [[null, 'Life Finds a Way'], [null, '{L}: Welcome to the Park'], [null, 'Clever Girl']]],
  tmt: ['ninja', [[null, 'Cowabunga!'], [null, 'Heroes in a Half Shell'], [null, '{L} and the Sewer Dojo']]],
  trk: ['epic', [[null, 'To Boldly Go'], [null, '{L}: Make It So'], [null, 'Live Long and Prosper'], [/borg|locutus/i, 'Resistance Is Futile']]],
  dnd: ['dragon', [[null, 'Roll for Initiative'], [null, '{L} and the Dungeon of Doom'], [null, 'A Natural Twenty']]],
  godzilla: ['dino', [[null, 'King of the Monsters'], [null, '{L}: Titans Rising']]],
  dracula: ['vampire', [[null, 'Children of the Night'], [null, '{L}: The Count Awakes']]],
}
const UNI_NAME = { bot: 'Transformers', acr: "Assassin's Creed", ltr: 'The Lord of the Rings', '40k': 'Warhammer 40,000', spm: "Marvel's Spider-Man", marvel: 'Marvel', who: 'Doctor Who',
  pip: 'Fallout', fin: 'Final Fantasy', tla: 'Avatar: The Last Airbender', rex: 'Jurassic World', tmt: 'Teenage Mutant Ninja Turtles', trk: 'Star Trek', dnd: 'Dungeons & Dragons', godzilla: 'Godzilla', dracula: 'Dracula' }
// sem o vocab.json: as mecânicas próprias de cada universo
const UNI_KW = [['bot', c => c.kw?.some(k => k === 'More Than Meets the Eye' || k === 'Living metal')], ['acr', c => c.kw?.includes('Freerunning')],
  ['ltr', c => /the ring tempts you/i.test(c.o || '')], ['40k', c => c.kw?.includes('Squad')], ['pip', c => /\brad counters?\b/i.test(c.o || '')], ['who', c => /Time Lord/.test(c.t)]]
// frases de um tema que não mudam com a língua (o latim da legião)
const THEME_LINES = { legion: ['SPQR: Roma Invicta', 'SPQR: Legio Aeterna', 'Imperium Sine Fine', '{L}: Ave Imperator'] }

const TITLES = /^(Admiral|Captain|Lord|Lady|General|King|Queen|Prince|Princess|Sir|Doctor|Commander|Grand|High|Baron|Count|Duke|Emperor|Empress|Saint|Old|Professor|Master|Elder|Mother|Father|Sister|Brother)$/
/** O nome curto de uma carta para o nome do deck: antes da vírgula, «Admiral Beckett», «Edgar Markov», «Ezio» (de Ezio Auditore da Firenze). */
export function shortName(n, legendary = true) {
  const s = n.split(' // ')[0], i = s.indexOf(',')
  if (i > 0) return s.slice(0, i)
  const w = s.split(' ')
  if (w.length > 1 && TITLES.test(w[0])) return w.slice(0, 2).join(' ')
  if (legendary && w.length <= 2) return s
  return w[0] === 'The' && w[1] ? w[1] : w[0]
}
const plural = w => (/(s|x|ch|sh)$/.test(w) ? w + 'es' : /f$/.test(w) ? w.slice(0, -1) + 'ves' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's')
const legendary = c => /Legendary/.test(c.t)
const subtypes = c => (c.t.split(' // ')[0].split(' — ')[1] || '').split(' ').filter(Boolean)

/** Perfil do deck para os nomes e para a IA. */
export function analyse(data, deck) {
  const get = n => data.byName.get(n)
  const cmds = (deck.commanders || []).map(get).filter(Boolean)
  const main = Object.entries(deck.main || {}).map(([n, q]) => [get(n), q]).filter(([c]) => c)
  const all = [...cmds.map(c => [c, 1]), ...main]
  const spells = all.filter(([c]) => c.mt !== 'Land' && !/\bLand\b/.test(c.t.split(' // ')[0]))
  const nl = spells.reduce((s, [, q]) => s + q, 0) || 1
  let tribe = deckTribe(all.flatMap(([c, q]) => Array(Math.min(q, 4)).fill(c)))
  if (!tribe) for (const c of cmds) {  // «Other Pirates you control get +1/+1»: a tribo do texto do comandante, se o deck tiver alguns
    const t = subtypes(c).find(t => new RegExp(`\\b${t}s?\\b`).test(c.o || '') && main.filter(([x]) => subtypes(x).includes(t)).length >= 3)
    if (t) { tribe = t; break }
  }
  // estratégias: a fração das não-terreno que serve cada uma (o comandante vale 8 cópias); «combo» só com combos completos
  const share = {}
  for (const k of Object.keys(ARCH)) {
    if (k === 'removal' || k === 'combo') continue
    let s = 0
    for (const [c, q] of spells) if (archScore(c, k) >= 1) s += cmds.includes(c) ? Math.min(8, nl * 0.1) : q
    share[k] = (s / nl) * (k === 'midrange' ? 0.6 : 1)
  }
  const have = new Set(all.map(([c]) => c.i)), combos = []
  if (data.combos && data.combosByCard) {
    const seen = new Set()
    for (const i of have) for (const k of data.combosByCard[i] || []) {
      if (seen.has(k)) continue
      seen.add(k)
      const cb = data.combos[k]
      if (cb[1].every(j => have.has(j))) combos.push(cb)
    }
    combos.sort((a, b) => (b[5] || 0) - (a[5] || 0))
  }
  if (combos.length >= 2) share.combo = 0.25
  const archs = Object.entries(share).filter(([, v]) => v >= 0.18).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k)
  // universo: as cartas nascidas numa franquia (vocab.json); sem ele, as mecânicas próprias
  let uni = null, best = 0
  const uniq = spells.map(([c]) => c)
  if (VOC.on) for (const f of VOC.fr.values()) {  // o comandante nascido lá decide; senão ≥ 20% das cartas
    if (f.id === 'ub' || !UNI[f.id]) continue
    const o = setOriginals(f.id), g = new Set(setGroup(f.id))
    const n = uniq.filter(c => o.has(c.i)).length + cmds.filter(c => g.has(VOC.first[c.i])).length * 1000
    if (n > best && n >= Math.max(5, uniq.length * 0.2)) { best = n; uni = f.id }
  }
  if (!uni) for (const [id, f] of UNI_KW) { const n = uniq.filter(f).length + cmds.filter(f).length * 4; if (n > best && n >= 3) { best = n; uni = id } }
  // cartas-chave: lendárias, condições de vitória, cópias, custo alto
  const score = ([c, q]) => q * 2 + (legendary(c) ? 4 : 0) + (c.tg?.includes('wincon') ? 2 : 0) + (c.cmc >= 4 ? 1 : 0) + (c.r === 'm' ? 1 : 0) + (c.cx ? 0.5 : 0)
  const top = spells.filter(([c]) => !cmds.includes(c)).sort((a, b) => score(b) - score(a) || (a[0].er ?? 1e9) - (b[0].er ?? 1e9)).map(([c]) => c)
  const keyC = !cmds.length && top.find(c => (deck.main[c.n] || 0) >= 3 || legendary(c))
  const lead = cmds.length ? cmds.map(c => shortName(c.n)).join(' & ') : keyC && legendary(keyC) ? shortName(keyC.n) : ''
  const key = !cmds.length && keyC ? shortName(keyC.n, legendary(keyC)) : ''
  const { ci } = deckIdentity(data, { commanders: deck.commanders || [], main: deck.main || {} })
  const guild = ci.length >= 2 && ci.length <= 3 ? CNAME[ci] : ci.length === 4 ? NEPH[ci] : ''
  // temas por ordem: universo, tribo, 1.ª estratégia, tipos do comandante, outras estratégias, cores, genérico
  const themes = [], push = k => { if (k && BANK[k] && !themes.includes(k)) themes.push(k) }
  if (uni) push(UNI[uni][0])
  if (tribe) push(TRIBE_THEME[tribe])
  push(ARCH_THEME[archs[0]])
  for (const c of cmds) for (const t of subtypes(c)) push(TRIBE_THEME[t])
  for (const k of archs.slice(1)) push(ARCH_THEME[k])
  push(COLOR_THEME[ci])
  push('epic')
  // frases prontas: as do universo (as com regex só se o nome bater) e as do tema
  const names = [...cmds, ...top.slice(0, 3)].map(c => c.n).join(' | ')
  const lines = []
  if (uni) for (const [re, s] of UNI[uni][1]) if (!re || re.test(names)) lines.push({ s, re: !!re, c: !!re || s.includes('{L}') })
  for (const t of themes) for (const s of THEME_LINES[t] || []) lines.push({ s, c: s.includes('{L}') })
  return { key: deck.id || deck.name || '', name: deck.name || '', format: deck.format || '', cmds: cmds.map(c => c.n), cmdText: cmds.map(c => c.o || ''),
    lead, keyCard: key, tribe, archs, ci, guild, uni, themes, lines, top: top.slice(0, 12).map(c => c.n),
    combos: combos.slice(0, 3).map(cb => `${cb[1].map(i => data.cards[i]?.n).join(' + ')}${cb[2]?.[0] ? ` → ${cb[2][0]}` : ''}`) }
}

// --- frases ---
const hash = s => [...s].reduce((h, ch) => Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0, 2166136261)
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const parts = s => (s ? s.split('|') : [])
const gw = s => { const i = s.indexOf(':'); return i < 0 ? { g: 'm', w: s } : { g: s.slice(0, i), w: s.slice(i + 1) } }
const ROM = { pt: { art: { m: 'o', f: 'a', mp: 'os', fp: 'as' }, de: { m: 'do', f: 'da', mp: 'dos', fp: 'das', '': 'de' }, and: 'e' },
  es: { art: { m: 'el', f: 'la', mp: 'los', fp: 'las' }, de: { m: 'del', f: 'de la', mp: 'de los', fp: 'de las', '': 'de' }, and: 'y' } }
const adjG = (a, g) => { const i = a.indexOf('/'); if (i < 0) return a; const b = a.slice(0, i), s = a.slice(i + 1); return g[0] === 'f' ? (/o$/.test(b) ? b.slice(0, -1) + s : b + s) : b }
const cap = s => s && s[0].toUpperCase() + s.slice(1)
const possEn = n => (/s$/i.test(n) ? `${n}'` : `${n}'s`)
const possDe = n => (/[sxzß]$/i.test(n) ? `${n}'` : `${n}s`)
// modelos: [id, precisa de (L comandante, T tribo, G guilda, A arquétipo, K carta-chave), f]; w = palavras sorteadas
const TPL = {
  en: [['1', 'L', w => `${possEn(w.L)} ${w.a()} ${w.n()}`], ['2', 'L', w => `${w.L}, ${w.r()} of ${w.p()}`], ['3', 'L', w => `${w.L} and the ${w.n()} of ${w.p()}`],
    ['4', 'L', w => `${possEn(w.L)} ${w.n()} of ${w.p()}`], ['5', 'L', w => `${w.L}: The ${w.a()} ${w.n()}`], ['6', 'T', w => `${w.T} of ${w.p()}`],
    ['7', '', w => `The ${w.a()} ${w.n()}`], ['8', '', w => `${w.n()} of ${w.p()}`], ['9', 'G', w => `The ${w.G} ${w.n()}`], ['10', 'GA', w => `${w.G} ${w.A}`], ['11', 'KA', w => `${w.K} ${w.A}`]],
  de: [['1', 'L', w => `${possDe(w.L)} ${w.nb()}`], ['2', 'L', w => `${w.L}, ${w.r()} ${w.p()}`], ['3', 'L', w => `${w.L} und ${w.n()} ${w.p()}`], ['4', 'L', w => `${cap(w.n())} von ${w.L}`],
    ['6', 'T', w => `${w.T} ${w.p()}`], ['8', '', w => `${cap(w.n())} ${w.p()}`], ['9', 'G', w => `${w.G}: ${cap(w.n())}`], ['10', 'GA', w => `${w.G} ${w.A}`], ['11', 'KA', w => `${w.K} ${w.A}`]],
  zh: [['1', 'L', w => `${w.L}的${w.a()}${w.n()}`], ['2', 'L', w => `${w.L}·${w.p()}${w.r()}`], ['3', 'L', w => `${w.L}与${w.p()}${w.n()}`], ['6', 'T', w => `${w.p()}${w.T}`],
    ['7', '', w => `${w.a()}${w.n()}`], ['8', '', w => `${w.p()}${w.n()}`], ['9', 'G', w => `${w.G}${w.n()}`], ['10', 'GA', w => `${w.G} ${w.A}`], ['11', 'KA', w => `${w.K} ${w.A}`]],
}
for (const l of ['pt', 'es']) {  // pt e es: o adjetivo concorda com o nome; artigos e «de»+artigo contraídos
  const R = ROM[l], N = w => w.nn(), art = x => R.art[x.g] || R.art.m, A = (w, x) => adjG(w.a(), x.g)
  TPL[l] = [['1', 'L', w => { const x = N(w); return cap(`${art(x)} ${x.w} ${A(w, x)} de ${w.L}`) }], ['2', 'L', w => `${w.L}, ${w.r()} ${w.p()}`],
    ['3', 'L', w => { const x = N(w); return `${w.L} ${R.and} ${art(x)} ${x.w} ${w.p()}` }], ['4', 'L', w => { const x = N(w); return `${w.L}: ${cap(art(x))} ${x.w} ${A(w, x)}` }],
    ['6', 'T', w => `${w.T} ${w.p()}`], ['7', '', w => { const x = N(w); return cap(`${art(x)} ${x.w} ${A(w, x)}`) }], ['8', '', w => { const x = N(w); return cap(`${art(x)} ${x.w} ${w.p()}`) }],
    ['9', 'G', w => { const x = N(w); return cap(`${art(x)} ${x.w} ${w.G}`) }], ['10', 'GA', w => `${w.G} ${w.A}`], ['11', 'KA', w => `${w.K} ${w.A}`]]
}
export const nameKey = s => norm(String(s || ''))
// «O Esquecimento Esquecido»: duas palavras com a mesma raiz soam a eco
const roots = s => norm(s).split(' ').filter(x => x.length >= 5).map(x => x.slice(0, 5))
const echo = s => { const w = norm(s).split(' ').filter(x => x.length >= 5).map(x => x.slice(0, 5)); return new Set(w).size < w.length }

/**
 * 5–8 nomes para o perfil p (analyse): lang = língua dos modelos; keep = com o nome do comandante (ou da carta-chave);
 * seed muda o sorteio; taken = nomes que não se repetem (os outros decks, o nome atual).
 */
export function suggest(p, { lang = 'pt', keep = true, seed = 0, taken = [], n = 6 } = {}) {
  lang = TPL[lang] ? lang : 'en'
  const r = rng(hash(`${p.key}|${seed}|${lang}|${keep ? 1 : 0}`)), pick = a => a[Math.floor(r() * a.length)]
  const L = keep ? p.lead : '', K = keep ? p.keyCard : '', T = p.tribe ? parts(TRIBES[p.tribe])[LANGI[lang]] || (lang === 'en' ? plural(p.tribe) : '') : ''
  const A = ARCH_NAME[p.archs[0]] || '', G = p.guild
  const have = { L: !!L, T: !!T, G: !!G, A: !!A, K: !!K }
  const tpls = TPL[lang].filter(([, need]) => [...need].every(k => have[k]))
  const withL = tpls.filter(t => t[1].includes('L') || t[1].includes('K')), noL = tpls.filter(t => !t[1].includes('L') && !t[1].includes('K'))
  const weights = p.themes.map((t, i) => (t === 'epic' ? 0.5 : [6, 3, 2][i] || 1))
  const theme = () => { let x = r() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return p.themes[i]; return p.themes[0] }
  const seen = new Set(taken.map(nameKey)), out = [], perTpl = {}, used = new Map(), leadR = new Set(roots(`${L} ${K} ${T} ${G} ${A}`))
  const add = s => { const k = nameKey(s); if (!k || seen.has(k)) return false; seen.add(k); out.push(s); return true }
  // frases do universo/tema primeiro: uma própria do comandante (Optimus, Megatron…) e uma geral; são em inglês, na outra língua só uma
  const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
  const ok = p.lines.filter(x => (keep || !x.c) && (!x.s.includes('{L}') || L)), txt = x => x.s.replace('{L}', L)
  const own = shuf(ok.filter(x => x.re).map(txt)), gen = shuf(ok.filter(x => !x.re).map(txt))
  for (const s of [own[0], gen[0]].filter(Boolean).slice(0, lang === 'en' ? 2 : 1)) add(s)
  for (let tries = 0; out.length < n && tries < 400; tries++) {
    const pool = withL.length && (!noL.length || r() < 0.62) ? withL : noL
    if (!pool.length) break
    const [id, need, f] = pick(pool)
    if ((perTpl[id] || 0) >= 2) continue
    const th = need.includes('T') && BANK[TRIBE_THEME[p.tribe]] ? TRIBE_THEME[p.tribe] : theme(), b = BANK[th][lang], alt = BANK[theme()][lang]  // um quarto das vezes o adjetivo vem de outro tema
    const roles = [...parts(b.r), ...parts(ROLES[lang])]
    const w = { L, T, G, A, K, a: () => pick(parts((r() < 0.25 ? alt : b).a || b.a)), n: () => pick(parts(b.n)), nb: () => pick(parts(b.n)).replace(/^\S+ /, ''),
      nn: () => gw(pick(parts(b.n))), r: () => pick(roles.filter(x => !L.includes(x))),
      p: () => { const s = pick(parts(b.p)); if (!ROM[lang]) return s; if (s[0] === '=') return s.slice(1); const x = gw(s); return `${ROM[lang].de[x.g] ?? 'de'} ${x.w}` } }
    const s = f(w).replace(/\s+/g, ' ').trim()
    if (s.length > 52 || /undefined/.test(s) || echo(s)) continue
    const rs = roots(s).filter(x => !leadR.has(x))
    if (rs.some(x => (used.get(x) || 0) >= 2)) continue  // a mesma palavra em mais de dois nomes cansa
    if (add(s)) { perTpl[id] = (perTpl[id] || 0) + 1; for (const x of rs) used.set(x, (used.get(x) || 0) + 1) }
  }
  return out
}

// a descrição da IA acrescentada às notas do deck (sem repetir)
export const addNotes = (old, d) => (!old?.trim() ? d : old.includes(d) ? old : `${old.trimEnd()}\n\n${d}`)

/** Resumo compacto do deck para a IA (sem a lista inteira). */
export function summary(p) {
  return [`Nome atual: ${p.name || '—'}`, `Formato: ${p.format || '—'}`,
    p.cmds.length ? `Comandante: ${p.cmds.map((n, i) => `${n} — ${p.cmdText[i].replace(/\n/g, ' ').slice(0, 280)}`).join(' | ')}` : p.keyCard ? `Carta-chave: ${p.keyCard}` : '',
    `Cores: ${p.ci || 'incolor'}${p.guild ? ` (${p.guild})` : ''}`, p.tribe ? `Tribo: ${p.tribe}` : '',
    p.archs.length ? `Estratégias: ${p.archs.map(k => ARCH_NAME[k] || k).join(', ')}` : '', p.uni ? `Universo: ${UNI_NAME[p.uni] || p.uni}` : '',
    `Cartas principais: ${p.top.join('; ')}`, p.combos.length ? `Combos: ${p.combos.join('; ')}` : ''].filter(Boolean).join('\n')
}

export function selfcheck(assert, prepData) {
  const F = ['commander', 'modern']
  const c = (n, t, o, ci, extra = {}) => ({ n, t, o, ci, mc: '', cmc: 3, tg: [], kw: [], pt: '', r: 'r', lg: 3, rs: 0, er: 1000, ...extra })
  const cards = [
    c('Teval, the Balanced Scale', 'Legendary Creature — Spirit Dragon', 'Flying\nWhenever Teval attacks, mill three cards. Then you may return a land card from your graveyard to the battlefield tapped.', 'BGU', { cmc: 4, tg: ['graveyard'], kw: ['Flying'] }),
    ...['Kami of the Crescent Moon', 'Spectral Sailor', 'Ghostly Pilferer', 'Hallowed Haunting', 'Kaya\'s Ghostform', 'Shadow of Mortality', 'Moonsilver Spear Spirit'].map((n, i) =>
      c(n, 'Creature — Spirit', 'Flying', 'U', { cmc: 2 + (i % 3) })),
    c('Admiral Beckett Brass', 'Legendary Creature — Human Pirate', 'Other Pirates you control get +1/+1.\nAt the beginning of your end step, gain control of target nonland permanent controlled by a player who was dealt combat damage by three or more Pirates this turn.', 'BRU', { cmc: 4 }),
    ...['Dire Fleet Captain', 'Fathom Fleet Captain', 'Ruthless Knave', 'Siren Stormtamer'].map(n => c(n, 'Creature — Human Pirate', 'Menace', 'B')),
    c('Murktide Regent', 'Creature — Dragon', 'Delve\nFlying\nMurktide Regent enters with a +1/+1 counter on it for each instant and sorcery card exiled with it.', 'U', { cmc: 7, kw: ['Delve', 'Flying'], tg: ['wincon'] }),
    c('Brazen Borrower // Petty Theft', 'Creature — Faerie Rogue // Instant — Adventure', 'Flash\nFlying\nReturn target nonland permanent an opponent controls to its owner\'s hand.', 'U', { kw: ['Flash', 'Flying'], tg: ['bounce'] }),
    c('Spell Snare', 'Instant', 'Counter target spell with mana value 2.', 'U', { cmc: 1, tg: ['counter'], kw: ['Flash'] }),
    c('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.', 'R', { cmc: 1, tg: ['burn', 'removal'] }),
    c('Snapcaster Mage', 'Creature — Human Wizard', 'Flash\nWhen Snapcaster Mage enters, target instant or sorcery card in your graveyard gains flashback.', 'U', { cmc: 2, kw: ['Flash'] }),
    c('Island', 'Basic Land — Island', '({T}: Add {U}.)', 'U'), c('Mountain', 'Basic Land — Mountain', '({T}: Add {R}.)', 'R'),
  ]
  const data = prepData({ formats: F, dim: 1 }, cards, [], new ArrayBuffer(cards.length), new ArrayBuffer(cards.length * 12))
  const teval = analyse(data, { id: 'a', name: 'Teval', format: 'commander', commanders: ['Teval, the Balanced Scale'], main: Object.fromEntries(cards.slice(1, 8).map(x => [x.n, 1])) })
  assert.equal(teval.tribe, 'Spirit'); assert.equal(teval.lead, 'Teval'); assert.equal(teval.guild, 'Sultai'); assert.equal(teval.themes[0], 'ghost')
  const tp = suggest(teval, { lang: 'pt' }), te = suggest(teval, { lang: 'en' })
  assert.ok(tp.length >= 5 && tp.length <= 8, tp); assert.ok(tp.some(s => s.includes('Teval')), tp)
  assert.ok(tp.every(s => !/\bundefined\b|\bde o\b|\bde a\b|\bdo [A-ZÁ-Ú]\w+as\b/.test(s)), tp)  // contrações e artigos
  assert.ok(te.some(s => /Teval's|Teval,|Teval and|Teval:/.test(s)), te)
  assert.deepEqual(suggest(teval, { lang: 'en' }), te, 'determinístico'); assert.notDeepEqual(suggest(teval, { lang: 'en', seed: 1 }), te, '🎲 muda')
  assert.ok(suggest(teval, { lang: 'en', keep: false }).every(s => !s.includes('Teval')))
  assert.ok(!suggest(teval, { lang: 'en', taken: te }).some(s => te.includes(s)), 'sem repetir nomes')
  assert.ok(suggest(teval, { lang: 'zh' }).length >= 5 && suggest(teval, { lang: 'de' }).length >= 5 && suggest(teval, { lang: 'es' }).length >= 5)
  const beck = analyse(data, { id: 'b', name: 'Pirates', format: 'commander', commanders: ['Admiral Beckett Brass'], main: Object.fromEntries(cards.slice(9, 13).map(x => [x.n, 1])) })
  assert.equal(beck.lead, 'Admiral Beckett'); assert.equal(beck.tribe, 'Pirate'); assert.equal(beck.themes[0], 'pirate'); assert.equal(beck.guild, 'Grixis')
  const be = suggest(beck, { lang: 'en', n: 8 })
  assert.ok(be.some(s => s.startsWith("Admiral Beckett's")), be); assert.ok(be.every(s => !s.includes('Admiral Beckett, Admiral')), be)
  const izz = analyse(data, { id: 'c', name: 'UR', format: 'modern', commanders: [], main: { 'Murktide Regent': 4, 'Brazen Borrower // Petty Theft': 4, 'Spell Snare': 4, 'Snapcaster Mage': 4, 'Lightning Bolt': 4, Island: 10, Mountain: 6 } })
  assert.equal(izz.guild, 'Izzet'); assert.equal(izz.keyCard, 'Murktide'); assert.equal(izz.lead, ''); assert.ok(izz.archs.includes('tempo'), izz.archs)
  const ie = suggest(izz, { lang: 'en', n: 8 }), ip = suggest(izz, { lang: 'pt', n: 8, keep: false })
  assert.ok(ie.some(s => s.includes('Izzet')) && ie.some(s => s.includes('Murktide')), ie)
  assert.ok(ip.every(s => !s.includes('Murktide')) && ip.length >= 5, ip)
  assert.equal(shortName('Optimus Prime, Hero // Optimus Prime, Autobot Leader'), 'Optimus Prime'); assert.equal(shortName('Ezio Auditore da Firenze'), 'Ezio')
  assert.match(summary(teval), /Comandante: Teval, the Balanced Scale/)
  return { teval: [tp, te], beck: be, izzet: [ie, ip] }
}
