# Lucid

Interface épurée pour Path of Building, construite **sur son moteur** :
aucun calcul n'est réécrit, Lucid exécute le code Lua de PoB tel quel.

## Lancer
- Double-clic sur `Lucid.pyw` (sans console), ou `Lancer Lucid.cmd` (avec journal).
- Une fenêtre d'application s'ouvre (Edge en mode app) sur http://127.0.0.1:47821.

Prérequis : Python 3, **Path of Building Community** (le moteur, mis à jour par son propre updater)
et, pour les images d'objets et de gemmes, **Path of Exile** installé (Steam ou client autonome).

## Le moteur : Path of Building, et seulement lui
| Élément | Source |
|---|---|
| Calculs, données, arbre, infobulles | code de `%APPDATA%\Path of Building Community` exécuté tel quel (forçable : `LUCID_POB_SOURCE`) |
| Runtime LuaJIT, polices bitmap | même dossier (`lua51.dll`, `SimpleGraphic\Fonts`) |
| Builds | `Documents\Path of Building\Builds` (partagés avec PoB) |
| Données propres à Lucid | `%APPDATA%\Lucid` (rôles guide/perso, associations, cache d'images, journal) |

Mise à jour : lance Path of Building (il se met à jour), puis dans Lucid pastille du moteur →
« Recharger le moteur ».

### Arbre passif : le dessin de PoB, porté en JavaScript
- `web/app.js` (classe `PobTree`) est la traduction ligne pour ligne de `PassiveTreeView:Draw` de PoB
  (fond, groupes, ascendances, liaisons/orbites, nœuds, anneaux de joyaux, recherche, zoom, déplacement).
  Il tourne dans le navigateur, à la résolution de l'écran.
- Les données viennent de PoB à l'ouverture (`lua/treescene.lua`) : positions, sprites résolus par état,
  liaisons, couleurs de comparaison, chemins, joyaux sertis. Un nouvel arbre publié par PoB fonctionne
  donc sans mise à jour de Lucid ; seul un changement de la façon de dessiner de PoB demanderait d'adapter
  le portage.
- Infobulles (passifs, objets, gemmes) : produites par PoB (`AddNodeTooltip`, `AddItemTooltip`, `GemTooltip`)
  et rejouées telles quelles avec ses cadres et ses polices bitmap (`lua/graphics.lua`).
- L'allocation au clic n'existe que dans l'onglet « Arbre & détails » (en mémoire, Ctrl+Z) : Lucid n'écrit jamais
  dans tes builds.

## Le cockpit (refonte)
Une page de build = trois zones. Routes : `#/b/<build>/<onglet>/<vue>` (les anciennes adresses sont redirigées).
- **Colonne « Santé du build »** (gauche, toujours visible, `web/ui_health.js`, route `health`) : DPS global, coup max
  encaissable, vie / ES, résistances, attributs et leurs exigences ; **préparation à l'étape** (40 % santé + 60 %
  piliers fixes : compétence principale et ses supports liés, keystones / ascendance, objets verrouillés par le
  créateur ; prêt dès 80 %, validation manuelle toujours possible) ; alertes du linter P1 (critique) / P2
  (attention) ; assistants « Pourquoi je meurs ? », « Problème de mana », « Attribut manquant », « Chute de DPS ».
- **Onglet Suivre le guide** (`ui_guide.js`) : Étapes & chronologie (fiche, courbe, ce qui change, ordre conseillé par
  le créateur), Écarts & améliorations, Équipement / Arbre / Gemmes visés.
- **Onglet Tester un upgrade** (`ui_sandbox.js`) : objet collé (ou copié en jeu), trade, simulation de config.
- **Onglet Arbre & détails** (`ui_expert.js`) : arbre (puissance, allocation Ctrl+Z, anoint), équipement, gemmes,
  statistiques. Les vues d'essai (upgrade, arbre) remettent le build d'aplomb dès qu'on les quitte.
- **Menu ⚙️** (`ui_settings.js`) : Vue Simple / Experte, thème, Exporter vers PoB, partage pobb.in, import / export
  `.lucid`, presse-papier en jeu (désactivé par défaut), Mode Création.

Le JS est découpé en scripts classiques qui partagent la portée globale, chargés dans cet ordre par `index.html` :
`core.js` (socle, routeur) · `components.js` · `tree.js` · `ui_health.js` · `ui_guide.js` · `ui_sandbox.js` ·
`ui_expert.js` · `ui_creator.js` · `ui_settings.js` · `ui_home.js` · `main.js` (démarrage).

Le moteur PoB ne tient qu'un build : chaque requête qui en a besoin le garde pour elle seule jusqu'au bout
(`route_api`, `HOST.lock`), sinon deux requêtes simultanées mélangeraient leurs chiffres.

