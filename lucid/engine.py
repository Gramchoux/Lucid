"""
Lucid — hôte du moteur Path of Building.

Charge le runtime LuaJIT livré avec Path of Building Community (lua51.dll) via ctypes
et exécute le code de l'installation PoB (mise à jour par PoB lui-même). Aucune autre dépendance.
"""
import ctypes
import json
import os
import re
import struct
import threading
import time
import zlib
from ctypes import c_char_p, c_double, c_int, c_size_t, c_void_p, POINTER

LUA_GLOBALSINDEX = -10002
HERE = os.path.dirname(os.path.abspath(__file__))

APPDATA = os.environ.get("APPDATA", "")
LOCALAPPDATA = os.environ.get("LOCALAPPDATA", "")
DOCUMENTS = os.path.join(os.environ.get("USERPROFILE", ""), "Documents")

POB_COMMUNITY = os.path.join(APPDATA, "Path of Building Community")
LUCID_DATA = os.path.join(APPDATA, "Lucid")


def find_runtime():
    """Dossier contenant lua51.dll + modules natifs (lua-utf8, lzip…)."""
    candidates = [os.environ.get("LUCID_RUNTIME"), POB_COMMUNITY]
    for c in candidates:
        if c and os.path.isfile(os.path.join(c, "lua51.dll")):
            return c
    raise RuntimeError(
        "Runtime introuvable : installez Path of Building Community "
        "(lua51.dll attendu dans %APPDATA%\\Path of Building Community)."
    )


def _manifest_version(path):
    """Version déclarée dans manifest.xml (<Version number="2.69.0" …>)."""
    try:
        with open(os.path.join(path, "manifest.xml"), encoding="utf-8", errors="replace") as f:
            m = re.search(r'<Version\b[^>]*\bnumber="([0-9.]+)"', f.read(4096))
        return m.group(1) if m else None
    except OSError:
        return None


def _vkey(v):
    try:
        return tuple(int(x) for x in (v or "0").split("."))
    except ValueError:
        return (0,)


def pob_sources(game="poe1"):
    """Installation Path of Building Community (mise à jour par son propre updater)."""
    c = POB_COMMUNITY
    if os.path.isfile(os.path.join(c, "Launch.lua")) and os.path.isdir(os.path.join(c, "Modules")):
        return [source_info(c)]
    return []


def find_pob_source(game="poe1"):
    """Source PoB : l'installation Path of Building Community (ou LUCID_POB_SOURCE)."""
    forced = os.environ.get("LUCID_POB_SOURCE")
    if forced and os.path.isfile(os.path.join(forced, "Launch.lua")):
        return forced
    srcs = pob_sources(game)
    if not srcs:
        raise RuntimeError("Path of Building Community introuvable (dossier %APPDATA%, Path of Building Community).")
    return srcs[0]["path"]


def source_info(path):
    info = {"path": path, "origin": "Path of Building", "version": _manifest_version(path)}
    try:
        info["synced"] = int(os.path.getmtime(os.path.join(path, "manifest.xml")))
    except OSError:
        pass
    return info


