// Lucid — bibliothèque native minimale pour lire les fichiers du jeu (comme le font les outils d'extraction PoE).
//  - lucid_oodle : décompression Oodle (Kraken/Mermaid/Selkie/Leviathan) via ooz (powzix/ooz, code libre)
//  - lucid_bc    : décodage des textures DDS compressées BC1-BC7 en RGBA via bcdec (iOrange/bcdec)
#include "stdafx.h"

int Kraken_Decompress(const byte *src, size_t src_len, byte *dst, size_t dst_len);

#define BCDEC_IMPLEMENTATION
#include "bcdec.h"

extern "C" __declspec(dllexport) int lucid_oodle(const byte *src, size_t src_len, byte *dst, size_t dst_len) {
  return Kraken_Decompress(src, src_len, dst, dst_len);
}

// fmt : 1=BC1, 2=BC2, 3=BC3, 4=BC4, 5=BC5, 7=BC7. Sortie : RGBA8, w*h*4 octets.
extern "C" __declspec(dllexport) int lucid_bc(int fmt, const byte *src, size_t src_len, int w, int h, byte *out) {
  const int bs = (fmt == 1 || fmt == 4) ? 8 : 16;
  const int bw = (w + 3) / 4, bh = (h + 3) / 4;
  if ((size_t)bw * bh * bs > src_len) return -1;
  unsigned char tmp[4 * 4 * 4];
  unsigned char r8[16], rg[32];
  for (int by = 0; by < bh; by++) {
    for (int bx = 0; bx < bw; bx++) {
      const byte *blk = src + ((size_t)by * bw + bx) * bs;
      switch (fmt) {
        case 1: bcdec_bc1(blk, tmp, 16); break;
        case 2: bcdec_bc2(blk, tmp, 16); break;
        case 3: bcdec_bc3(blk, tmp, 16); break;
        case 7: bcdec_bc7(blk, tmp, 16); break;
        case 4:
          bcdec_bc4(blk, r8, 4);
          for (int i = 0; i < 16; i++) { tmp[i*4] = tmp[i*4+1] = tmp[i*4+2] = r8[i]; tmp[i*4+3] = 255; }
          break;
        case 5:
          bcdec_bc5(blk, rg, 8);
          for (int i = 0; i < 16; i++) { tmp[i*4] = rg[i*2]; tmp[i*4+1] = rg[i*2+1]; tmp[i*4+2] = 0; tmp[i*4+3] = 255; }
          break;
        default: return -2;
      }
      for (int y = 0; y < 4; y++) {
        int py = by * 4 + y; if (py >= h) break;
        for (int x = 0; x < 4; x++) {
          int px = bx * 4 + x; if (px >= w) break;
          memcpy(out + ((size_t)py * w + px) * 4, tmp + (y * 4 + x) * 4, 4);
        }
      }
    }
  }
  return 0;
}
