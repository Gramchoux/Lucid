"""
Lucid — serveur local.

  python server.py            démarre Lucid et ouvre la fenêtre
  python server.py --no-open  démarre sans ouvrir de fenêtre

Bibliothèque : lit les builds de Path of Building (Documents\\Path of Building\\Builds).
Import : code PoB, lien (pobb.in, poe.ninja, maxroll, pastebin…) ou XML → enregistré
dans le dossier des builds, donc visible aussi dans PoB.
"""
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import engine as eng
import poe_account
import art

HERE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(HERE, "web")
PORT = int(os.environ.get("LUCID_PORT", "47821"))
APP_VERSION = "1.0.0"

DATA = eng.LUCID_DATA
os.makedirs(DATA, exist_ok=True)
META_FILE = os.path.join(DATA, "library.json")
LOG_FILE = os.path.join(DATA, "lucid.log")


def log(msg):
    line = time.strftime("[%H:%M:%S] ") + str(msg)
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------- dossiers PoB
def builds_dir():
    """Dossier des builds PoB (respecte un éventuel buildPath des réglages PoB)."""
    base = os.path.join(eng.DOCUMENTS, "Path of Building")
    settings = os.path.join(base, "Settings.xml")
    try:
        root = ET.parse(settings).getroot()
        for el in root.iter("Misc"):
            bp = el.get("buildPath")
            if bp and os.path.isdir(bp):
                return bp
    except Exception:
        pass
    d = os.path.join(base, "Builds")
    os.makedirs(d, exist_ok=True)
    return d


def safe_name(name):
    name = re.sub(r'[\\/:*?"<>|]+', " ", name or "").strip()
    name = re.sub(r"\s+", " ", name)
    return name[:120] or "Build importé"


# ---------------------------------------------------------------- méta (rôles)
_meta_lock = threading.Lock()


def load_meta():
    try:
        with open(META_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"builds": {}}


def save_meta(meta):
    with _meta_lock:
        tmp = META_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        os.replace(tmp, META_FILE)


# ---------------------------------------------------------------- bibliothèque
_lib_cache = {}  # path -> (mtime, entry)


def read_build_meta(path):
    st = os.stat(path)
    c = _lib_cache.get(path)
    if c and c[0] == st.st_mtime:
        return dict(c[1])
    entry = {"stats": {}}
    try:
        root = ET.parse(path).getroot()
        b = root.find("Build")
        if b is not None:
            entry.update(level=int(b.get("level") or 0), cls=b.get("className"),
                         asc=b.get("ascendClassName") if b.get("ascendClassName") not in (None, "None") else None)
            for ps in b.findall("PlayerStat"):
                try:
                    entry["stats"][ps.get("stat")] = float(ps.get("value"))
                except (TypeError, ValueError):
                    pass
            for ps in b.findall("MinionStat"):
                try:
                    entry["stats"]["Minion" + ps.get("stat")] = float(ps.get("value"))
                except (TypeError, ValueError):
                    pass
            main_idx = int(b.get("mainSocketGroup") or 1)
            skills = root.find("Skills")
            if skills is not None:
                sets = skills.findall("SkillSet") or [skills]
                active = skills.get("activeSkillSet")
                chosen = sets[0]
                for s in sets:
                    if s.get("id") == active:
                        chosen = s
                groups = chosen.findall("Skill")
                if 0 < main_idx <= len(groups):
                    for gem in groups[main_idx - 1].findall("Gem"):
                        sid = gem.get("skillId") or ""
                        if not sid.startswith("Support"):
                            entry["mainSkill"] = gem.get("nameSpec")
                            break
        tree = root.find("Tree")
        entry["stages"] = len(tree.findall("Spec")) if tree is not None else 0
        notes = root.find("Notes")
        entry["hasNotes"] = bool(notes is not None and (notes.text or "").strip())
        entry["notesLen"] = len((notes.text or "").strip()) if notes is not None else 0
    except Exception as e:
        entry["error"] = str(e)
    _lib_cache[path] = (st.st_mtime, entry)
    return dict(entry)


def library():
    root = builds_dir()
    meta = load_meta()
    out = []
    for dirpath, dirnames, files in os.walk(root):
        for fn in files:
            if not fn.lower().endswith(".xml"):
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, root).replace("\\", "/")
            try:
                e = read_build_meta(p)
            except OSError:
                continue
            m = meta["builds"].get(rel, {})
            if m.get("kpi"):
                e["stats"] = dict(e.get("stats") or {}, **m["kpi"])
            role = m.get("role")
            if not role:
                role = "guide" if (e.get("stages", 0) > 2 or e.get("notesLen", 0) > 400) else "perso"
                e["roleGuessed"] = True
            e.update(id=rel, name=fn[:-4], folder=os.path.dirname(rel), role=role, poe=m.get("poe"),
                     guide=m.get("guide"), stage=m.get("stage"), pinned=m.get("pinned", False),
                     progress=m.get("progress") or {},
                     cfgSource=m.get("cfgSource") or "guide", fullDps=m.get("fullDps") or "guide",
                     mtime=os.path.getmtime(p), opened=m.get("opened"))
            out.append(e)
    out.sort(key=lambda x: (-(x.get("opened") or 0), -x["mtime"]))
    return out


def build_path(build_id):
    root = builds_dir()
    p = os.path.normpath(os.path.join(root, build_id))
    if not p.startswith(os.path.normpath(root)) or not os.path.isfile(p):
        raise ValueError("Build introuvable : %s" % build_id)
    return p


def read_xml(build_id):
    with open(build_path(build_id), encoding="utf-8-sig", errors="replace") as f:
        return f.read()


_FULL_CACHE = {}


def xml_full_dps(build_id):
    """Compétences actives cochées « Full DPS » dans le XML (toutes étapes confondues), sans passer par le moteur."""
    p = build_path(build_id)
    mt = os.path.getmtime(p)
    c = _FULL_CACHE.get(build_id)
    if c and c[0] == mt:
        return c[1]
    names = []
    try:
        skills = ET.parse(p).getroot().find("Skills")
        for ss in (skills.findall("SkillSet") or [skills]) if skills is not None else []:
            for sk in ss.findall("Skill"):
                if sk.get("includeInFullDPS") != "true" or sk.get("enabled") == "false":
                    continue
                act = [g.get("nameSpec") for g in sk.findall("Gem")
                       if g.get("nameSpec") and not (g.get("skillId") or "").startswith("Support") and g.get("enabled") != "false"]
                if act and act[0] not in [n["name"] for n in names]:
                    try:
                        cnt = int(sk.get("groupCount") or 0) or None
                    except ValueError:
                        cnt = None
                    names.append({"name": act[0], "count": cnt})
    except (OSError, ET.ParseError):
        pass
    _FULL_CACHE[build_id] = (mt, names)
    return names


def main_pick(build_id):
    """Compétence principale choisie dans Lucid pour ce build (index du groupe), ou None."""
    try:
        m = load_meta()["builds"].get(build_id) or {}
        v = m.get("mainPick")
        return {"index": int(v), "part": m.get("mainPart")} if v else None
    except Exception:
        return None


def auto_full_dps(build_id):
    """Perso sans aucune compétence « Full DPS » qui suit un guide : on additionne les mêmes compétences que le guide,
    pour que le DPS global ait partout le même sens."""
    try:
        m = load_meta()["builds"].get(build_id) or {}
        if m.get("role") == "guide" or not m.get("guide") or xml_full_dps(build_id):
            return None
        return xml_full_dps(m["guide"]) or None
    except Exception:
        return None


# ---------------------------------------------------------------- moteur
class EngineHost:
    """Possède le moteur et l'état du build actif (le moteur PoB n'en charge qu'un à la fois)."""

    def __init__(self):
        self.engine = None
        self.error = None
        self.ready = threading.Event()
        self.lock = threading.RLock()
        self.current = None  # (build_id, mtime, stage_key)
        self.tree_cache = {}
        threading.Thread(target=self._start, daemon=True).start()

    def _start(self):
        try:
            self.engine = eng.LuaEngine(log=log)
            self.error = None
        except Exception as e:
            self.error = str(e)
            log("ERREUR moteur : %s" % traceback.format_exc())
        finally:
            self.ready.set()

    def restart(self):
        with self.lock:
            self.ready.clear()
            if self.engine:
                try:
                    self.engine.close()
                except Exception:
                    pass
            self.engine = None
            self.current = None
            self.tree_cache = {}
            self._start()

    def status(self):
        st = {"ready": self.ready.is_set() and self.engine is not None, "error": self.error, "app": APP_VERSION}
        if self.engine:
            st["engine"] = self.engine.info
            st["runtime"] = self.engine.runtime
            # PoB a-t-il été mis à jour (par son updater) depuis le démarrage du moteur ?
            # nouvelle version : la source active a été mise à jour, ou l'autre source est devenue plus récente
            best = eng.find_pob_source()
            fresh = eng.source_info(best)
            cur = self.engine.info
            st["updateAvailable"] = (best != self.engine.source or fresh.get("version") != cur.get("version")
                                     or fresh.get("commit") != cur.get("commit"))
            st["freshVersion"] = fresh.get("version")
            st["freshOrigin"] = fresh.get("origin")
            st["sources"] = eng.pob_sources()
        st["buildsDir"] = builds_dir()
        st["pobExe"] = pob_exe()
        return st

    def call(self, cmd, **args):
        self.ready.wait(120)
        if not self.engine:
            raise RuntimeError(self.error or "Moteur indisponible")
        with self.lock:
            return self.engine.call(cmd, **args)

    def open(self, build_id, stage=None, force=False):
        """Charge un build (et une étape) si ce n'est pas déjà le build actif."""
        # stage = { tree, items, skills, config } (jeux du build) et, en option, cfg = configuration de
        # simulation imposée (celle de l'étape d'un guide, pour comparer à conditions égales)
        with self.lock:
            mtime = os.path.getmtime(build_path(build_id))
            stage = dict(stage or {})
            cfg = stage.pop("cfg", None)
            if isinstance(cfg, list):  # table Lua vide sérialisée en []
                cfg = {}
            fulldps = stage.pop("fulldps", None)  # compétences du Full DPS du guide, appliquées à ce build
            auto_full = False
            if fulldps is None:  # [] = réglage du perso, explicitement
                fulldps = auto_full_dps(build_id)
                auto_full = bool(fulldps)
            pick = main_pick(build_id)
            stage_key = json.dumps({"s": stage, "c": cfg, "f": fulldps, "m": pick}, sort_keys=True)
            if not force and self.current and self.current[0] == build_id and self.current[1] == mtime:
                if self.current[2] == stage_key:
                    return self.snapshot
                if stage and cfg is None and (fulldps is None or auto_full) and '"c": null' in self.current[2]:
                    self.snapshot = self.call("setStage", **stage)
                    if fulldps:
                        self.snapshot = self.call("setFullDPS", skills=fulldps)
                        if isinstance(self.snapshot.get("key"), dict):
                            self.snapshot["key"]["FullDPSFromGuide"] = True
                    if pick:
                        self.snapshot = self.call("setMainSkill", **pick)
                    self.current = (build_id, mtime, stage_key)
                    return self.snapshot
            name = os.path.basename(build_id)[:-4]
            snap = self.call("load", xml=read_xml(build_id), name=name)
            if stage:
                snap = self.call("setStage", **stage)
            if cfg is not None:
                snap = self.call("applyConfig", input=cfg)
            if fulldps:
                snap = self.call("setFullDPS", skills=fulldps)
                if auto_full and isinstance(snap.get("key"), dict):
                    snap["key"]["FullDPSFromGuide"] = True
            # compétence principale choisie dans Lucid : réappliquée à chaque rechargement du fichier
            if pick:
                fk = snap.get("key") if isinstance(snap.get("key"), dict) else None
                snap = self.call("setMainSkill", **pick)
                if fk and fk.get("FullDPSFromGuide") and isinstance(snap.get("key"), dict):
                    snap["key"]["FullDPSFromGuide"] = True
            self.snapshot = snap
            self.current = (build_id, mtime, stage_key)
            return snap

    def mutate(self, cmd, **args):
        """Modification transitoire (config, compétence principale) : le build actif change d'état."""
        with self.lock:
            # l'état modifié reste actif tant qu'on ne charge pas un autre build / une autre étape
            snap = self.call(cmd, **args)
            self.snapshot = snap
            return snap


