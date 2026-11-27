"""
Lucid — lecture des fichiers de Path of Exile (Bundles2), comme les outils d'extraction de la communauté.

  index  : Bundles2/_.index.bin  (liste des bundles, table « hash du chemin → bundle, offset, taille »)
  bundle : en-tête + blocs compressés en Oodle (décompressés par lucidnative.dll / ooz)
  images : fichiers .dds (BC1-BC7 ou RGBA) décodés en PNG

Rien n'est écrit dans le dossier du jeu.
"""
import ctypes
import os
import re
import struct
import threading
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
_native = None


def native():
    global _native
    if _native is None:
        d = ctypes.CDLL(os.path.join(HERE, "native", "lucidnative.dll"))
        d.lucid_oodle.restype = ctypes.c_int
        d.lucid_oodle.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t]
        d.lucid_bc.restype = ctypes.c_int
        d.lucid_bc.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
        _native = d
    return _native


def find_game_dir():
    """Dossier d'installation de Path of Exile 1 (Steam ou client autonome)."""
    cands = [os.environ.get("LUCID_POE_DIR")]
    steam = r"C:\Program Files (x86)\Steam"
    libs = [steam]
    vdf = os.path.join(steam, "steamapps", "libraryfolders.vdf")
    try:
        with open(vdf, encoding="utf-8", errors="replace") as f:
            libs += [p.replace("\\\\", "\\") for p in re.findall(r'"path"\s+"([^"]+)"', f.read())]
    except OSError:
        pass
    cands += [os.path.join(l, "steamapps", "common", "Path of Exile") for l in libs]
    cands += [r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile", r"C:\Program Files\Grinding Gear Games\Path of Exile"]
    for c in cands:
        if c and os.path.isfile(os.path.join(c, "Bundles2", "_.index.bin")):
            return c
    return None


# ------------------------------------------------------------------ hachage des chemins (PoE 3.21.2+)
M64 = 0xFFFFFFFFFFFFFFFF


def murmur64a(data, seed=0x1337B33F):
    m, r = 0xC6A4A7935BD1E995, 47
    h = (seed ^ (len(data) * m)) & M64
    n = len(data) // 8
    for i in range(n):
        k = struct.unpack_from("<Q", data, i * 8)[0]
        k = (k * m) & M64
        k ^= k >> r
        k = (k * m) & M64
        h ^= k
        h = (h * m) & M64
    tail = data[n * 8:]
    if tail:
        h ^= int.from_bytes(tail, "little")
        h = (h * m) & M64
    h ^= h >> r
    h = (h * m) & M64
    h ^= h >> r
    return h


def fnv1a64(data):
    h = 0xCBF29CE484222325
    for b in data:
        h ^= b
        h = (h * 0x100000001B3) & M64
    return h


# ------------------------------------------------------------------ bundles
def decompress_bundle(raw):
    """Format bundle : [u32 taille, u32 taille payload, u32 taille en-tête] + en-tête + blocs Oodle."""
    (uncompressed_size, total_payload, head_size) = struct.unpack_from("<III", raw, 0)
    p = 12
    first_file_encode, _unk, unc64, pay64, block_count, granularity = struct.unpack_from("<IIQQII", raw, p)
    p += 4 + 4 + 8 + 8 + 4 + 4 + 16
    sizes = struct.unpack_from("<%dI" % block_count, raw, p)
    p += 4 * block_count
    out = bytearray(unc64)
    lib = native()
    pos = 0
    buf = (ctypes.c_char * (granularity + 64))()
    for i, sz in enumerate(sizes):
        dst_len = min(granularity, unc64 - pos)
        n = lib.lucid_oodle(raw[p:p + sz], sz, buf, dst_len)
        if n != dst_len:
            raise RuntimeError("décompression Oodle échouée (bloc %d)" % i)
        out[pos:pos + dst_len] = buf.raw[:dst_len]
        pos += dst_len
        p += sz
    return bytes(out)


class GameFiles:
    def __init__(self, game_dir):
        self.dir = game_dir
        self.b2 = os.path.join(game_dir, "Bundles2")
        self.lock = threading.Lock()
        self.cache = {}  # nom de bundle → données (petit cache)
        idx = decompress_bundle(open(os.path.join(self.b2, "_.index.bin"), "rb").read())
        p = 0
        (n,) = struct.unpack_from("<I", idx, p); p += 4
        self.bundles = []
        for _ in range(n):
            (ln,) = struct.unpack_from("<I", idx, p); p += 4
            name = idx[p:p + ln].decode("utf-8"); p += ln
            p += 4  # taille décompressée
            self.bundles.append(name)
        (n,) = struct.unpack_from("<I", idx, p); p += 4
        self.files = {}
        for _ in range(n):
            h, bi, off, size = struct.unpack_from("<QIII", idx, p); p += 20
            self.files[h] = (bi, off, size)
        self.hash = self._detect_hash(idx, p)

    def _detect_hash(self, idx, p):
        """Le jeu a changé de fonction de hachage (FNV1a → MurmurHash64A) : on teste sur un chemin connu."""
        probe = "art/2ditems/currency/currencyrerollrare.dds"
        if murmur64a(probe.encode()) in self.files:
            return lambda path: murmur64a(path.lower().encode())
        if fnv1a64((probe + "++").encode()) in self.files or fnv1a64(("Art/2DItems/Currency/CurrencyRerollRare.dds++").encode()) in self.files:
            return lambda path: fnv1a64((path + "++").encode())
        return lambda path: murmur64a(path.lower().encode())

    def _bundle(self, i):
        name = self.bundles[i]
        data = self.cache.get(name)
        if data is None:
            with open(os.path.join(self.b2, name + ".bundle.bin"), "rb") as f:
                data = decompress_bundle(f.read())
            if len(self.cache) > 24:
                self.cache.pop(next(iter(self.cache)))
            self.cache[name] = data
        return data

    def read(self, path, _depth=0):
        """Contenu d'un fichier du jeu (ou None)."""
        e = self.files.get(self.hash(path))
        if not e:
            return None
        bi, off, size = e
        with self.lock:
            data = self._bundle(bi)[off:off + size]
        # certains .dds ne contiennent qu'un renvoi « *Chemin/vers/autre.dds »
        if data[:1] == b"*" and _depth < 3:
            return self.read(data[1:].decode("utf-8", "replace").strip(), _depth + 1)
        return data


# ------------------------------------------------------------------ DDS → PNG
def dds_to_rgba(data):
    if data[:4] != b"DDS ":
        raise ValueError("pas un fichier DDS")
    h, w = struct.unpack_from("<II", data, 12)
    pf_flags, fourcc, rgb_bits, rmask, gmask, bmask, amask = struct.unpack_from("<I4sIIIII", data, 80)
    off = 128
    fmt = None
    if fourcc == b"DX10":
        (dxgi,) = struct.unpack_from("<I", data, 128)
        off = 148
        fmt = {71: 1, 72: 1, 74: 2, 75: 2, 77: 3, 78: 3, 80: 4, 83: 5, 98: 7, 99: 7, 28: "rgba", 29: "rgba", 87: "bgra", 91: "bgra"}.get(dxgi)
    elif fourcc in (b"DXT1",):
        fmt = 1
    elif fourcc in (b"DXT2", b"DXT3"):
        fmt = 2
    elif fourcc in (b"DXT4", b"DXT5"):
        fmt = 3
    elif fourcc in (b"ATI1", b"BC4U"):
        fmt = 4
    elif fourcc in (b"ATI2", b"BC5U"):
        fmt = 5
    elif pf_flags & 0x40 and rgb_bits == 32:
        fmt = "bgra" if rmask == 0x00FF0000 else "rgba"
    if fmt is None:
        raise ValueError("format DDS non géré (%r)" % fourcc)
    px = data[off:]
    if fmt == "rgba":
        return w, h, px[:w * h * 4]
    if fmt == "bgra":
        a = bytearray(px[:w * h * 4])
        a[0::4], a[2::4] = a[2::4], a[0::4]
        return w, h, bytes(a)
    out = (ctypes.c_ubyte * (w * h * 4))()
    if native().lucid_bc(fmt, px, len(px), w, h, out) != 0:
        raise ValueError("décodage BC%s échoué" % fmt)
    return w, h, bytes(out)


def png(w, h, rgba):
    raw = b"".join(b"\x00" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


# ------------------------------------------------------------------ calques (flasques, gemmes)
def _crop(w, h, rgba, x0, fw):
    rows = [rgba[(y * w + x0) * 4:(y * w + x0 + fw) * 4] for y in range(h)]
    return bytearray(b"".join(rows))


def _over(dst, src):
    """Composition alpha « source over » sur deux tampons RGBA de même taille."""
    for i in range(0, len(dst), 4):
        sa = src[i + 3]
        if sa == 0:
            continue
        if sa == 255:
            dst[i:i + 4] = src[i:i + 4]
            continue
        da = dst[i + 3]
        oa = sa + da * (255 - sa) // 255
        if oa == 0:
            continue
        for c in range(3):
            dst[i + c] = (src[i + c] * sa + dst[i + c] * da * (255 - sa) // 255) // oa
        dst[i + 3] = oa


def compose_layers(path, w, h, rgba):
    """Les icônes de flasques et de gemmes sont des bandes de 3 calques que le jeu superpose :
    flasque = liquide (3) derrière, bouteille en verre translucide (1), puis cadre avant (2) ;
    gemme = pierre (3) + sertissage (1)."""
    p = path.replace("\\", "/").lower()
    if w < 2 * h and "/flasks/" not in p:
        return w, h, rgba
    fw = w // 3
    if fw <= 0:
        return w, h, rgba
    layers = [_crop(w, h, rgba, i * fw, fw) for i in range(3)]
    if "/flasks/" in p:
        order = (2, 0, 1)
    elif "/gems/" in p:
        order = (2, 0)
    else:
        return w, h, rgba
    out = bytearray(fw * h * 4)
    for i in order:
        _over(out, layers[i])
    return fw, h, bytes(out)
