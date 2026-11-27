"""
Lucid — connexion au compte Path of Exile (API officielle de GGG), comme le fait Path of Building.

Flux identique à PoB (Classes/PoEAPI.lua + LaunchServer.lua) :
  1. OAuth 2 avec PKCE sur www.pathofexile.com, client public « pob », retour sur http://localhost:49082-49084
  2. l'utilisateur se connecte lui-même sur le site de GGG (Lucid ne voit jamais le mot de passe)
  3. jetons conservés (chiffrés avec DPAPI) dans %APPDATA%\\Lucid\\poe_auth.json, renouvelés automatiquement
  4. api.pathofexile.com/character et /character/<nom> → JSON importé par le code d'import de PoB
"""
import base64
import ctypes
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

CLIENT_ID = "pob"
SCOPES = ["account:profile", "account:leagues", "account:characters"]
PORTS = (49082, 49083, 49084)
AUTH_URL = "https://www.pathofexile.com/oauth/authorize"
TOKEN_URL = "https://www.pathofexile.com/oauth/token"
API = "https://api.pathofexile.com"
REALMS = {"pc": "PC", "xbox": "Xbox", "sony": "PlayStation"}


# ---------------------------------------------------------------- DPAPI (Windows, sans dépendance)
class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data, protect):
    """Chiffre / déchiffre avec la clé du compte Windows courant. None hors Windows ou en cas d'échec."""
    if os.name != "nt":
        return None
    try:
        crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
        buf = ctypes.create_string_buffer(data, len(data))
        src, out = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), _Blob()
        fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
        if not fn(ctypes.byref(src), None, None, None, None, 0x1, ctypes.byref(out)):  # 0x1 : sans interface
            return None
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            kernel32.LocalFree(out.pbData)
    except Exception:
        return None


