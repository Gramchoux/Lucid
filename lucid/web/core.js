// Lucid — core.js : Socle : utilitaires, API, état, thème, statut du moteur, modales, routeur et navigation.

/* Lucid — interface. Vanilla JS, aucune dépendance. Tous les chiffres viennent du moteur Path of Building. */
"use strict";

// ------------------------------------------------------------------ utilitaires
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf = (v, d = 0) => v == null || !isFinite(v) ? "—" : new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
function compact(v) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return nf(v / 1e9, 2) + " Md";
  if (a >= 1e6) return nf(v / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + " M";
  if (a >= 1e4) return nf(v / 1e3, a >= 1e5 ? 0 : 1) + " k";
  return nf(v, a < 10 && a % 1 ? 1 : 0);
}
const store = {
  get(k, d) { try { const v = localStorage.getItem("lucid." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("lucid." + k, JSON.stringify(v)); } catch (e) {} },
};

// Format d'une stat selon la spec PoB (fmt "d", ".1f", "+d%%", pc, mod…)
function statValue(s, v) {
  if (v == null) return null;
  return v * (s.pc ? 100 : 1) - (s.mod ? 100 : 0);
}
function fmtStat(s, v, opts = {}) {
  const val = statValue(s, v);
  if (val == null || !isFinite(val)) return v >= 1e299 ? "∞" : "—";
  if (Math.abs(val) >= 1e299) return "∞";
  const m = /^(\+)?(?:\.(\d+))?([df])(%%)?$/.exec(s.fmt || "d") || [];
  const plus = m[1] && val >= 0 ? "+" : "";
  const dec = m[3] === "f" ? +(m[2] || 0) : 0;
  const pct = m[4] ? " %" : "";
  if (opts.compact && Math.abs(val) >= 1e5 && !pct) return plus + compact(val);
  // pas de décimales inutiles (61,000 % → 61 %, 1,50 → 1,5)
  let d = dec;
  while (d > 0 && Math.abs(Math.round(val * 10 ** d) - Math.round(val * 10 ** (d - 1)) * 10) < 1e-6) d--;
  return plus + nf(val, d) + pct;
}
function fmtDelta(d, s) {
  // d : entrée diff du moteur (base, new, delta, pct, fmt…)
  const dv = statValue(d, d.new) - statValue(d, d.base);
  const m = /^(\+)?(?:\.(\d+))?([df])(%%)?$/.exec(d.fmt || "d") || [];
  const dec = m[3] === "f" ? +(m[2] || 0) : 0;
  const unit = m[4] ? " %" : "";
  return (dv >= 0 ? "+" : "−") + nf(Math.abs(dv), dec) + unit;
}
function deltaClass(v, lower) {
  if (v == null || Math.abs(v) < 0.05) return "flat";   // même seuil que pctText (« ±0 % » jamais en rouge)
  return (lower ? v < 0 : v > 0) ? "up" : "down";
}
function pctText(p, d = 1) {
  if (p == null || !isFinite(p)) return "—";
  if (Math.abs(p) < 0.05) return "±0 %";
  if (Math.abs(p) > 999) return p > 0 ? "> +999 %" : "< −999 %";
  return (p > 0 ? "+" : "−") + nf(Math.abs(p), d) + " %";
}

// Couleurs PoB (^0-^9, ^xRRGGBB) → spans lisibles dans les deux thèmes
const POB_DIGITS = ["#000000", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#BF40BF", "#00FFFF", "#FFFFFF", "#B3B3B3", "#4D4D4D"];
function adaptColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const dark = document.documentElement.dataset.resolvedTheme === "dark";
  if (!dark && lum > 0.72) return null; // blanc/gris clair → couleur de texte par défaut
  if (dark && lum < 0.25) return null;
  if (!dark && lum > 0.45) { const k = 0.55; r *= k; g *= k; b *= k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function pobText(text) {
  const str = String(text || "");
  const re = /\^x([0-9A-Fa-f]{6})|\^([0-9])/g;
  let html = "", last = 0, open = false, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) {
      html += esc(str.slice(last, m.index)).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    }
    const hex = m[1] ? "#" + m[1] : POB_DIGITS[+m[2]];
    if (open) html += "</span>";
    const c = adaptColor(hex);
    html += c ? `<span style="color:${c}">` : "<span>";
    open = true;
    last = re.lastIndex;
  }
  if (last < str.length) {
    html += esc(str.slice(last)).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  if (open) html += "</span>";
  return html;
}
const itemTitle = (it) => !it ? "" : (!it.title || it.title === "New Item") ? (it.base || it.name) : it.title;
const portrait = (name, cls = "") => name ? `<img class="portrait ${cls}" src="/pobasset/ascendants/${esc(String(name).toLowerCase())}.jpeg" alt="" onerror="this.remove()">` : "";
const stripPob = (t) => String(t || "").replace(/\^x[0-9A-Fa-f]{6}|\^\d/g, "");

// ------------------------------------------------------------------ API
async function api(route, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch("/api/" + route, opt);
  const j = await r.json().catch(() => ({ error: "Réponse invalide" }));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}
function toast(msg, err = false) {
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), err ? 6000 : 2600);
}