## Mode Création de guide (`web/ui_creator.js`)
Métadonnées du créateur, rangées dans `lucid_meta.json` → `builds[<guide>].guideMeta`, clés stables = **titres des
étapes PoB** et cibles sémantiques (`item:<emplacement>`, `tree:<passif>`, `gem:<groupe>`, `config:<option>`) :
- **Règles ignorées** : « Ignorer sur cette étape » / « Ignorer partout » sous chaque alerte (`globalDisabledRules`,
  `steps[étape].disabledRules`), filtrées par `Bridge.lint` (`lua/linter.lua`) ; le joueur voit « N alertes
  masquées par le créateur ».
- **Chronologie des transitions** : les changements entre deux étapes (`stage_diff` → `changes`) se réordonnent par
  glisser-déposer, avec une note par bloc et par étape, et 🔒 pour verrouiller un objet (`lockedSlots`).
- **Réimport** : menu du guide → « Mettre à jour ce guide » remplace le PoB (ancienne version en `.bak`) et
  réconcilie : 🟢 conservé, 🟡 NOUVEAU (changement pas encore placé), 🔴 orphelin (étape renommée / supprimée,
  réassignable en un clic en haut de la page du guide).
- **Format `.lucid`** : `{version, guideTitle, pobCode, timeline, variants, globalDisabledRules, steps, transitions}`
  (routes `lucidExport` / `lucidImport`, ou contenu collé dans le champ d'import de la bibliothèque).

## Parcours
1. **Bibliothèque** : colle un code ou un lien (pobb.in, poe.ninja, maxroll, pob.codes,
   pastebin, rentry, poedb) ou un `.lucid`. Classe chaque build en « Guide » ou « Mon perso ».
2. **Suivre le guide** : choisir une étape aligne arbre, équipement, gemmes et config portant le même nom.
3. **Écarts & améliorations** : ton perso vs l'étape. Chaque différence (objet, passif) est appliquée seule à ton
   build par le moteur, puis classée par gain de DPS ou de survie.

## Images d'objets et de gemmes : extraites du jeu (comme PoB Redux)
- Lucid lit les fichiers de ton installation de Path of Exile (`Bundles2`) : index, blocs Oodle
  décompressés par `native/lucidnative.dll` (ooz, libre), textures DDS décodées (bcdec), puis PNG.
- Flasques et gemmes sont, dans le jeu, des bandes de calques : Lucid les compose comme le jeu
  (flasque = bouteille + liquide + cadre ; gemme = pierre + sertissage).
- Correspondance nom → image : données publiques RePoE (générées depuis les tables du jeu).
- Cache : `%APPDATA%\Lucid\art\game`, vidé automatiquement quand le jeu est patché. Rien n'est
  écrit dans le dossier du jeu.
- Sans jeu installé : repli sur le CDN de GGG.
- Recompiler la DLL : `tools\build_native.cmd` (zig via `pip install --target tools\zig ziglang`,
  sources dans `tools\src`).

## Importer tes personnages depuis ton compte
Bibliothèque → **Importer depuis mon compte PoE**. Même mécanisme que Path of Building :
- tu te connectes toi-même sur pathofexile.com (OAuth, client « pob », retour sur
  `http://localhost:49082-49084`) ; Lucid ne voit jamais ton mot de passe ;
- la page d'autorisation de GGG affiche « Path of Building », puisque Lucid réutilise cette connexion ;
- le jeton est stocké dans `%APPDATA%\Lucid\poe_auth.json`, chiffré avec DPAPI : seul ton compte Windows peut le relire (bouton « se déconnecter » pour le supprimer) ;
- choisis un, plusieurs ou tous tes personnages (PC, Xbox, PlayStation). Chaque perso devient
  `Nom (Ligue).xml` dans ton dossier de builds, classé « Mon perso » ;
- menu ⋯ d'un perso importé → « Mettre à jour depuis le compte » pour récupérer son état actuel.

La conversion JSON GGG → build passe par le code d'import de PoB (`ImportPassiveTreeAndJewels`,
`ImportItemsAndSkills`), donc le résultat est le même que dans PoB.

## DPS global : une seule définition