HOST = None
POE = None
ART = None


def import_character(name, realm="pc"):
    """Télécharge un personnage via l'API GGG et le convertit en build avec le code d'import de PoB."""
    char = POE.character(name, realm)
    league = char.get("league") or ""
    with HOST.lock:
        xml = HOST.call("importCharacter", char=char, name=name)["xml"]
        HOST.current = None  # le moteur a changé de build actif
    meta = load_meta()
    # met à jour le fichier existant de ce personnage s'il y en a un
    existing = next((k for k, v in meta["builds"].items()
                     if (v.get("poe") or {}).get("name") == name and (v.get("poe") or {}).get("realm") == realm
                     and os.path.isfile(os.path.join(builds_dir(), k))), None)
    if existing:
        fn = existing
    else:
        base = safe_name("%s (%s)" % (name, league) if league else name)
        fn, i = base + ".xml", 2
        while os.path.exists(os.path.join(builds_dir(), fn)):
            fn = "%s %d.xml" % (base, i)
            i += 1
    with open(os.path.join(builds_dir(), fn), "w", encoding="utf-8") as f:
        f.write(xml)
    m = meta["builds"].setdefault(fn, {})
    m.setdefault("role", "perso")
    m["poe"] = {"name": name, "realm": realm, "league": league, "imported": time.time()}
    save_meta(meta)
    return {"id": fn, "updated": bool(existing)}


def pob_exe():
    p = os.path.join(eng.POB_COMMUNITY, "Path of Building.exe")
    return p if os.path.isfile(p) else None