// ------------------------------------------------------------------ état
const S = {
  status: null,
  library: null,
  snap: {},         // id -> snapshot
  stage: store.get("stages", {}), // id -> {tree, items, skills, config}
  tree: {},         // version -> layout
};
// Setup actif de chaque build (arbre, objets, gemmes, config) : un seul état, partagé par toutes les pages.
function stageOf(id) { return S.stage[id] || buildMeta(id)?.stage || null; }
function setStageOf(id, st, persist = true) {
  if (st) S.stage[id] = st; else delete S.stage[id];
  store.set("stages", S.stage);
  delete S.snap[id];
  const m = buildMeta(id); if (m) m.stage = st || null;
  if (persist) api("meta", { id, stage: st || null }).catch(() => {});
}
// Étapes du guide validées par un perso : meta.progress = { guideId: [id d'arbre, …] }
function progressOf(persoId, guideId) { return ((buildMeta(persoId)?.progress || {})[guideId]) || []; }
async function setProgress(persoId, guideId, list) {
  const m = buildMeta(persoId); if (!m) return;
  m.progress = Object.assign({}, m.progress || {}, { [guideId]: list });
  await api("meta", { id: persoId, progress: m.progress });
}
async function toggleStageDone(persoId, guideId, treeId, on) {
  const cur = new Set(progressOf(persoId, guideId));
  if (on === undefined ? !cur.has(treeId) : on) cur.add(treeId); else cur.delete(treeId);
  await setProgress(persoId, guideId, [...cur]);
}
// Jeux PoB d'un build, lus dans son XML (rapide, sans moteur)
S.sets = {};
async function setsOf(id) {
  if (!S.sets[id]) S.sets[id] = (await api("sets", { id })).sets;
  return S.sets[id];
}
// Sélection effective : setup mémorisé, sinon jeux actifs du build
function selectionOf(id, sets) {
  const st = stageOf(id) || {};
  const act = (l) => ((l || []).find((x) => x.active) || (l || [])[0] || {}).id;
  return { tree: st.tree ?? act(sets.trees), items: st.items ?? act(sets.items), skills: st.skills ?? act(sets.skills), config: st.config ?? act(sets.configs) };
}
// Guide à étapes sans setup mémorisé : on aligne objets / gemmes / config sur l'arbre actif
async function ensureGuideStage(id) {
  const m = buildMeta(id);
  if (!m || m.role !== "guide" || stageOf(id)) return;
  const sets = await setsOf(id);
  if (sets.trees.length < 2) return;
  const cur = sets.trees.find((t) => t.active) || sets.trees[0];
  setStageOf(id, await api("matchStage", { sets, tree: cur.id }));
}

async function loadLibrary(force) {
  if (!S.library || force) S.library = await api("library");
  return S.library;
}
function buildMeta(id) { return (S.library?.builds || []).find((b) => b.id === id); }