Partout dans Lucid (bibliothèque, vue d'ensemble, guide, comparaison, gains des objets et passifs, linter), « DPS global » = le **Full DPS** de PoB, c'est-à-dire la somme des compétences cochées « Full DPS ». Un perso qui n'en coche aucune et qui suit un guide reprend automatiquement les compétences additionnées par le guide. Sans Full DPS nulle part, on retombe sur la compétence principale, et la carte le dit. Seules les sections *Sbires*, *Compétence sélectionnée* et le détail du Guardian montrent des chiffres propres à une compétence ou à un sbire.

## Analyse de cohérence (linter)

Onglet **Comparer → Analyse**. Lucid croise la configuration de l'étape du guide, le build réel du joueur et les
statistiques calculées par PoB. Chaque règle est indépendante, dans `rules/*.lua` (relus à chaque analyse) :

```lua
local L = ...            -- outils : L.n, L.pct, L.label(var), L.impactText
return { {
  id = "config.charges.frenzy", category = "CONFIG", severity = "CRITIQUE", title = "…",
  triggerCondition = function(guide, player) return guide:opt("useFrenzyCharges") end,       -- prérequis du guide
  isFailing = function(stats, player, guide) return not player:has({ "gain.-frenzy charge" }) end, -- test sur le joueur
  calculateImpact = function(player, engine) return engine:simulate({ useFrenzyCharges = false }) end, -- simulation PoB
  formatMessage = function(stats, impact, player, guide, data) return "…" end,                -- message pédagogique
  fix = "…",
} }
```

Familles livrées : A (faux positifs de config), B (survie), C (mécanique), D (progression vs guide).
`engine:simulate(options)` change la config le temps d'un calcul ; `engine:simulateMods(lignes)` ajoute des mods
comme les « Custom Modifiers » de PoB. Rien n'est enregistré dans le build.

## Animated Guardian (équipement des sbires)

PoB équipe le Guardian avec un jeu d'objets du build, désigné par la gemme (`skillMinionItemSet`). Lucid le lit tel quel :
- **Équipement** : inventaire du Guardian (icônes du jeu, infobulles PoB sans fausse comparaison avec le personnage),
  et ce que chaque objet apporte (calcul PoB en le retirant du jeu d'objets du Guardian).
- **Comparer → Équipement** : objets du Guardian du guide testés sur ton Guardian (gain DPS / survie, détail des stats du sbire),
  repris dans **Priorités** et dans le linter (sources d'électrocution, Wither… portées par le Guardian).
Les mercenaires ne sont pas simulés par PoB : seules les options de config du guide les représentent.

## Lire les chiffres de PoB (lua/insight.lua)

- **Pourquoi ce chiffre ?** `Bridge.explainStats` lit les mods additionnés par PoB (`modDB:Tabulate`) pour la vie, la mana, l'ES, l'armure, l'évasion, les résistances, les attributs, le blocage, la suppression, la vitesse de déplacement et la régénération de mana. Ils sont regroupés par source (arbre, objets, gemmes, base, bandit…) et présentés avec la formule « base × (1 + increased) × more ». La Vue d'ensemble l'affiche au clic sur une stat. Dans Comparer → Statistiques, le perso et le guide sont côte à côte, source par source.
- **Gain de chaque écart.** `Bridge.statGaps` (linter.lua) mesure le gain si le perso avait la valeur du guide : on ajoute le mod équivalent en « Custom Modifiers » et on rejoue le calcul PoB. Une 2e passe ajuste la quantité quand des « increased » la multiplient. Au-delà de 75 % de résistance, la résistance maximale est ajoutée aussi.
- **Budget de mana.** `Bridge.manaBudget` recalcule chaque compétence comme compétence principale, comme le fait le Full DPS de PoB. Il additionne la dépense de la compétence lancée qui fait le plus de dégâts et de tous les sorts déclenchés (Cast on…, Arcanist, objets…). Il compare ce total à la régénération et au vol de mana, et le met face à la réserve libre. Règles : `meca.mana.cast`, `meca.mana.reserved`, `meca.mana.sustain`. Elles sont jugées par rapport au guide : si le guide est dans le même cas, c'est un simple conseil.

## D'où vient l'écart de DPS avec le guide

`compare()` (`server.py`) décompose l'écart entre le DPS global du perso et celui du guide, mesuré par PoB sur le build du perso :

1. **Conditions de combat** : options du guide retirées faute de source (`gateConfig`), leur impact simulé.
2. **Équipement** : tout l'équipement du guide posé d'un coup, sbires compris (`Bridge.stepsToGuide`). Les emplacements vides chez le guide sont vidés chez le perso ; les jeux d'objets des sbires du perso sont vidés entièrement avant de poser ceux du guide. La calculatrice de PoB ne régénère pas les groupes des compétences données par un objet (seul le mode principal le fait) : un groupe rattaché à l'objet retiré passe au nouvel objet s'il donne la même compétence, sinon il est coupé ; un groupe du guide issu d'un objet est rattaché à l'objet du guide posé (`source` = `Item:<id>:<nom>`, d'où l'id fixé avant `BuildModList`). Deux objets du même nom mais aux mods différents (deux Voidforge) sont bien échangés : la comparaison se fait sur le texte complet.
3. **Arbre** : en plus, l'arbre complet du guide reconstruit par `ImportFromNodeList` (ascendance, maîtrises, tatouages, joyaux Timeless), puis `BuildClusterJewelGraphs` pour les cluster jewels. Sur le guide lui-même, cette reconstruction redonne exactement son DPS.
4. **Gemmes** : en plus, les gemmes du guide : niveaux et qualités exacts, gemmes manquantes ajoutées, gemmes et groupes en trop coupés, groupes absents ajoutés, emplacement du guide (y compris « aucun »), effets cochés des gemmes Vaal (partie normale / partie Vaal), nombre de copies (`groupCount`), support imprégné (`imbuedSupport` du groupe et `imbuedSupportBySlot`, 3.27). Un groupe du guide fait de supports est reproduit tel quel, à la place des groupes de supports du perso, et ces derniers perdent leur emplacement : PoB déduit le socket (donc la couleur, +10 % de qualité si elle correspond) de l'ordre des gemmes de tous les groupes d'un emplacement. Les supports d'une compétence donnée par un objet sont comparés à l'ensemble des groupes de supports du même emplacement.
5. **Personnage** : niveau, bandit, panthéon et flasques cochées actives comme dans le guide.
5 bis. **Onglet Party** : buffs d'alliés importés dans l'onglet Party du PoB du perso, retirés.
6. **Lignes ajoutées par le guide** : les Custom Modifiers écrits à la main par l'auteur (ex. bonus d'un objet du Guardian que PoB ne calcule pas), à la place de ceux du perso. Ils ne sont jamais appliqués au perso dans le reste de la comparaison : la carte les montre.
7. **Le reste** : ce qui n'est pas posé (réglages propres à une compétence, effets non simulés).

Équipement des sbires : chaque groupe de gemmes de sbire utilise le jeu d'objets `skillMinionItemSet` (`skillMinionItemSetCalcs` ne sert qu'à l'onglet Calcs de PoB). Un sbire « arme seule » (Animate Guardian's Weapon) n'est rattaché au Guardian que si c'est le même jeu ou exactement la même arme ; parmi plusieurs groupes d'une même compétence, celui du Full DPS compte.

Chaque étape part de la précédente : les parts se composent exactement. La carte n'apparaît pas si les deux DPS ne mesurent pas la même chose (Full DPS d'un côté, compétence principale de l'autre).

## Survie : le coup max encaissable, pas l'EHP

L'EHP de PoB est gonflé par le blocage et la récupération sur blocage. Lucid mesure la survie avec les **Max Hit** de PoB
(coup max encaissable pour chaque type : physique, feu, froid, foudre, chaos) :
- cartes « Coup max encaissable » : le plus petit des cinq, avec son type (ton point faible) ;
- « Survie +x % » (objets, passifs, anoints, tri des améliorations, règles) : variation de la moyenne géométrique des cinq
  (`Bridge._survival` dans `lua/bridge.lua`, réutilisé par le linter et la recherche trade).

## Compétence principale

Le DPS global sans « Full DPS » repose sur la compétence principale. Lucid retient ton choix (et sa sous-partie, ex. Lightning
Strike : Melee / Projectiles) dans `lucid_meta.json`, sans toucher ton fichier PoB. La règle `meca.mainskill` signale une
compétence principale qui ne fait aucun dégât (Dash, aura…), ce qui fausserait tous les gains mesurés.

## Bac à sable : arbre

- **Puissance des nœuds** : `CalcsTab:PowerBuilder` de PoB (Show Node Power), limité aux nœuds à 8 points ou moins ;
  rouge = dégâts, bleu = défense.
- **Clic : allouer / retirer** avec Ctrl+Z (`Bridge.treeEdit`) : l'arbre modifié reste en mémoire et revient à ton perso
  en quittant le bac à sable.
- **Meilleur anoint** (`Bridge.bestAnoints`) : chaque notable gravé sur ton amulette à la place de l'anoint actuel, avec la
  recette d'huiles (aussi dans l'aperçu au clic d'un notable).

## Partager

Menu d'un build → « Partager (lien court pobb.in) » : même envoi que le bouton Share de PoB (`https://pobb.in/pob/`). Le lien
est public : Lucid le dit et attend la confirmation avant d'envoyer.

## Tests de non-régression

`python tests/test_dps_gap.py` relance la comparaison guide / perso de référence sur 7 étapes et vérifie que la part « Le reste » de l'écart de DPS vaut ×1,00 (±2 %), sans erreur de test d'objet ni groupe laissé dans le build. À relancer après chaque mise à jour de Path of Building. Autre guide : `python tests/test_dps_gap.py "<guide.xml>" "<perso.xml>" "Etape 3" …`.