def _b64url(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


class PoEAccount:
    def __init__(self, data_dir, version_fn, log=print):
        self.file = os.path.join(data_dir, "poe_auth.json")
        self.version_fn = version_fn
        self.log = log
        self.lock = threading.RLock()
        self.pending = None  # état d'une connexion en cours
        self.tok = self._load()

    # ------------------------------------------------------------- stockage
    def _load(self):
        # jetons chiffrés avec DPAPI : seul ton compte Windows peut les relire
        try:
            with open(self.file, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            return {}
        if isinstance(d, dict) and "dpapi" in d:
            raw = _dpapi(base64.b64decode(d["dpapi"]), protect=False)
            try:
                return json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                return {}
        # ancien fichier en clair : réécrit chiffré
        if isinstance(d, dict) and d:
            self.tok = d
            try:
                self._save()
            except Exception:
                pass
            return d
        return {}

    def _save(self):
        raw = json.dumps(self.tok).encode("utf-8")
        enc = _dpapi(raw, protect=True)
        body = {"dpapi": base64.b64encode(enc).decode()} if enc else self.tok
        tmp = self.file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(body, f)
        os.replace(tmp, self.file)

    def logout(self):
        with self.lock:
            self.tok = {}
            try:
                os.remove(self.file)
            except OSError:
                pass

    # ------------------------------------------------------------- HTTP
    def _ua(self):
        return "Path of Building/%s (Lucid)" % (self.version_fn() or "2")

    def _post_form(self, url, fields):
        data = urllib.parse.urlencode(fields).encode()
        req = urllib.request.Request(url, data=data, headers={
            "User-Agent": self._ua(), "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))

    def _store_token(self, r):
        self.tok = {
            "access_token": r["access_token"],
            "refresh_token": r.get("refresh_token") or self.tok.get("refresh_token"),
            "expiry": time.time() + int(r.get("expires_in") or 3600) - 60,
            "account": self.tok.get("account"),
        }
        self._save()

    def _valid_token(self):
        with self.lock:
            if not self.tok.get("access_token"):
                raise PermissionError("Non connecté au compte Path of Exile")
            if time.time() >= self.tok.get("expiry", 0):
                if not self.tok.get("refresh_token"):
                    self.logout()
                    raise PermissionError("Session expirée : reconnecte-toi")
                try:
                    r = self._post_form(TOKEN_URL, {"client_id": CLIENT_ID, "grant_type": "refresh_token",
                                                    "refresh_token": self.tok["refresh_token"]})
                    self._store_token(r)
                except Exception as e:
                    self.logout()
                    raise PermissionError("Session expirée (%s) : reconnecte-toi" % e)
            return self.tok["access_token"]

    def get(self, path, _retry=True):
        token = self._valid_token()
        req = urllib.request.Request(API + path, headers={"User-Agent": self._ua(), "Authorization": "Bearer " + token})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 401 and _retry:
                with self.lock:
                    self.tok["expiry"] = 0
                return self.get(path, _retry=False)
            if e.code == 429:
                wait = int(e.headers.get("Retry-After") or 10)
                if _retry and wait <= 30:
                    self.log("API GGG : limite atteinte, attente %ds" % wait)
                    time.sleep(wait + 1)
                    return self.get(path, _retry=False)
                raise RuntimeError("Trop de requêtes vers GGG, réessaie dans %d s" % wait)
            if e.code == 404:
                raise RuntimeError("Personnage introuvable (ou profil privé)")
            raise RuntimeError("API GGG : erreur %d" % e.code)

    # ------------------------------------------------------------- connexion
    def status(self):
        p = self.pending
        return {
            "connected": bool(self.tok.get("access_token")),
            "account": self.tok.get("account"),
            "pending": bool(p and not p.get("done")),
            "error": p.get("error") if p else None,
            "url": p.get("url") if p and not p.get("done") else None,
        }

    def start_login(self):
        """Ouvre la page de connexion GGG et attend le retour sur localhost (comme LaunchServer.lua)."""
        with self.lock:
            if self.pending and not self.pending.get("done"):
                return self.status()
            verifier = _b64url(secrets.token_bytes(32))
            challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
            state = secrets.token_hex(8)
            srv = None
            for port in PORTS:
                try:
                    srv = HTTPServer(("127.0.0.1", port), _CallbackHandler)
                    break
                except OSError:
                    continue
            if not srv:
                raise RuntimeError("Ports 49082-49084 occupés (PoB est peut-être en train de se connecter) : ferme-le et réessaie")
            redirect = "http://localhost:%d" % port
            url = "%s?%s" % (AUTH_URL, urllib.parse.urlencode({
                "client_id": CLIENT_ID, "response_type": "code", "scope": " ".join(SCOPES),
                "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
                "redirect_uri": redirect}, quote_via=urllib.parse.quote))
            self.pending = {"url": url, "done": False, "error": None}
            srv.result = None
            srv.timeout = 1
            threading.Thread(target=self._wait_callback, args=(srv, state, verifier, redirect), daemon=True).start()
        webbrowser.open(url)
        return self.status()

    def _wait_callback(self, srv, state, verifier, redirect):
        p = self.pending
        try:
            deadline = time.time() + 180
            while time.time() < deadline and srv.result is None:
                srv.handle_request()
            res = srv.result
            if res is None:
                raise RuntimeError("Délai dépassé : la connexion n'a pas été finalisée")
            if res.get("error"):
                raise RuntimeError("Connexion refusée : %s" % res.get("error_description", res["error"]))
            if res.get("state") != state:
                raise RuntimeError("Réponse OAuth invalide (state)")
            r = self._post_form(TOKEN_URL, {
                "client_id": CLIENT_ID, "grant_type": "authorization_code", "code": res["code"],
                "redirect_uri": redirect, "scope": " ".join(SCOPES), "code_verifier": verifier})
            with self.lock:
                self._store_token(r)
            try:
                prof = self.get("/profile")
                with self.lock:
                    self.tok["account"] = prof.get("name")
                    self._save()
            except Exception as e:
                self.log("profil : %s" % e)
            self.log("Compte Path of Exile connecté")
        except Exception as e:
            p["error"] = str(e)
            self.log("Connexion PoE : %s" % e)
        finally:
            p["done"] = True
            srv.server_close()

    # ------------------------------------------------------------- personnages
    def characters(self, realm="pc"):
        path = "/character" + ("" if realm == "pc" else "/" + realm)
        r = self.get(path)
        out = []
        for c in r.get("characters", []):
            out.append({"name": c.get("name"), "class": c.get("class"), "level": c.get("level"),
                        "league": c.get("league"), "realm": c.get("realm", realm), "current": c.get("current", False),
                        "id": c.get("id")})
        return out

    def character(self, name, realm="pc"):
        path = "/character" + ("" if realm == "pc" else "/" + realm) + "/" + urllib.parse.quote(name)
        r = self.get(path)
        if not r.get("character"):
            raise RuntimeError("Réponse GGG sans personnage")
        return r["character"]


class _CallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if not q.get("code") and not q.get("error"):
            self.send_response(404)
            self.end_headers()
            return
        self.server.result = {k: v[0] for k, v in q.items()}
        ok = "code" in q
        body = ("""<!doctype html><html lang="fr"><meta charset="utf-8"><title>Lucid</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;font:15px 'Segoe UI',system-ui;background:#f5f5f3;color:#16171a">
<div style="text-align:center"><div style="width:28px;height:28px;border-radius:8px;background:#4b45d6;margin:0 auto 14px"></div>
<h2 style="margin:0 0 6px;font-weight:600">%s</h2><p style="color:#7a7e86;margin:0">%s</p></div>
<script>setTimeout(()=>window.close(),1500)</script></body></html>""" % (
            ("Compte connecté", "Tu peux fermer cet onglet et revenir dans Lucid.") if ok else
            ("Connexion annulée", "Reviens dans Lucid pour réessayer."))).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