def read_image_size(path):
    """Dimensions d'une image PNG / JPEG / WebP (en-tête seulement)."""
    try:
        with open(path, "rb") as f:
            head = f.read(64)
            if head[:4] == bytes([0x89, 0x50, 0x4E, 0x47]):
                return struct.unpack(">II", head[16:24])
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                if head[12:16] == b"VP8X":
                    return 1 + int.from_bytes(head[24:27], "little"), 1 + int.from_bytes(head[27:30], "little")
                if head[12:16] == b"VP8L":
                    v = int.from_bytes(head[21:25], "little")
                    return (v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1
                if head[12:16] == b"VP8 ":
                    return struct.unpack("<H", head[26:28])[0] & 0x3FFF, struct.unpack("<H", head[28:30])[0] & 0x3FFF
            if head[:2] == bytes([0xFF, 0xD8]):
                f.seek(2)
                while True:
                    m = f.read(2)
                    if len(m) < 2 or m[0] != 0xFF:
                        return None
                    if m[1] in (0xC0, 0xC1, 0xC2):
                        f.read(3)
                        h, w = struct.unpack(">HH", f.read(4))
                        return w, h
                    (ln,) = struct.unpack(">H", f.read(2))
                    f.seek(ln - 2, 1)
    except OSError:
        return None
    return None


LuaCFunction = ctypes.CFUNCTYPE(ctypes.c_longlong, c_void_p)


class LuaEngine:
    def __init__(self, game="poe1", log=print):
        self.log = log
        self.game = game
        self.runtime = find_runtime()
        self.source = find_pob_source(game)
        self.info = source_info(self.source)
        self.lock = threading.RLock()
        self._t0 = time.time()
        self._keep = []  # garde les callbacks en vie
        self._load_dll()
        self._boot()

    # ------------------------------------------------------------------ C API
    def _load_dll(self):
        os.add_dll_directory(self.runtime)
        os.environ["PATH"] = self.runtime + os.pathsep + os.environ.get("PATH", "")
        d = ctypes.CDLL(os.path.join(self.runtime, "lua51.dll"))
        self.dll = d
        sig = {
            "luaL_newstate": (c_void_p, []),
            "luaL_openlibs": (None, [c_void_p]),
            "luaL_loadbuffer": (c_int, [c_void_p, c_char_p, c_size_t, c_char_p]),
            "lua_pcall": (c_int, [c_void_p, c_int, c_int, c_int]),
            "lua_tolstring": (c_void_p, [c_void_p, c_int, POINTER(c_size_t)]),
            "lua_pushlstring": (None, [c_void_p, c_char_p, c_size_t]),
            "lua_pushnil": (None, [c_void_p]),
            "lua_pushnumber": (None, [c_void_p, c_double]),
            "lua_pushboolean": (None, [c_void_p, c_int]),
            "lua_tonumber": (c_double, [c_void_p, c_int]),
            "lua_toboolean": (c_int, [c_void_p, c_int]),
            "lua_type": (c_int, [c_void_p, c_int]),
            "lua_pushcclosure": (None, [c_void_p, LuaCFunction, c_int]),
            "lua_setfield": (None, [c_void_p, c_int, c_char_p]),
            "lua_getfield": (None, [c_void_p, c_int, c_char_p]),
            "lua_settop": (None, [c_void_p, c_int]),
            "lua_gettop": (c_int, [c_void_p]),
            "lua_close": (None, [c_void_p]),
        }
        for name, (res, args) in sig.items():
            f = getattr(d, name)
            f.restype = res
            f.argtypes = args
        self.L = d.luaL_newstate()
        d.luaL_openlibs(self.L)

    def _tostring(self, idx):
        n = c_size_t()
        p = self.dll.lua_tolstring(self.L, idx, ctypes.byref(n))
        if not p:
            return None
        return ctypes.string_at(p, n.value)

    def _push(self, b):
        if b is None:
            self.dll.lua_pushnil(self.L)
        else:
            if isinstance(b, str):
                b = b.encode("utf-8")
            self.dll.lua_pushlstring(self.L, b, len(b))

    def _register(self, name, pyfunc):
        """Expose une fonction Python à Lua : pyfunc(args: list[bytes|None]) -> bytes|str|None|number|bool"""
        dll = self.dll

        def cfunc(L):
            try:
                n = dll.lua_gettop(L)
                args = []
                for i in range(1, n + 1):
                    t = dll.lua_type(L, i)
                    if t == 4:  # string
                        args.append(self._tostring(i))
                    elif t == 3:
                        args.append(dll.lua_tonumber(L, i))
                    elif t == 1:
                        args.append(bool(dll.lua_toboolean(L, i)))
                    else:
                        args.append(None)
                r = pyfunc(args)
                if isinstance(r, bool):
                    dll.lua_pushboolean(L, 1 if r else 0)
                elif isinstance(r, (int, float)):
                    dll.lua_pushnumber(L, float(r))
                else:
                    self._push(r)
                return 1
            except Exception as e:  # ne jamais propager une exception Python dans le C
                self.log("[host] %s: %r" % (name, e))
                dll.lua_pushnil(L)
                return 1

        cb = LuaCFunction(cfunc)
        self._keep.append(cb)
        dll.lua_pushcclosure(self.L, cb, 0)
        dll.lua_setfield(self.L, LUA_GLOBALSINDEX, name.encode())

    def _set_global_str(self, name, value):
        self._push(value)
        self.dll.lua_setfield(self.L, LUA_GLOBALSINDEX, name.encode())

    def run(self, code, chunkname="lucid"):
        """Exécute un bloc Lua ; lève RuntimeError avec le message Lua en cas d'erreur."""
        if isinstance(code, str):
            code = code.encode("utf-8")
        with self.lock:
            top = self.dll.lua_gettop(self.L)
            st = self.dll.luaL_loadbuffer(self.L, code, len(code), ("=" + chunkname).encode())
            if st == 0:
                st = self.dll.lua_pcall(self.L, 0, 1, 0)
            res = self._tostring(-1)
            self.dll.lua_settop(self.L, top)
            if st != 0:
                raise RuntimeError((res or b"?").decode("utf-8", "replace"))
            return res

    # ---------------------------------------------------------------- boot
    def _boot(self):
        def inflate(a):
            data = a[0] or b""
            for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS, zlib.MAX_WBITS | 32):
                try:
                    return zlib.decompress(data, wbits)
                except zlib.error:
                    continue
            return None

        def deflate(a):
            return zlib.compress(a[0] or b"", 9)

        def list_dir(a):
            pattern = (a[0] or b"").decode("utf-8", "replace")
            dirs_only = bool(a[1]) if len(a) > 1 else False
            folder, mask = os.path.split(pattern.replace("\\", "/"))
            import fnmatch
            out = []
            try:
                for e in os.scandir(folder or "."):
                    if e.name in (".", ".."):
                        continue
                    if dirs_only != e.is_dir():
                        continue
                    if fnmatch.fnmatch(e.name, mask or "*"):
                        st = e.stat()
                        out.append({"name": e.name, "size": st.st_size, "mtime": st.st_mtime})
            except OSError:
                pass
            return json.dumps(out)

        def make_dir(a):
            os.makedirs((a[0] or b"").decode("utf-8", "replace"), exist_ok=True)
            return True

        def con_print(a):
            msg = (a[0] or b"").decode("utf-8", "replace")
            if msg.strip():
                self.log("[pob] " + msg)
            return None

        self._register("Inflate", inflate)
        self._register("Deflate", deflate)
        self._register("GetTime", lambda a: int((time.time() - self._t0) * 1000))
        self._register("__ListDir", list_dir)
        self._register("MakeDir", make_dir)
        self._register("__Print", con_print)

        def image_size(a):
            path = (a[0] or b"").decode("utf-8", "replace")
            wh = read_image_size(path)
            return "%d,%d" % wh if wh else None

        self._register("__ImageSize", image_size)

        import pob_fonts
        self.fonts = pob_fonts.PobFonts(self.runtime)

        def string_width(a):
            h = a[0] if isinstance(a[0], float) else 14.0
            font = (a[1] or b"VAR").decode("utf-8", "replace")
            text = (a[2] or b"").decode("utf-8", "replace")
            return self.fonts.width(h, font, text)

        self._register("__StringWidth", string_width)
        self._set_global_str("__LUCID_LUA", os.path.join(HERE, "lua").replace("\\", "/"))

        user = os.path.join(LUCID_DATA, "pob-user")
        os.makedirs(os.path.join(user, "Path of Building", "Builds"), exist_ok=True)
        self._set_global_str("__SCRIPT_PATH", self.source.replace("\\", "/"))
        self._set_global_str("__RUNTIME_PATH", self.runtime.replace("\\", "/"))
        self._set_global_str("__USER_PATH", user.replace("\\", "/") + "/")
        cache = os.path.join(LUCID_DATA, "timeless-cache")
        os.makedirs(cache, exist_ok=True)
        tdirs = [cache, os.path.join(self.source, "Data", "TimelessJewelData")]
        self._set_global_str("__TIMELESS_DIRS", ";".join(d.replace("\\", "/") for d in tdirs if os.path.isdir(d)))

        os.chdir(self.source)  # PoB s'appuie sur des chemins relatifs
        t = time.time()
        with open(os.path.join(HERE, "lua", "host.lua"), "rb") as f:
            self.run(f.read(), "host.lua")
        with open(os.path.join(HERE, "lua", "bridge.lua"), "rb") as f:
            self.run(f.read(), "bridge.lua")
        with open(os.path.join(HERE, "lua", "treescene.lua"), "rb") as f:
            self.run(f.read(), "treescene.lua")
        with open(os.path.join(HERE, "lua", "linter.lua"), "rb") as f:
            self.run(f.read(), "linter.lua")
        with open(os.path.join(HERE, "lua", "trade.lua"), "rb") as f:
            self.run(f.read(), "trade.lua")
        with open(os.path.join(HERE, "lua", "insight.lua"), "rb") as f:
            self.run(f.read(), "insight.lua")
        self.log("[lucid] moteur PoB %s (%s) prêt en %.1fs"
                 % (self.info.get("version", "?"), self.info["origin"], time.time() - t))

    def close(self):
        with self.lock:
            if self.L:
                self.dll.lua_close(self.L)
                self.L = None
            self._keep.clear()  # callbacks ctypes : inutiles une fois l'état Lua fermé

    # ----------------------------------------------------------------- API
    def call(self, cmd, **args):
        with self.lock:
            self._set_global_str("__ARGS", json.dumps(args))
            res = self.run("return Bridge.dispatch(%s, __ARGS)" % json.dumps(cmd), "call:" + cmd)
        out = json.loads(res.decode("utf-8", "replace"))
        if isinstance(out, dict) and out.get("__error"):
            raise RuntimeError(out["__error"])
        return out