async function openBuild(id, opts = {}) {
  if (!opts.force && S.snap[id] && !opts.stage) return S.snap[id];
  const stage = opts.stage !== undefined ? opts.stage : stageOf(id);
  const snap = await api("open", { id, stage, force: !!opts.force });
  S.snap[id] = snap;
  return snap;
}

// ------------------------------------------------------------------ thème
function resolveTheme() {
  const t = document.documentElement.dataset.theme;
  const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.resolvedTheme = dark ? "dark" : "light";
}
$("#theme-btn").onclick = () => {
  const cur = document.documentElement.dataset.resolvedTheme;
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("lucid.theme", next); } catch (e) {}
  resolveTheme();
  route();
};
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { resolveTheme(); route(); });
resolveTheme();
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ------------------------------------------------------------------ statut moteur
async function pollStatus() {
  try {
    S.status = await api("status");
  } catch (e) {
    S.status = { ready: false, error: "Serveur Lucid injoignable" };
  }
  renderEngineChip();
  if (!S.status.ready && !S.status.error) setTimeout(pollStatus, 700);
}
function engineLabel(st) {
  if (!st) return "…";
  if (st.error) return "Moteur indisponible";
  if (!st.ready) return "Démarrage du moteur…";
  const e = st.engine || {};
  return `PoB ${e.version || "?"} · ${e.origin}`;
}
function renderEngineChip() {
  const st = S.status, chip = $("#engine-chip");
  const cls = !st ? "busy" : st.error ? "err" : !st.ready ? "busy" : st.updateAvailable ? "busy" : "ok";
  chip.innerHTML = `<span class="dot ${cls}"></span><span>${esc(st && st.updateAvailable ? "Mise à jour PoB prête" : engineLabel(st))}</span>`;
}
$("#engine-chip").onclick = () => engineDialog();

function syncedText(e) {
  if (!e || !e.synced) return "";
  return new Date(e.synced * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function engineDialog() {
  const st = S.status || {};
  const e = st.engine || {};
  modal(`
    <div class="card-head"><h3>Moteur Path of Building</h3></div>
    <div class="card-body stack">
      ${st.error ? `<div class="tag bad">${esc(st.error)}</div>` : ""}
      <table class="stat-table">
        <tr><td class="l">Version du moteur</td><td class="v">${esc(e.version || "?")}${e.commit ? ` <span class="muted small">(${esc(e.commit)})</span>` : ""}</td></tr>
        <tr><td class="l">Source</td><td class="v">${esc(e.origin || "—")}</td></tr>
        <tr><td class="l">Synchronisé le</td><td class="v">${esc(syncedText(e) || "—")}</td></tr>
        <tr><td class="l">Dossier des builds</td><td class="v small">${esc(st.buildsDir || "")}</td></tr>
      </table>
      <p class="muted small">Lucid n'embarque aucun calcul : il exécute directement le code de Path of Building, celui de ton installation PoB. Pour mettre à jour, lance Path of Building (il se met à jour au démarrage), puis recharge le moteur.</p>
      ${st.updateAvailable ? `<div class="tag accent">Nouvelle version disponible : ${esc(st.freshVersion || "")} (${esc(st.freshOrigin || "")})</div>` : ""}
    </div>
    <div class="modal-actions">
      ${st.pobExe ? `<button class="btn" data-act="pob">Lancer Path of Building</button>` : ""}
      <button class="btn ${st.updateAvailable ? "primary" : ""}" data-act="restart">Recharger le moteur</button>
      <button class="btn ghost" data-act="close">Fermer</button>
    </div>`, {
    pob: async () => { await api("launchPoB", {}); toast("Path of Building lancé : il se met à jour au démarrage."); },
    restart: async (m) => {
      m.close();
      S.status = { ready: false }; renderEngineChip();
      try { S.status = await api("restart", {}); S.snap = {}; toast("Moteur rechargé"); } catch (err) { toast(err.message, true); }
      renderEngineChip(); route();
    },
  });
}

// ------------------------------------------------------------------ modales & menus
function modal(html, actions = {}) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal">${html}</div>`;
  const m = { el: back, close: () => back.remove() };
  back.addEventListener("click", (ev) => {
    if (ev.target === back) return m.close();
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "close") return m.close();
    if (actions[a]) actions[a](m, b);
  });
  document.addEventListener("keydown", function k(ev) { if (ev.key === "Escape") { m.close(); document.removeEventListener("keydown", k); } });
  document.body.appendChild(back);
  const f = back.querySelector("input, select, textarea");
  if (f) f.focus();
  return m;
}
function menu(anchor, items) {
  closeMenus();
  const m = document.createElement("div");
  m.className = "menu";
  m.innerHTML = items.map((it, i) => it === "-" ? "<hr>" : `<button data-i="${i}">${esc(it.label)}</button>`).join("");
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + "px";
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
  m.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    closeMenus();
    items[+b.dataset.i].run();
  });
  setTimeout(() => document.addEventListener("click", closeMenus, { once: true }), 0);
}
function closeMenus() { $$(".menu").forEach((m) => m.remove()); }

