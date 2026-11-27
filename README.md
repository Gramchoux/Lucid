# Lucid

Interface épurée et assistant de progression pour Path of Building.

Lucid s'appuie directement sur le moteur de calcul de **Path of Building Community** : aucun calcul n'est réécrit ou approximé, Lucid exécute le code Lua de PoB tel quel pour comparer ton personnage à un guide, repérer les incohérences et mesurer le gain réel de chaque amélioration.

## Fonctionnalités

- **Suivi de guide étape par étape** : aligne automatiquement l'arbre passif, l'équipement, les gemmes et la configuration de chaque étape d'un guide.
- **Santé du build et linter** : détecte les faux positifs de configuration (charges activées sans source, buffs impossibles), les problèmes de mana, d'attributs ou de survie (basé sur le coup max encaissable plutôt que l'EHP gonflé).
- **Écarts et priorités d'amélioration** : teste individuellement chaque objet ou passif manquant du guide sur ton personnage et les classe par gain réel de DPS ou de survie.
- **Décomposition de l'écart de DPS** : mesure étape par étape d'où vient la différence entre ton DPS et celui du guide (conditions de combat, équipement, arbre, gemmes, configuration).
- **Import et recherche Trade** : importe tes personnages depuis ton compte Path of Exile (OAuth officiel, jeton chiffré localement via DPAPI) ou depuis un lien (`pobb.in`, `poe.ninja`, `maxroll`, `pastebin`…), et génère des recherches Trade ciblées.
- **Mode Création de guide** : réordonne les transitions par glisser-déposer, ajoute des notes par étape, verrouille des objets clés et exporte le tout au format `.lucid`.

## Installation et lancement

### Prérequis
1. **[Path of Building Community](https://github.com)** doit être installé sur ton PC (Lucid utilise son moteur et se met à jour en même temps que lui).
2. *(Optionnel)* **Path of Exile** installé (Steam ou client autonome) pour extraire les icônes directement depuis les fichiers du jeu.

### Avec l'exécutable Windows
1. Télécharge **`Lucid.exe`** dans la section [**Releases**](../../releases).
2. Double-clique sur `Lucid.exe` : une fenêtre d'application s'ouvre automatiquement (`http://127.0.0.1:47821`).

> **Note sur Windows SmartScreen :**
> Comme Lucid n'a pas de certificat de signature payant, Windows peut afficher un avertissement *« Windows a protégé votre ordinateur »* au premier lancement. Clique sur **Informations complémentaires** puis **Exécuter quand même**.

## Lancer depuis les sources

Aucune dépendance Python externe n'est requise pour exécuter Lucid (bibliothèque standard uniquement).

```bash
git clone https://github.com
cd Lucid
python lucid/server.py
```

Tu peux aussi double-cliquer sur `lucid/Lucid.pyw` (sans console) ou `lucid/Lancer Lucid.cmd` (avec journal).

### Compiler l'exécutable `.exe`
```bash
pip install pyinstaller
pyinstaller --onefile --noconsole --name Lucid --paths lucid --add-data "lucid/web;web" --add-data "lucid/lua;lua" --add-data "lucid/rules;rules" --add-binary "lucid/native/lucidnative.dll;native" lucid/Lucid.pyw
```

### Recompiler la DLL native (`lucidnative.dll`)
Utilisée pour décompresser les archives Oodle (`Bundles2`) et décoder les textures DDS du jeu :
```bash
pip install --target tools\zig ziglang
tools\build_native.cmd
```

## Architecture

| Composant | Rôle et source |
| :--- | :--- |
| **Moteur de calcul** | Charge `lua51.dll` et exécute les scripts de `%APPDATA%\Path of Building Community` via `ctypes` (`lucid/engine.py`). |
| **Arbre passif et infobulles** | Portage de `PassiveTreeView:Draw` en JavaScript (`lucid/web/tree.js`) utilisant les sprites et polices bitmap `.tgf/.tga` de PoB. |
| **Linter et simulations** | Règles modulaires dans `lucid/rules/*.lua` exécutées via `lucid/lua/linter.lua` sans modifier les fichiers de build. |
| **Builds et données** | Lit et écrit dans `Documents\Path of Building\Builds` (compatible PoB). Cache et métadonnées dans `%APPDATA%\Lucid`. |
| **Extraction d'icônes** | Lecture seule des `Bundles2` de PoE via `lucidnative.dll` (`ooz` et `bcdec`), avec repli sur le CDN officiel GGG. |

## Licence et crédits

- Distribué sous licence **MIT** (voir le fichier `LICENSE`).
- Construit autour du moteur **[Path of Building Community](https://github.com)** (licence MIT).
- Utilise **[ooz](https://github.com)** (décompression Oodle), **[bcdec](https://github.com)** (décodage BC1-BC7) et les données publiques **[RePoE](https://github.com)**.