# ---------------------------------------------------------------- import
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lucid/" + APP_VERSION


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def text_to_xml(text):
    """Code PoB, lien (pobb.in, poe.ninja…) ou XML collé → (xml, site source ou None)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Rien à importer")
    source = None
    if text.startswith("<"):
        xml = text
    else:
        if re.match(r"^https?://", text) or re.match(r"^[\w.-]+\.\w{2,}/", text):
            url = text if text.startswith("http") else "https://" + text
            r = HOST.call("resolveUrl", url=url)
            if not isinstance(r, dict) or not r.get("url"):
                raise ValueError("Site non reconnu. Sites pris en charge : pobb.in, poe.ninja, maxroll, pob.codes, pastebin, rentry, poedb.")
            source = r["site"]
            try:
                code = fetch(r["url"]).strip()
            except Exception as e:
                raise ValueError("Téléchargement impossible depuis %s (%s)" % (r["site"], e))
        else:
            code = text
        xml = HOST.call("decode", code=code)["xml"]
    return xml, source


def import_build(text, name=None, role=None):
    xml, source = text_to_xml(text)
    # nom : celui fourni, sinon classe + compétence principale
    if not name:
        try:
            root = ET.fromstring(xml.encode("utf-8"))
            b = root.find("Build")
            asc = b.get("ascendClassName") if b is not None else None
            cls = b.get("className") if b is not None else None
            name = "%s %s" % (asc if asc and asc != "None" else (cls or "Build"), time.strftime("%d-%m %Hh%M"))
        except Exception:
            name = "Build importé " + time.strftime("%d-%m %Hh%M")
    folder = builds_dir()
    base = safe_name(name)
    fn, i = base + ".xml", 2
    while os.path.exists(os.path.join(folder, fn)):
        fn = "%s (%d).xml" % (base, i)
        i += 1
    with open(os.path.join(folder, fn), "w", encoding="utf-8") as f:
        f.write(xml)
    meta = load_meta()
    meta["builds"].setdefault(fn, {})
    if role:
        meta["builds"][fn]["role"] = role
    if source:
        meta["builds"][fn]["source"] = source
    save_meta(meta)
    return {"id": fn, "source": source}


def reconcile_guide_meta(build_id):
    """Après un réimport : chaque note / règle ignorée / transition du créateur est conservée si son étape existe
    toujours (clé = titre de l'étape PoB), sinon elle devient orpheline (réassignable dans le Mode Création)."""
    gm = (load_meta()["builds"].get(build_id) or {}).get("guideMeta") or {}
    titles = {t["title"] for t in (xml_sets(build_id).get("trees") or [])}
    kept, orphans = [], []
    for k in (gm.get("steps") or {}):
        (kept if k in titles else orphans).append("étape « %s »" % k)
    for k in (gm.get("transitions") or {}):
        a, _, b = k.partition("->")
        (kept if a in titles and b in titles else orphans).append("transition « %s → %s »" % (a, b))
    return {"kept": kept, "orphans": orphans}


def lucid_export(build_id):
    """Fichier .lucid : le code PoB et les métadonnées du créateur (chronologie, notes, règles ignorées, verrous)."""
    HOST.open(build_id)
    code = HOST.call("encode")["code"]
    gm = guide_meta(build_id)
    trees = xml_sets(build_id).get("trees") or []
    titles = [t["title"] for t in trees]
    return {
        "version": "1.0", "guideTitle": (load_meta()["builds"].get(build_id) or {}).get("name") or os.path.basename(build_id)[:-4],
        "pobCode": code, "timeline": gm.get("timeline") or titles,
        "variants": gm.get("variants") or [t for t in titles if re.match(r"\s*(OPT|VAR)\b", t, re.I) or "SPECIAL" in t.upper()],
        "globalDisabledRules": gm.get("globalDisabledRules") or [], "steps": gm.get("steps") or {}, "transitions": gm.get("transitions") or {},
    }


def lucid_import(text, name=None):
    """Importe un .lucid : le build (comme un guide) puis ses métadonnées, réconciliées avec ses étapes."""
    try:
        d = json.loads(text)
    except ValueError:
        raise ValueError("Fichier .lucid illisible (JSON attendu)")
    if not isinstance(d, dict) or not d.get("pobCode"):
        raise ValueError("Ce n'est pas un fichier .lucid (pas de code PoB)")
    r = import_build(d["pobCode"], name=name or d.get("guideTitle"), role="guide")
    gm = {k: d[k] for k in ("timeline", "variants", "globalDisabledRules", "steps", "transitions") if d.get(k)}
    meta = load_meta()
    meta["builds"].setdefault(r["id"], {})["guideMeta"] = gm
    save_meta(meta)
    r.update(reconcile_guide_meta(r["id"]))
    return r


def update_guide(build_id, text):
    """Met à jour le PoB d'un guide existant (même fichier, mêmes métadonnées de créateur). L'ancienne version est
    gardée à côté (.bak) ; les notes sont ensuite réconciliées avec les étapes du nouveau PoB."""
    xml, source = text_to_xml(text)
    p = build_path(build_id)
    try:
        with open(p, encoding="utf-8") as f:
            old = f.read()
        with open(p + ".bak", "w", encoding="utf-8") as f:
            f.write(old)
    except OSError:
        pass
    with open(p, "w", encoding="utf-8") as f:
        f.write(xml)
    _CURVE_CACHE.pop(build_id, None)
    _SHEET_CACHE.pop(build_id, None)
    _HEALTH_CACHE.clear()
    HOST.current = None
    r = reconcile_guide_meta(build_id)
    r["source"] = source
    return r


# ---------------------------------------------------------------- comparaison
_SETS_CACHE = {}


def xml_sets(build_id):
    """Jeux du build (arbres, objets, gemmes, config) lus directement dans le XML : pas besoin de charger le moteur.
    Mêmes identifiants que ceux de PoB (index de l'arbre, id des jeux)."""
    p = build_path(build_id)
    mt = os.path.getmtime(p)
    c = _SETS_CACHE.get(p)
    if c and c[0] == mt:
        return c[1]
    root = ET.parse(p).getroot()

    def clean(t):
        return re.sub(r"\^(x[0-9A-Fa-f]{6}|\d)", "", t or "").strip() or "Default"

    out = {"trees": [], "items": [], "skills": [], "configs": []}
    tree = root.find("Tree")
    if tree is not None:
        act = int(tree.get("activeSpec") or 1)
        for i, sp in enumerate(tree.findall("Spec"), 1):
            out["trees"].append({"id": i, "title": clean(sp.get("title")), "active": i == act})
    for tag, sub, attr, key in (("Items", "ItemSet", "activeItemSet", "items"), ("Skills", "SkillSet", "activeSkillSet", "skills"),
                                ("Config", "ConfigSet", "activeConfigSet", "configs")):
        el = root.find(tag)
        if el is None:
            continue
        act = el.get(attr)
        for s in el.findall(sub):
            if s.get("id") and s.get("id").isdigit():
                out[key].append({"id": int(s.get("id")), "title": clean(s.get("title")), "active": s.get("id") == act})
    for k in out:
        if not out[k]:
            out[k] = [{"id": 1, "title": "Default", "active": True}]
        elif not any(x["active"] for x in out[k]):
            out[k][0]["active"] = True
    _SETS_CACHE[p] = (mt, out)
    return out


def match_stage(sets, tree_id):
    """Étape cohérente : sets d'objets / gemmes / config portant le même titre que l'arbre choisi."""
    trees = sets.get("trees", [])
    title = next((t["title"] for t in trees if t["id"] == tree_id), None)
    idx = next((i for i, t in enumerate(trees) if t["id"] == tree_id), 0)

    def norm(s):
        return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

    def pick(lst):
        if not lst:
            return None
        if title:
            for s in lst:
                if norm(s["title"]) == norm(title):
                    return s["id"]
            # même préfixe d'étape ("Etape 3", "Act 2", "Level 90"…)
            m = re.match(r"^\s*([a-zéè]+\s*\d+)", norm(title))
            if m:
                for s in lst:
                    if norm(s["title"]).startswith(m.group(1)):
                        return s["id"]
        if len(lst) == len(trees):
            return lst[idx]["id"]
        return next((s["id"] for s in lst if s.get("active")), lst[0]["id"])

    return {"tree": tree_id, "items": pick(sets.get("items")), "skills": pick(sets.get("skills")),
            "config": pick(sets.get("configs"))}


def item_title(it):
    if not it:
        return None
    t = it.get("title")
    return it.get("base") or it.get("name") if (not t or t == "New Item") else t


def gem_key(g):
    return (g.get("name") or g.get("nameSpec") or "").lower()


def as_list(v):
    """Une table Lua vide est sérialisée en {} : on la ramène à une liste."""
    return v if isinstance(v, list) else []


# ---------------------------------------------------------------- suivi de guide
_CURVE_CACHE = {}


def stage_curve(build_id):
    """Chiffres clés de chaque étape d'un guide (DPS global, coup max encaissable, vie, ES, niveau, points) :
    la courbe de progression du build. Recalculé seulement si le fichier change."""
    mt = os.path.getmtime(build_path(build_id))
    c = _CURVE_CACHE.get(build_id)
    if c and c[0] == mt:
        return c[1]
    snap = HOST.open(build_id)
    sets = snap["sets"]
    out = []
    for t in sets.get("trees") or []:
        st = match_stage(sets, t["id"])
        k = (HOST.open(build_id, st) or {}).get("key") or {}
        info = (HOST.snapshot or {}).get("info") or {}
        tree = (HOST.snapshot or {}).get("tree") or {}
        out.append({"id": t["id"], "title": t["title"], "dps": k.get("GlobalDPS"), "dpsSource": k.get("GlobalDPSSource"),
                    "hit": k.get("MinMaxHit"), "hitType": k.get("MinMaxHitType"), "life": k.get("Life"), "es": k.get("EnergyShield"),
                    "level": info.get("level"), "points": tree.get("points")})
    r = {"stages": out}
    _CURVE_CACHE[build_id] = (mt, r)
    return r


_SHEET_CACHE = {}


def build_sheet(build_id):
    """Fiche d'un guide (façon pages de build Mobalytics), lue sur sa dernière étape : compétence principale et ses
    châsses, objets uniques clés, keystones, couches défensives, réserve vie / ES, plage de niveaux du guide.
    Uniquement des chiffres calculés par PoB : aucune note inventée."""
    mt = os.path.getmtime(build_path(build_id))
    c = _SHEET_CACHE.get(build_id)
    if c and c[0] == mt:
        return c[1]
    curve = stage_curve(build_id)["stages"]
    snap = HOST.open(build_id)
    trees = snap["sets"].get("trees") or []
    # étape de référence : la plus aboutie (le plus de points passifs ; à égalité, la plus tardive). La dernière du
    # guide est parfois une variante (« SPECIAL… », « OPT… ») et non le build final.
    pts = {x["id"]: (x.get("points") or 0) for x in curve}
    main_line = [t for t in trees if not re.match(r"\s*(OPT|VAR)\b", t["title"], re.I) and "SPECIAL" not in t["title"].upper()] or trees
    last = max(main_line, key=lambda t: (pts.get(t["id"], 0), trees.index(t))) if trees else None
    sheet_stage = match_stage(snap["sets"], last["id"]) if last else None
    S = normalize_snapshot(dict(HOST.open(build_id, sheet_stage) if last else snap))
    if ART:
        ART.enrich_snapshot(S)
    k = S.get("key") or {}
    main = next((g for g in S["skills"] if g.get("main")), None)
    full = [g for g in S["skills"] if g.get("includeInFullDPS") and g.get("enabled")]

    def active_name(g):
        return next(iter(as_list(g.get("active"))), None) or next((x["name"] for x in g["gems"] if not x.get("support")), None)
    # compétence vedette : celle comptée dans le DPS global (Full DPS) si le guide en a une, sinon la principale.
    # Une compétence donnée par un objet (Chains of Command…) a ses supports dans un autre groupe du même
    # emplacement : on montre ce groupe-là (le plus de gemmes), c'est lui qu'on serti en jeu.
    hero_name = active_name(full[0]) if full else (active_name(main) if main else None)
    if full:
        slot = full[0].get("slot")
        same = [g for g in S["skills"] if g.get("enabled") and slot and g.get("slot") == slot]
        main = max(same, key=lambda g: len(g["gems"])) if same else full[0]
    uniques = [{"slot": x.get("label") or x["slot"], "item": x["item"]} for x in S["items"]
               if x.get("item") and x["item"].get("rarity") == "UNIQUE"]
    for g in S["minionGear"]:
        if g.get("enabled"):
            uniques += [{"slot": "%s · %s" % (g.get("skill") or "Sbire", x.get("label") or x["slot"]), "item": x["item"]}
                        for x in g["slots"] if x.get("item") and x["item"].get("rarity") == "UNIQUE"]
    levels = [x.get("level") for x in curve if x.get("level")]
    r = {
        "info": S.get("info"), "stages": len(trees), "stage": sheet_stage, "lastStage": last["title"] if last else None,
        "levelFrom": min(levels) if levels else None, "levelTo": max(levels) if levels else None,
        "main": main, "mainName": hero_name, "full": [{"name": next((x["name"] for x in g["gems"] if not x.get("support")), "?"), "count": g.get("count")} for g in full],
        "uniques": uniques[:12],
        "keystones": [{"id": n.get("id"), "name": n["name"], "stats": n.get("stats")} for n in S["tree"]["keystones"]],
        "ascendancy": [{"id": n.get("id"), "name": n["name"], "stats": n.get("stats")} for n in S["tree"]["ascendancy_nodes"] if n.get("kind") == "notable"],
        "key": {x: k.get(x) for x in ("GlobalDPS", "GlobalDPSSource", "Life", "EnergyShield", "Ward", "Mana", "Armour", "Evasion",
                                     "BlockChance", "SpellBlockChance", "SpellSuppressionChance", "MeleeEvadeChance",
                                     "FireResist", "ColdResist", "LightningResist", "ChaosResist", "MinMaxHit", "MinMaxHitType",
                                     "PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken",
                                     "LightningMaximumHitTaken", "ChaosMaximumHitTaken")},
    }
    _SHEET_CACHE[build_id] = (mt, r)
    return r


def stage_diff(build_id, a, b):
    """Ce qui change dans le guide entre deux étapes : arbre, objets, gemmes, config, Guardian, stats clés."""
    A = normalize_snapshot(HOST.open(build_id, a))
    B = normalize_snapshot(HOST.open(build_id, b))
    if ART:
        ART.enrich_snapshot(B)
        ART.enrich_snapshot(A)
    ta, tb = A["tree"], B["tree"]
    a_alloc, b_alloc = set(ta["alloc"]), set(tb["alloc"])

    def imp(t):
        return t["keystones"] + t["notables"] + t["masteries"] + [n for n in t["ascendancy_nodes"] if n["kind"] == "notable"]
    tree = {
        "points": (tb.get("points") or 0) - (ta.get("points") or 0),
        "ascPoints": (tb.get("ascPoints") or 0) - (ta.get("ascPoints") or 0),
        "added": [{"id": n["id"], "name": n["name"], "kind": n["kind"], "asc": n.get("asc"), "stats": n.get("stats")}
                  for n in imp(tb) if n["id"] not in a_alloc],
        "removed": [{"id": n["id"], "name": n["name"], "kind": n["kind"], "asc": n.get("asc")} for n in imp(ta) if n["id"] not in b_alloc],
        "smallAdded": len(b_alloc - a_alloc), "smallRemoved": len(a_alloc - b_alloc),
    }

    def items_diff(la, lb, label_prefix=""):
        ma = {s["slot"]: s for s in la}
        out = []
        for s in lb:
            old = (ma.get(s["slot"]) or {}).get("item")
            new = s.get("item")
            if (old or {}).get("name") == (new or {}).get("name") and (old or {}).get("raw") == (new or {}).get("raw"):
                continue
            if not old and not new:
                continue
            out.append({"slot": s["slot"], "label": label_prefix + (s.get("label") or s["slot"]), "from": old, "to": new,
                        "same": bool(old and new and old.get("name") == new.get("name"))})
        seen = {s["slot"] for s in lb}
        for s in la:
            if s["slot"] not in seen and s.get("item"):
                out.append({"slot": s["slot"], "label": label_prefix + (s.get("label") or s["slot"]), "from": s["item"], "to": None})
        return out

    items = items_diff(A["items"], B["items"])
    guardian = []
    ga = {g["skill"]: g for g in A["minionGear"] if g.get("enabled")}
    for g in B["minionGear"]:
        if g.get("enabled"):
            guardian += items_diff((ga.get(g["skill"]) or {}).get("slots") or [], g["slots"], "Guardian · ")

    def groups(S):
        out = {}
        for g in S["skills"]:
            act = [x for x in g["gems"] if not x["support"]]
            if not g["gems"] or not g.get("enabled", True):
                continue
            # groupe sans compétence active (supports d'un objet, ex. arme du Guardian) : repéré par son emplacement
            if act:
                key, name = gem_key(act[0]), act[0]["name"]
            else:
                where = g.get("label") or g.get("slot") or "sans emplacement"
                key, name = "supports:" + where, "Supports · " + where
            out.setdefault(key, {"name": name, "gems": {}})
            for x in g["gems"]:
                out[key]["gems"][gem_key(x)] = x
        return out
    ga_, gb_ = groups(A), groups(B)
    gems = {"added": [], "removed": [], "changed": []}
    for k, g in gb_.items():
        if k not in ga_:
            gems["added"].append({"name": g["name"], "gems": [x["name"] for x in g["gems"].values()]})
            continue
        old = ga_[k]["gems"]
        add = [x["name"] for kk, x in g["gems"].items() if kk not in old]
        rem = [x["name"] for kk, x in old.items() if kk not in g["gems"]]
        lvl = [{"name": x["name"], "from": [old[kk].get("level"), old[kk].get("quality")], "to": [x.get("level"), x.get("quality")]}
               for kk, x in g["gems"].items() if kk in old and ((x.get("level") or 0) > (old[kk].get("level") or 0) + 0
                                                                  or (x.get("quality") or 0) > (old[kk].get("quality") or 0))]
        if add or rem or lvl:
            gems["changed"].append({"name": g["name"], "add": add, "remove": rem, "levels": lvl})
    for k, g in ga_.items():
        if k not in gb_:
            gems["removed"].append({"name": g["name"]})

    ca = {c["var"]: c for c in as_list(A.get("config"))}
    cb = {c["var"]: c for c in as_list(B.get("config"))}
    config = []
    for var in list(cb) + [v for v in ca if v not in cb]:
        x, y = ca.get(var), cb.get(var)
        if (x or {}).get("value") != (y or {}).get("value"):
            config.append({"label": (y or x)["label"], "from": (x or {}).get("value"), "to": (y or {}).get("value"),
                           "type": (y or x).get("type"), "options": (y or x).get("options")})
    # liste plate de changements à clé stable (pour la chronologie ordonnée et annotée par le créateur) :
    # la clé ne dépend que de la cible (emplacement, nom de passif, de gemme, variable de config), jamais d'un index
    changes = []
    for it in items + guardian:
        old, new = it.get("from"), it.get("to")
        if new and old:
            s = "Remplacer %s par %s (%s)" % (item_title(old), item_title(new), it["label"])
        elif new:
            s = "Équiper %s (%s)" % (item_title(new), it["label"])
        else:
            s = "Retirer %s (%s)" % (item_title(old), it["label"])
        changes.append({"key": "item:" + it["label"], "kind": "item", "slot": it["slot"], "autoSummary": s})
    # l'arbre en un seul bloc résumé (le détail se voit sur l'arbre, différences surlignées)
    if tree["added"] or tree["removed"] or tree["smallAdded"] or tree["smallRemoved"]:
        key_nodes = [n["name"] for n in tree["added"]]
        parts = ["%+d point%s" % (tree["points"], "s" if abs(tree["points"]) > 1 else "")]
        if tree["ascPoints"]:
            parts.append("%+d d'ascendance" % tree["ascPoints"])
        if key_nodes:
            parts.append(", ".join(key_nodes[:4]) + (" +%d" % (len(key_nodes) - 4) if len(key_nodes) > 4 else ""))
        if tree["removed"]:
            parts.append("retirer " + ", ".join(n["name"] for n in tree["removed"][:3]))
        changes.append({"key": "tree:changes", "kind": "tree", "autoSummary": "Arbre passif : " + " · ".join(parts)})
    for g in gems["added"]:
        changes.append({"key": "gem:" + g["name"], "kind": "gem", "autoSummary": "Nouveau groupe %s : %s" % (g["name"], ", ".join(g["gems"]))})
    for g in gems["changed"]:
        parts = (["+ " + ", ".join(g["add"])] if g["add"] else []) + (["− " + ", ".join(g["remove"])] if g["remove"] else []) \
            + (["niveaux / qualité de %d gemme%s" % (len(g["levels"]), "s" if len(g["levels"]) > 1 else "")] if g["levels"] else [])
        changes.append({"key": "gem:" + g["name"], "kind": "gem", "autoSummary": "%s : %s" % (g["name"], " · ".join(parts))})
    for g in gems["removed"]:
        changes.append({"key": "gem:-" + g["name"], "kind": "gem", "autoSummary": "Retirer le groupe %s" % g["name"]})
    for c in config:
        changes.append({"key": "config:" + c["label"], "kind": "config",
                        "autoSummary": "Config « %s » : %s → %s" % (re.sub(r"\^x[0-9A-Fa-f]{6}|\^\d", "", c["label"]), c["from"] if c["from"] is not None else "—", c["to"] if c["to"] is not None else "—")})
    return {"from": a, "to": b, "tree": tree, "items": items, "guardian": guardian, "gems": gems, "config": config, "changes": changes,
            "keyFrom": A["key"], "keyTo": B["key"], "levelFrom": A["info"].get("level"), "levelTo": B["info"].get("level")}


_LEAGUES = {"t": 0, "v": None}


def trade_leagues():
    """Ligues du site trade (liste publique de GGG), mise en cache une heure."""
    if _LEAGUES["v"] and time.time() - _LEAGUES["t"] < 3600:
        return _LEAGUES["v"]
    import art as _art
    try:
        d = json.loads(_art.download("https://www.pathofexile.com/api/trade/data/leagues", timeout=15).decode("utf-8"))
        out = [x["id"] for x in d.get("result", []) if x.get("realm", "pc") == "pc"]
    except Exception as e:
        log("ligues trade : %s" % e)
        out = []
    if not out:
        out = ["Standard", "Hardcore"]
    _LEAGUES.update(t=time.time(), v=out)
    return out


def trade_url(league, q):
    for st in as_list(q.get("query", {}).get("stats")):
        st["filters"] = as_list(st.get("filters"))
    stats = [st for st in as_list(q.get("query", {}).get("stats")) if st["filters"] or st.get("type") == "weight"]
    if "query" in q and "stats" in q["query"]:
        q["query"]["stats"] = stats
    return "https://www.pathofexile.com/trade/search/%s?q=%s" % (
        urllib.parse.quote(league), urllib.parse.quote(json.dumps(q, separators=(",", ":"), ensure_ascii=False)))


def trade_searches(build_id, stage, slot, guide_raw, league):
    HOST.open(build_id, stage)
    r = HOST.call("tradeQuery", slot=slot, guideRaw=guide_raw)
    r["searches"] = as_list(r.get("searches"))
    r["topStats"] = as_list(r.get("topStats"))
    r["crafted"] = as_list(r.get("crafted"))
    for s in r["searches"]:
        s["url"] = trade_url(league, s.pop("query"))
        s["chips"] = as_list(s.get("chips"))
    r["league"] = league
    return r


def dps_breakdown(M, G, item_rows, dropped, steps, gem_rows, g_mods="", g_party=False):
    """D'où vient l'écart de DPS avec le guide ? Mesuré par PoB sur TON build, par étapes cumulées :
    1. conditions de combat que ton build ne peut pas activer (retirées chez toi) ;
    2. l'équipement du guide ; 3. + son arbre ; 4. + ses gemmes (niveaux, qualités, supports) ;
    le reste = ce qui n'est pas posé (maîtrises, groupes de gemmes absents, compétences additionnées…).
    Chaque étape part de la précédente : les multiplicateurs se composent exactement."""
    import math
    mk, gk = M.get("key") or {}, G.get("key") or {}
    m, g = mk.get("GlobalDPS") or 0, gk.get("GlobalDPS") or 0
    if m <= 0 or g <= 0 or mk.get("GlobalDPSSource") != gk.get("GlobalDPSSource"):
        return None  # pas la même mesure de DPS des deux côtés : rien de comparable
    ratio = g / m
    if not (1 / 50 < ratio < 50):
        return None  # écart démesuré : pas les mêmes compétences comptées
    if abs(math.log(ratio)) < math.log(1.03):
        return None  # moins de 3 % d'écart : rien à expliquer

    def mult(p):
        return max(0.01, 1 + (p or 0) / 100)

    def step(a, b):
        return (b / a) if a and b and a > 0 and b > 0 else 1.0

    parts = []
    c, cl = 1.0, []
    for d in dropped:
        p = (d.get("impact") or {}).get("dps")
        if p:
            c *= mult(p)
            cl.append({"name": d.get("label"), "pct": p})
    parts.append({"key": "conditions", "label": "Conditions de combat", "mult": c,
                  "hint": "options du guide que ton build ne peut pas encore activer (charges, buffs…)", "top": cl})
    st = steps or {}
    b0 = st.get("base") or m
    gl = [{"name": r.get("label"), "pct": (r.get("head") or {}).get("dps")} for r in item_rows if (r.get("head") or {}).get("dps")]
    parts.append({"key": "gear", "label": "Équipement", "mult": step(b0, st.get("gear")),
                  "hint": "tout l'équipement du guide à la place du tien", "top": gl})
    parts.append({"key": "tree", "label": "Arbre passif", "mult": step(st.get("gear"), st.get("tree")),
                  "hint": "l'arbre du guide, en plus de son équipement", "top": []})
    absent = []
    for r in gem_rows:
        if r.get("guide") and not r.get("mine") and not r.get("_supportsOf") and r["guide"].get("enabled") is not False:
            gl = as_list(r["guide"].get("gems"))
            act = [z["name"] for z in gl if not z.get("support")] or [z["name"] for z in gl]
            if act:
                absent.append(act[0])
    parts.append({"key": "gems", "label": "Gemmes", "mult": step(st.get("tree"), st.get("gems")),
                  "hint": "les gemmes du guide : niveaux, qualités, supports%s" % (
                      " ; groupes que tu n'as pas : " + ", ".join(absent[:4]) if absent else ""), "top": []})
    parts.append({"key": "settings", "label": "Personnage", "mult": step(st.get("gems"), st.get("settings")),
                  "hint": "niveau, bandit, panthéon et flasques cochées actives comme dans le guide", "top": []})
    parts.append({"key": "party", "label": "Onglet Party", "mult": step(st.get("settings"), st.get("party")),
                  "hint": "buffs d'alliés importés dans l'onglet Party de ton PoB, retirés%s" % (
                      " (le guide en a aussi, non reproduits)" if g_party else " (le guide n'en a pas)"), "top": []})
    parts.append({"key": "custom", "label": "Lignes ajoutées par le guide", "mult": step(st.get("party"), st.get("customMods")),
                  "hint": "effets que l'auteur a écrits à la main dans PoB (Custom Modifiers) pour simuler ce que PoB ne calcule pas",
                  "detail": g_mods.strip() or None, "top": []})
    done = st.get("customMods") or st.get("settings") or st.get("gems") or b0
    rest = ratio * m / done / c if done > 0 else 1.0
    parts.append({"key": "rest", "label": "Le reste", "mult": rest,
                  "hint": "réglages propres à une compétence (nombre de copies, partie de compétence…), effets non simulés", "top": []})
    L = math.log(ratio)
    for p in parts:
        p["share"] = math.log(p["mult"]) / L
        p["dps"] = (g - m) * p["share"]  # équivalent en DPS de cette part
        p["top"] = sorted(p["top"], key=lambda x: -x["pct"] if L > 0 else x["pct"])[:3]
    # gros reste : la décomposition n'explique pas l'essentiel, on le dit
    unexplained = abs(parts[-1]["share"]) > 0.4
    return {"mine": m, "guide": g, "ratio": ratio, "parts": parts, "unexplained": unexplained}


def guardian_compare(G, M):
    """Équipement des sbires (Animated Guardian) : objets du guide testés sur le Guardian du joueur."""
    out = []
    used, seen = set(), set()
    # le sbire compté dans le Full DPS d'abord : s'il y a plusieurs groupes d'une même compétence, c'est son équipement qui compte
    for gg in sorted(as_list(G.get("minionGear")), key=lambda x: not x.get("full")):
        # gemmes désactivées et doublons (même compétence) ignorés : on garde l'équipement réellement porté
        if not gg.get("enabled") or gg.get("skill") in seen:
            continue
        seen.add(gg.get("skill"))
        mg = None
        for i, x in enumerate(as_list(M.get("minionGear"))):
            if i not in used and x.get("skill") == gg.get("skill"):
                mg, _ = x, used.add(i)
                break
        if mg is None:
            # chez toi, ce sbire est rattaché à un autre (ex. l'arme animée prend l'arme de ton Guardian)
            for x in as_list(M.get("minionGear")):
                if any(l.get("skill") == gg.get("skill") for l in as_list(x.get("linked"))):
                    mg = x
                    break
        m_slots = {s["slot"]: s for s in as_list((mg or {}).get("slots"))}
        rows = []
        for gs in as_list(gg.get("slots")):
            ms = m_slots.get(gs["slot"]) or {}
            gi, mi = gs.get("item"), ms.get("item")
            if not gi and not mi:
                continue
            row = {"slot": gs["slot"], "label": "Guardian · " + gs["slot"], "guide": gi, "mine": mi,
                   "same": bool(gi and mi and gi["name"] == mi["name"]),
                   "sameRaw": bool(gi and mi and gi.get("raw") == mi.get("raw"))}
            if gi and mg and not row["same"]:
                try:
                    r = HOST.call("testMinionItem", setId=mg["setId"], slot=gs["slot"], raw=gi["raw"])
                    row.update(head=r.get("head"), diff=as_list(r.get("diff")), minionDiff=as_list(r.get("minionDiff")))
                except Exception as e:
                    row["error"] = str(e)
            rows.append(row)
        out.append({"skill": gg.get("skill"), "linked": [l.get("skill") for l in as_list(gg.get("linked"))],
                    "guideTitle": gg.get("title"), "mineTitle": (mg or {}).get("title"),
                    "mineSetId": (mg or {}).get("setId"), "missing": mg is None, "rows": rows})
    return out


def normalize_snapshot(S):
    for k in ("items", "skills", "stats"):
        S[k] = as_list(S.get(k))
    t = S.get("tree") or {}
    for k in ("alloc", "keystones", "notables", "masteries", "ascendancy_nodes"):
        t[k] = as_list(t.get(k))
    for g in S["skills"]:
        g["gems"] = as_list(g.get("gems"))
    S["minionGear"] = as_list(S.get("minionGear"))
    for g in S["minionGear"]:
        g["slots"] = as_list(g.get("slots"))
        g["linked"] = as_list(g.get("linked"))
    return S


RULES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules")


def lint_rules():
    """Fichiers de règles du linter (relus à chaque analyse : on peut en ajouter sans redémarrer)."""
    out = []
    if os.path.isdir(RULES_DIR):
        for name in sorted(os.listdir(RULES_DIR)):
            if name.endswith(".lua"):
                with open(os.path.join(RULES_DIR, name), encoding="utf-8") as f:
                    out.append({"name": name, "code": f.read()})
    return out


def guide_meta(guide_id):
    """Métadonnées de créateur d'un guide (règles ignorées, chronologie, notes…), rangées dans lucid_meta.json."""
    if not guide_id:
        return {}
    return (load_meta()["builds"].get(guide_id) or {}).get("guideMeta") or {}


def active_step(snap):
    """Titre de l'étape active d'un instantané de guide (clé stable des métadonnées : le nom du jeu d'arbre)."""
    trees = ((snap or {}).get("sets") or {}).get("trees") or []
    t = next((x for x in trees if x.get("active")), trees[0] if trees else None)
    return t["title"] if t else None


def lint(guide_profile=None, compare_data=None, meta=None, step=None):
    t = time.time()
    try:
        r = HOST.call("lint", rules=lint_rules(), guide=guide_profile, compare=compare_data or {},
                      guideMeta=meta or {}, activeStep=step)
    except Exception as e:
        log("linter : %s" % e)
        return {"findings": [], "errors": [str(e)]}
    r["findings"] = as_list(r.get("findings"))
    r["ignored"] = as_list(r.get("ignored"))
    r["errors"] = as_list(r.get("errors"))
    for e in r["errors"]:
        log("linter : %s" % e)
    log("linter : %d règles, %d constats, %d simulations en %.2fs"
        % (r.get("rules", 0), len(r["findings"]), r.get("simulations", 0), time.time() - t))
    return r


class ClipboardWatch:
    """Lit le presse-papier Windows seulement quand l'option est activée dans Lucid (⚙️), et ne garde que les
    textes d'objets de Path of Exile (Ctrl+C en jeu : « Item Class: … »). Rien n'est lu ni gardé sinon."""

    def __init__(self):
        self.on = False
        self.seq = 0          # numéro de séquence Windows du dernier contenu vu
        self.item = None      # {"n": compteur, "text": objet}
        self.n = 0
        self.lock = threading.Lock()
        threading.Thread(target=self._loop, daemon=True).start()

    def _read(self):
        import ctypes
        from ctypes import wintypes
        u, k = ctypes.windll.user32, ctypes.windll.kernel32
        u.GetClipboardData.restype = wintypes.HANDLE
        k.GlobalLock.restype = wintypes.LPVOID
        k.GlobalLock.argtypes = [wintypes.HGLOBAL]
        k.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
        if not u.OpenClipboard(None):
            return None
        try:
            h = u.GetClipboardData(13)  # CF_UNICODETEXT
            if not h:
                return None
            ptr = k.GlobalLock(h)
            if not ptr:
                return None
            try:
                return ctypes.wstring_at(ptr)
            finally:
                k.GlobalUnlock(h)
        finally:
            u.CloseClipboard()

    def _loop(self):
        if os.name != "nt":
            return
        import ctypes
        while True:
            time.sleep(0.7)
            if not self.on:
                continue
            try:
                seq = ctypes.windll.user32.GetClipboardSequenceNumber()
                if seq == self.seq:
                    continue
                self.seq = seq
                text = self._read() or ""
                if text.lstrip().startswith("Item Class:") and len(text) < 20000:
                    with self.lock:
                        self.n += 1
                        self.item = {"n": self.n, "text": text}
            except Exception as e:  # noqa: BLE001
                log("presse-papier : %s" % e)

    def set(self, on):
        self.on = bool(on)
        if not self.on:
            with self.lock:
                self.item = None
        else:
            try:
                import ctypes
                self.seq = ctypes.windll.user32.GetClipboardSequenceNumber()  # ignore ce qui était déjà copié
            except Exception:
                pass
        return {"on": self.on}


CLIP = None


_HEALTH_CACHE = {}
HEALTH_KEYS = ("PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken",
               "ChaosMaximumHitTaken", "BlockChance", "SpellBlockChance", "SpellSuppressionChance", "Armour", "Evasion",
               "Life", "LifeUnreserved", "EnergyShield", "Mana", "ManaUnreserved", "Ward",
               "FireResist", "ColdResist", "LightningResist", "ChaosResist",
               "FireResistOverCap", "ColdResistOverCap", "LightningResistOverCap",
               "Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt",
               "GlobalDPS", "GlobalDPSSource", "FullDPS", "MinMaxHit", "MinMaxHitType", "HitPool", "TotalEHP")


def readiness(G, M, L, meta, step):
    """Score de préparation à l'étape (validation souple, les objets rares n'étant jamais identiques) :
    40 % santé (aucune alerte critique non ignorée) + 60 % piliers fixes, à parts égales :
      - la compétence principale du guide, avec au moins autant de gemmes liées ;
      - les keystones et notables d'ascendance de l'étape ;
      - les emplacements verrouillés par le créateur (objet identique au guide), s'il y en a.
    80 % ou plus : prêt pour l'étape suivante."""
    missing = []
    crit = [f for f in (L.get("findings") or []) if f.get("severity") == "CRITIQUE"]
    health_ok = not crit
    if crit:
        missing += ["Alerte critique : " + (f.get("title") or f.get("id")) for f in crit]
    pillars = []

    def act(g):
        return next((x["name"] for x in as_list(g.get("gems")) if not x.get("support")), None) or next(iter(as_list(g.get("active"))), None)
    gmain = next((g for g in as_list(G.get("skills")) if g.get("includeInFullDPS") and g.get("enabled")), None) \
        or next((g for g in as_list(G.get("skills")) if g.get("main")), None)
    def supports(S, name):
        """Supports liés à une compétence : ceux de son groupe ; pour une compétence donnée par un objet
        (Chains of Command…), tous les supports sertis dans l'emplacement de l'objet (souvent répartis sur
        plusieurs groupes dans PoB). None si la compétence est absente."""
        groups = [g for g in as_list(S.get("skills")) if g.get("enabled") and (act(g) == name or name in as_list(g.get("active")))]
        if not groups:
            return None
        own = max(groups, key=lambda g: len(as_list(g.get("gems"))))
        sup = {x["name"] for x in as_list(own.get("gems")) if x.get("support")}
        if str(own.get("source") or "").startswith("Item:"):
            slot = own.get("slot")
            for g in as_list(S.get("skills")):
                if g.get("enabled") and slot and g.get("slot") == slot and not any(not x.get("support") for x in as_list(g.get("gems"))):
                    sup |= {x["name"] for x in as_list(g.get("gems")) if x.get("support")}
        return sup
    if gmain and act(gmain):
        name = act(gmain)
        need, have = supports(G, name) or set(), supports(M, name)
        v = 0 if have is None else min(1.0, len(have & need) / len(need)) if need else 1.0
        pillars.append(v)
        if v < 1:
            lack = sorted(need - (have or set()))
            missing.append("%s : %s" % (name, "absente" if have is None else "%d supports liés sur %d (manque %s)" % (
                len(have & need), len(need), ", ".join(lack[:3]) + ("…" if len(lack) > 3 else ""))))
    need_nodes = [n["name"] for n in G["tree"]["keystones"]] + [n["name"] for n in G["tree"]["ascendancy_nodes"] if n.get("kind") == "notable"]
    if need_nodes:
        have_nodes = {n["name"] for n in M["tree"]["keystones"]} | {n["name"] for n in M["tree"]["ascendancy_nodes"]}
        miss = [n for n in need_nodes if n not in have_nodes]
        pillars.append(1 - len(miss) / len(need_nodes))
        missing += ["Passif : " + n for n in miss]
    locked = ((meta or {}).get("steps") or {}).get(step or "", {}).get("lockedSlots") or []
    if locked:
        gi = {(x.get("label") or x["slot"]): x.get("item") for x in G["items"]}
        mi = {(x.get("label") or x["slot"]): x.get("item") for x in M["items"]}
        bad = [sl for sl in locked if not gi.get(sl) or not mi.get(sl) or (gi[sl] or {}).get("name") != (mi[sl] or {}).get("name")]
        pillars.append(1 - len(bad) / len(locked))
        missing += ["Objet verrouillé : %s (%s)" % (item_title(gi.get(sl)) or "?", sl) for sl in bad]
    score = (40 if health_ok else 0) + (60 * sum(pillars) / len(pillars) if pillars else 60)
    return {"score": round(score), "ready": score >= 80, "missing": missing[:12], "pillars": len(pillars), "locked": locked}


def health(mine_id, guide_id=None, guide_stage=None, mine_sets=None, cfg_source="guide", full_dps="guide"):
    """Colonne « Santé du build » : voyants vitaux et alertes du linter, dans les mêmes conditions que la comparaison
    (sans tester chaque objet / nœud). Mise en cache tant que les fichiers, l'étape et les réglages ne changent pas."""
    sig = [mine_id, guide_id, guide_stage, mine_sets, cfg_source, full_dps, os.path.getmtime(build_path(mine_id)),
           os.path.getmtime(build_path(guide_id)) if guide_id else None,
           json.dumps((load_meta()["builds"].get(guide_id) or {}).get("guideMeta"), sort_keys=True) if guide_id else None]
    key = json.dumps(sig, sort_keys=True, default=str)
    if key in _HEALTH_CACHE:
        return _HEALTH_CACHE[key]
    if guide_id:
        P = prepare_pair(guide_id, guide_stage, mine_id, mine_sets, cfg_source, full_dps, why=False)
        M, profile, dropped = P["M"], P["guide_profile"], P["dropped"]
        meta, step = guide_meta(guide_id), active_step(P["G"])
        G = P["G"]
    else:
        M, profile, dropped = normalize_snapshot(HOST.open(mine_id, mine_sets)), None, []
        # guide ouvert seul : ses propres règles ignorées s'appliquent à lui-même
        meta, step = guide_meta(mine_id), active_step(M)
    L = lint(profile, {}, meta, step)
    k = M.get("key") or {}
    ready = readiness(G, M, L, meta, step) if guide_id else None
    # chiffres du guide à l'étape (cible affichée sous les tiens, ou vue « stats du guide »)
    gk = (G.get("key") or {}) if guide_id else {}
    r = {"key": {x: k.get(x) for x in HEALTH_KEYS}, "info": M.get("info"), "findings": L.get("findings") or [],
         "guideKey": {x: gk.get(x) for x in HEALTH_KEYS} if guide_id else None, "guideInfo": G.get("info") if guide_id else None,
         "ignored": L.get("ignored") or [], "step": step, "guideId": guide_id or mine_id,
         "ignoreAttrReq": bool(L.get("ignoreAttrReq")), "readiness": ready, "attrs": L.get("attrs") or {},
         "mana": L.get("mana"), "dropped": [{x: d.get(x) for x in ("var", "label", "guideSrc")} for d in dropped]}
    if len(_HEALTH_CACHE) > 40:
        _HEALTH_CACHE.clear()
    _HEALTH_CACHE[key] = r
    return r


def prepare_pair(guide_id, guide_stage, mine_id, mine_sets=None, cfg_source="guide", full_dps="guide", why=True):
    """Charge le guide à l'étape puis le perso dans les mêmes conditions de simulation (config de l'étape moins ce que
    le perso ne peut pas activer, même périmètre de Full DPS). Partagé par compare() et la colonne Santé."""
    G = normalize_snapshot(HOST.open(guide_id, guide_stage))
    if ART:
        ART.enrich_snapshot(G)
    # conditions de simulation de l'étape du guide (charges, états de l'ennemi, boss…), appliquées à ton perso
    g_cfg = HOST.call("configInput").get("input") or {}
    if isinstance(g_cfg, list):
        g_cfg = {}
    guide_conf = HOST.call("config")
    # lignes écrites à la main par l'auteur dans Configuration > Custom Modifiers (hypothèses du guide)
    try:
        g_mods = (HOST.call("customMods") or {}).get("text") or ""
        g_party = bool((HOST.call("partyInfo") or {}).get("has"))
    except Exception as e:  # noqa: BLE001
        log("customMods: %s" % e)
        g_mods, g_party = "", False

    guide_profile = HOST.call("lintProfile")
    # « Pourquoi ce chiffre ? » : sources de chaque stat, côté guide (le guide est chargé maintenant)
    g_why = (HOST.call("explainStats") or {}) if why else {}
    # périmètre du Full DPS : les compétences que le guide additionne, additionnées aussi chez toi
    g_full = []
    for g in as_list(G.get("skills")):
        if g.get("includeInFullDPS") and g.get("enabled"):
            act = [x["name"] for x in as_list(g.get("gems")) if not x.get("support")]
            if act:
                g_full.append({"name": act[0], "count": g.get("count")})
    mine_stage = dict(mine_sets or {})
    if cfg_source == "guide":
        mine_stage["cfg"] = g_cfg
    if full_dps == "guide" and g_full:
        mine_stage["fulldps"] = g_full
    elif full_dps == "mine":
        mine_stage["fulldps"] = []
    M = normalize_snapshot(HOST.open(mine_id, mine_stage))
    # conditions réalistes : sans les conditions du guide que ton build ne peut pas activer (charges sans source…)
    dropped = []
    if cfg_source == "guide":
        try:
            gates = HOST.call("gateConfig", rules=lint_rules(), guide=guide_profile, guideCfg=g_cfg)
            drop, keep = as_list(gates.get("drop")), as_list(gates.get("keep"))
            if drop:
                mine_stage["cfg"] = {k: v for k, v in g_cfg.items() if k not in {d["var"] for d in drop}}
                M = normalize_snapshot(HOST.open(mine_id, mine_stage))
            dropped = as_list(HOST.call("setGates", drop=drop, keep=keep).get("dropped"))
        except Exception as e:  # noqa: BLE001 — la comparaison reste possible aux conditions du guide
            log("conditions réalistes : %s" % e)
    return {"G": G, "g_cfg": g_cfg, "guide_conf": guide_conf, "g_mods": g_mods, "g_party": g_party,
            "guide_profile": guide_profile, "g_why": g_why, "g_full": g_full, "mine_stage": mine_stage, "M": M, "dropped": dropped}


def compare(guide_id, guide_stage, mine_id, mine_sets=None, cfg_source="guide", full_dps="guide"):
    """Compare le perso au guide.
    guide_stage : jeux du guide (arbre, objets, gemmes, config) — l'« étape » ;
    mine_sets : jeux du perso (None = ceux actifs dans le build) ;
    cfg_source : "guide" = conditions de simulation de l'étape du guide appliquées au perso, "mine" = sa propre config ;
    full_dps : "guide" = mêmes compétences additionnées que le guide, "mine" = réglage du perso."""
    P = prepare_pair(guide_id, guide_stage, mine_id, mine_sets, cfg_source, full_dps)
    G, g_cfg, guide_conf, g_mods, g_party = P["G"], P["g_cfg"], P["guide_conf"], P["g_mods"], P["g_party"]
    guide_profile, g_why, g_full, mine_stage, M, dropped = P["guide_profile"], P["g_why"], P["g_full"], P["mine_stage"], P["M"], P["dropped"]
    if ART:
        ART.enrich_snapshot(M)
    mine_conf = HOST.call("config")
    m_why = HOST.call("explainStats") or {}

    # --- objets : on teste l'objet du guide dans mon build
    g_items = {s["slot"]: s for s in G["items"]}
    m_items = {s["slot"]: s for s in M["items"]}
    slots = []
    order = [s["slot"] for s in M["items"]] + [s for s in g_items if s not in m_items]
    for slot in order:
        gs, ms = g_items.get(slot), m_items.get(slot)
        gi = gs and gs.get("item")
        mi = ms and ms.get("item")
        if not gi and not mi:
            continue
        row = {"slot": slot, "label": (gs or ms).get("label") or slot, "jewel": (gs or ms).get("jewel"),
               "guide": gi, "mine": mi, "same": bool(gi and mi and gi["name"] == mi["name"]),
               "sameRaw": bool(gi and mi and gi.get("raw") == mi.get("raw"))}
        if gi and not row["same"] and not (gs or {}).get("jewel"):
            try:
                r = HOST.call("testItem", raw=gi["raw"], slot=slot)
                if r["results"]:
                    row["head"] = r["results"][0]["head"]
                    row["diff"] = r["results"][0]["diff"]
                    row["conditions"] = as_list(r["results"][0].get("conditions"))
                    row["resBalance"] = r["results"][0].get("resBalance")
                    row["abyss"] = r["results"][0].get("abyss")
                    row["brokenReqs"] = as_list(r["results"][0].get("brokenReqs"))
                    row["duplicateUnique"] = r["results"][0].get("duplicateUnique")
            except Exception as e:
                row["error"] = str(e)
        slots.append(row)

    # --- équipement des sbires (Animated Guardian)
    guardian = guardian_compare(G, M)

    # --- arbre
    g_alloc, m_alloc = set(G["tree"]["alloc"]), set(M["tree"]["alloc"])
    g_imp = G["tree"]["keystones"] + G["tree"]["notables"] + G["tree"]["masteries"]
    m_imp = M["tree"]["keystones"] + M["tree"]["notables"] + M["tree"]["masteries"]
    to_take = [n for n in g_imp if n["id"] not in m_alloc]
    extra = [n for n in m_imp if n["id"] not in g_alloc]
    vals = {}
    try:
        for r in HOST.call("testNodes", ids=[n["id"] for n in to_take if n["kind"] != "mastery"]):
            vals[r["id"]] = r
    except Exception as e:
        log("testNodes: %s" % e)
    for n in to_take:
        v = vals.get(n["id"])
        if v:
            n["cost"], n["head"] = v["cost"], v["head"]
    try:
        ev = {r["id"]: r["head"] for r in HOST.call("nodeValues", ids=[n["id"] for n in extra if n["kind"] != "mastery"])}
        for n in extra:
            n["head"] = ev.get(n["id"])
    except Exception as e:
        log("nodeValues: %s" % e)
    tree = {
        "version": M["tree"]["version"], "guideVersion": G["tree"]["version"],
        "guide": sorted(g_alloc), "mine": sorted(m_alloc),
        "common": len(g_alloc & m_alloc), "onlyGuide": len(g_alloc - m_alloc), "onlyMine": len(m_alloc - g_alloc),
        "toTake": to_take, "extra": extra,
        "guideSpec": {"nodes": G["tree"]["alloc"], "classId": G["tree"].get("classId"), "ascendClassId": G["tree"].get("ascendClassId"),
                      "secondaryAscendClassId": G["tree"].get("secondaryAscendClassId"), "masterySelections": G["tree"].get("masterySelections"), "tattoos": G["tree"].get("tattoos") if isinstance(G["tree"].get("tattoos"), dict) else {},
                      "version": G["tree"]["version"]},
        "ascGuide": [n["name"] for n in G["tree"]["ascendancy_nodes"] if n["kind"] == "notable"],
        "ascMine": [n["name"] for n in M["tree"]["ascendancy_nodes"] if n["kind"] == "notable"],
    }

    # --- gemmes : on apparie les groupes par compétence active
    def groups(S):
        out = []
        for g in S["skills"]:
            act = [x for x in g["gems"] if not x["support"]]
            if not g["gems"]:
                continue
            out.append({"key": gem_key(act[0]) if act else gem_key(g["gems"][0]), "group": g})
        return out

    gg, mg = groups(G), groups(M)
    used = set()
    gem_rows = []
    for x in gg:
        match = None
        for i, y in enumerate(mg):
            if i in used:
                continue
            g_names = {gem_key(z) for z in x["group"]["gems"]}
            m_names = {gem_key(z) for z in y["group"]["gems"]}
            if y["key"] == x["key"] or (len(g_names & m_names) >= max(2, len(g_names) // 2)):
                match = i
                break
        if match is not None:
            used.add(match)
        y = mg[match]["group"] if match is not None else None
        g_names = [z for z in x["group"]["gems"]]
        m_set = {gem_key(z): z for z in (y["gems"] if y else [])}
        g_set = {gem_key(z): z for z in g_names}
        missing = [z for z in g_names if gem_key(z) not in m_set]
        extra_g = [z for z in (y["gems"] if y else []) if gem_key(z) not in g_set]
        level = []
        for k, z in g_set.items():
            if k in m_set:
                a, b = m_set[k], z
                if (a.get("level") or 0) < (b.get("level") or 0) or (a.get("quality") or 0) < (b.get("quality") or 0):
                    level.append({"name": z["name"], "mine": [a.get("level"), a.get("quality")],
                                  "guide": [b.get("level"), b.get("quality")]})
        gem_rows.append({"guide": x["group"], "mine": y, "missing": missing, "extra": extra_g, "level": level})
    for i, y in enumerate(mg):
        if i not in used:
            gem_rows.append({"guide": None, "mine": y["group"], "missing": [], "extra": y["group"]["gems"], "level": []})
    # gemmes du guide posées sur ton build (part des gemmes dans l'écart de DPS) :
    # niveaux et qualités exacts, gemmes manquantes ajoutées, gemmes et groupes en trop coupés, groupes absents ajoutés
    def gem_spec(z):
        return {"gemId": z.get("gemId"), "skillId": z.get("skillId"), "nameSpec": z.get("nameSpec") or z.get("name"),
                "level": z.get("level"), "quality": z.get("quality"), "g1": z.get("g1"), "g2": z.get("g2")}

    def on(z):
        return z.get("enabled") is not False

    gem_req, disable_groups, new_groups = [], [], []
    # supports d'une compétence donnée par un objet : chez toi ils peuvent être répartis sur plusieurs groupes
    # d'un même emplacement ; on compare le groupe du guide à leur ensemble
    m_sup = {}
    for g in M["skills"]:
        gl = as_list(g.get("gems"))
        if gl and all(z.get("support") for z in gl) and g.get("slot"):
            m_sup.setdefault(g["slot"], []).append(g)
    used_sup = set()
    for r in gem_rows:
        gd = r.get("guide")
        if not gd or r.get("mine") or not gd.get("slot") or not all(z.get("support") for z in as_list(gd.get("gems"))):
            continue
        mine = m_sup.get(gd["slot"]) or []
        if not mine:
            continue
        # on reproduit le groupe du guide tel quel (un seul groupe : les mods « Socketed… » de l'objet
        # s'appliquent alors comme chez le guide) et on coupe tes groupes de supports de cet emplacement
        for g in mine:
            used_sup.add(g["index"])
            disable_groups.append(g["index"])
        gems = [gem_spec(z) for z in as_list(gd.get("gems")) if on(z)]
        if gems:
            new_groups.append({"slot": gd["slot"], "gems": gems, "at": min(g["index"] for g in mine), "imbued": gd.get("imbued")})
        r["_supportsOf"] = gd["slot"]
    for r in gem_rows:
        gd, md = r.get("guide"), r.get("mine")
        if gd and md and md.get("index"):
            if gd.get("enabled") is False:
                disable_groups.append(md["index"])
                continue
            want = {gem_key(z): z for z in gd["gems"] if on(z)}
            st = [{"name": z["name"], "level": want[gem_key(z)].get("level"), "quality": want[gem_key(z)].get("quality"),
                   "g1": want[gem_key(z)].get("g1"), "g2": want[gem_key(z)].get("g2")}
                  for z in md["gems"] if gem_key(z) in want]
            have = {gem_key(z) for z in md["gems"]}
            gem_req.append({"index": md["index"], "set": st, "slot": gd.get("slot") or "", "count": gd.get("count") or 1,
                            "imbued": gd.get("imbued") or "",
                            "disable": [z["name"] for z in md["gems"] if gem_key(z) not in want],
                            "add": [gem_spec(z) for k, z in want.items() if k not in have]})
        elif md and not gd and md.get("index") and md["index"] not in used_sup and not str(md.get("source") or "").startswith("Item:"):
            disable_groups.append(md["index"])
        elif gd and not md and not r.get("_supportsOf") and gd.get("enabled") is not False:
            gems = [gem_spec(z) for z in gd["gems"] if on(z)]
            if gems:
                new_groups.append({"slot": gd.get("slot"), "gems": gems, "imbued": gd.get("imbued"),
                                   "fromItem": str(gd.get("source") or "").startswith("Item:")})
    # étapes cumulées vers le guide (équipement, + arbre, + gemmes) : décomposition exacte de l'écart de DPS
    try:
        steps = HOST.call("stepsToGuide",
                          items=[{"slot": r["slot"], "raw": r["guide"]["raw"]} for r in slots if r.get("guide") and not r.get("sameRaw") and r["guide"].get("raw")]
                          + [{"slot": r["slot"], "clear": True} for r in slots if r.get("mine") and not r.get("guide")],
                          # sbires « arme seule » en dernier : si ton arme animée partage le jeu du Guardian,
                          # c'est l'arme animée du guide qui compte pour ses dégâts
                          minion=[{"setId": gd["mineSetId"], "slot": r["slot"], "raw": None if r["clear"] else r["guide"]["raw"], "clear": r["clear"]}
                                  for gd in sorted(guardian, key=lambda x: all(r["slot"].startswith("Weapon") for r in x["rows"]))
                                  if gd.get("mineSetId")
                                  # tes jeux de sbire sont vidés d'abord (minionClear) : on repose tout l'équipement du guide
                                  for r in gd["rows"] if (r.get("guide") or {}).get("raw")
                                  for r in [dict(r, clear=False)]],
                          spec=tree["guideSpec"] if M["tree"]["version"] == G["tree"]["version"] else None,
                          add=sorted(g_alloc - m_alloc), remove=sorted(m_alloc - g_alloc), groups=gem_req, disableGroups=disable_groups, newGroups=new_groups,
                          level=G["info"].get("level"), customMods=g_mods, clearParty=True,
                          choices={k: g_cfg.get(k) for k in ("bandit", "pantheonMajorGod", "pantheonMinorGod") if g_cfg.get(k) is not None},
                          minionClear=sorted({gd["mineSetId"] for gd in guardian if gd.get("mineSetId")}),
                          flasks={s["slot"]: bool(s.get("active")) for s in G["items"] if s["slot"].startswith("Flask") and s["slot"] in m_items})
    except Exception as e:  # noqa: BLE001
        log("stepsToGuide: %s" % e)
        steps = None

    # --- stats côte à côte (sur la liste de stats de PoB)
    g_stats = {s["key"]: s for s in G["stats"]}
    stats = []
    for s in M["stats"]:
        g = g_stats.pop(s["key"], None)
        stats.append({"key": s["key"], "label": s["label"], "fmt": s["fmt"], "pc": s.get("pc"), "mod": s.get("mod"),
                      "lower": s.get("lower"), "mine": s["value"], "guide": g["value"] if g else None})
    for k, g in g_stats.items():
        stats.append({"key": k, "label": g["label"], "fmt": g["fmt"], "pc": g.get("pc"), "mod": g.get("mod"),
                      "lower": g.get("lower"), "mine": None, "guide": g["value"]})
    # écart → gain mesuré par PoB si tu avais la valeur du guide (sur ton build, conditions de l'étape)
    try:
        sg = HOST.call("statGaps", rows=[{"key": x["key"], "guide": x["guide"]} for x in stats
                                          if x["mine"] is not None and x["guide"] is not None and not x.get("lower")])
        gaps = sg.get("gaps") or {}
        es_cap = sg.get("esCap") or None
    except Exception as e:  # noqa: BLE001 — la comparaison reste utile sans les gains
        print("[lucid] statGaps :", e)
        gaps, es_cap = {}, None
    if isinstance(gaps, list):
        gaps = {}
    for x in stats:
        if x["key"] in gaps:
            x["gain"] = gaps[x["key"]]
        if isinstance(m_why, dict) and isinstance(g_why, dict) and (x["key"] in m_why or x["key"] in g_why):
            x["why"] = True
    why = {k: {"mine": m_why.get(k) if isinstance(m_why, dict) else None, "guide": g_why.get(k) if isinstance(g_why, dict) else None}
           for k in set(list(m_why or {}) + list(g_why or {}))} if isinstance(m_why, dict) and isinstance(g_why, dict) else {}

    # --- recommandations : tout ce qui se mesure, trié
    recos = []
    for row in slots:
        h = row.get("head")
        if h:
            recos.append({"type": "item", "slot": row["slot"], "label": row["label"], "name": item_title(row["guide"]),
                          "from": item_title(row["mine"]) if row.get("mine") else None, "head": h})
    for g in guardian:
        for row in g["rows"]:
            if row.get("head"):
                recos.append({"type": "item", "slot": row["slot"], "label": row["label"], "name": item_title(row["guide"]),
                              "from": item_title(row["mine"]) if row.get("mine") else None, "head": row["head"], "guardian": True})
    for n in to_take:
        if n.get("head"):
            recos.append({"type": "node", "id": n["id"], "name": n["name"], "kind": n["kind"], "cost": n.get("cost"), "head": n["head"]})
    for r in gem_rows:
        for z in r["missing"]:
            recos.append({"type": "gem", "name": z["name"], "support": z["support"],
                          "group": (r["guide"]["gems"][0]["name"] if r["guide"] and r["guide"]["gems"] else None)})

    # --- linter : cohérence entre la config du guide, ton build réel et les stats PoB
    analysis = lint(guide_profile, {
        "items": [{"slot": r["slot"], "label": r["label"], "name": item_title(r["guide"]), "head": r["head"]}
                  for r in slots + [x for g in guardian for x in g["rows"]] if r.get("head") and r.get("guide")],
        "toTake": [{"name": n["name"], "kind": n["kind"], "head": n.get("head"), "cost": n.get("cost")} for n in to_take if n.get("head")],
    }, guide_meta(guide_id), active_step(G))

    return {
        "lint": analysis,
        "guide": {"id": guide_id, "info": G["info"], "key": G["key"], "stage": guide_stage, "sets": G["sets"]},
        "mine": {"id": mine_id, "info": M["info"], "key": M["key"], "stage": mine_stage, "sets": M["sets"]},
        "options": {"cfgSource": cfg_source, "fullDps": full_dps, "mineSets": mine_sets},
        # tes groupes de compétences actifs : choix de la compétence principale depuis la comparaison
        "mineSkills": [{"index": g.get("index"), "main": bool(g.get("main")),
                        "name": g.get("label") or next((x["name"] for x in as_list(g.get("gems")) if not x.get("support")), "?"),
                        "slot": g.get("slot"), "parts": g.get("parts"), "part": g.get("part")}
                       for g in as_list(M.get("skills")) if g.get("enabled") and any(not x.get("support") for x in as_list(g.get("gems")))],
        "dropped": [{k: d.get(k) for k in ("var", "label", "what", "guideSrc", "impact", "impactText")} for d in dropped],
        "simConfig": {
            "fullDps": g_full,
            "mineFullDps": [next((x["name"] for x in as_list(g.get("gems")) if not x.get("support")), "?")
                            for g in as_list(M.get("skills")) if g.get("includeInFullDPS") and g.get("enabled")],
            "applied": as_list(mine_conf.get("active")) + [x for x in as_list(mine_conf.get("key")) if x.get("value") not in (None, False, 0, "") and x.get("value") != x.get("default")],
            "choices": {k: [M["info"].get(k2), G["info"].get(k2)] for k, k2 in (("bandit", "bandit"), ("pantheonMajorGod", "pantheonMajor"), ("pantheonMinorGod", "pantheonMinor"))},
        },
        "dpsGap": dps_breakdown(M, G, slots + [x for gd in guardian for x in gd["rows"]], dropped, steps, gem_rows, g_mods, g_party),
        "stats": stats, "why": why, "esCap": es_cap, "items": slots, "guardian": guardian, "tree": tree, "gems": gem_rows, "recos": recos,
    }


# ---------------------------------------------------------------- HTTP
MIME = {".webp": "image/webp", ".jpg": "image/jpeg", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2"}


class Handler(BaseHTTPRequestHandler):
    server_version = "Lucid/" + APP_VERSION

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache=False):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=604800" if cache else "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def do_GET(self):
        path = urllib.parse.unquote(self.path.split("?")[0])
        if path.startswith("/art/") and path.endswith(".png"):
            try:
                data = ART.image(path[5:-4])
            except Exception:
                return self._send(404, {"error": "image indisponible"})
            return self._send(200, data, "image/png", cache=True)
        # fichiers de PoB : TreeData (images de l'arbre), Assets (cadres d'infobulles, portraits), polices bitmap
        m = re.match(r"^/(pobfile|pobasset|pobfont)/(.+)$", path)
        if m:
            if not HOST.engine:
                return self._send(503, {"error": "moteur non prêt"})
            kind, rest = m.group(1), m.group(2)
            if kind == "pobfont":
                try:
                    if rest == "meta.json":
                        return self._send(200, HOST.engine.fonts.meta(), cache=True)
                    fm = re.match(r"^([A-Z ]+)/(\d+)\.png$", rest)
                    return self._send(200, HOST.engine.fonts.atlas_png(fm.group(1), fm.group(2)), "image/png", cache=True)
                except Exception:
                    return self._send(404, {"error": "police introuvable"})
            if kind == "pobasset":
                rest = "Assets/" + rest
            if not re.match(r"^(TreeData|Assets)/", rest):
                return self._send(404, {"error": "not found"})
            root = os.path.normpath(HOST.engine.source)
            f = os.path.normpath(os.path.join(root, rest))
            if not f.startswith(root + os.sep) or not os.path.isfile(f):
                return self._send(404, {"error": "not found"})
            with open(f, "rb") as fh:
                return self._send(200, fh.read(), MIME.get(os.path.splitext(f)[1].lower(), "application/octet-stream"), cache=True)
        if path.startswith("/api/"):
            return self._api("GET", path[5:], {})
        if path == "/" or not os.path.splitext(path)[1]:
            path = "/index.html"
        f = os.path.normpath(os.path.join(WEB, path.lstrip("/")))
        if not f.startswith(WEB) or not os.path.isfile(f):
            return self._send(404, {"error": "not found"})
        with open(f, "rb") as fh:
            self._send(200, fh.read(), MIME.get(os.path.splitext(f)[1], "application/octet-stream"))

    def do_POST(self):
        path = self.path.split("?")[0]
        if not path.startswith("/api/"):
            return self._send(404, {"error": "not found"})
        # refuse les requêtes venant d'autres origines (le serveur n'écoute qu'en local)
        origin = self.headers.get("Origin")
        if origin and not re.match(r"^http://(127\.0\.0\.1|localhost):%d$" % PORT, origin):
            return self._send(403, {"error": "origine refusée"})
        try:
            body = self._body()
        except Exception:
            return self._send(400, {"error": "JSON invalide"})
        return self._api("POST", path[5:], body)

    def _api(self, method, route, b):
        try:
            res = route_api(method, route, b)
            self._send(200, res)
        except (ValueError, RuntimeError) as e:
            msg = str(e)
            log("API %s: %s" % (route, msg[:2000]))
            self._send(400, {"error": msg.split("\nstack traceback")[0][:600]})
        except Exception as e:
            log("API %s: %s" % (route, traceback.format_exc()))
            self._send(500, {"error": str(e)})


SNAPSHOT_ROUTES = {"open", "stage", "config", "mainSkill"}


ENGINE_FREE = {"status", "library", "meta", "sets", "matchStage", "guideMeta", "guideMetaSet", "clipboardItem"}


def route_api(method, route, b):
    # Le moteur PoB ne tient qu'un build à la fois. Une requête en plusieurs temps (ouvrir le guide, puis le perso,
    # puis lancer le linter…) doit garder le moteur pour elle seule jusqu'au bout : sinon une autre requête
    # (courbe des étapes, fiche…) recharge un autre build entre deux appels et les chiffres se mélangent.
    if route in ENGINE_FREE or route.startswith("poe/") or HOST is None:
        res = _route_api(method, route, b)
    else:
        with HOST.lock:
            res = _route_api(method, route, b)
    if ART:
        if route in SNAPSHOT_ROUTES:
            ART.enrich_snapshot(res)
        elif route == "testItem" and isinstance(res, dict) and res.get("item"):
            ART.decorate(res["item"])
    return res


def _route_api(method, route, b):
    if route == "status":
        return HOST.status()
    if route == "poe/status":
        return POE.status()
    if route == "poe/login":
        return POE.start_login()
    if route == "poe/logout":
        POE.logout()
        return POE.status()
    if route == "poe/characters":
        realm = b.get("realm") or "pc"
        try:
            chars = POE.characters(realm)
        except PermissionError as e:
            raise ValueError(str(e))
        known = {(v.get("poe") or {}).get("name"): k for k, v in load_meta()["builds"].items() if v.get("poe")}
        for c in chars:
            c["imported"] = known.get(c["name"])
        return {"characters": chars, "account": POE.tok.get("account")}
    if route == "poe/import":
        try:
            return import_character(b["name"], b.get("realm") or "pc")
        except PermissionError as e:
            raise ValueError(str(e))
    if route == "library":
        return {"builds": library(), "dir": builds_dir()}
    if route == "meta":
        meta = load_meta()
        m = meta["builds"].setdefault(b["id"], {})
        for k in ("role", "guide", "stage", "pinned", "cfgSource", "fullDps", "progress"):
            if k in b:
                if b[k] is None:
                    m.pop(k, None)
                else:
                    m[k] = b[k]
        save_meta(meta)
        return {"ok": True}
    if route == "import":
        return import_build(b.get("text"), b.get("name"), b.get("role"))
    if route == "rename":
        p = build_path(b["id"])
        new = os.path.join(os.path.dirname(p), safe_name(b["name"]) + ".xml")
        if os.path.exists(new):
            raise ValueError("Un build porte déjà ce nom")
        os.rename(p, new)
        meta = load_meta()
        new_id = os.path.relpath(new, builds_dir()).replace("\\", "/")
        if b["id"] in meta["builds"]:
            meta["builds"][new_id] = meta["builds"].pop(b["id"])
        for v in meta["builds"].values():
            if v.get("guide") == b["id"]:
                v["guide"] = new_id
        save_meta(meta)
        return {"id": new_id}
    if route == "open":
        snap = HOST.open(b["id"], b.get("stage"), force=b.get("force", False))
        meta = load_meta()
        m = meta["builds"].setdefault(b["id"], {})
        m["opened"] = time.time()
        k = snap.get("key") if isinstance(snap, dict) else None
        if isinstance(k, dict) and not b.get("cfg"):
            # stats calculées par le moteur (le XML de PoB peut être périmé ou sans Full DPS) : cartes de la bibliothèque
            m["kpi"] = {x: k.get(x) for x in ("GlobalDPS", "GlobalDPSSource", "FullDPS", "Life", "EnergyShield", "TotalEHP", "MinMaxHit", "MinMaxHitType") if k.get(x) is not None}
        save_meta(meta)
        return snap
    if route == "stage":
        return HOST.open(b["id"], match_stage(HOST.open(b["id"])["sets"], b["tree"]) if b.get("auto") else b.get("stage"))
    if route == "stageDiff":
        return stage_diff(b["id"], b.get("from"), b.get("to"))
    if route == "tradeLeagues":
        return {"leagues": trade_leagues()}
    if route == "trade":
        league = b.get("league") or trade_leagues()[0]
        return trade_searches(b["id"], b.get("stage"), b["slot"], b.get("guideRaw"), league)
    if route == "sets":
        return {"sets": xml_sets(b["id"])}
    if route == "clipboardWatch":
        return CLIP.set(b.get("on")) if CLIP else {"on": False}
    if route == "clipboardItem":
        return {"on": bool(CLIP and CLIP.on), "item": CLIP.item if CLIP and CLIP.on else None}
    if route == "lucidExport":
        return lucid_export(b["id"])
    if route == "lucidImport":
        return lucid_import(b.get("text") or "", b.get("name"))
    if route == "reimport":
        return update_guide(b["id"], b.get("text"))
    if route == "guideMetaReconcile":
        return reconcile_guide_meta(b["id"])
    if route == "guideMeta":
        return {"meta": guide_meta(b["id"])}
    if route == "guideMetaSet":
        # écriture partielle : chaque clé fournie remplace la précédente (null = supprimer)
        meta = load_meta()
        entry = meta["builds"].setdefault(b["id"], {})
        gm = dict(entry.get("guideMeta") or {})
        for k, v in (b.get("set") or {}).items():
            if v is None:
                gm.pop(k, None)
            else:
                gm[k] = v
        entry["guideMeta"] = gm
        save_meta(meta)
        _HEALTH_CACHE.clear()
        return {"meta": gm}
    if route == "health":
        return health(b["mine"], b.get("guide"), b.get("stage"), b.get("mineSets"), b.get("cfgSource") or "guide", b.get("fullDps") or "guide")
    if route == "buildSheet":
        return build_sheet(b["id"])
    if route == "stageCurve":
        return stage_curve(b["id"])
    if route == "matchStage":
        return match_stage(b["sets"], b["tree"])
    if route == "detectStage":
        mine_snap = normalize_snapshot(HOST.open(b["mine"], b.get("mineSets")))
        player_payload = {
            "level": (mine_snap.get("info") or {}).get("level", 1),
            "items": mine_snap.get("items") or [],
            "tree": mine_snap.get("tree") or {},
            "skills": mine_snap.get("skills") or [],
        }
        HOST.open(b["guide"])
        r = HOST.call("detectStage", player=player_payload)
        r["ranking"] = as_list(r.get("ranking"))
        return r
    if route == "config":
        HOST.open(b["id"], b.get("stage"))
        return HOST.mutate("setConfig", var=b["var"], value=b.get("value"))
    if route == "configList":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("config", focus=b.get("focus") or [])
    if route == "mainSkill":
        # mémorisé pour ce build (jamais écrit dans ton fichier PoB) : la comparaison recharge le fichier
        meta = load_meta()
        entry = meta["builds"].setdefault(b["id"], {})
        entry["mainPick"] = int(b["index"])
        entry["mainPart"] = int(b["part"]) if b.get("part") else None
        save_meta(meta)
        HOST.current = None
        return HOST.open(b["id"], b.get("stage"))
    if route == "itemTooltip":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("itemTooltip", slot=b.get("slot"), raw=b.get("raw"), noCompare=bool(b.get("noCompare")))
    if route == "gemTooltip":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("gemTooltip", group=int(b["group"]), gem=int(b["gem"]))
    if route == "treeScene":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("treeScene", compare=b.get("compare"))
    if route == "treeTooltip":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("treeTooltip", id=b["nodeId"], compare=b.get("compare"), vh=b.get("vh"))
    if route == "treeSearch":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("treeSearch", str=b.get("str") or "")
    if route == "testItem":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("testItem", raw=b["raw"], slot=b.get("slot"))
    if route == "itemValue":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("itemValue", slot=b["slot"])
    if route == "minionItem":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("testMinionItem", setId=b["setId"], slot=b["slot"], raw=b.get("raw"))
    if route == "nodeValues":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("nodeValues", ids=b["ids"], detail=bool(b.get("detail")))
    if route == "nodePower":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("nodePower", maxDepth=b.get("maxDepth") or 8)
    if route == "bestAnoints":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("bestAnoints", metric=b.get("metric") or "dps")
    if route == "treeEdit":
        # bac à sable : l'arbre modifié reste chargé (jamais écrit dans ton fichier) jusqu'à la sortie du bac à sable
        HOST.open(b["id"], b.get("stage"))
        r = HOST.call("treeEdit", id=b.get("id_node"), undo=bool(b.get("undo")))
        r["snapshot"] = HOST.mutate("snapshot")
        return r
    if route == "testNodes":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("testNodes", ids=b["ids"])
    if route == "explain":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("explainStats", keys=b.get("keys"))
    if route == "manaBudget":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("manaBudget")
    if route == "lint":
        HOST.open(b["id"], b.get("stage"))
        return lint()
    if route == "compare":
        return compare(b["guide"], b.get("stage"), b["mine"], b.get("mineSets"),
                       b.get("cfgSource") or "guide", b.get("fullDps") or "guide")
    if route == "code":
        HOST.open(b["id"], b.get("stage"))
        return HOST.call("encode")
    if route == "share":
        # comme le bouton « Share » de PoB : le code est publié sur pobb.in (lien public), sur demande explicite
        HOST.open(b["id"], b.get("stage"))
        code = HOST.call("encode")["code"]
        req = urllib.request.Request("https://pobb.in/pob/", data=code.encode("utf-8"), method="POST",
                                     headers={"User-Agent": UA, "Content-Type": "text/plain"})
        with urllib.request.urlopen(req, timeout=20) as r:
            out = r.read().decode("utf-8", "replace").strip()
        if not out or "<" in out or len(out) > 64:
            raise RuntimeError("pobb.in n'a pas renvoyé de lien")
        return {"url": "https://pobb.in/" + out}
    if route == "restart":
        HOST.restart()
        HOST.ready.wait(120)
        return HOST.status()
    if route == "launchPoB":
        exe = pob_exe()
        if not exe:
            raise ValueError("Path of Building introuvable")
        subprocess.Popen([exe], cwd=os.path.dirname(exe), close_fds=True)
        return {"ok": True}
    if route == "openFolder":
        os.startfile(builds_dir())
        return {"ok": True}
    raise ValueError("Route inconnue : " + route)


# ---------------------------------------------------------------- lancement
def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def open_window(url):
    """Fenêtre d'application (Edge/Chrome en mode --app), sinon navigateur par défaut."""
    candidates = [
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("ProgramFiles", ""), "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(os.environ.get("ProgramFiles", ""), "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
    ]
    profile = os.path.join(DATA, "window")
    for exe in candidates:
        if os.path.isfile(exe):
            try:
                subprocess.Popen([exe, "--app=" + url, "--user-data-dir=" + profile, "--window-size=1440,920",
                                  "--no-first-run", "--disable-features=Translate"], close_fds=True)
                return
            except OSError:
                pass
    webbrowser.open(url)


def main():
    global HOST
    url = "http://127.0.0.1:%d/" % PORT
    no_open = "--no-open" in sys.argv
    if port_in_use(PORT):
        log("Lucid tourne déjà : ouverture de la fenêtre")
        if not no_open:
            open_window(url)
        return
    HOST = EngineHost()
    global POE, ART, CLIP
    CLIP = ClipboardWatch()
    ART = art.ArtIndex(DATA, log=log)
    POE = poe_account.PoEAccount(DATA, lambda: (HOST.engine.info.get("version") if HOST.engine else None), log=log)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    log("Lucid %s sur %s" % (APP_VERSION, url))
    if not no_open:
        threading.Timer(0.3, open_window, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
