"""
Lucid — visuels du jeu.

Objets et gemmes : index « nom de base / unique / gemme → chemin d'image du jeu » construit une fois
depuis les données publiques RePoE, puis icônes officielles servies par le CDN de GGG
(web.poecdn.com) et gardées en cache dans %APPDATA%\\Lucid\\art.
"""
import json
import os
import re
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request

REPOE = "https://repoe-fork.github.io/"
CDN = "https://web.poecdn.com/image/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lucid"
INDEX_MAX_AGE = 14 * 24 * 3600
MAX_DOWNLOAD = 32 * 1024 * 1024  # index des icônes compris ; une icône fait quelques Ko
SAFE_ART = re.compile(r"^Art/[A-Za-z0-9_/ \-'().]+$")


def download(url, timeout=20):
    """GET binaire. Si OpenSSL (Python) refuse la chaîne de certificats alors que Windows l'accepte
    (cas de web.poecdn.com), on passe par curl.exe de Windows (Schannel, vérification conservée)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            # lecture bornée : une réponse anormale ne doit pas remplir la mémoire
            data = r.read(MAX_DOWNLOAD + 1)
            if len(data) > MAX_DOWNLOAD:
                raise ValueError("réponse trop grosse")
            return data
    except urllib.error.URLError as e:
        if not isinstance(getattr(e, "reason", None), ssl.SSLError):
            raise
    curl = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "curl.exe")
    if not os.path.isfile(curl):
        raise RuntimeError("certificat refusé et curl.exe indisponible")
    r = subprocess.run([curl, "-sSfL", "--max-time", str(timeout), "-A", UA, url],
                       capture_output=True, timeout=timeout + 5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise RuntimeError("téléchargement impossible (%s)" % r.stderr.decode("utf-8", "replace").strip()[:200])
    return r.stdout


# ------------------------------------------------------------------ objets & gemmes
class ArtIndex:
    def __init__(self, data_dir, log=print):
        self.dir = os.path.join(data_dir, "art")
        self.cache = os.path.join(self.dir, "game")
        os.makedirs(self.cache, exist_ok=True)
        self.game = None
        self.game_error = None
        self.version = "cdn"
        threading.Thread(target=self._open_game, daemon=True).start()
        self.file = os.path.join(self.dir, "index.json")
        self.log = log
        self.idx = None
        self.lock = threading.Lock()
        self.building = False
        try:
            with open(self.file, encoding="utf-8") as f:
                self.idx = json.load(f)
        except Exception:
            self.idx = None
        if not self.idx or self.idx.get("v") != 2 or time.time() - self.idx.get("built", 0) > INDEX_MAX_AGE:
            self.refresh()

    def _open_game(self):
        """Ouvre les fichiers du jeu (Bundles2). Après un patch du jeu, le cache d'icônes est vidé et ré-extrait."""
        import poe_files
        try:
            d = poe_files.find_game_dir()
            if not d:
                self.game_error = "Path of Exile introuvable"
                return
            idx = os.path.join(d, "Bundles2", "_.index.bin")
            # inclut la version de la composition des calques : un changement vide le cache d'icônes
            stamp = "%d:%d:c3" % (os.path.getmtime(idx), os.path.getsize(idx))
            marker = os.path.join(self.cache, ".game-version")
            try:
                old = open(marker, encoding="utf-8").read()
            except OSError:
                old = None
            if old != stamp:
                import shutil
                shutil.rmtree(self.cache, ignore_errors=True)
                os.makedirs(self.cache, exist_ok=True)
                with open(marker, "w", encoding="utf-8") as f:
                    f.write(stamp)
            self.game = poe_files.GameFiles(d)
            self.version = "g%08x" % (__import__("zlib").crc32(stamp.encode()) & 0xFFFFFFFF)    # change avec le jeu et la composition
            self.log("Fichiers du jeu ouverts : %s (%d fichiers)" % (d, len(self.game.files)))
        except Exception as e:
            self.game_error = str(e)
            self.log("Fichiers du jeu illisibles : %s" % e)

    def _fetch_json(self, name):
        req = urllib.request.Request(REPOE + name, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))

    def refresh(self):
        with self.lock:
            if self.building:
                return
            self.building = True
        threading.Thread(target=self._build, daemon=True).start()

    def _build(self):
        try:
            t = time.time()
            base = self._fetch_json("base_items.min.json")
            uniq = self._fetch_json("uniques.json")
            bases, gems_by_id, gems_by_name = {}, {}, {}
            for meta, v in base.items():
                vi = (v.get("visual_identity") or {}).get("dds_file")
                name = v.get("name")
                if not vi or not name:
                    continue
                path = vi[:-4] if vi.endswith(".dds") else vi
                cls = v.get("item_class") or ""
                if "Skill Gem" in cls:
                    gems_by_id[meta] = path
                    gems_by_name.setdefault(name.lower(), path)
                    if name.endswith(" Support"):
                        gems_by_name.setdefault(name[:-8].lower(), path)
                elif v.get("release_state") != "unreleased":
                    if name not in bases or v.get("release_state") == "released":
                        bases[name] = path
            uniques = {}
            for v in (uniq.values() if isinstance(uniq, dict) else uniq):
                vi = (v.get("visual_identity") or {}).get("dds_file")
                if vi and v.get("name") and not v.get("is_alternate_art") and vi.startswith("Art/2DItems/"):
                    uniques.setdefault(v["name"], vi[:-4] if vi.endswith(".dds") else vi)
            idx = {"v": 2, "built": time.time(), "bases": bases, "uniques": uniques, "gemsById": gems_by_id, "gems": gems_by_name}
            tmp = self.file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(idx, f)
            os.replace(tmp, self.file)
            self.idx = idx
            self.log("Index des visuels prêt (%d bases, %d uniques, %d gemmes) en %.1fs"
                     % (len(bases), len(uniques), len(gems_by_id), time.time() - t))
        except Exception as e:
            self.log("Index des visuels indisponible : %s" % e)
        finally:
            self.building = False

    # -------------------------------------------------------------- recherche
    def url(self, path):
        # version dans l'URL : le navigateur ne réutilise jamais une ancienne image (ex. anciennes bandes non composées)
        return "/art/" + path + ".png?v=" + self.version if path else None

    def item_icon(self, it):
        if not it or not self.idx:
            return None
        title = it.get("title") or ""
        if it.get("rarity") in ("UNIQUE", "RELIC"):
            # comme Redux : l'art de l'unique (Foulborn compris), sinon celui de la base
            for t in (title, re.sub(r"^Foulborn ", "", title)):
                p = self.idx["uniques"].get(t)
                if p and self.has(p):
                    return self.url(p)
        base = re.sub(r"\s*\([^)]*\)\s*$", "", it.get("base") or "")  # « Two-Stone Ring (Fire/Lightning) »
        p = self.idx["bases"].get(base)
        if not p:
            # « Synthesised … », « Foulborn … », etc.
            for pre in ("Synthesised ", "Foulborn ", "Replica "):
                if base.startswith(pre):
                    p = self.idx["bases"].get(base[len(pre):])
            if not p and title in self.idx["uniques"]:
                p = self.idx["uniques"][title]
        return self.url(p)

    def has(self, path):
        """L'image existe-t-elle dans les fichiers du jeu ? (sans jeu installé : on suppose que oui)"""
        if not self.game:
            return True
        return self.game.hash(path + ".dds") in self.game.files

    def decorate(self, it):
        it["icon"] = self.item_icon(it)
        return it

    def gem_icon(self, g):
        if not g or not self.idx:
            return None
        p = self.idx["gemsById"].get(g.get("gameId") or "")
        if not p:
            n = (g.get("name") or "").lower()
            p = self.idx["gems"].get(n) or self.idx["gems"].get(re.sub(r" of .*$", "", n)) or self.idx["gems"].get(re.sub(r"^vaal ", "", n))
        return self.url(p)

    def enrich_snapshot(self, snap):
        if not isinstance(snap, dict):
            return snap
        for s in snap.get("items") or []:
            if s.get("item"):
                self.decorate(s["item"])
        for g in snap.get("minionGear") or []:
            for s in g.get("slots") or []:
                if s.get("item"):
                    self.decorate(s["item"])
        for grp in snap.get("skills") or []:
            for g in grp.get("gems") or []:
                g["icon"] = self.gem_icon(g)
        return snap

    # -------------------------------------------------------------- images
    def image(self, path):
        """Icône du jeu en PNG : extraite des fichiers de Path of Exile (Bundles2, DDS), calques des flasques et
        gemmes composés comme en jeu, puis mise en cache. Sans jeu installé : repli sur le CDN de GGG."""
        if not SAFE_ART.match(path) or ".." in path:
            raise ValueError("chemin d'image invalide")
        local = os.path.join(self.cache, path.replace("/", os.sep) + ".png")
        if os.path.isfile(local):
            with open(local, "rb") as f:
                return f.read()
        if self.game:
            import poe_files
            raw = self.game.read(path + ".dds")
            if raw is None:
                raise ValueError("image absente des fichiers du jeu")
            w, h, rgba = poe_files.dds_to_rgba(raw)
            w, h, rgba = poe_files.compose_layers(path, w, h, rgba)
            data = poe_files.png(w, h, rgba)
        else:
            data = download(CDN + urllib.request.quote(path) + ".png?scale=1")
            if not data.startswith(bytes([0x89]) + b"PNG"):
                raise ValueError("image invalide")
        os.makedirs(os.path.dirname(local), exist_ok=True)
        # fichier temporaire propre au thread : le navigateur demande souvent la même icône plusieurs fois en parallèle
        tmp = "%s.%d.tmp" % (local, threading.get_ident())
        with open(tmp, "wb") as f:
            f.write(data)
        try:
            os.replace(tmp, local)
        except OSError:
            # un autre thread vient d'écrire la même icône (Windows refuse de remplacer un fichier ouvert)
            try:
                os.remove(tmp)
            except OSError:
                pass
        return data