// ------------------------------------------------------------------ routeur
// Cockpit : à gauche la santé du build (toujours visible), à droite trois onglets.
//   Suivre le guide (vert)   : étapes, chronologie, écarts, ce que vise l'étape
//   Tester un upgrade (ambre) : objet collé, trade, config — rien n'est enregistré
//   Arbre & détails (violet) : arbre (puissance, allocation, anoint), équipement, gemmes, statistiques
const TABS = {
  guide: { label: "Suivre le guide", color: "--good" },
  upgrade: { label: "Tester un upgrade", color: "--warn" },
  expert: { label: "Arbre & détails", color: "--accent" },
};
// vues de chaque onglet : [id, libellé, à quoi elle sert]
function tabViews(meta) {
  const guideBuild = meta?.role === "guide";
  const hasGuide = !guideBuild && meta?.guide && buildMeta(meta.guide);
  return {
    guide: guideBuild ? [
      ["etapes", "Étapes & chronologie", "Le plan et ce qui change à chaque étape"],
    ] : hasGuide ? [
      ["etapes", "Étapes & chronologie", "Le plan, ta progression, ce qui change"],
      ["ecarts", "Écarts & améliorations", "Ce qui te sépare de l'étape, trié par gain"],
    ] : [["choisir", "Choisir un guide", "Le guide que suit ce perso"]],
    upgrade: [
      ["objet", "Tester un objet", "Colle un objet du jeu ou du trade"],
      ["config", "Simuler la config", "Charges, buffs, boss : l'impact"],
    ],
    expert: [
      ["arbre", "Arbre", "Puissance des nœuds, allocation, anoint"],
      ["equipement", "Équipement", "Inventaire et Guardian"],
      ["gemmes", "Gemmes", "Groupes, liens, compétence principale"],
      ["stats", "Statistiques", "Toutes les stats, et d'où elles viennent"],
    ],
  };
}
// Arbre / Équipement / Gemmes : une seule vue par thème, avec sa source [Mon perso | Le guide | Comparer]
const SOURCES = [["perso", "Mon perso"], ["guide", "Le guide"], ["cmp", "Comparer"]];
const SOURCE_VIEWS = { arbre: "tree", equipement: "items", gemmes: "gems" };
// anciennes adresses → cockpit
const LEGACY = {
  overview: "expert/stats", compare: "guide/ecarts", guide: "guide/etapes", items: "expert/equipement", tree: "expert/arbre",
  skills: "expert/gemmes", config: "upgrade/config", "s-items": "upgrade/objet", "s-tree": "expert/arbre", "s-config": "upgrade/config",
  "g-items": "expert/equipement/guide", "g-tree": "expert/arbre/guide", "g-skills": "expert/gemmes/guide", gems: "expert/gemmes",
};
// vues où l'on modifie le build en mémoire (jamais dans le fichier) : on le remet d'aplomb en les quittant
const isSandbox = (tab, view) => tab === "upgrade" || (tab === "expert" && view === "arbre");
// mode des pages existantes (couleur d'étiquette, outils disponibles)
function modeOf(tab, view, meta) {
  if (isSandbox(tab, view)) return "sandbox";
  if (tab === "guide" || meta?.role === "guide") return "guide";
  return "mine";
}
// En-tête de page : de quel build viennent les chiffres (ton perso, le guide, les deux) + à quoi sert la page
const EYEBROW = { mine: ["mine", "Ton perso"], guide: ["guide", "Guide"], cmp: ["cmp", "Ton perso face au guide"] };
function pageHead(kind, title, purpose, right = "", extra = "") {
  const [cls, label] = EYEBROW[kind] || EYEBROW.mine;
  return `<div class="page-head ${extra}"><div><span class="eyebrow ${cls}">${esc(label)}</span><h1>${title}</h1>${purpose ? `<p>${purpose}</p>` : ""}</div>${right}</div>`;
}
function ownerKind(id) { return buildMeta(id)?.role === "guide" ? "guide" : "mine"; }
let routeToken = 0;
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  if (!h) return { page: "home" };
  const [kind, id, tab, view, ...rest] = h.split("/");
  if (kind !== "b") return { page: "home" };
  return { page: "build", id: decodeURIComponent(id), tab: tab || "", view: view || "", rest };
}
function go(id, tab, view, src) {
  if (LEGACY[tab] && !view) [tab, view, src] = LEGACY[tab].split("/");
  const h = `#/b/${encodeURIComponent(id)}/${tab}${view ? "/" + view : ""}${src ? "/" + src : ""}`;
  // garde-fou : jamais plus de quelques redirections d'affilée (une boucle figerait la page)
  const now = Date.now();
  go._n = now - (go._t || 0) < 300 ? (go._n || 0) + 1 : 0; go._t = now;
  if (go._n > 8) { console.error("Lucid : boucle de redirection arrêtée vers", h); return; }
  if (location.hash === h || decodeURIComponent(location.hash) === decodeURIComponent(h)) setTimeout(route, 0); else location.hash = h;
}
window.addEventListener("hashchange", () => route());

