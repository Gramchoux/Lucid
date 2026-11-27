"""
Lucid — polices bitmap de Path of Building (SimpleGraphic/Fonts : atlas .tga + métriques .tgf).
Utilisées telles quelles : mêmes glyphes, mêmes largeurs que dans PoB.
"""
import os
import re
import struct
import zlib

FONT_FILES = {
    "VAR": "Liberation Sans", "VAR BOLD": "Liberation Sans Bold", "FIXED": "Bitstream Vera Sans Mono",
    "FONTIN": "Fontin", "FONTIN ITALIC": "Fontin Italic",
    "FONTIN SC": "Fontin SmallCaps", "FONTIN SC ITALIC": "Fontin SmallCaps Italic",
}
ESC = re.compile(r"\^x[0-9A-Fa-f]{6}|\^[0-9]")


class PobFonts:
    def __init__(self, pob_dir):
        self.dir = os.path.join(pob_dir, "SimpleGraphic", "Fonts")
        self.fonts = {}  # nom PoB → { hauteur: [(x, y, w, sl, sr) × 256] }
        for key, name in FONT_FILES.items():
            path = os.path.join(self.dir, name + ".tgf")
            if os.path.isfile(path):
                self.fonts[key] = self._parse_tgf(path)

    @staticmethod
    def _parse_tgf(path):
        sizes, cur = {}, None
        with open(path, encoding="latin-1") as f:
            for line in f:
                m = re.match(r"\s*HEIGHT\s+(\d+)", line)
                if m:
                    cur = sizes.setdefault(int(m.group(1)), [])
                    continue
                m = re.match(r"\s*GLYPH\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)", line)
                if m and cur is not None:
                    cur.append(tuple(int(v) for v in m.groups()))
        return sizes

    def pick(self, font, height):
        """Taille d'atlas utilisée pour une hauteur demandée (la plus grande ≤ hauteur, sinon la plus petite)."""
        sizes = sorted(self.fonts.get(font) or self.fonts.get("VAR") or {})
        if not sizes:
            return None
        best = sizes[0]
        for s in sizes:
            if s <= height:
                best = s
        return best

    def width(self, height, font, text):
        f = self.fonts.get(font) or self.fonts.get("VAR")
        if not f or not text:
            return 0
        size = self.pick(font if font in self.fonts else "VAR", height)
        glyphs = f[size]
        scale = height / size
        widest = 0
        for line in ESC.sub("", text).split("\n"):
            w = 0
            for ch in line.encode("latin-1", "replace"):
                if ch < len(glyphs):
                    g = glyphs[ch]
                    w += g[2] + g[3] + g[4]
            widest = max(widest, w)
        return widest * scale

    def meta(self):
        """Métriques pour le navigateur : { police: { taille: [[x,y,w,sl,sr]…] } }."""
        return {k: {str(h): g for h, g in v.items()} for k, v in self.fonts.items()}

    def atlas_png(self, font, size):
        name = FONT_FILES.get(font)
        if not name:
            raise ValueError("police inconnue")
        path = os.path.join(self.dir, "%s.%d.tga" % (name, int(size)))
        with open(path, "rb") as f:
            return tga_to_png(f.read())


def tga_to_png(data):
    idlen, cmtype, itype, cmfirst, cmlen, cmbits, xo, yo, w, h, bpp, desc = struct.unpack_from("<BBBHHBHHHHBB", data, 0)
    p = 18 + idlen + cmlen * ((cmbits + 7) // 8)
    px = bytearray()
    bpp_b = bpp // 8
    n = w * h
    if itype in (2, 3):
        px = bytearray(data[p:p + n * bpp_b])
    elif itype in (10, 11):
        while len(px) < n * bpp_b:
            hdr = data[p]; p += 1
            cnt = (hdr & 0x7F) + 1
            if hdr & 0x80:
                px += data[p:p + bpp_b] * cnt
                p += bpp_b
            else:
                px += data[p:p + cnt * bpp_b]
                p += cnt * bpp_b
    else:
        raise ValueError("TGA type %d non géré" % itype)
    rgba = bytearray(n * 4)
    for i in range(n):
        if bpp_b == 4:
            b, g, r, a = px[i * 4:i * 4 + 4]
        elif bpp_b == 3:
            b, g, r = px[i * 3:i * 3 + 3]; a = 255
        else:  # niveaux de gris → blanc avec alpha
            v = px[i]; r = g = b = 255; a = v
        rgba[i * 4:i * 4 + 4] = bytes((r, g, b, a))
    if not desc & 0x20:  # origine en bas : on retourne l'image
        rows = [rgba[y * w * 4:(y + 1) * w * 4] for y in range(h)]
        rgba = b"".join(reversed(rows))
    raw = b"".join(b"\x00" + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (bytes([0x89]) + b"PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
