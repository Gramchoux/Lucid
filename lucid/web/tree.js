// Lucid — tree.js : Arbre passif : PassiveTreeView de PoB porté en JavaScript (PobTree) et SimpleGraphic sur WebGL2 (SGL).

// ------------------------------------------------------------------ ARBRE : PassiveTreeView:Draw de PoB, porté en JavaScript (classe PobTree)
// Données de dessin préparées par PoB (treeScene), infobulles produites et dessinées par PoB (treeTooltip).
// PobGfx / renderPobList / drawPobText rejouent les listes d'affichage de PoB (infobulles) comme SimpleGraphic.
const PobGfx = {
  imgs: new Map(), tinted: new Map(), fonts: null, atlases: new Map(),
  image(path, onload) {
    let im = this.imgs.get(path);
    if (!im) {
      im = new Image();
      im.onload = () => { im.ok = true; onload && onload(); };
      im.src = "/pobfile/" + path.split("/").map(encodeURIComponent).join("/");
      this.imgs.set(path, im);
    }
    return im.ok ? im : null;
  },
  // SetDrawColor de PoB multiplie la texture par la couleur : copie teintée, mise en cache par couleur
  tint(key, im, ck, r, g, b) {
    if (r >= 0.999 && g >= 0.999 && b >= 0.999) return im;
    const k = key + "|" + ck;
    let c = this.tinted.get(k);
    if (!c) {
      c = document.createElement("canvas");
      c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
      const x = c.getContext("2d");
      x.drawImage(im, 0, 0);
      x.globalCompositeOperation = "multiply";
      x.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
      x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = "destination-in";
      x.drawImage(im, 0, 0);
      if (this.tinted.size > 600) this.tinted.clear();
      this.tinted.set(k, c);
    }
    return c;
  },
  async loadFonts() {
    if (!this.fonts) this.fonts = fetch("/pobfont/meta.json").then((r) => r.json()).catch(() => ({}));
    return this.fonts;
  },
  atlas(font, size, onload) {
    const k = font + "/" + size;
    let im = this.atlases.get(k);
    if (!im) {
      im = new Image();
      im.onload = () => { im.ok = true; onload && onload(); };
      im.src = "/pobfont/" + encodeURIComponent(font) + "/" + size + ".png";
      this.atlases.set(k, im);
    }
    return im.ok ? im : null;
  },
};
const GFX_DIGITS = { 0: [0, 0, 0], 1: [1, 0, 0], 2: [0, 1, 0], 3: [0, 0, 1], 4: [1, 1, 0], 5: [1, 0, 1], 6: [0, 1, 1], 7: [1, 1, 1], 8: [0.7, 0.7, 0.7], 9: [0.4, 0.4, 0.4] };
const pickSize = (sizes, h) => { let s = sizes[0]; for (const v of sizes) if (v <= h) s = v; return s; };