async function route() {
  const token = ++routeToken;
  // arbres de la page précédente : contexte WebGL libéré tout de suite (sinon seulement à leur prochain dessin)
  for (const t of [...PobTree.live]) if (!document.body.contains(t.host) || t.host.closest("#app")) t.destroy();
  const r = parseRoute();
  const app = $("#app");
  closeMenus();
  if (r.page === "home") {
    $("#crumbs").innerHTML = "";
    document.body.classList.remove("in-build");
    return renderHome(app, token);
  }
  await loadLibrary().catch(() => {});
  const meta = buildMeta(r.id);
  // ancienne adresse, ou onglet / vue absents : redirection vers la vue par défaut
  const views = tabViews(meta);
  // (« guide » est à la fois un onglet et une ancienne page : seule une adresse sans vue est traduite)
  if (LEGACY[r.tab] && !(TABS[r.tab] && r.view)) { const [t, v, sr] = LEGACY[r.tab].split("/"); return go(r.id, t, v, sr); }
  // anciennes vues « visées » de Suivre le guide → Arbre & détails, source « Le guide »
  const VISE = { "vise-items": "equipement", "vise-tree": "arbre", "vise-skills": "gemmes" };
  if (r.tab === "guide" && VISE[r.view]) return go(r.id, "expert", VISE[r.view], "guide");
  if (!views[r.tab]) return go(r.id, meta?.role === "guide" || meta?.guide ? "guide" : "expert", meta?.role === "guide" || meta?.guide ? "etapes" : "stats");
  if (!views[r.tab].some(([v]) => v === r.view)) return go(r.id, r.tab, views[r.tab][0][0]);
  const { tab, view } = r;
  const followedG = meta?.role !== "guide" && meta?.guide && buildMeta(meta.guide) ? meta.guide : null;
  const src = SOURCE_VIEWS[view] && followedG ? (["perso", "guide", "cmp"].includes(r.rest[0]) ? r.rest[0] : "perso") : null;
  document.body.classList.add("in-build");
  $("#crumbs").innerHTML = `<span>/</span><a href="#/">Bibliothèque</a><span>/</span><b>${esc(meta ? meta.name : r.id)}</b>`;
  if (!app.querySelector(".cockpit") || app.dataset.build !== r.id) {
    app.dataset.build = r.id;
    app.innerHTML = `<div class="cockpit"><aside class="health" id="health"></aside>
      <div class="main-col"><nav class="cockpit-tabs" id="sidenav"></nav><section class="content" id="content"></section></div></div>`;
  }
  renderNav(r.id, tab + "/" + view, meta, src);
  const c = $("#content");
  c.classList.toggle("wide", /tree|arbre/.test(view));
  if (c._tipCleanup) c._tipCleanup();
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Calcul avec le moteur PoB…</div>`;
  const mode = modeOf(tab, view, meta);
  $(".main-col").dataset.mode = mode;
  try {
    await ensureGuideStage(r.id);
    if (meta?.role !== "guide" && meta?.guide) await ensureGuideStage(meta.guide);
    if (token !== routeToken) return;
    TT_CTX = { id: r.id, stage: stageOf(r.id) };
    // (plus de barre d'étape au-dessus des onglets : la liste des étapes de « Suivre le guide » suffit)
    // en quittant une vue d'essai, le build modifié en mémoire (config, arbre) revient à son état réel
    if (!isSandbox(tab, view) && S.cfgDirty && S.cfgDirty[r.id]) {
      delete S.cfgDirty[r.id];
      await openBuild(r.id, { force: true, stage: stageOf(r.id) });
      if (token !== routeToken) return;
    }
    renderHealth(r.id, meta, token);
    const followed = meta?.role !== "guide" && meta?.guide && buildMeta(meta.guide) ? meta.guide : null;
    // --- Suivre le guide
    if (tab === "guide") {
      if (view === "etapes") {
        if (followed) {
          const gsnap = await openBuild(followed);
          if (token !== routeToken) return;
          S.setsCache = Object.assign(S.setsCache || {}, { [followed]: gsnap.sets });
          return await pageGuide(c, followed, gsnap, token, buildMeta(followed), r.id);
        }
        const snap = await openBuild(r.id);
        if (token !== routeToken) return;
        return await pageGuide(c, r.id, snap, token, meta);
      }
      if (view === "ecarts" || view === "choisir") return await pageCompare(c, r.id, null, token, meta);
      const fn = { "vise-items": pageItems, "vise-tree": pageTree, "vise-skills": pageSkills }[view];
      if (followed) {
        const gsnap = await openBuild(followed);
        if (token !== routeToken) return;
        TT_CTX = { id: followed, stage: stageOf(followed) };
        const msnap = S.snap[r.id] || await openBuild(r.id);
        if (token !== routeToken) return;
        return await fn(c, followed, gsnap, token, { mode: "guide", perso: r.id, persoSnap: msnap });
      }
      const snap = await openBuild(r.id);
      if (token !== routeToken) return;
      return await fn(c, r.id, snap, token, { mode: "guide", meta });
    }
    const snap = await openBuild(r.id);
    if (token !== routeToken) return;
    // --- Tester un upgrade
    if (tab === "upgrade") {
      const fn = view === "config" ? pageConfig : pageItems;
      await fn(c, r.id, snap, token, { mode: "sandbox", meta });
      // objet copié en jeu (presse-papier) en attente : testé dès l'arrivée sur la page
      if (S.clipText && $("#test-raw")) { $("#test-raw").value = S.clipText; S.clipText = null; $("#test-go").click(); }
      return;
    }
    // --- Arbre & détails : source « Le guide » (l'étape suivie, avec tes nœuds / le trade pour toi) ou « Comparer »
    if (src === "guide") {
      const gsnap = await openBuild(followed);
      if (token !== routeToken) return;
      TT_CTX = { id: followed, stage: stageOf(followed) };
      const msnap = S.snap[r.id] || await openBuild(r.id);
      if (token !== routeToken) return;
      const fn = { arbre: pageTree, equipement: pageItems, gemmes: pageSkills }[view];
      return await fn(c, followed, gsnap, token, { mode: "guide", perso: r.id, persoSnap: msnap });
    }
    if (src === "cmp") return await pageCompare(c, r.id, null, token, meta, { only: SOURCE_VIEWS[view] });
    if (view === "arbre") {
      // l'étape du guide en repère sur l'arbre (si le perso suit un guide)
      let gspec = null;
      if (followed) {
        const gsnap = await openBuild(followed);
        if (token !== routeToken) return;
        gspec = treeSpecOf(gsnap);
        await openBuild(r.id);
        if (token !== routeToken) return;
      }
      return await pageTree(c, r.id, snap, token, Object.assign({ mode: "sandbox", meta }, gspec ? { compare: gspec } : {}));
    }
    if (view === "stats") return await pageOverview(c, r.id, snap, token, meta);
    const fn = view === "gemmes" ? pageSkills : pageItems;
    return await fn(c, r.id, snap, token, { mode: "mine", meta });
  } catch (e) {
    if (token !== routeToken) return;
    c.innerHTML = `<div class="card pad"><h3>Impossible d'afficher ce build</h3><p class="muted">${esc(e.message)}</p><a class="btn" href="#/">Retour à la bibliothèque</a></div>`;
  }
}

// Onglets du cockpit + vues de l'onglet actif. « page » = "onglet/vue" (ou une ancienne page, traduite).
function renderNav(id, page, meta, src) {
  const nav = $("#sidenav"); if (!nav) return;
  if (LEGACY[page]) page = LEGACY[page];
  const [tab, view] = page.split("/");
  const views = tabViews(meta);
  const enc = encodeURIComponent(id);
  nav.innerHTML = `<div class="ct-tabs" role="tablist">${Object.entries(TABS).map(([t, T]) =>
      `<a class="ct-tab ${t === tab ? "on" : ""}" role="tab" href="#/b/${enc}/${t}" style="--c:var(${T.color})">${T.label}</a>`).join("")}
      ${meta?.role === "guide" ? `<button class="btn sm ct-link" id="link-perso">${icon("zap")} Associer mon perso</button>` : ""}</div>
    <div class="ct-views" style="--c:var(${(TABS[tab] || TABS.guide).color})">${(views[tab] || []).map(([v, label, desc]) =>
      `<a class="ct-view ${v === view ? "on" : ""}" href="#/b/${enc}/${tab}/${v}${src && SOURCE_VIEWS[v] ? "/" + src : ""}" title="${esc(desc)}">${esc(label)}</a>`).join("")}
      ${src ? `<span class="ct-src seg sm" title="De qui viennent les chiffres">${SOURCES.map(([k, l]) => `<a class="${k === src ? "on" : ""}" href="#/b/${enc}/${tab}/${view}/${k}">${l}</a>`).join("")}</span>` : ""}</div>`;
  const lp = $("#link-perso", nav);
  if (lp) lp.onclick = () => linkPersoDialog(id);
}
// Guide ouvert sans perso : choisir le perso qui le suit (ou en importer un)
function linkPersoDialog(guideId) {
  const persos = (S.library?.builds || []).filter((b) => b.role === "perso");
  const m = modal(`<div class="card-head"><h3>Associer mon perso à ce guide</h3><button class="icon-btn" data-act="close" aria-label="Fermer">✕</button></div>
    <div class="pad">${persos.length ? `<p class="muted small">Le perso choisi suivra ce guide : ses écarts, ses étapes validées et le trade se calculent pour lui.</p>
      <div class="stack" style="gap:6px">${persos.map((p) => `<button class="btn" data-p="${esc(p.id)}" style="justify-content:flex-start">${esc(p.name)}${p.guide === guideId ? ` <span class="tag accent">suit déjà ce guide</span>` : ""}</button>`).join("")}</div>`
      : `<p class="muted">Aucun perso dans ta bibliothèque. Importe d'abord ton personnage depuis l'accueil (code PoB ou compte Path of Exile).</p><a class="btn primary" href="#/">Aller à l'accueil</a>`}</div>`);
  m.el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-p]"); if (!b) return;
    await api("meta", { id: b.dataset.p, guide: guideId, role: "perso" });
    await loadLibrary(true);
    m.close && m.close();
    go(b.dataset.p, "guide", "etapes");
  });
}