// Rendu d'une liste d'affichage PoB dans un canvas (taille CSS w×h, échelle ds = pixels réels par pixel PoB)
function renderPobList(ctx, dl, w, h, ds, fontMeta, redraw, at) {
  if (at) {
    ctx.setTransform(ds, 0, 0, ds, at[0] * ds, at[1] * ds);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(ds, 0, 0, ds, 0, 0);
  }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  const paths = {};
  let cr = 1, cg = 1, cb = 1, ca = 1, ck = "1,1,1", vp = [0, 0, w, h], clipped = false;
  let p = 0;
  const n = dl.length;
  while (p < n) {
    let e = dl.indexOf("\n", p); if (e < 0) e = n;
    const ln = dl.slice(p, e); p = e + 1;
    const t = ln.charCodeAt(0);
    if (t === 73 || t === 81) {                                   // I / Q : images
      const v = ln.split(",");
      const id = v[1];
      if (t === 73 && id === "0") {                               // rectangle uni
        ctx.globalAlpha = ca; ctx.fillStyle = `rgb(${cr * 255},${cg * 255},${cb * 255})`;
        ctx.fillRect(+v[2], +v[3], +v[4], +v[5]); ctx.globalAlpha = 1; continue;
      }
      const im = PobGfx.image(paths[id], redraw); if (!im) continue;
      const src = PobGfx.tint(paths[id], im, ck, cr, cg, cb);
      const W = im.naturalWidth, H = im.naturalHeight;
      ctx.globalAlpha = ca;
      if (t === 73) {
        const x = +v[2], y = +v[3], w2 = +v[4], h2 = +v[5], s1 = +v[6], t1 = +v[7], s2 = +v[8], t2 = +v[9];
        if (s1 < 0 || t1 < 0 || s2 > 1.0001 || t2 > 1.0001) {      // texture répétée (fond de l'arbre)
          const pat = ctx.createPattern(src, "repeat");
          const kx = w2 / ((s2 - s1) * W), ky = h2 / ((t2 - t1) * H);
          pat.setTransform(new DOMMatrix([kx, 0, 0, ky, x - s1 * W * kx, y - t1 * H * ky]));
          ctx.fillStyle = pat; ctx.fillRect(x, y, w2, h2);
        } else {
          const sw = (s2 - s1) * W, sh = (t2 - t1) * H;
          if (sw < 0 || sh < 0) {                                  // texture retournée
            ctx.save(); ctx.translate(x + (sw < 0 ? w2 : 0), y + (sh < 0 ? h2 : 0)); ctx.scale(sw < 0 ? -1 : 1, sh < 0 ? -1 : 1);
            ctx.drawImage(src, Math.min(s1, s2) * W, Math.min(t1, t2) * H, Math.abs(sw), Math.abs(sh), 0, 0, w2, h2);
            ctx.restore();
          } else if (sw > 0 && sh > 0) ctx.drawImage(src, s1 * W, t1 * H, sw, sh, x, y, w2, h2);
        }
      } else {
        // quad (lignes, orbites, images tournées) : transformation affine de la zone de texture, sans découpage
        const x1 = +v[2], y1 = +v[3], x2 = +v[4], y2 = +v[5], x4 = +v[8], y4 = +v[9];
        const u1 = +v[10] * W, w1 = +v[11] * H, u2 = +v[12] * W, w2v = +v[13] * H, u3 = +v[14] * W, w3 = +v[15] * H, u4 = +v[16] * W, w4 = +v[17] * H;
        const m = affine([u1, w1], [u2, w2v], [u4, w4], [x1, y1], [x2, y2], [x4, y4]);
        if (!m) { ctx.globalAlpha = 1; continue; }
        const ua = Math.min(u1, u2, u3, u4), ub = Math.max(u1, u2, u3, u4), va = Math.min(w1, w2v, w3, w4), vb = Math.max(w1, w2v, w3, w4);
        if (ub > ua && vb > va) {
          ctx.save();
          ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);   // relatif à la transformation courante (décalage inclus)
          ctx.drawImage(src, ua, va, ub - ua, vb - va, ua, va, ub - ua, vb - va);
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
      continue;
    }
    if (t === 80) { const i = ln.indexOf(",", 2); paths[ln.slice(2, i)] = ln.slice(i + 1); continue; }
    if (t === 67) { const v = ln.split(","); cr = +v[1]; cg = +v[2]; cb = +v[3]; ca = +v[4]; ck = v[1] + "," + v[2] + "," + v[3]; continue; }
    if (t === 86) {
      const v = ln.split(",").map(Number);
      vp = v[3] > 0 ? [v[1], v[2], v[3], v[4]] : [0, 0, w, h];
      if (clipped) { ctx.restore(); clipped = false; }
      if (v[3] > 0 && v[4] > 0) { ctx.save(); ctx.beginPath(); ctx.rect(v[1], v[2], v[3], v[4]); ctx.clip(); clipped = true; }
      continue;
    }
    if (t === 84) {
      let q = 2; const f = [];
      for (let k = 0; k < 5; k++) { const i = ln.indexOf(",", q); f.push(ln.slice(q, i)); q = i + 1; }
      drawPobText(ctx, +f[0], +f[1], f[2], +f[3], f[4], ln.slice(q).replace(/\\n/g, "\n"), cr, cg, cb, ca, vp, ds, fontMeta, redraw);
    }
  }
  if (clipped) ctx.restore();
}

// DrawString de SimpleGraphic : mise en page avec les métriques de la taille demandée (comme PoB),
// glyphes pris dans l'atlas correspondant à la taille réelle à l'écran (net, sans agrandissement).
function drawPobText(ctx, x, y, align, height, font, str, cr, cg, cb, ca, vp, ds, fontMeta, redraw) {
  if (!fontMeta || !str) return;
  const fname = fontMeta[font] ? font : "VAR";
  const meta = fontMeta[fname]; if (!meta) return;
  const sizes = meta._sizes || (meta._sizes = Object.keys(meta).filter((k) => k !== "_sizes").map(Number).sort((a, b) => a - b));
  // Comme SimpleGraphic : les glyphes sont dessinés pixel pour pixel, dans la taille de police PoB la plus
  // proche de la hauteur réelle à l'écran (jamais rééchantillonnés, donc nets).
  const M = ctx.getTransform();
  const sc = M.a || 1;
  const dh = height * sc;
  const rsize = pickSize(sizes, dh * 1.06);
  const rg = meta[String(rsize)];
  const atlas = PobGfx.atlas(fname, rsize, redraw); if (!atlas || !rg) return;
  const dx = (v) => M.a * v + M.e, dy = (v) => M.d * v + M.f;
  let cy = dy(y);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = ca;
  for (const line of str.split("\n")) {
    const segs = []; let cur = [cr, cg, cb], last = 0, m; const re = /\^x([0-9A-Fa-f]{6})|\^([0-9])/g;
    while ((m = re.exec(line))) {
      if (m.index > last) segs.push([cur, line.slice(last, m.index)]);
      cur = m[1] ? [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255] : GFX_DIGITS[m[2]];
      last = re.lastIndex;
    }
    if (last < line.length) segs.push([cur, line.slice(last)]);
    let width = 0;
    for (const s of segs) for (const ch of s[1]) { const g = rg[Math.min(255, ch.charCodeAt(0))]; if (g) width += g[2] + g[3] + g[4]; }
    let px;
    if (align === "CENTER_X") px = dx(x) - width / 2;
    else if (align === "RIGHT_X") px = dx(x) - width;
    else if (align === "CENTER") px = dx(x + vp[2] / 2) - width / 2;
    else if (align === "RIGHT") px = dx(vp[0] + vp[2] - (x - vp[0])) - width;
    else px = dx(x);
    px = Math.round(px);
    const py = Math.round(cy + (dh - rsize) / 2);
    for (const [c, s] of segs) {
      const src = PobGfx.tint("font:" + fname + rsize, atlas, c.join(","), c[0], c[1], c[2]);
      for (const ch of s) {
        const g = rg[Math.min(255, ch.charCodeAt(0))]; if (!g) continue;
        px += g[3];
        if (g[2] > 0) ctx.drawImage(src, g[0], g[1], g[2], rsize, px, py, g[2], rsize);
        px += g[2] + g[4];
      }
    }
    cy += dh;
  }
  ctx.restore();
}

// ------------------------------------------------------------------ SimpleGraphic sur la carte graphique (WebGL2)
// Mêmes primitives que le moteur de PoB : quads texturés, coordonnées de texture par sommet (répétées au-delà
// de [0,1]), couleur de SetDrawColor multipliée à la texture, filtrage linéaire sans mipmaps (comme PoB).
class SGL {
  constructor(canvas) {
    const gl = this.gl = canvas.getContext("webgl2", { alpha: false, antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 indisponible sur cet ordinateur");
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, `#version 300 es
      in vec2 aPos; in vec2 aUV; in vec4 aCol; uniform vec2 uView; out vec2 vUV; out vec4 vCol;
      void main() { vUV = aUV; vCol = aCol; gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0); }`));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; uniform sampler2D uTex; in vec2 vUV; in vec4 vCol; out vec4 o;
      void main() { o = texture(uTex, vUV) * vCol; }`));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    this.uView = gl.getUniformLocation(p, "uView");
    this.cap = 16384;                                       // quads par lot
    this.data = new Float32Array(this.cap * 6 * 8);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = 8 * 4;
    for (const [name, size, off] of [["aPos", 2, 0], ["aUV", 2, 8], ["aCol", 4, 16]]) {
      const loc = gl.getAttribLocation(p, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);           // textures en alpha prémultiplié
    this.textures = new Map();
    this.white = this.makeTexture(null);
    this.n = 0; this.cur = null;
  }
  makeTexture(img) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  // libère les textures et le contexte (le navigateur limite le nombre de contextes WebGL actifs)
  destroy() {
    const gl = this.gl;
    if (!gl) return;
    for (const e of this.textures.values()) if (e.tex) gl.deleteTexture(e.tex);
    this.textures.clear();
    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
    this.gl = null;
  }
  // texture d'un fichier de PoB (chargée une fois) : { tex, w, h } ou null tant qu'elle charge
  texture(path, onload) {
    let e = this.textures.get(path);
    if (!e) {
      e = { tex: null };
      this.textures.set(path, e);
      const im = new Image();
      im.onload = () => { e.tex = this.makeTexture(im); e.w = im.naturalWidth; e.h = im.naturalHeight; onload && onload(); };
      im.src = "/pobfile/" + path.split("/").map(encodeURIComponent).join("/");
    }
    return e.tex ? e : null;
  }
  begin(w, h, dpr) {
    const gl = this.gl, c = gl.canvas;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uView, w, h);
    this.n = 0; this.cur = null;
  }
  // DrawImageQuad : 4 sommets (x,y) et 4 coordonnées de texture (s,t), couleur multipliée
  quad(tex, x1, y1, x2, y2, x3, y3, x4, y4, s1, t1, s2, t2, s3, t3, s4, t4, r, g, b, a) {
    if (tex !== this.cur || this.n >= this.cap) { this.flush(); this.cur = tex; }
    const d = this.data; let o = this.n * 48;
    const pr = r * a, pg = g * a, pb = b * a;
    const v = (x, y, s, t) => { d[o++] = x; d[o++] = y; d[o++] = s; d[o++] = t; d[o++] = pr; d[o++] = pg; d[o++] = pb; d[o++] = a; };
    v(x1, y1, s1, t1); v(x2, y2, s2, t2); v(x3, y3, s3, t3);
    v(x1, y1, s1, t1); v(x3, y3, s3, t3); v(x4, y4, s4, t4);
    this.n++;
  }
  // DrawImage : rectangle (coordonnées de texture s1,t1 → s2,t2)
  rect(tex, x, y, w, h, s1, t1, s2, t2, r, g, b, a) {
    this.quad(tex, x, y, x + w, y, x + w, y + h, x, y + h, s1, t1, s2, t1, s2, t2, s1, t2, r, g, b, a);
  }
  flush() {
    if (!this.n) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.cur);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * 48), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, this.n * 6);
    this.n = 0;
  }
}

class PobTree {
  constructor(host, opts) {
    this.host = host; this.opts = opts; this.alive = true;
    PobTree.live.add(this);
    window.__lucidTree = this;   // inspection depuis la console
    host.classList.add("game");
    if (opts.mini) host.classList.add("mini");   // vignette : ni recherche, ni zoom, ni glisser
    host.innerHTML = `<canvas class="gl"></canvas><canvas class="ov" tabindex="0"></canvas>
      <div class="tree-tools">${opts.search !== false ? `<input class="input" placeholder="Rechercher (comme dans PoB)…" spellcheck="false">` : ""}</div>
      <div class="tree-zoom"><button data-z="in" title="Zoom avant">+</button><button data-z="out" title="Zoom arrière">−</button></div>
      <div class="tree-hint">Molette : zoom · glisser : déplacer${opts.preview ? " · clic sur un nœud : ce qu'il rapporte" : ""} · Ctrl : cacher l'infobulle</div>
      <div class="loading tree-loading"><div class="spinner"></div>Chargement de l'arbre de PoB…</div>`;
    this.cv = $("canvas.ov", host);                    // calque 2D : événements, infobulles, textes
    this.ctx = this.cv.getContext("2d");
    this.gl = new SGL($("canvas.gl", host));          // carte graphique : tout le reste de l'arbre
    this.cursor = [-1, -1]; this.down = false; this.dragX = null; this.dragging = false;
    this.hoverNode = null; this.tip = null; this.tipFor = null;
    this.search = new Set();
    this.bind();
    new ResizeObserver(() => { if (this.opts.mini && this.s) this.fitAscendancy(); this.invalidate(); }).observe(host);
    Promise.all([api("treeScene", Object.assign({ compare: opts.compare || null }, opts.target())), PobGfx.loadFonts()]).then(([scene, fonts]) => {
      this.fontMeta = fonts;
      this.load(scene);
      $(".tree-loading", host)?.remove();
    }).catch((e) => { const l = $(".tree-loading", host); if (l) l.textContent = e.message; });
  }
  load(s, keepView) {
    this.s = s;
    this.assets = s.assets;
    if (!keepView) {
      this.zoomLevel = s.view.zoomLevel; this.zoom = 1.2 ** this.zoomLevel;
      this.zoomX = s.view.zoomX || 0; this.zoomY = s.view.zoomY || 0;
    }
    this.byId = new Map(s.nodes.map((n) => [n.id, n]));
    for (const n of s.nodes) { n._path = n.path ? new Set(n.path) : null; }
    this.invalidate();
    if (this.opts.onLoad && !keepView) setTimeout(() => this.alive && this.opts.onLoad(this), 0);
  }
  // Cadre la vue sur des nœuds (différences d'une étape) : boîte englobante + marge
  fitNodes(ids, margin = 0.8) {
    const pts = (ids || []).map((i) => this.byId && this.byId.get(i)).filter(Boolean);
    if (!pts.length) return false;
    const xs = pts.map((n) => n.x), ys = pts.map((n) => n.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const r = this.cv.getBoundingClientRect();
    const m = Math.min(r.width, r.height) || 1;
    const pad = 900;   // au moins un groupe de passifs autour, pour voir d'où part le chemin
    const scale = margin * Math.min(r.width / (x1 - x0 + pad), r.height / (y1 - y0 + pad));
    this.zoom = scale * this.s.size / m;
    this.zoomLevel = Math.log(this.zoom) / Math.log(1.2);
    this.zoomX = -((x0 + x1) / 2) * scale; this.zoomY = -((y0 + y1) / 2) * scale;
    this.invalidate();
    return true;
  }
  // Cadre la vue sur l'ascendance du build (le cercle de PoB, avec son illustration et ses nœuds)
  fitAscendancy(margin = 0.86) {
    const s = this.s; if (!s) return false;
    const ids = new Set();
    for (const c of s.connectors) if (c[5] && c[5] === s.curAsc) { ids.add(c[0]); ids.add(c[1]); }
    const pts = [...ids].map((i) => this.byId.get(i)).filter(Boolean);
    if (!pts.length) return false;
    // comme dans PoB : le cercle d'ascendance est centré sur le nœud de départ de l'ascendance (le doré)
    const start = pts.find((n) => n.t === "AscendClassStart");
    const xs = pts.map((n) => n.x), ys = pts.map((n) => n.y);
    const cx = start ? start.x : (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = start ? start.y : (Math.min(...ys) + Math.max(...ys)) / 2;
    const reach = Math.max(...pts.map((n) => Math.hypot(n.x - cx, n.y - cy)));
    // l'illustration déborde un peu des nœuds : rayon visible = nœud le plus éloigné + marge
    const span = 2 * (reach * 1.18 + 120);
    const r = this.cv.getBoundingClientRect();
    const m = Math.min(r.width, r.height) || 1;
    const scale = m * margin / span;
    this.zoom = scale * s.size / m;
    this.zoomLevel = Math.log(this.zoom) / Math.log(1.2);
    this.zoomX = -cx * scale; this.zoomY = -cy * scale;
    this.fixed = true;
    this.invalidate();
    return true;
  }
  // Icône d'un nœud (illustration + cadre, état « pris ») dessinée dans un canvas 2D, découpée dans les atlas de PoB
  async nodeIcon(nodeId, canvas) {
    const n = this.byId && this.byId.get(nodeId); if (!n || !canvas) return;
    const parts = [n.base, n.ov && (n.ov.alloc || n.ov.unalloc)].filter(Boolean).map((ai) => this.assets[ai - 1]).filter(Boolean);
    if (!parts.length) return;
    const load = (url) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = url; });
    const imgs = await Promise.all(parts.map((a) => load("/pobfile/" + this.s.imgs[a[0] - 1].split("/").map(encodeURIComponent).join("/"))));
    const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
    const big = Math.max(...parts.map((a) => Math.max(a[1], a[2])));
    ctx.clearRect(0, 0, W, H);
    parts.forEach((a, i) => {
      const im = imgs[i]; if (!im) return;
      const w = a[1] / big * W, h = a[2] / big * H;
      ctx.drawImage(im, a[3] * im.width, a[4] * im.height, (a[5] - a[3]) * im.width, (a[6] - a[4]) * im.height, (W - w) / 2, (H - h) / 2, w, h);
    });
  }
  // arbre modifié (bac à sable) : nouvelle scène, même cadrage
  async reload() {
    const scene = await api("treeScene", Object.assign({ compare: this.opts.compare || null }, this.opts.target()));
    if (!this.alive) return;
    this.load(scene, true);
  }
  // Puissance des nœuds (Show Node Power de PoB) : rouge = dégâts, bleu = défense, sur les nœuds non pris
  setHeat(data) {
    this.heat = data ? new Map(data.nodes.map((x) => [x[0], [x[1], x[2]]])) : null;
    this.heatMax = data ? data.max : null;
    this.invalidate();
  }
  heatCol(n) {
    const h = this.heat && this.heat.get(n.id);
    if (!h) return null;
    const mo = this.heatMax.offence || 1, md = this.heatMax.defence || 1;
    const o = Math.min(1, (Math.max(h[0], 0) / mo * 1.5) ** 0.5), d = Math.min(1, (Math.max(h[1], 0) / md * 1.5) ** 0.5);
    const mix = (Math.max(o - 0.5, 0) + Math.max(d - 0.5, 0)) / 2;
    return [o, mix, d, 1];
  }
  // ---- entrées (PassiveTreeView:Draw, « Process input events »)
  bind() {
    const pos = (e) => { const r = this.cv.getBoundingClientRect(); this.cursor = [e.clientX - r.left, e.clientY - r.top]; };
    this.cv.addEventListener("mousemove", (e) => { pos(e); this.lastEv = e; if (this.opts.mini) FloatTip.move(e); this.invalidate(); });
    this.cv.addEventListener("mousedown", (e) => { if (e.button !== 0) return; pos(e); this.down = true; this.dragX = this.cursor.slice(); this.cv.classList.add("drag"); });
    addEventListener("mouseup", () => {
      if (!this.down) return;
      const click = !this.dragging;
      this.down = false; this.dragging = false; this.dragX = null; this.cv.classList.remove("drag");
      // clic sur un nœud : son aperçu (remplace le précédent) ; clic dans le vide : ferme l'aperçu
      if (click && this.hoverNode && this.opts.onClick && this.opts.onClick(this.hoverNode)) { /* géré par la page (allocation) */ }
      else if (click && this.opts.preview) { if (this.hoverNode) this.preview(this.hoverNode); else this.closePreview(); }
      this.invalidate();
    });
    this.onKey = (e) => {
      if (e.key === "Control" && !this.ctrlHide) { this.ctrlHide = true; this.invalidate(); }
      if (e.key === "Escape" && this.pinned) this.closePreview();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && this.opts.onUndo && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
        e.preventDefault(); this.opts.onUndo();
      }
    };
    addEventListener("keydown", this.onKey);
    this.onKeyUp = (e) => { if (e.key === "Control" && this.ctrlHide) { this.ctrlHide = false; this.invalidate(); } };
    addEventListener("keyup", this.onKeyUp);
    addEventListener("blur", this.onKeyUp.bind(this, { key: "Control" }));
    this.cv.addEventListener("mouseleave", () => { if (this.opts.mini) { this.tipFor = null; FloatTip.hide(); } if (!this.down) { this.cursor = [-1, -1]; this.invalidate(); } });
    this.cv.addEventListener("wheel", (e) => { if (this.opts.mini) return; e.preventDefault(); pos(e); this.zoomBy(e.deltaY < 0 ? (e.shiftKey ? 3 : 1) : (e.shiftKey ? -3 : -1)); }, { passive: false });
    this.cv.addEventListener("contextmenu", (e) => e.preventDefault());
    $(".tree-zoom", this.host).onclick = (e) => {
      const z = e.target.closest("button")?.dataset.z; if (!z) return;
      const r = this.cv.getBoundingClientRect(); const keep = this.cursor; this.cursor = [r.width / 2, r.height / 2];
      this.zoomBy(z === "in" ? 1 : -1); this.cursor = keep;
    };
    const inp = $(".tree-tools input", this.host);
    if (inp) {
      let tm;
      inp.oninput = () => {
        clearTimeout(tm);
        tm = setTimeout(async () => {
          const r = await api("treeSearch", Object.assign({ str: inp.value }, this.opts.target()));
          this.search = new Set(r.ids || []); this.invalidate();
        }, 200);
      };
    }
  }
  closePreview() {
    this.pinned = null;
    const card = $(".tree-preview", this.host);
    if (card) card.parentNode.removeChild(card);
    this.invalidate();
  }
  // Aperçu au clic : ce que rapporte le nœud (et son chemin) s'il n'est pas pris, ce qu'il coûte s'il est retiré
  async preview(n) {
    const taken = !!(n && (n.alloc || n.isAlloc));
    if (!n || n.t === "ClassStart" || n.t === "AscendClassStart" || (n.t === "Mastery" && !taken)) return;
    let card = $(".tree-preview", this.host);
    if (!card) { this.host.insertAdjacentHTML("beforeend", `<div class="tree-preview card"></div>`); card = $(".tree-preview", this.host); }
    this.pinned = n; this.pinLit = !taken;
    card.innerHTML = `<div class="loading" style="padding:6px"><div class="spinner"></div>PoB calcule ${esc(n.dn || "ce nœud")}…</div>`;
    let r;
    try {
      r = taken ? (await api("nodeValues", Object.assign({ ids: [n.id], detail: true }, this.opts.target())))[0]
        : (await api("testNodes", Object.assign({ ids: [n.id] }, this.opts.target())))[0];
    } catch (e) { card.innerHTML = `<span class="muted small">${esc(e.message)}</span>`; return; }
    if (this.pinned !== n) return;
    if (!r) { card.innerHTML = `<span class="muted small">Rien à calculer pour ce nœud.</span>`; return; }
    const h = r.head || {}, cost = r.cost || 1;
    const pp = (v) => (v > 0 ? "+" : "") + nf(v, Math.abs(v) < 10 ? 1 : 0) + " %";
    const big = (v) => Math.abs(v || 0) >= 0.05;
    // ce qui bouge vraiment : DPS / survie s'ils changent, puis les stats qui changent le plus (toi, puis tes sbires)
    const top = (list, who) => (list || []).slice().sort((a, b) => Math.abs(b.pct || 0) - Math.abs(a.pct || 0)).slice(0, 4)
      .map((d) => `<span class="delta ${d.better ? "up" : "down"}">${who}${esc(d.label)} ${fmtDelta(d)}</span>`);
    const chips = [
      big(h.dps) ? `<span class="delta ${deltaClass(h.dps)}">DPS ${pp(h.dps)}</span>` : "",
      big(h.ehp) ? `<span class="delta ${deltaClass(h.ehp)}">Survie ${pp(h.ehp)}</span>` : "",
      ...top((r.diff || []).filter((d) => !/^(TotalEHP|CombinedDPS|TotalDPS|FullDPS|HitPool)$/.test(d.key)), ""),
      ...top(r.minionDiff, "Sbires · "),
    ].filter(Boolean);
    const lines = (r.stats || []).filter(Boolean);
    card.innerHTML = `<div class="row" style="justify-content:space-between;gap:10px">
        <b>${taken ? "Si tu retires" : "Si tu prends"} ${esc(r.name || n.dn || "")}</b>
        <button class="icon-btn" data-close title="Fermer (Échap ou clic dans le vide)">✕</button></div>
      <div class="muted small">${!taken ? `${cost} point${cost > 1 ? "s" : ""} avec le chemin`
        : r.dependents ? `<b class="dep-warn">Coupe le chemin : ${r.dependents} autre${r.dependents > 1 ? "s" : ""} nœud${r.dependents > 1 ? "s" : ""} tombe${r.dependents > 1 ? "nt" : ""} avec lui</b> (en rouge) · ${r.points} point${r.points > 1 ? "s" : ""} rendu${r.points > 1 ? "s" : ""}`
        : "ce que le nœud t'apporte aujourd'hui · 1 point rendu"}</div>
      ${taken && (r.lostNames || []).length ? `<div class="small dep-lost">Perdus aussi : ${r.lostNames.map(esc).join(", ")}</div>` : ""}
      ${chips.length ? `<div class="row" style="gap:8px 14px;margin-top:6px;flex-wrap:wrap">${chips.join("")}
        ${!taken && cost > 1 && big(h.dps) ? `<span class="muted small">soit ${pp(h.dps / cost)} DPS / point</span>` : ""}</div>`
        : `<p class="small" style="margin:6px 0 0">Aucun chiffre ne bouge dans PoB : ${lines.length ? "cet effet n'entre pas dans ses calculs (déplacement, durée d'effets, conditions non cochées…)." : "nœud de passage."}</p>`}
      ${lines.length ? `<div class="tree-pv-lines">${lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>` : ""}
      ${(r.recipe || []).length ? `<div class="small" style="margin-top:6px"><span class="muted">Anoint (amulette) :</span> ${oilRecipe(r.recipe)}</div>` : ""}
      <div class="row" style="justify-content:space-between;gap:10px;margin-top:6px">
        ${!taken ? `<label class="small tree-pin"><input type="checkbox" ${this.pinLit ? "checked" : ""} data-lit> Garder le chemin éclairé</label>` : "<span></span>"}
        <span class="muted small">Échap ou clic dans le vide pour fermer</span></div>`;
    $("[data-close]", card).onclick = () => this.closePreview();
    const lit = $("[data-lit]", card);
    if (lit) lit.onchange = () => { this.pinLit = lit.checked; this.invalidate(); };
    this.invalidate();
  }
  // PassiveTreeView:Zoom
  zoomBy(level) {
    if (!this.s) return;
    const r = this.cv.getBoundingClientRect();
    this.zoomLevel = Math.max(0, Math.min(12, this.zoomLevel + level));
    const old = this.zoom; this.zoom = 1.2 ** this.zoomLevel;
    const f = this.zoom / old;
    const relX = this.cursor[0] - r.width / 2, relY = this.cursor[1] - r.height / 2;
    this.zoomX = relX + (this.zoomX - relX) * f;
    this.zoomY = relY + (this.zoomY - relY) * f;
    this.invalidate();
  }
  // PassiveTreeView:Focus
  focus(nodeId) {
    const n = this.byId && this.byId.get(nodeId); if (!n) return;
    const r = this.cv.getBoundingClientRect();
    this.zoomLevel = 12; this.zoom = 1.2 ** 12;
    const scale = Math.min(r.width, r.height) / this.s.size * this.zoom;
    this.zoomX = -n.x * scale; this.zoomY = -n.y * scale;
    this.invalidate();
  }
  destroy() {
    if (!this.alive) return;
    this.alive = false;
    if (this.onKey) removeEventListener("keydown", this.onKey);
    if (this.onKeyUp) removeEventListener("keyup", this.onKeyUp);
    try { this.gl && this.gl.destroy(); } catch (e) { /* contexte déjà perdu */ }
    PobTree.live.delete(this);
  }
  invalidate() {
    if (this.raf || !this.alive) return;
    const run = () => {
      if (!this.raf) return;
      cancelAnimationFrame(this.raf.a); clearTimeout(this.raf.t);
      this.raf = null;
      if (!document.body.contains(this.host)) { this.destroy(); return; }
      this.draw();
    };
    // requestAnimationFrame, avec repli si le navigateur le suspend (fenêtre non visible)
    this.raf = { a: requestAnimationFrame(run), t: setTimeout(run, 60) };
  }
  tex(i) { return this.gl.texture(this.s.imgs[i - 1], () => this.invalidate()); }
  // PassiveTreeView:DrawAsset
  drawAsset(ai, x, y, scale, half, col) {
    if (!ai) return;
    const a = this.assets[ai - 1];
    const t = this.tex(a[0]); if (!t) return;
    const w = a[1] * scale * 1.33, h = a[2] * scale * 1.33;
    if (x + w < 0 || y + 2 * h < 0 || x - w > this.vw || y - 2 * h > this.vh) return;
    const al = col[3] ?? 1;
    if (half) {
      this.gl.rect(t.tex, x - w, y - h * 2, w * 2, h * 2, a[3], a[4], a[5], a[6], col[0], col[1], col[2], al);
      this.gl.rect(t.tex, x - w, y, w * 2, h * 2, a[3], a[6], a[5], a[4], col[0], col[1], col[2], al);   // moitié basse retournée
    } else {
      this.gl.rect(t.tex, x - w, y - h, w * 2, h * 2, a[3], a[4], a[5], a[6], col[0], col[1], col[2], al);
    }
  }
  // PassiveTreeView:DrawImageRotated
  drawRotated(ai, x, y, w, h, angle, col) {
    const a = this.assets[ai - 1]; if (!a) return;
    const t = this.tex(a[0]); if (!t) return;
    const rot = this.s.showAnimations ? angle * performance.now() * 0.00003 : 0;
    const hw = w / 2, hh = h / 2, c = Math.cos(rot), s = Math.sin(rot);
    this.gl.quad(t.tex, x - hw * c + hh * s, y - hw * s - hh * c, x + hw * c + hh * s, y + hw * s - hh * c,
      x + hw * c - hh * s, y + hw * s + hh * c, x - hw * c - hh * s, y - hw * s + hh * c,
      0, 0, 1, 0, 1, 1, 0, 1, col[0], col[1], col[2], col[3] ?? 1);
  }

  draw() {
    const s = this.s; if (!s) return;
    const r = this.host.getBoundingClientRect(); if (!r.width) return;
    const dpr = this.dpr = devicePixelRatio || 1;
    const vw = this.vw = r.width, vh = this.vh = r.height;
    const gl = this.gl;
    gl.begin(vw, vh, dpr);
    if (this.cv.width !== Math.round(vw * dpr) || this.cv.height !== Math.round(vh * dpr)) { this.cv.width = Math.round(vw * dpr); this.cv.height = Math.round(vh * dpr); }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [cx, cy] = this.cursor;
    const mOver = cx >= 0 && cy >= 0 && cx < vw && cy < vh;

    // glisser (seuil de 5 px comme PoB)
    if (this.down && this.dragX) {
      if (!this.opts.mini && !this.dragging && (Math.abs(cx - this.dragX[0]) > 5 || Math.abs(cy - this.dragX[1]) > 5)) this.dragging = true;
      if (this.dragging) { this.zoomX += cx - this.dragX[0]; this.zoomY += cy - this.dragX[1]; this.dragX = [cx, cy]; }
    }
    // borne du décalage
    const clamp = this.zoom * 2 / 3;
    if (!this.fixed) {
      this.zoomX = Math.min(Math.max(this.zoomX, -vw * clamp), vw * clamp);
      this.zoomY = Math.min(Math.max(this.zoomY, -vh * clamp), vh * clamp);
    }

    const scale = Math.min(vw, vh) / s.size * this.zoom;
    const offX = this.zoomX + vw / 2, offY = this.zoomY + vh / 2;
    const T = (x, y) => [x * scale + offX, y * scale + offY];

    // nœud survolé
    let hoverNode = null;
    if (mOver && !this.dragging) {
      const tx = (cx - offX) / scale, ty = (cy - offY) / scale;
      for (const n of s.nodes) {
        if (!n.rsq) continue;
        const dx = tx - n.x, dy = ty - n.y;
        if (dx * dx + dy * dy <= n.rsq) { hoverNode = n; break; }
      }
    }
    this.hoverNode = hoverNode;
    const pathNode = hoverNode || (this.pinned && this.pinLit ? this.pinned : null);
    const hoverPath = pathNode && pathNode._path ? pathNode._path : null;
    const depNode = hoverNode || (this.pinned && (this.pinned.alloc || this.pinned.isAlloc) ? this.pinned : null);
    const hoverDep = depNode && depNode.dep ? new Set(depNode.dep) : null;

    // fond : DrawImage avec coordonnées de texture répétées (formule de PoB)
    if (s.bg && s.bgW) {
      const t = this.tex(s.assets[s.bg - 1][0]);
      if (t) {
        const bgSize = s.bgW * scale * 1.33 * 2.5;
        gl.rect(t.tex, 0, 0, vw, vh, (this.zoomX + vw / 2) / -bgSize, (this.zoomY + vh / 2) / -bgSize, (vw / 2 - this.zoomX) / bgSize, (vh / 2 - this.zoomY) / bgSize, 1, 1, 1, 1);
      }
    }
    if (s.classBg) { const [x, y] = T(s.classBg[1], s.classBg[2]); this.drawAsset(s.classBg[0], x, y, scale, false, [1, 1, 1, 1]); }

    // fonds de groupes / arts d'ascendance (renderGroup)
    for (const g of s.groups) {
      const [x, y] = T(g.x, g.y);
      this.drawAsset(g.a, x, y, scale, g.half, g.tint || [1, 1, 1, g.alpha ?? 1]);
      if (g.ft && this.zoom >= 2.5) {
        const [fx, fy] = T(g.x + g.ft[1], g.y + g.ft[2]);
        drawPobText(ctx, fx, fy, "LEFT", 52 * scale, "FONTIN ITALIC", g.ft[0], 1, 1, 1, 1, [0, 0, vw, vh], dpr, this.fontMeta, () => this.invalidate());
      }
    }

    // calque 15 : effets de maîtrise / tatouage et icônes de maîtrise
    const stateOf = (n) => (n.isAlloc || n === hoverNode || n === pathNode) ? "alloc" : (hoverPath && hoverPath.has(n.id)) ? "path" : "unalloc";
    for (const n of s.nodes) {
      if (!n.fx && n.t !== "Mastery") continue;
      const [x, y] = T(n.x, n.y);
      if (x < -300 || y < -300 || x > vw + 300 || y > vh + 300) continue;
      const col = [n.col[0], n.col[1], n.col[2], 1];
      if (n.fx && n.isAlloc) this.drawAsset(n.fx, x, y, scale, false, col);
      if (n.t === "Mastery") this.drawAsset(n.b && (n.isAlloc ? n.b.alloc : n === hoverNode ? n.b.hover : n.b.unalloc), x, y, scale, false, col);
    }

    // calque 20 : liaisons (renderConnector) — DrawImageQuad avec les coordonnées de texture de PoB
    const getState = (a1, a2, n1, n2) => {
      if (a1 && a2) return 2;
      if (hoverPath && (a1 || n1 === pathNode || hoverPath.has(n1.id)) && (a2 || n2 === pathNode || hoverPath.has(n2.id))) return 1;
      return 0;
    };
    for (const c of s.connectors) {
      const n1 = this.byId.get(c[0]), n2 = this.byId.get(c[1]); if (!n1 || !n2) continue;
      let col = c[6] ? [0.62, 0.36, 1] : [1, 1, 1];
      let state = getState(n1.alloc, n2.alloc, n1, n2);
      if (this.opts.compare) {
        const cmpState = (n1.calloc && n2.calloc) ? 2 : 0;
        if (cmpState === 2 && state !== 2) { state = 2; col = [0, 1, 0]; }
        if (cmpState !== 2 && state === 2) col = [1, 0, 0];
      }
      const v = c[2][state];
      const x1 = v[0] * scale + offX, y1 = v[1] * scale + offY, x2 = v[2] * scale + offX, y2 = v[3] * scale + offY;
      const x3 = v[4] * scale + offX, y3 = v[5] * scale + offY, x4 = v[6] * scale + offX, y4 = v[7] * scale + offY;
      if (Math.max(x1, x2, x3, x4) < 0 || Math.max(y1, y2, y3, y4) < 0 || Math.min(x1, x2, x3, x4) > vw || Math.min(y1, y2, y3, y4) > vh) continue;
      if (hoverDep && hoverDep.has(n1.id) && hoverDep.has(n2.id)) col = [1, 0, 0];
      else if (c[5] && c[5] !== s.curAsc) col = [0.75, 0.75, 0.75];
      const a = s.assets[c[3][state] - 1]; if (!a) continue;
      const t = this.tex(a[0]); if (!t) continue;
      const L = a[3], Tp = a[4], Wd = a[5] - a[3], Ht = a[6] - a[4], u = c[4];
      gl.quad(t.tex, x1, y1, x2, y2, x3, y3, x4, y4,
        L + u[0] * Wd, Tp + u[1] * Ht, L + u[2] * Wd, Tp + u[3] * Ht, L + u[4] * Wd, Tp + u[5] * Ht, L + u[6] * Wd, Tp + u[7] * Ht,
        col[0], col[1], col[2], 1);
    }

    // calque 25 : nœuds (base puis cadre)
    for (const n of s.nodes) {
      if (n.t === "Mastery") continue;
      const [x, y] = T(n.x, n.y);
      if (x < -200 || y < -200 || x > vw + 200 || y > vh + 200) continue;
      const col = [n.col[0], n.col[1], n.col[2], 1];
      if (n.t === "ClassStart" || n.t === "AscendClassStart") { this.drawAsset(n.ov, x, y, scale, false, col); continue; }
      const st = stateOf(n);
      const red = depNode && depNode !== n && hoverDep && hoverDep.has(n.id);
      if (n.t === "Socket") {
        this.drawAsset(n.b && n.b[st], x, y, scale, false, hoverDep && hoverDep.has(n.id) ? [1, 0, 0, 1] : col);
        if (n.ovj) this.drawAsset(n.ovj, x, y, scale, false, red ? [1, 0, 0, 1] : col);
        continue;
      }
      const hc = st === "unalloc" ? this.heatCol(n) : null;
      this.drawAsset(n.base, x, y, scale, false, hc || col);
      if (n.ov && n.ov[st]) this.drawAsset(n.ov[st], x, y, scale, false, red ? [1, 0, 0, 1] : hc || col);
    }
    // anneaux des joyaux (drawJewelRadius) et rayons au survol d'une châsse
    for (const so of s.sockets) {
      const [x, y] = T(so.x, so.y);
      if (hoverNode && hoverNode.id === so.id && s.ring) {
        const t = this.tex(s.assets[s.ring - 1][0]);
        if (t) for (const rd of s.radius) {
          const outer = rd[1] * scale, inner = rd[0] * scale;
          if (so.toh ? inner !== 0 : inner === 0) {
            gl.rect(t.tex, x - outer, y - outer, outer * 2, outer * 2, 0, 0, 1, 1, rd[2][0], rd[2][1], rd[2][2], 1);
            if (so.toh) gl.rect(t.tex, x - inner, y - inner, inner * 2, inner * 2, 0, 0, 1, 1, rd[2][0], rd[2][1], rd[2][2], 1);
          }
        }
      }
      for (const [rings, tint] of [[so.rings, so.tint || [1, 1, 1, 0.7]], [so.crings, [0, 1, 0, 0.7]]]) {
        if (!rings) continue;
        for (const rg of rings) {
          const [rx, ry] = T(rg[3], rg[4]);
          this.drawRotated(rg[0], rx, ry, rg[1] * scale * 2, rg[1] * scale * 2, rg[2], tint);
        }
      }
    }

    // calque 30 : surbrillance de recherche
    if (this.search.size && s.highlight) {
      const t = this.tex(s.assets[s.highlight - 1][0]);
      if (t) for (const id of this.search) {
        const n = this.byId.get(id); if (!n) continue;
        const [x, y] = T(n.x, n.y);
        let size = 175 * scale / this.zoom ** 0.4;
        let nx = x - size, ny = y - size;
        if (s.edgeSearch) {
          const wide = [-size / 1.15, vw - size * 1.15], high = [-size / 1.15, vh - size * 1.15];
          const ex = Math.min(Math.max(x - size, wide[0]), wide[1]), ey = Math.min(Math.max(y - size, high[0]), high[1]);
          if (ex !== x - size || ey !== y - size) { size *= 0.6667; nx = ex + size / 2; ny = ey + size / 2; } else { nx = ex; ny = ey; }
        }
        gl.rect(t.tex, nx, ny, size * 2, size * 2, 0, 0, 1, 1, 1, 0, 0, 1);
      }
    }
    gl.flush();

    // calque 100 : infobulle de PoB (AddNodeTooltip), positionnée comme dans PoB, sur le calque 2D
    const tipNode = hoverNode && hoverNode.t !== "ClassStart" && hoverNode.t !== "AscendClassStart" && (hoverNode.t !== "Mastery" || hoverNode.mfx) ? hoverNode : null;
    if (this.opts.mini) {
      if (tipNode && this.tipFor !== tipNode.id) this.loadTip(tipNode.id);
      if (!tipNode && this.tipFor != null) { this.tipFor = null; FloatTip.hide(); }
    } else if (tipNode && !this.ctrlHide) {
      if (this.tipFor !== hoverNode.id) this.loadTip(hoverNode.id);
      if (this.tip && this.tip.id === hoverNode.id && this.tip.main) {
        const [x, y] = T(hoverNode.x, hoverNode.y);
        const size = Math.floor(hoverNode.size * scale);
        const tw = this.tip.main.w, th = this.tip.main.h;
        const sk = this.tip.skill;
        const fat = sk && sk.w > sk.h * 1.5;
        const totalW = fat ? Math.max(tw, sk ? sk.w : 0) : tw + (sk ? sk.w : 0);
        const totalH = fat ? th + (sk ? sk.h : 0) : Math.max(th, sk ? sk.h : 0);
        const nodeX = Math.floor(x + size), nodeY = Math.floor(y - size);
        let ttX = nodeX, ttY = nodeY;
        if (ttX + totalW > vw) ttX -= ttX + totalW - vw;
        if (ttY + totalH > vh) ttY -= ttY + totalH - vh;
        const mx = fat ? Math.min(nodeX, vw - tw) : Math.max(ttX, 0);
        const my = Math.max(0, fat ? Math.max(ttY, 0) : Math.min(nodeY, vh - th));
        if (sk) renderPobList(ctx, sk.dl, sk.w, sk.h, dpr, this.fontMeta, () => this.invalidate(), fat ? [ttX, ttY + th] : [ttX + tw + 5, ttY]);
        renderPobList(ctx, this.tip.main.dl, tw, th, dpr, this.fontMeta, () => this.invalidate(), [mx, my]);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
  }
  loadTip(id) {
    this.tipFor = id;
    const vh = this.opts.mini ? innerHeight : Math.round(this.host.getBoundingClientRect().height);
    api("treeTooltip", Object.assign({ nodeId: id, compare: this.opts.compare || null, vh }, this.opts.target())).then((t) => {
      if (this.tipFor !== id) return;
      this.tip = Object.assign({ id }, t);
      if (this.opts.mini) { if (t.main) FloatTip.showData(t.main, this.lastEv); return; }
      this.invalidate();
    }).catch(() => {});
  }
}
PobTree.live = new Set();

// transformation affine envoyant (u,v) des trois points de texture sur les trois points écran
function affine(a, b, c, A, B, C) {
  const det = a[0] * (b[1] - c[1]) - a[1] * (b[0] - c[0]) + (b[0] * c[1] - c[0] * b[1]);
  if (Math.abs(det) < 1e-9) return null;
  const inv = (p, q, r) => [
    (p * (b[1] - c[1]) + q * (c[1] - a[1]) + r * (a[1] - b[1])) / det,
    (p * (c[0] - b[0]) + q * (a[0] - c[0]) + r * (b[0] - a[0])) / det,
    (p * (b[0] * c[1] - c[0] * b[1]) + q * (c[0] * a[1] - a[0] * c[1]) + r * (a[0] * b[1] - b[0] * a[1])) / det,
  ];
  const X = inv(A[0], B[0], C[0]), Y = inv(A[1], B[1], C[1]);
  return [X[0], Y[0], X[1], Y[1], X[2], Y[2]];
}
