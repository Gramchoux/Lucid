// Lucid — ui_guide.js : Suivre le guide : étapes, chronologie, fiche du build, courbe, écarts et améliorations.

// ------------------------------------------------------------------ résumé des changements entre deux étapes
async function loadStageDiff(el, id, sets, idx, token, opts) {
  if (!el) return;
  const trees = sets.trees;
  if (idx <= 0) { el.innerHTML = `<div class="card pad stage-diff"><h3>Point de départ du guide</h3><p class="muted small" style="margin:4px 0 0">Première étape : les suivantes montreront automatiquement ce qui change.</p></div>`; return; }
  el.innerHTML = `<div class="card pad stage-diff"><div class="loading" style="padding:8px"><div class="spinner"></div>Lucid compare cette étape à la précédente…</div></div>`;
  let D, curStage, prevStage;
  // ton perso, lu avant le calcul de l'étape (cases cochées automatiquement si tu as déjà fait le changement)
  let P = null;
  if (opts && opts.persoId) { try { P = S.snap[opts.persoId] || await openBuild(opts.persoId); } catch (e) { P = null; } }
  try {
    curStage = stageOf(id) || await api("matchStage", { sets, tree: trees[idx].id });
    prevStage = await api("matchStage", { sets, tree: trees[idx - 1].id });
    D = await api("stageDiff", { id, from: prevStage, to: curStage });
  } catch (e) { el.innerHTML = `<div class="card pad muted">${esc(e.message)}</div>`; return; }
  if (token !== routeToken) return;
  S.snap = {}; // le moteur a chargé l'étape précédente puis celle-ci
  const kf = D.keyFrom, kt = D.keyTo;
  const tipReqs = [];
  const tip = (x) => tipReqs.push({ route: "itemTooltip", body: { id, stage: stageOf(id), raw: x.raw, noCompare: true } }) - 1;
  const [dl, d0, d1] = cmpDps(kt, kf);
  const pc = (a, b) => a ? (b - a) / Math.abs(a) * 100 : 0;
  const stageKey = "stepcheck:" + id + ":" + trees[idx].id;
  const saved = store.get(stageKey, {});
  const auto = {};
  if (P) {
    const pItems = {}; (P.items || []).forEach((x) => { if (x.item) pItems[x.slot] = x.item; });
    const uniq = (x) => x && (x.rarity === "UNIQUE" || x.rarity === "RELIC");
    D.items.forEach((r) => {
      const mine = pItems[r.slot], to = r.to;
      if (to && mine && (uniq(to) ? itemTitle(mine) === itemTitle(to) : mine.raw === to.raw)) auto["i:" + r.slot] = true;
      if (!to && !mine) auto["i:" + r.slot] = true;
    });
    const alloc = new Set((P.tree && P.tree.alloc) || []);
    if ((D.tree.added.length || D.tree.removed.length) && D.tree.added.every((n) => alloc.has(n.id)) && !D.tree.removed.some((n) => alloc.has(n.id))) auto["t:tree"] = true;
    const groups = (P.skills || []).map((g) => ({ act: (g.active || []).concat(g.gems.filter((x) => !x.support).map((x) => x.name)), gems: new Set(g.gems.map((x) => x.name)) }));
    D.gems.added.forEach((g) => { if (groups.some((x) => x.act.includes(g.name))) auto["g:+" + g.name] = true; });
    D.gems.changed.forEach((g) => { const x = groups.find((y) => y.act.includes(g.name)); if (x && g.add.every((n) => x.gems.has(n))) auto["g:" + g.name] = true; });
    D.gems.removed.forEach((g) => { if (!groups.some((x) => x.act.includes(g.name))) auto["g:-" + g.name] = true; });
  }
  // valeur cochée : ton choix s'il existe, sinon la détection automatique
  const checks = new Proxy({}, { get: (_, k) => (k in saved ? saved[k] : !!auto[k]), has: (_, k) => true });
  const ck = (key) => `<button class="sd-check ${checks[key] ? "on" : ""} ${auto[key] && !(key in saved) ? "auto" : ""}" data-ck="${esc(key)}" title="${auto[key] ? "Détecté sur ton perso (clique pour changer)" : "Fait"}">✓</button>`;

  // gains de l'étape : une tuile par stat, barre proportionnelle au gain
  const gain = (label, a, b, fmt = compact) => {
    const p = pc(a, b), w = Math.min(100, Math.abs(p) / 2);
    const raw = !a || Math.abs(p) > 999;   // départ ≈ 0 : le gain brut parle mieux
    const txt = raw ? ((b - (a || 0)) >= 0 ? "+" : "−") + fmt(Math.abs(b - (a || 0))) : pctText(p);
    return `<div class="sd-gain ${p > 0.5 ? "up" : p < -0.5 ? "down" : "flat"}"><span class="l">${label}</span><b>${fmt(b)}</b>
      <span class="d">${p > 0.5 ? "▲" : p < -0.5 ? "▼" : "•"} ${txt}</span><i style="--w:${w}%"></i></div>`;
  };

  // objet rare : on affiche sa base (le nom donné par l'auteur du guide est libre : prix, notes… ou rien)
  const unique = (x) => x && (x.rarity === "UNIQUE" || x.rarity === "RELIC");
  const mainName = (x) => unique(x) ? itemTitle(x) : (x.base || itemTitle(x));
  const authorName = (x) => !unique(x) && x.base && itemTitle(x) && itemTitle(x) !== x.base ? itemTitle(x) : "";
  const items = D.items.concat(D.guardian.map((r) => Object.assign({ minion: true }, r)));
  const CAT = [["gear", "Équipement", (r) => !r.minion && !/Flask|Socket|Abyssal|Jewel/i.test(r.slot)], ["jewel", "Joyaux", (r) => !r.minion && /Socket|Abyssal|Jewel/i.test(r.slot)],
    ["flask", "Flasques", (r) => !r.minion && /Flask/i.test(r.slot)], ["minion", "Sbire", (r) => r.minion]];
  const itemRow = (r) => {
    const x = r.to;
    // même objet en mieux : même unique, ou même base rare
    const upgraded = r.from && x && r.from.base === x.base && (unique(x) ? unique(r.from) && mainName(r.from) === mainName(x) : !unique(r.from));
    const key = "i:" + r.slot;
    const note = x && authorName(x);
    return `<div class="sd-it ${checks[key] ? "done" : ""}">${ck(key)}
      ${x ? `<span class="sd-ico" data-tip="${tip(x)}">${itemIcon(x, "sm")}</span>` : `<span class="sd-ico empty">∅</span>`}
      <div class="sd-it-main">
        <div class="sd-it-top"><span class="sd-it-name r-${esc(x ? x.rarity : "")}" ${x ? `data-tip="${tipReqs.length - 1}"` : ""}>${x ? esc(mainName(x)) : "Retirer l'objet"}</span>
          ${upgraded ? `<span class="sd-tag">${unique(x) ? "meilleur roll" : "meilleure version"}</span>` : ""}</div>
        <div class="sd-it-sub"><span class="sd-slotc">${esc(r.label)}</span>${note ? `<span class="muted" title="Nom donné par l'auteur du guide">« ${esc(note)} »</span>` : ""}
          ${r.from && !upgraded ? `<span class="muted">remplace ${esc(mainName(r.from))}</span>` : !r.from ? `<span class="muted">emplacement vide</span>` : ""}</div>
      </div></div>`;
  };
  const card = (ico, color, title, sub, body, keys) => {
    const n = keys.length, done = keys.filter((k) => checks[k]).length;
    return `<div class="sd-card"><div class="sd-card-h">${icon(ico, color)}<b>${title}</b>${sub ? `<span class="muted small">${sub}</span>` : ""}
      ${n ? `<span class="sd-count ${done === n ? "all" : ""}">${done}/${n}</span>` : ""}</div>${body}</div>`;
  };
  const cards = [];
  if (items.length) {
    const keys = items.map((r) => "i:" + r.slot);
    cards.push(card("shield", "--es", "Objets à changer", `${items.length} emplacement${items.length > 1 ? "s" : ""}`,
      CAT.map(([k, label, f]) => { const l = items.filter(f); return l.length ? `<div class="sd-grp"><div class="sd-grp-l">${label}</div>${l.map(itemRow).join("")}</div>` : ""; }).join(""), keys));
  }
  const T = D.tree, G = D.gems;
  if (T.added.length || T.removed.length) {
    const nodeChip = (n, sign) => `<span class="sd-node ${sign > 0 ? "add" : "rem"} ${n.kind === "keystone" ? "ks" : ""}" title="${esc((n.stats || []).join("\n"))}">${sign > 0 ? "+" : "−"} ${esc(n.name)}</span>`;
    const asc = T.added.filter((n) => n.asc), main = T.added.filter((n) => !n.asc);
    const key = "t:tree";
    const names = (l) => l.map((n) => esc(n.name)).join(", ");
    cards.push(card("target", "--accent", "Arbre passif", `${T.points >= 0 ? "+" : ""}${T.points} point${Math.abs(T.points) > 1 ? "s" : ""}${T.ascPoints ? ` · ${T.ascPoints > 0 ? "+" : ""}${T.ascPoints} ascendance` : ""}`,
      `<div class="sd-it ${checks[key] ? "done" : ""}">${ck(key)}<button class="sd-it-main sd-tree-open" data-tree-open title="Ouvrir l'arbre : nouveaux passifs en vert, à retirer en rouge">
        <div class="sd-it-top"><b>${main.length ? names(main.slice(0, 3)) + (main.length > 3 ? ` +${main.length - 3}` : "") : `${T.smallAdded} petit${T.smallAdded > 1 ? "s" : ""} passif${T.smallAdded > 1 ? "s" : ""}`}</b><span class="sd-tag">Voir sur l'arbre →</span></div>
        <div class="sd-it-sub">${asc.length ? `<span>Ascendance : ${names(asc)}</span>` : ""}${T.removed.length ? `<span class="muted">· retirer ${names(T.removed)}</span>` : ""}
          ${T.smallAdded ? `<span class="muted">· +${T.smallAdded} petits passifs</span>` : ""}</div></button></div>`, [key]));
  }
  if (G.added.length || G.removed.length || G.changed.length) {
    const rows = [], keys = [];
    G.added.forEach((g) => { const k = "g:+" + g.name; keys.push(k); rows.push(`<div class="sd-it ${checks[k] ? "done" : ""}">${ck(k)}<div class="sd-it-main"><div class="sd-it-top"><b>${esc(g.name)}</b><span class="sd-tag add">nouveau groupe</span></div>
      <div class="sd-it-sub">${g.gems.filter((n) => n !== g.name).map((n) => `<span class="sd-gem">${esc(n)}</span>`).join("")}</div></div></div>`); });
    G.changed.forEach((g) => { const k = "g:" + g.name; keys.push(k); rows.push(`<div class="sd-it ${checks[k] ? "done" : ""}">${ck(k)}<div class="sd-it-main"><div class="sd-it-top"><b>${esc(g.name)}</b></div>
      <div class="sd-it-sub">${g.add.map((n) => `<span class="sd-gem add">+ ${esc(n)}</span>`).join("")}${g.remove.map((n) => `<span class="sd-gem rem">− ${esc(n)}</span>`).join("")}
      ${g.levels.map((l) => `<span class="sd-gem">${esc(l.name)} <small>${l.from[0] || 1}/${l.from[1] || 0} → <b>${l.to[0] || 1}/${l.to[1] || 0}</b></small></span>`).join("")}</div></div></div>`); });
    G.removed.forEach((g) => { const k = "g:-" + g.name; keys.push(k); rows.push(`<div class="sd-it ${checks[k] ? "done" : ""}">${ck(k)}<div class="sd-it-main"><div class="sd-it-top"><b>${esc(g.name)}</b><span class="sd-tag rem">groupe retiré</span></div></div></div>`); });
    cards.push(card("zap", "--fire", "Gemmes", "niveau / qualité", rows.join(""), keys));
  }
  const cfgVal = (c, v) => v === undefined || v === null || v === false ? "non" : v === true ? "oui" : c.type === "list" ? (((c.options || []).find((o) => String(o.val) === String(v)) || {}).label || v) : v;
  if (D.config.length)
    cards.push(card("dots", "--chaos", "Réglages de simulation", "à reporter dans PoB, pas en jeu",
      D.config.map((c) => `<div class="sd-cfg"><span>${esc(stripPob(c.label))}</span><span><span class="muted">${esc(String(cfgVal(c, c.from)))}</span> → <b>${esc(String(cfgVal(c, c.to)))}</b></span></div>`).join(""), []));

  el.innerHTML = `<div class="sd">
    <div class="sd-hero">
      <div class="sd-path"><span class="sd-from">${esc(trees[idx - 1].title)}</span><span class="sd-arrow">→</span><span class="sd-to">${esc(trees[idx].title)}</span></div>
      ${D.levelTo !== D.levelFrom ? `<span class="sd-lvl">niveau ${D.levelFrom} → <b>${D.levelTo}</b></span>` : ""}
    </div>
    <div class="sd-prog" hidden><span>Changements faits pour cette étape : <b></b></span><div class="progress"><i></i></div>
      ${P ? `<span class="muted small">Les cases déjà faites sur ton perso sont cochées automatiquement.</span>` : ""}</div>
    <div class="sd-gains">${gain(dl, d1, d0)}${gain("Coup max encaissable", minHit(kf), minHit(kt))}${gain("Vie", kf.Life, kt.Life, nf)}${(kt.EnergyShield || 0) > 100 ? gain("Bouclier d'énergie", kf.EnergyShield, kt.EnergyShield, nf) : ""}</div>
    ${cards.length ? `<div class="sd-cards">${cards.join("")}</div>` : `<p class="muted small">Aucun changement d'arbre, d'équipement, de gemmes ou de config entre ces deux étapes.</p>`}
  </div>`;
  el.onclick = (ev) => {
    if (ev.target.closest("[data-tree-open]")) return openTreeDiff(id, prevStage, curStage, D, trees[idx - 1].title, trees[idx].title);
    const b = ev.target.closest("[data-ck]"); if (!b) return;
    const k = b.dataset.ck, cur = store.get(stageKey, {});
    cur[k] = !checks[k]; store.set(stageKey, cur); saved[k] = cur[k];
    $$("[data-ck]", el).filter((x) => x.dataset.ck === k).forEach((x) => {
      x.classList.toggle("on", cur[k]);
      const row = x.closest(".sd-it"); if (row) row.classList.toggle("done", cur[k]);
      const cardEl = x.closest(".sd-card"), cnt = cardEl && cardEl.querySelector(".sd-count");
      if (cnt) { const all = $$("[data-ck]", cardEl), d = all.filter((y) => y.classList.contains("on")).length; cnt.textContent = `${d}/${all.length}`; cnt.classList.toggle("all", d === all.length); }
    });
    allDone();
  };
  // toutes les cases de l'étape cochées : bandeau pour la valider et passer à la suivante
  function allDone() {
    const tl = $(".tl-card [data-ck]", el) ? $(".tl-card", el) : el;
    const keys = [...new Set($$("[data-ck]", tl).map((x) => x.dataset.ck))];
    const all = keys, d = keys.filter((k) => checks[k]).length;
    const pr = $(".sd-prog", el);
    if (pr && all.length) {
      pr.hidden = false;
      $("b", pr).textContent = `${d} / ${all.length}`;
      $("i", pr).style.width = (d / all.length * 100).toFixed(1) + "%";
      pr.classList.toggle("all", d === all.length);
    }
    const bn = $(".sd-alldone", el);
    const show = !!(opts && opts.validate && all.length && d === all.length);
    if (bn) bn.hidden = !show;
  }
  if (opts && opts.validate) {
    el.firstElementChild.insertAdjacentHTML("beforeend", `<div class="sd-alldone" hidden><span>✓ Tout est fait pour cette étape.</span>
      <button class="btn primary sm" data-validate>Valider l'étape et passer à la suivante →</button></div>`);
    $(".sd-alldone [data-validate]", el).onclick = (ev) => { ev.stopPropagation(); ev.target.disabled = true; opts.validate(); };
  }
  allDone();
  bindItemTips(el, (k) => tipReqs[+k]);
  // chronologie ordonnée et annotée par le créateur (Mode Création), lue par le joueur
  transitionCard(el.firstElementChild, id, trees[idx - 1].title, trees[idx].title, D, trees.map((t) => t.title), { checks }).then(allDone);
}

// ------------------------------------------------------------------ BARRE DE SETUP (toutes les pages d'un build)
// Perso : ses jeux PoB + l'étape du guide qu'il suit. Guide : l'étape (et ses jeux). Un changement vaut partout.
async function renderSetupBar(id, page, meta, token) {
  const bar = $("#setupbar"); if (!bar) return;
  let sets, gsets = null;
  const guideId = meta?.role !== "guide" ? meta?.guide : null;
  try {
    sets = await setsOf(id);
    if (guideId && buildMeta(guideId)) gsets = await setsOf(guideId);
  } catch (e) { bar.innerHTML = ""; return; }
  if (token !== routeToken) return;
  const sel = selectionOf(id, sets);
  const pick = (list, key, cur, attr) => `<select class="select sm" ${attr}="${key}">${list.map((x) => `<option value="${x.id}" ${x.id === cur ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select>`;
  const setFields = (sets, sel, attr, skipTree) => SET_KINDS.filter(([k, key]) => (sets[k] || []).length > 1 && !(skipTree && key === "tree"))
    .map(([k, key, label]) => `<label class="sb-field"><span>${label}</span>${pick(sets[k], key, sel[key], attr)}</label>`).join("");
  const stageField = (sets, sel, attr) => {
    const i = sets.trees.findIndex((t) => t.id === sel.tree);
    return `<div class="sb-stage">
      <button class="icon-btn" ${attr}-step="-1" ${i <= 0 ? "disabled" : ""} title="Étape précédente">‹</button>
      ${pick(sets.trees, "tree", sel.tree, attr)}
      <button class="icon-btn" ${attr}-step="1" ${i >= sets.trees.length - 1 ? "disabled" : ""} title="Étape suivante">›</button></div>`;
  };
  let html;
  if (meta?.role === "guide") {
    const staged = sets.trees.length > 1;
    const others = setFields(sets, sel, "data-own", true);
    html = `<div class="sb-group"><span class="sb-tag guide">Guide</span>
        ${staged ? `<span class="sb-label">Étape</span>${stageField(sets, sel, "data-own")}` : `<span class="muted small">Une seule étape</span>`}
        ${others ? `<details class="sb-more"><summary>Setups de l'étape</summary><div class="sb-pop">${others}<p class="muted small">Choisis l'étape : objets, gemmes et config suivent (même nom). Tu peux en forcer un ici.</p></div></details>` : ""}
      </div>`;
  } else {
    const own = setFields(sets, sel, "data-own", false);
    html = `<div class="sb-group"><span class="sb-tag mine">Ton perso</span>
        ${own || `<span class="muted small">Un seul setup dans ce build</span>`}</div>`;
    if (gsets) {
      const gsel = selectionOf(guideId, gsets);
      const done = progressOf(id, guideId);
      const isDone = done.includes(gsel.tree);
      const staged = gsets.trees.length > 1;
      html += `<div class="sb-group"><span class="sb-tag guide">Guide suivi</span>
        <a class="sb-link" href="#/b/${encodeURIComponent(guideId)}/guide" title="Ouvrir le guide">${esc(buildMeta(guideId).name)}</a>
        ${staged ? stageField(gsets, gsel, "data-gd") : ""}
        ${staged ? `<span class="sb-progress" title="Étapes validées">${done.length}/${gsets.trees.length}</span>
          <button class="btn sm ${isDone ? "done" : "primary"}" id="sb-validate" title="${isDone ? "Étape validée : cliquer pour annuler" : "Marquer l'étape comme faite et passer à la suivante"}">${isDone ? "✓ Validée" : "Valider l'étape"}</button>` : ""}
</div>`;
    } else if (page !== "compare") {
      html += `<div class="sb-group"><a class="sb-link muted" href="#/b/${encodeURIComponent(id)}/compare">Choisir un guide à suivre →</a></div>`;
    }
  }
  if (gsets && gsets.trees.length > 1) {
    const pct = progressOf(id, guideId).length / gsets.trees.length * 100;
    html += `<div class="sb-line" title="${Math.round(pct)} % du guide validé"><i style="width:${pct.toFixed(1)}%"></i></div>`;
  }
  bar.innerHTML = html;
  const apply = async (bid, bsets, patch) => {
    let st = Object.assign(selectionOf(bid, bsets), patch);
    // nouvelle étape d'un guide : les autres jeux suivent (même nom)
    if (patch.tree !== undefined && buildMeta(bid)?.role === "guide") st = await api("matchStage", { sets: bsets, tree: patch.tree });
    setStageOf(bid, st);
    route();
  };
  $$("[data-own]", bar).forEach((el) => el.onchange = () => apply(id, sets, { [el.dataset.own]: +el.value }));
  const vb = $("#sb-validate", bar);
  if (vb) vb.onclick = async () => {
    const cur = selectionOf(guideId, gsets).tree;
    const was = progressOf(id, guideId).includes(cur);
    await toggleStageDone(id, guideId, cur, !was);
    if (!was) {
      const i = gsets.trees.findIndex((t) => t.id === cur);
      toast(`Étape validée : ${gsets.trees[i].title}`);
      if (gsets.trees[i + 1]) return apply(guideId, gsets, { tree: gsets.trees[i + 1].id });
    }
    route();
  };
  $$("[data-gd]", bar).forEach((el) => el.onchange = () => apply(guideId, gsets, { [el.dataset.gd]: +el.value }));
  $$("[data-own-step],[data-gd-step]", bar).forEach((b) => b.onclick = () => {
    const own = b.hasAttribute("data-own-step");
    const bs = own ? sets : gsets, bid = own ? id : guideId;
    const cur = selectionOf(bid, bs).tree;
    const i = bs.trees.findIndex((t) => t.id === cur) + +b.getAttribute(own ? "data-own-step" : "data-gd-step");
    if (bs.trees[i]) apply(bid, bs, { tree: bs.trees[i].id });
  });
}

// ------------------------------------------------------------------ GUIDE
// Étape optionnelle ou variante (d'après son titre) : repérée à part, hors de la numérotation principale
function stageKind(title) {
  const t = (title || "").toLowerCase();
  if (/option/.test(t)) return "OPT";
  if (/variante?\b|alternati|\buber\b|blight/.test(t)) return "VAR";
  return null;
}
// Fiche du build (façon pages de build Mobalytics) : lue sur la dernière étape du guide, chiffres de PoB uniquement.
const HIT_TYPES = [["Physical", "Physique", "--normal"], ["Fire", "Feu", "--fire"], ["Cold", "Froid", "--cold"], ["Lightning", "Foudre", "--light"], ["Chaos", "Chaos", "--chaos"]];
async function buildSheetCard(box, id) {
  const open = store.get("sheetOpen", false);
  box.innerHTML = `<div class="card sheet"><div class="loading" style="padding:18px"><div class="spinner"></div>PoB prépare la fiche du build (dernière étape du guide)…</div></div>`;
  let r;
  try { r = await api("buildSheet", { id }); } catch (e) { box.innerHTML = ""; return; }
  if (!box.isConnected) return;
  const k = r.key || {}, info = r.info || {};
  const pct = (v) => v == null ? "—" : nf(v) + " %";
  // jauge 0 → plafond : remplissage accent, piste d'un ton plus clair
  const meter = (label, v, cap, help) => `<div class="sh-meter" title="${esc(help)}"><div class="row" style="justify-content:space-between"><span>${label}</span><b>${pct(v)}</b></div>
    <div class="sh-track"><i style="width:${Math.min(100, Math.max(0, (v || 0) / cap * 100)).toFixed(1)}%"></i></div></div>`;
  const hits = HIT_TYPES.map(([t, l, c]) => [l, c, k[t + "MaximumHitTaken"]]).filter((x) => x[2] > 0);
  const hmax = Math.max(1, ...hits.map((x) => x[2]));
  const weakest = hits.reduce((a, b) => (!a || b[2] < a[2] ? b : a), null);
  const life = k.Life || 0, es = k.EnergyShield || 0, pool = life + es || 1;
  // compétence active du groupe principal : celle que PoB calcule (un groupe de supports peut servir une compétence donnée par un objet)
  const main = r.main, mainName = main ? (r.mainName || (main.active || [])[0] || info.mainSkill || (main.gems.find((g) => !g.support) || {}).name || "") : "";
  box.innerHTML = `<details class="card sheet" ${open ? "open" : ""}>
    <summary class="sh-hero">
      ${portrait(info.ascendancy || info.class, "lg")}
      <div class="sh-id"><span class="eyebrow guide">Fiche du build</span>
        <h2>${esc(info.ascendancy || info.class || "Build")}${mainName ? ` · ${esc(mainName)}` : ""}</h2>
        <div class="muted small">${r.levelFrom ? `niveaux ${r.levelFrom} → ${r.levelTo}` : ""}${r.stages ? ` · ${r.stages} étapes` : ""}${r.lastStage ? ` · chiffres de l'étape la plus aboutie : « ${esc(r.lastStage)} »` : ""}</div></div>
      <div class="sh-big"><div><span class="muted small">DPS global</span><b>${compact(k.GlobalDPS)}</b></div>
        <div title="${HIT_HELP}"><span class="muted small">Coup max encaissable</span><b>${compact(k.MinMaxHit)}</b>${k.MinMaxHitType ? `<span class="muted small">point faible : ${esc(k.MinMaxHitType)}</span>` : ""}</div></div>
    </summary>
    <div class="sh-body">
      <section>
        <h4>Compétence principale</h4>
        ${main ? `<div class="sh-main"><b>${esc(mainName)}</b>${main.gems.length ? ` <span class="muted small">· ${main.gems.length} châsses liées</span>` : ""}${main.source && /^Item:/.test(main.source) ? ` <span class="muted small">donnée par ${esc(main.source.replace(/^Item:\d+:/, "").split(",")[0])}</span>` : ""}</div>${socketStrip(main.gems, "", { icons: true, tip: (i) => main.index + ":" + (i + 1) })}<p class="muted small" style="margin:2px 0 0">Survole une gemme pour son détail.</p>` : `<p class="muted small">Non définie.</p>`}
        ${(r.full || []).length > 1 ? `<p class="small muted" style="margin:8px 0 0">DPS global = ${r.full.map((x) => esc(x.name) + (x.count > 1 ? " ×" + x.count : "")).join(" + ")}</p>` : ""}
        <h4>Keystones</h4>
        <div class="sh-ks">${(r.keystones || []).map((n) => `<div class="ks" title="${esc((n.stats || []).join("\n"))}"><canvas width="96" height="96" data-ks="${n.id}"></canvas><span>${esc(n.name)}</span></div>`).join("") || `<span class="muted small">Aucun.</span>`}</div>
      </section>
      <section class="sh-ascsec">
        <h4>Ascendance</h4>
        <div class="sh-asc tree-wrap" id="sh-asc"></div>
        <div class="sh-ascnames">${(r.ascendancy || []).map((n) => `<span title="${esc((n.stats || []).join("\n"))}">${esc(n.name)}</span>`).join(" · ") || `<span class="muted small">—</span>`}</div>
      </section>
      <section>
        <h4>Objets clés</h4>
        <div class="sh-items">${(r.uniques || []).slice(0, 8).map((u) => `<div class="sh-item" title="${esc(u.slot)}">${itemIcon(u.item, "sm")}<div><div class="r-unique">${esc(itemTitle(u.item))}</div><div class="muted small">${esc(u.slot)}</div></div></div>`).join("") || `<p class="muted small">Aucun unique : le build tourne sur des objets rares.</p>`}${(r.uniques || []).length > 8 ? `<p class="muted small" style="margin:6px 0 0">+ ${r.uniques.length - 8} autres uniques (onglet Équipement visé)</p>` : ""}</div>
      </section>
      <section>
        <h4>Réserve de vie</h4>
        <div class="sh-pool" title="Vie ${nf(life)} · Bouclier d'énergie ${nf(es)}">${life ? `<i style="width:${(life / pool * 100).toFixed(1)}%;background:var(--life)"></i>` : ""}${es ? `<i style="width:${(es / pool * 100).toFixed(1)}%;background:var(--es)"></i>` : ""}</div>
        <div class="sh-legend"><span><i style="background:var(--life)"></i>Vie ${nf(life)}</span><span><i style="background:var(--es)"></i>Bouclier d'énergie ${nf(es)}</span>${k.Ward ? `<span>Ward ${nf(k.Ward)}</span>` : ""}</div>
        <h4>Couches défensives</h4>
        ${meter("Blocage des attaques", k.BlockChance, 75, "Chance de bloquer une attaque (plafond 75 %)")}
        ${meter("Blocage des sorts", k.SpellBlockChance, 75, "Chance de bloquer un sort (plafond 75 %)")}
        ${meter("Suppression des sorts", k.SpellSuppressionChance, 100, "Les sorts supprimés font 50 % de dégâts en moins (plafond 100 %)")}
        ${k.MeleeEvadeChance ? meter("Esquive (corps à corps)", k.MeleeEvadeChance, 95, "Chance d'esquiver une attaque au corps à corps") : ""}
        <div class="sh-res">${[["Feu", k.FireResist], ["Froid", k.ColdResist], ["Foudre", k.LightningResist], ["Chaos", k.ChaosResist]].map(([l, v]) => `<span class="${v != null && v < (l === "Chaos" ? 0 : 75) ? "low" : ""}">${l} <b>${pct(v)}</b></span>`).join("")}</div>
      </section>
      <section>
        <h4>Coup max encaissable, par type</h4>
        <div class="sh-hits">${hits.map(([l, c, v]) => `<div class="sh-hit ${weakest && weakest[0] === l ? "weak" : ""}"><span>${l}</span>
          <span class="sh-bar"><i style="width:${(v / hmax * 100).toFixed(1)}%;background:var(${c})"></i></span><b>${compact(v)}</b></div>`).join("")}</div>
        <p class="muted small" style="margin:8px 0 0">Le plus gros coup de chaque type encaissé sans mourir. ${weakest ? `Le point faible du build : <b>${esc(weakest[0].toLowerCase())}</b>.` : ""}</p>
      </section>
    </div></details>`;
  const d = $("details.sheet", box);
  // ascendance dessinée par le moteur de l'arbre (comme PoB) + icônes des keystones découpées dans ses atlas
  let mini = null;
  const drawTree = () => {
    if (mini || !d.open) return;
    const host = $("#sh-asc", box); if (!host) return;
    mini = new PobTree(host, { target: () => ({ id, stage: r.stage }), mini: true, search: false,
      onLoad: (t) => { t.fitAscendancy(); $$("canvas[data-ks]", box).forEach((cv) => t.nodeIcon(+cv.dataset.ks, cv)); } });
  };
  drawTree();
  d.ontoggle = () => { store.set("sheetOpen", d.open); drawTree(); };
  // infobulle de gemme dessinée par PoB, sur l'étape de la fiche
  box.onmouseover = (ev) => { const el = ev.target.closest("[data-sheet-tip]"); if (!el) return; const [gr, gm] = el.dataset.sheetTip.split(":").map(Number);
    FloatTip.show({ route: "gemTooltip", body: { id, stage: r.stage, group: gr, gem: gm } }, ev); };
  box.onmousemove = (ev) => { if (ev.target.closest("[data-sheet-tip]")) FloatTip.move(ev); };
  box.onmouseout = (ev) => { const el = ev.target.closest("[data-sheet-tip]"); if (el && !el.contains(ev.relatedTarget)) FloatTip.hide(); };
}
async function stageCurveCard(box, id, active, follower, onPick) {
  if (!box) return;
  if (!box.dataset.acc) {
    box.dataset.acc = "1";
    box.innerHTML = `<details class="card pad sl-acc"><summary><b>Progression du build</b> <span class="muted small">· courbes DPS et coup max sur toutes les étapes</span></summary><div class="sl-body"></div></details>`;
    const d = $("details", box);
    d.ontoggle = () => {
      if (d.open && !d.dataset.done) {
        d.dataset.done = "1";
        stageCurveCard($(".sl-body", box), id, active, follower, onPick);
      }
    };
    return;
  }
  box.innerHTML = `<div class="loading" style="padding:14px 0"><div class="spinner"></div>PoB calcule les étapes…</div>`;
  let r;
  try { r = await api("stageCurve", { id }); } catch (e) { box.innerHTML = ""; return; }
  if (!box.isConnected || !r.stages || r.stages.length < 2) { box.innerHTML = ""; return; }
  // ton perso : son état chargé s'il l'est, sinon les chiffres retenus dans la bibliothèque
  const fk = follower ? (S.snap[follower.id] && S.snap[follower.id].key) || (buildMeta(follower.id) || {}).stats || {} : {};
  box.innerHTML = `<div><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px">
      <span class="muted small">${r.stages.length} étapes calculées par PoB · clique un point pour ouvrir l'étape${follower ? ` · ligne grise : ${esc(follower.name)}` : ""}</span></div>
    <div class="sl-grid2">
      <div><div class="sl-title">DPS global <span class="muted small">(échelle ×10)</span></div><div class="sl" id="sl-dps"></div></div>
      <div><div class="sl-title">Coup max encaissable <span class="muted small">(le plus faible des 5 types)</span></div><div class="sl" id="sl-hit"></div></div>
    </div>
    <details class="sl-table"><summary class="muted small">Voir en tableau</summary>
      <table class="stat-table"><thead><tr><th></th><th>Étape</th><th class="v">Niveau</th><th class="v">DPS</th><th class="v">Coup max</th><th class="v">Vie / ES</th></tr></thead>
      <tbody>${r.stages.map((x, i) => `<tr><td class="muted">${i + 1}</td><td class="l">${esc(x.title)}</td><td class="v">${x.level || ""}</td><td class="v">${compact(x.dps)}</td><td class="v">${compact(x.hit)}${x.hitType ? ` <span class="muted small">${esc(x.hitType)}</span>` : ""}</td><td class="v">${compact(x.life)} / ${compact(x.es)}</td></tr>`).join("")}</tbody></table></details></div>`;
  const draw = () => {
    stageLine($("#sl-dps", box), { pts: r.stages.map((x) => ({ id: x.id, title: x.title, v: x.dps, sub: x.level ? "niv. " + x.level : "" })), fmt: compact, log: true, you: fk.GlobalDPS, active, onPick });
    stageLine($("#sl-hit", box), { pts: r.stages.map((x) => ({ id: x.id, title: x.title, v: x.hit, sub: x.hitType ? "coup de " + x.hitType : "" })), fmt: compact, log: false, you: fk.MinMaxHit, active, onPick });
  };
  draw();
  const ro = new ResizeObserver(() => { if (!box.isConnected) return ro.disconnect(); draw(); });
  ro.observe(box);
}
async function pageGuide(c, id, snap, token, _meta, viewer) {
  // viewer : le perso depuis lequel on regarde le guide qu'il suit (navigation du perso, sa progression)
  const navId = viewer || id;
  // Première visite d'un guide à étapes : on aligne objets / gemmes / config sur l'arbre actif
  if (!stageOf(id) && snap.sets.trees.length > 1) {
    const cur = snap.sets.trees.find((t) => t.active) || snap.sets.trees[0];
    const st = await api("matchStage", { sets: snap.sets, tree: cur.id });
    const actId = (l) => (l.find((x) => x.active) || {}).id;
    setStageOf(id, st);
    if (st.items !== actId(snap.sets.items) || st.skills !== actId(snap.sets.skills) || st.config !== actId(snap.sets.configs)) {
      snap = S.snap[id] = await api("open", { id, stage: st });
      if (token !== routeToken) return;
      if (!viewer) renderNav(id, "guide", buildMeta(id), snap);
    }
  }
  const sets = snap.sets;
  const trees = sets.trees;
  const active = trees.find((t) => t.active) || trees[0];
  const k = snap.key;
  const persos = (S.library?.builds || []).filter((b) => b.role === "perso");
  const titleOf = (lst) => (lst.find((x) => x.active) || {}).title || "—";
  // perso qui suit ce guide (sa progression s'affiche dans la liste des étapes)
  const follower = (viewer && persos.find((p) => p.id === viewer)) || persos.find((p) => p.id === store.get("guidePerso:" + id)) || persos.find((p) => p.guide === id) || persos[0];
  const done = follower ? new Set(progressOf(follower.id, id)) : new Set();
  c.innerHTML = `
    ${pageHead("guide", "Étapes du guide",
      `${viewer ? `« ${esc(buildMeta(id)?.name || id)} » : ` : ""}${trees.length > 1 ? `le plan en ${trees.length} étapes. Choisis une étape pour voir ce qu'elle change, puis valide-la quand ${viewer ? "ton perso l'a faite" : "le perso l'a faite"}.` : "ce build n'a qu'une seule étape."}`,
      `<div class="row">
        ${viewer ? `<button class="btn sm" id="g-detect" title="Trouver automatiquement l'étape qui correspond à ton perso">🎯 Détecter mon étape</button>
          <button class="btn primary" id="g-compare">Voir mes écarts avec cette étape →</button>`
          : persos.length ? `<select class="select" id="g-perso" title="Perso qui suit ce guide">${persos.map((p) => `<option value="${esc(p.id)}" ${follower && p.id === follower.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <button class="btn sm" id="g-detect" title="Trouver automatiquement l'étape qui correspond à ce perso">🎯 Détecter mon étape</button>
        <button class="btn primary" id="g-compare">Comparer ce perso à l'étape</button>` : `<span class="muted small">Ajoute un perso pour le comparer à ce guide.</span>`}
      </div>`)}
    <div id="orphan-notes" class="creator-only" style="margin-bottom:12px"></div>
    <div id="build-sheet" style="margin-bottom:16px"></div>
    <div class="guide-layout">
      <div class="card stages" id="stages">
        ${follower && trees.length > 1 ? `<div class="stages-progress"><div class="row" style="justify-content:space-between"><span class="small"><b>${esc(follower.name)}</b></span><span class="small muted">${done.size}/${trees.length} validées</span></div>
          <div class="progress"><i style="width:${(done.size / trees.length * 100).toFixed(1)}%"></i></div></div>` : ""}
        ${(() => { let n = 0; return trees.map((t) => { const k = stageKind(t.title); if (!k) n++; return Object.assign({ n, k }, t); }); })().map((t) => `<div class="stage-line"><button class="stage ${t.active ? "on" : ""} ${done.has(t.id) ? "done" : ""} ${t.k ? "side" : ""}" data-tree="${t.id}"><span class="ix ${t.k ? "tag-" + t.k.toLowerCase() : ""}" ${t.k ? `title="${t.k === "OPT" ? "Étape optionnelle" : "Variante"}"` : ""}>${done.has(t.id) ? "✓" : t.k || t.n}</span><span class="st">${esc(t.title)}</span></button>
          ${follower ? `<button class="stage-chk ${done.has(t.id) ? "on" : ""}" data-done="${t.id}" title="${done.has(t.id) ? "Annuler la validation" : "Valider cette étape"}">✓</button>` : ""}</div>`).join("")}
      </div>
      <div class="stack">
        <div class="section-title" style="margin:0"><h2>Ce que vise l'étape « ${esc(active.title)} »</h2></div>
        <div class="kpi-row">
          <div class="card kpi"><div class="label">${dpsLabel(k)}</div><div class="value">${compact(mainDps(k))}</div><div class="sub">${esc(dpsSub(k))}</div></div>
          <div class="card kpi" title="${HIT_HELP}"><div class="label">Coup max encaissable</div><div class="value">${compact(minHit(k))}</div><div class="sub">${minHitType(k) ? "point faible : " + esc(minHitType(k)) : ""}</div></div>
          <div class="card kpi"><div class="label">Vie / ES</div><div class="value">${compact(k.Life)}<span class="muted" style="font-size:16px"> / ${compact(k.EnergyShield)}</span></div></div>
          <div class="card kpi"><div class="label">Points passifs</div><div class="value">${snap.tree.points}</div><div class="sub">${snap.tree.ascPoints} d'ascendance · niv. ${snap.info.level}</div></div>
        </div>
        <div id="stage-diff"></div>
        <div id="stage-curve"></div>
        <details class="card pad">
          <summary style="cursor:pointer"><b>Composition de l'étape</b> <span class="muted small">· équipement « ${esc(titleOf(sets.items))} » · gemmes « ${esc(titleOf(sets.skills))} »</span></summary>
          <div class="stage-meta" style="margin-top:14px">
            ${[["items", "Équipement", sets.items], ["skills", "Gemmes", sets.skills], ["config", "Configuration", sets.configs]].map(([key, label, lst]) =>
              `<label><span class="field-label">${label}</span><select class="select" data-set="${key}">${lst.map((x) => `<option value="${x.id}" ${x.active ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select></label>`).join("")}
          </div>
        </details>
        ${snap.notes && snap.notes.trim() ? `<div class="card notes">${pobText(snap.notes.trim())}</div>` : `<div class="empty">Pas de notes dans ce build.</div>`}
      </div>
    </div>`;
  const apply = async (stage) => {
    c.style.opacity = .6;
    try {
      setStageOf(id, stage);
      S.snap[id] = await api("open", { id, stage });
    } catch (e) { toast(e.message, true); }
    c.style.opacity = 1;
    if (token === routeToken) route();
  };
  buildSheetCard($("#build-sheet"), id);
  orphanNotesCard($("#orphan-notes"), id, trees.map((t) => t.title));
  if (trees.length > 1) stageCurveCard($("#stage-curve"), id, active.id, follower, async (tid) => apply(await api("matchStage", { sets, tree: tid })));
  $("#stages").onclick = async (ev) => {
    const chk = ev.target.closest(".stage-chk");
    if (chk && follower) { await toggleStageDone(follower.id, id, +chk.dataset.done); return route(); }
    const b = ev.target.closest(".stage"); if (!b) return;
    const st = await api("matchStage", { sets, tree: +b.dataset.tree });
    apply(st);
  };
  $$("[data-set]").forEach((sel) => sel.onchange = () => {
    const st = { tree: active.id };
    $$("[data-set]").forEach((s) => st[s.dataset.set] = +s.value);
    apply(st);
  });
  if ($("#g-perso")) $("#g-perso").onchange = (ev) => { store.set("guidePerso:" + id, ev.target.value); route(); };
  const idx = trees.findIndex((t) => t.id === active.id);
  const onEl = $("#stages .stage.on"), stEl = $("#stages");
  if (onEl && stEl) stEl.scrollTop += onEl.getBoundingClientRect().top - stEl.getBoundingClientRect().top - stEl.clientHeight / 2 + onEl.offsetHeight / 2;
  if (trees.length > 1) loadStageDiff($("#stage-diff"), id, sets, idx, token, Object.assign({ persoId: follower && follower.id },
    follower && !done.has(active.id) ? {
      validate: async () => {
        await toggleStageDone(follower.id, id, active.id, true);
        toast(`Étape validée : ${active.title}`);
        const next = trees[idx + 1];
        if (next) apply(await api("matchStage", { sets, tree: next.id })); else route();
      },
    } : {}));
  if ($("#g-compare")) $("#g-compare").onclick = async () => {
    cmpTab = "priorities";
    store.set("cmpTab", cmpTab);
    if (viewer) return go(viewer, "compare");
    const pid = $("#g-perso").value;
    await api("meta", { id: pid, guide: id });
    await loadLibrary(true);
    go(pid, "compare");
  };
  if ($("#g-detect")) $("#g-detect").onclick = async () => {
    const pid = viewer || ($("#g-perso") && $("#g-perso").value);
    if (!pid) return;
    const btn = $("#g-detect");
    btn.disabled = true;
    try {
      const det = await api("detectStage", { mine: pid, guide: id, mineSets: stageOf(pid) });
      const targetTree = trees.find((t) => t.id === det.treeId);
      const st = await api("matchStage", { sets, tree: det.treeId });
      toast(`Étape détectée : ${targetTree ? targetTree.title : "#" + det.treeId} (${det.reason})`);
      await apply(st);
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    }
  };
}

// ------------------------------------------------------------------ COMPARER
// Deux familles d'onglets : « À faire » (agir) puis « Différences » (comprendre en détail)
const CMP_TABS = [
  { label: "À faire", tabs: [
    ["analysis", "Problèmes", "Ce qui ne marche pas ou te met en danger dans ton build : à corriger avant tout le reste."],
    ["priorities", "Améliorations", "Ce que tu peux changer pour te rapprocher du guide, trié par gain mesuré par PoB."],
  ] },
  { label: "Différences", tabs: [
    ["items", "Équipement", "Chaque emplacement : ton objet face à celui du guide, et ce que celui du guide t'apporterait."],
    ["tree", "Arbre", "Les passifs du guide qui te manquent, et ceux que tu as en plus."],
    ["gems", "Gemmes", "Groupe par groupe : gemmes manquantes, niveaux et qualité."],
    ["stats", "Statistiques", "Chaque stat face au guide, ce que l'écart te coûte, et d'où vient la valeur (clique sur une ligne)."],
  ] },
];
let cmpTab = store.get("cmpTab", "analysis");
let lintCat = "all";
// « Corriger » : un problème ou une amélioration ouvre l'onglet où se fait la correction, sur le bon élément
let cmpFocus = null;   // { tab, slot | slotRe | keyRe | node | gem, from, back }
const CFG_FIX = { "config.charges.power": "usePowerCharges", "config.charges.frenzy": "useFrenzyCharges", "config.charges.endurance": "useEnduranceCharges",
  "config.charges.minionpower": "minionsUsePowerCharges", "config.charges.minionfrenzy": "minionsUseFrenzyCharges",
  "config.player.fulllife": "conditionFullLife", "config.player.lowlife": "conditionLowLife", "config.minion.fulllife": "minionsConditionFullLife" };
function fixTarget(f) {
  const id = f.id || "";
  let m;
  if (CFG_FIX[id]) return { page: "s-config", focus: CFG_FIX[id], label: "Simuler la config" };
  if (id === "meca.mainskill") return { page: "gems", label: "Gemmes de ton perso" };
  if ((m = id.match(/^survie\.res\.(fire|cold|lightning|chaos)/))) return { tab: "stats", keyRe: new RegExp("^" + m[1][0].toUpperCase() + m[1].slice(1) + "Resist$"), label: "Statistiques" };
  if ((m = id.match(/^meca\.attr\.(str|dex|int)/))) return { tab: "stats", keyRe: new RegExp("^" + m[1][0].toUpperCase() + m[1].slice(1) + "$"), label: "Statistiques" };
  if (id === "survie.ehp.guide") return { tab: "stats", keyRe: /MaximumHitTaken$/, label: "Statistiques" };
  if (id === "survie.maxhit") return { tab: "stats", keyRe: /MaximumHitTaken/, label: "Statistiques" };
  if (id === "survie.suppress") return { tab: "stats", keyRe: /SpellSuppression/, label: "Statistiques" };
  if (id === "survie.netregen") return { tab: "stats", keyRe: /NetLifeRegen|LifeRegen/, label: "Statistiques" };
  if (id === "survie.escap") return { tab: "stats", keyRe: /^(Armour|Evasion|EnergyShield)$/, label: "Statistiques" };
  if (id === "meca.accuracy") return { tab: "stats", keyRe: /Accuracy/, label: "Statistiques" };
  if (/^survie\.immune\.|^prog\.flasks|^prog\.mageblood/.test(id)) return { tab: "items", slotRe: id === "prog.mageblood" ? /^Belt$/ : /^Flask/, label: "Équipement" };
  if (id === "prog.keyitems") return { tab: "items", label: "Équipement" };
  if (/^prog\.(keystones|ascendancy)/.test(id)) return { tab: "tree", label: "Arbre" };
  if (id === "prog.dps") return { tab: "priorities", label: "Améliorations" };
  if (/^meca\.(reservation|mana|auras|mainlink|gemlevel|gemlow)/.test(id)) return { tab: "gems", label: "Gemmes" };
  return null;
}
function recoTarget(r) {
  if (r.type === "item") return { tab: "items", slot: r.slot, guardian: !!r.guardian, label: "Équipement" };
  if (r.type === "node") return { tab: "tree", node: r.name, label: "Arbre" };
  if (r.type === "gem") return { tab: "gems", gem: r.name, label: "Gemmes" };
  return null;
}
let recoMetric = store.get("recoMetric", "dps");

async function pageCompare(c, id, _snap, token, meta, opts = {}) {
  // opts.only : un seul onglet de la comparaison (vue « Comparer » d'Équipement / Arbre / Gemmes)
  const only = opts.only || null;
  await loadLibrary(true);
  meta = buildMeta(id);
  const all = S.library.builds;
  // id peut être un perso (cas normal) ou un guide (on cherche le perso qui le suit)
  let mineId = id, guideId = meta?.guide;
  if (meta?.role === "guide") {
    guideId = id;
    const p = all.find((b) => b.role === "perso" && b.guide === id) || all.find((b) => b.role === "perso");
    mineId = p ? p.id : null;
  }
  const guides = all.filter((b) => b.id !== mineId);
  const persos = all.filter((b) => b.id !== guideId);
  if (!guideId || !mineId) {
    c.innerHTML = `${pageHead("cmp", "Choisir un guide", "Choisis ton personnage et le guide qu'il suit : Lucid mesurera ensuite ce qui les sépare, étape par étape.")}
      <div class="card vs-bar">
        <label><span class="field-label">Mon perso</span><select class="select" id="c-mine" style="width:100%">${persos.map((b) => `<option value="${esc(b.id)}" ${b.id === mineId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
        <span class="vs">vs</span>
        <label><span class="field-label">Guide</span><select class="select" id="c-guide" style="width:100%">${guides.filter((b) => b.role === "guide").concat(guides.filter((b) => b.role !== "guide")).map((b) => `<option value="${esc(b.id)}" ${b.id === guideId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
        <button class="btn primary" id="c-go">Comparer</button>
      </div>`;
    $("#c-go").onclick = async () => {
      const m = $("#c-mine").value, g = $("#c-guide").value;
      if (m === g) return toast("Choisis deux builds différents", true);
      await api("meta", { id: m, guide: g, role: "perso" });
      await loadLibrary(true);
      go(m, "compare");
    };
    return;
  }
  const gMeta = buildMeta(guideId), mMeta = buildMeta(mineId) || {};
  // réglages de la comparaison, mémorisés sur le perso
  const stage = stageOf(guideId);
  const cmpOpts = { mineSets: stageOf(mineId), cfgSource: mMeta.cfgSource || "guide", fullDps: mMeta.fullDps || "guide" };
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Le moteur PoB compare les deux builds et teste chaque différence…</div>`;
  let R;
  try { R = await api("compare", Object.assign({ guide: guideId, stage, mine: mineId }, cmpOpts)); }
  catch (e) { c.innerHTML = `<div class="card pad"><h3>Comparaison impossible</h3><p class="muted">${esc(e.message)}</p></div>`; return; }
  if (token !== routeToken) return;
  S.snap = {}; // le moteur a changé de build actif
  const G = R.guide, M = R.mine;
  const trees = G.sets.trees;
  const activeTree = trees.find((t) => t.active) || trees[0];
  const T = R.tree;
  const pctTree = T.guide.length ? Math.round(T.common / T.guide.length * 100) : 0;

  const kp = (label, mine, guide, fmt = compact, lowerBetter = false) => {
    const ratio = guide ? Math.max(0, Math.min(1, lowerBetter ? guide / mine : mine / guide)) : 1;
    return `<div class="card cmp-kpi"><div class="label">${esc(label)}</div>
      <div class="pair"><span class="mine">${fmt(mine)}</span><span class="goal">/ ${fmt(guide)}</span></div>
      <div class="progress"><i style="width:${(ratio * 100).toFixed(1)}%;background:${ratio >= .999 ? "var(--good)" : "var(--accent)"}"></i></div></div>`;
  };
  const mk = M.key, gk = G.key;
  const res = (k) => Math.min(k.FireResist ?? 0, k.ColdResist ?? 0, k.LightningResist ?? 0);
  const recos = R.recos.filter((r) => r.type !== "gem");
  const gemRecos = R.recos.filter((r) => r.type === "gem");
  const itemsDiff = R.items.concat(...(R.guardian || []).map((g) => g.rows)).filter((x) => !x.same).length;

  const prevTab = cmpTab;
  if (only) cmpTab = only;
  c.innerHTML = `
    ${only ? pageHead("cmp", { items: "Équipement : toi face au guide", tree: "Arbre : toi face au guide", gems: "Gemmes : toi face au guide" }[only] || "Comparer",
      `Étape « ${esc(activeTree.title)} » · mesuré par PoB sur <b>ton</b> build.`) : ""}
    <div ${only ? "hidden" : ""}>
    ${pageHead("cmp", "Écarts avec l'étape", `Ce qui sépare ton perso de l'étape « ${esc(activeTree.title)} » et ce qu'il faut faire, mesuré par PoB sur <b>ton</b> build.`)}
    ${cmpSetupPanel(R, { persos, guides, mineId, guideId })}
    ${dpsGapCard(R.dpsGap)}
    </div>
    <div class="tabs grouped" id="c-tabs" ${only ? "hidden" : ""}>
      ${CMP_TABS.map((g) => `<div class="tab-group"><span class="tab-glabel">${g.label}</span><div class="tab-btns">${g.tabs.map(([k, l]) => {
        const n = { analysis: lintCount(R), priorities: recos.length, items: itemsDiff, tree: T.toTake.length, gems: gemRecos.length, stats: "" }[k];
        return `<button data-t="${k}" class="${cmpTab === k ? "on" : ""}">${l}<span class="count">${n}</span></button>`;
      }).join("")}</div></div>`).join("")}
    </div>
    <p class="tab-purpose" id="c-purpose"></p>
    <div id="c-body"></div>`;

  const save = async (patch) => { await api("meta", Object.assign({ id: mineId }, patch)); await loadLibrary(true); };
  $("#c-mine").onchange = async (ev) => { await api("meta", { id: ev.target.value, guide: guideId, role: "perso" }); await loadLibrary(true); go(ev.target.value, "compare"); };
  $("#c-guide").onchange = async (ev) => { await save({ guide: ev.target.value }); go(mineId, "compare"); route(); };
  // réglages : chaque changement est mémorisé sur le perso puis la comparaison est relancée
  $$("[data-opt]", c).forEach((el) => el.onclick = async (ev) => {
    const b = ev.target.closest("button[data-v]"); if (!b || b.classList.contains("on")) return;
    await save({ [el.dataset.opt]: b.dataset.v }); route();
  });

  $$("[data-part]", c).forEach((sel) => sel.onchange = () => setMainPart(c, mineId, +sel.dataset.part, +sel.value));
  const ms = $("#cmp-main-skill", c);
  if (ms) ms.onchange = async () => {
    c.style.opacity = .6;
    try { S.snap[mineId] = await api("mainSkill", { id: mineId, stage: stageOf(mineId), index: +ms.value }); } catch (e) { toast(e.message, true); }
    c.style.opacity = 1; route();
  };
  const sm = $(".setup-more", c);
  if (sm) sm.ontoggle = () => store.set("cmpSetupOpen", sm.open);
  $("#c-tabs").onclick = (ev) => {
    const b = ev.target.closest("button[data-t]"); if (!b) return;
    cmpTab = b.dataset.t; store.set("cmpTab", cmpTab);
    $$("#c-tabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderTab();
  };
  const body = $("#c-body");
  function renderTab() {
    const def = CMP_TABS.flatMap((g) => g.tabs).find((t) => t[0] === cmpTab);
    $("#c-purpose").textContent = def ? def[2] : "";
    const done = ({ analysis: tabAnalysis, priorities: tabPriorities, items: tabItems, tree: tabTree, gems: tabGems, stats: tabStats }[cmpTab] || tabPriorities)(body, R, { recos, gemRecos });
    Promise.resolve(done).then(() => applyFocus(body, R));
  }
  R._jump = (t) => {
    if (!t) return;
    if (only) { cmpTab = t.tab || cmpTab; store.set("cmpTab", cmpTab); return go(mineId, "guide", "ecarts"); }
    if (t.page) { if (t.focus) S.cfgFocus = { var: t.focus, from: t.from }; return go(mineId, t.page); }
    cmpFocus = Object.assign({}, t);
    cmpTab = t.tab; store.set("cmpTab", cmpTab);
    $$("#c-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === cmpTab));
    renderTab();
  };
  // « Voir où corriger » depuis la colonne Santé : on saute directement à l'endroit de la correction
  if (S.pendingFix) {
    const f = S.pendingFix; S.pendingFix = null;
    const t = fixTarget(f);
    if (t) return R._jump(Object.assign(t, { from: f.title || f.id, back: "analysis" }));
    cmpTab = "analysis";
    $$("#c-tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === cmpTab));
  }
  renderTab();
  if (only) cmpTab = prevTab;   // la page Écarts garde son onglet
}

// Focus après un « Corriger » : bandeau de retour, élément ouvert (avant / après) et surligné
function applyFocus(body, R) {
  const f = cmpFocus;
  if (!f || f.tab !== cmpTab) return;
  cmpFocus = null;
  const BACK = { analysis: "Problèmes", priorities: "Améliorations" };
  body.insertAdjacentHTML("afterbegin", `<div class="fix-banner">${icon("target", "--accent")}<span>Pour corriger <b>${esc(f.from || "")}</b> : ${
    f.tab === "items" ? "ton objet (avant) face à celui du guide (après), avec ce qui change." : f.tab === "stats" ? "ta valeur face à celle du guide et d'où elle vient." : f.tab === "tree" ? "le passif à prendre, son gain et son coût en points." : f.tab === "gems" ? "ton groupe (avant) face à celui du guide (après)." : ""}</span>
    ${f.back ? `<button class="btn sm" data-back>← ${BACK[f.back] || "Retour"}</button>` : ""}</div>`);
  const bk = $("[data-back]", body);
  if (bk) bk.onclick = () => $(`#c-tabs button[data-t="${f.back}"]`).click();
  let el = null;
  if (f.tab === "items") {
    const rows = R.items.concat(...(R.guardian || []).map((g) => g.rows.map((r) => Object.assign({ guardian: g }, r))));
    const i = rows.findIndex((r) => (f.slot ? r.slot === f.slot && !!r.guardian === !!f.guardian : f.slotRe ? f.slotRe.test(r.slot) && !r.same : false));
    if (i >= 0) {
      el = body.querySelector(`tr.row-click[data-i="${i}"], .inv-slot[data-i="${i}"]`);
      if (el) el.click();
    }
  } else if (f.tab === "stats" && f.keyRe) {
    el = [...body.querySelectorAll("tr[data-k]")].find((tr) => f.keyRe.test(tr.dataset.k));
    if (el && el.classList.contains("why-row")) el.click();
  } else if (f.tab === "tree" && f.node) {
    el = [...body.querySelectorAll(".node-row")].find((x) => x.dataset.name === f.node);
  } else if (f.tab === "gems" && f.gem) {
    const g = f.gem.toLowerCase();
    el = [...body.querySelectorAll(".ggroup")].find((x) => (x.dataset.gems || "").split("|").includes(g));
  }
  if (el) el.classList.add("focus-hl");
  // l'élément ouvert (ou à défaut le bandeau) au centre de l'écran, une fois le détail inséré
  const target = el || $(".fix-banner", body);
  setTimeout(() => target && target.scrollIntoView({ block: el ? "center" : "start" }), 80);
}

// ------------------------------------------------------------------ réglages de la comparaison
// Deux colonnes (ton perso / le guide) avec les 4 jeux PoB utilisés de chaque côté, puis les règles de calcul.
const SET_KINDS = [["trees", "tree", "Arbre"], ["items", "items", "Objets"], ["skills", "skills", "Gemmes"], ["configs", "config", "Config"]];
function setTitle(list) {
  const act = (list || []).find((x) => x.active) || (list || [])[0] || {};
  return `<span class="set-one" title="${esc(act.title || "")}">${esc(act.title || "Default")}</span>`;
}
function setSelect(list, attr, key, disabled) {
  list = list || [];
  const act = list.find((x) => x.active) || list[0] || {};
  if (list.length <= 1) return `<span class="set-one" title="${esc(act.title || "")}">${esc(act.title || "Default")}</span>`;
  return `<select class="select sm" ${attr}="${key}" ${disabled ? "disabled" : ""}>${list.map((x) => `<option value="${x.id}" ${x.id === act.id ? "selected" : ""}>${esc(x.title || "Default")}</option>`).join("")}</select>`;
}
function cmpSetupPanel(R, { persos, guides, mineId, guideId }) {
  const G = R.guide, M = R.mine, o = R.options || {}, sc = R.simConfig || {};
  const trees = G.sets.trees || [];
  const activeTree = trees.find((t) => t.active) || trees[0] || {};
  const who = (info) => `${portrait(info.ascendancy || info.class, "sm")}<span>${esc(info.ascendancy || info.class || "")} · niveau ${info.level || "?"}${info.mainSkill ? " · " + esc(info.mainSkill) : ""}</span>`;
  const cfgGuide = o.cfgSource !== "mine", fdGuide = o.fullDps !== "mine";
  const nOpt = (sc.applied || []).length;
  const names = { bandit: "Bandit", pantheonMajorGod: "Panthéon majeur", pantheonMinorGod: "Panthéon mineur" };
  const diffs = Object.entries(sc.choices || {}).filter(([, v]) => v && v[0] !== v[1]);
  const seg = (opt, cur, a, b) => `<div class="seg sm" data-opt="${opt}">
      <button data-v="guide" class="${cur ? "on" : ""}">${a}</button><button data-v="mine" class="${cur ? "" : "on"}">${b}</button></div>`;
  return `<div class="card cmp-setup compact">
    <div class="setup-quick">
      <div class="q"><b>Conditions</b>${seg("cfgSource", cfgGuide, "Réalistes", "Les miennes")}</div>
      <div class="q"><b>DPS</b>${seg("fullDps", fdGuide, "Comme le guide", "Mon réglage")}</div>
      ${(R.dropped || []).length && cfgGuide ? `<span class="tag warn" title="Conditions du guide que ton build ne peut pas activer">${R.dropped.length} condition${R.dropped.length > 1 ? "s" : ""} retirée${R.dropped.length > 1 ? "s" : ""}</span>` : ""}
      ${diffs.length ? `<span class="tag warn">${diffs.length} choix de perso différent${diffs.length > 1 ? "s" : ""}</span>` : ""}
    </div>
    <details class="setup-more" ${store.get("cmpSetupOpen", false) ? "open" : ""}><summary>Réglages de simulation</summary>
    <div class="setup-cols">
      <div class="setup-col">
        <div class="setup-h"><span class="who-tag mine">Ton perso</span>
          <select class="select" id="c-mine">${persos.map((b) => `<option value="${esc(b.id)}" ${b.id === mineId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
        <div class="setup-id">${who(M.info)}</div>
        <div class="setup-sets">
          ${SET_KINDS.map(([k, key, label]) => `<div class="set-row"><span>${label}</span>${key === "config" && cfgGuide
            ? `<span class="set-one muted" title="Remplacée par les conditions de l'étape du guide (voir « Calcul » plus bas)">Conditions du guide</span>`
            : setTitle(M.sets && M.sets[k])}</div>`).join("")}
        </div>
      </div>
      <div class="setup-vs">vs</div>
      <div class="setup-col">
        <div class="setup-h"><span class="who-tag guide">Guide</span>
          <select class="select" id="c-guide">${guides.map((b) => `<option value="${esc(b.id)}" ${b.id === guideId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
        <div class="setup-id">${who(G.info)}</div>
        <div class="setup-sets">
          ${SET_KINDS.map(([k, key, label]) => `<div class="set-row ${key === "tree" ? "stage" : ""}"><span>${key === "tree" ? "Étape" : label}</span>${setTitle(G.sets[k])}</div>`).join("")}
        </div>
      </div>
    </div>
    <p class="setup-hint muted small">Les setups et l'étape se changent dans la barre en haut : le choix vaut pour toutes les pages.</p>
    <div class="setup-calc">
      <div class="calc-row">
        <div><b>Conditions de simulation</b><div class="muted small">${cfgGuide
          ? `Ton perso est simulé dans la situation de combat de l'étape (boss, état de l'ennemi, buffs : ${nOpt} option${nOpt > 1 ? "s" : ""}), <b>sauf</b> ce que ton build ne peut pas activer lui-même.`
          : "Ta propre configuration PoB : les écarts peuvent venir des cases cochées, pas du build."}</div>
          ${cfgGuide && (R.dropped || []).length ? `<div class="dropped">${R.dropped.map((d) => `<div class="dropped-row">${icon("zap", "--warn")}<span><b>${esc(d.label)}</b> : retiré chez toi, aucune source dans ton build${d.guideSrc ? ` (le guide : « ${esc(d.guideSrc)} »)` : ""}.
            ${d.impactText ? `<span class="muted">Avec une source : ${esc(d.impactText)}.</span>` : ""}</span></div>`).join("")}
            <p class="muted small" style="margin:4px 0 0">Un objet testé qui apporte cette source la réactive pendant son test (et l'inverse si ton objet était la seule source).</p></div>` : ""}</div>
      </div>
      <div class="calc-row">
        <div><b>DPS global</b><div class="muted small">${fdGuide
          ? (sc.fullDps || []).length ? `Mêmes compétences additionnées que le guide : ${esc(sc.fullDps.map((x) => typeof x === "string" ? x : x.name + (x.count > 1 ? " ×" + x.count : "")).join(", "))}.` : "Le guide n'additionne aucune compétence : DPS de la compétence principale."
          : (sc.mineFullDps || []).length ? `Tes compétences cochées « Full DPS » : ${esc(sc.mineFullDps.join(", "))}.` : "Aucune compétence cochée « Full DPS » dans ton build : DPS de ta compétence principale (le guide, lui, additionne ses compétences : les deux chiffres ne mesurent pas la même chose)."}</div></div>
        ${!fdGuide && !(sc.mineFullDps || []).length && (R.mineSkills || []).length ? `<select class="select" id="cmp-main-skill" style="max-width:280px" title="Compétence principale de ton perso (mémorisée dans Lucid, ton fichier PoB n'est pas modifié)">
          ${R.mineSkills.map((g) => `<option value="${g.index}" ${g.main ? "selected" : ""}>${esc(g.name)}${g.slot ? " — " + esc(g.slot) : ""}</option>`).join("")}</select>
          ${(() => { const m = R.mineSkills.find((g) => g.main && g.parts); return m ? partSelect(m) : ""; })()}` : ""}
      </div>
      <div class="calc-row">
        <div><b>Bandit et panthéons</b><div class="muted small">Toujours ceux de ton perso (ce sont des choix réels de ton personnage).
          ${diffs.length ? diffs.map(([k, v]) => `${names[k]} : <b>${esc(v[0] || "aucun")}</b> (guide : ${esc(v[1] || "aucun")})`).join(" · ") : "Identiques au guide."}</div></div>
        ${diffs.length ? `<span class="tag warn">${diffs.length} différent${diffs.length > 1 ? "s" : ""}</span>` : `<span class="tag">identiques</span>`}
      </div>
      ${simConfigPanel(R)}
    </div>
    </details>
  </div>`;
}

// conditions de simulation : celles de l'étape du guide, appliquées à ton perso
function simConfigPanel(R) {
  const sc = R.simConfig || {};
  const rows = (sc.applied || []).filter((o) => o.value !== undefined && o.value !== null);
  const val = (o) => o.type === "check" ? "oui" : o.type === "list" ? ((o.options || []).find((x) => String(x.val) === String(o.value)) || {}).label || o.value : o.value;
  const mine = R.options && R.options.cfgSource === "mine";
  return `<details class="sim-config">
    <summary class="muted small">Voir les ${rows.length} option${rows.length > 1 ? "s" : ""} de simulation utilisée${rows.length > 1 ? "s" : ""} pour ton perso${mine ? " (ta config)" : " (config de l'étape du guide)"}</summary>
    <div class="sim-grid">${rows.map((o) => `<div class="sim-row"><span>${esc(stripPob(o.label))}</span><b>${esc(String(val(o)))}</b></div>`).join("") || '<p class="muted">Aucune condition particulière.</p>'}</div>
  </details>`;
}
function tabPriorities(body, R, { recos, gemRecos }) {
  const score = (r) => recoMetric === "dps" ? (r.head.dps || 0) : (r.head.ehp || 0);
  const list = recos.slice().sort((a, b) => score(b) - score(a));
  const positive = list.filter((r) => score(r) > 0.05);
  const rest = list.filter((r) => score(r) <= 0.05);
  const row = (r, i) => `<div class="reco reco-go" data-r="${recos.indexOf(r)}" title="Ouvrir là où se fait le changement (avant / après)">
      <span class="rank">${i + 1}</span>
      <div class="what">
        <div class="t">${r.type === "item" ? esc(r.name) : esc(r.name)} ${r.type === "node" ? `<span class="tag">${r.kind === "keystone" ? "Keystone" : "Notable"} · ${r.cost} pt${r.cost > 1 ? "s" : ""}</span>` : `<span class="tag">${esc(r.label)}</span>`}</div>
        <div class="s">${r.type === "item" ? (r.guardian ? "porté par ton Guardian · " : "") + (r.from ? "remplace " + esc(r.from) : "emplacement vide") : "Passif du guide absent de ton arbre (chemin compris)"}${r.head.life ? ` · ${r.head.life > 0 ? "+" : "−"}${nf(Math.abs(r.head.life))} vie` : ""}${r.head.es ? ` · ${r.head.es > 0 ? "+" : "−"}${nf(Math.abs(r.head.es))} ES` : ""}</div>
      </div>
      <div class="gain">${gainBars(r.head, recoMetric)}</div>
      <span class="reco-arrow">${icon("arrow")}</span>
    </div>`;
  body.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <p class="muted small" style="margin:0">Chaque ligne = l'élément du guide appliqué seul à <b>ton</b> build. Le moteur recalcule tout : synergies, plafonds, conversions.</p>
      <div class="seg" id="metric"><button data-m="dps" class="${recoMetric === "dps" ? "on" : ""}">Trier par DPS</button><button data-m="ehp" class="${recoMetric === "ehp" ? "on" : ""}">Trier par survie</button></div>
    </div>
    ${positive.length ? `<div class="card">${positive.map(row).join("")}</div>` : `<div class="empty">Aucun gain mesurable sur ce critère : ton build est au niveau du guide à cette étape.</div>`}
    ${rest.length ? `<details class="section"><summary class="muted" style="cursor:pointer">${rest.length} autre${rest.length > 1 ? "s" : ""} différence${rest.length > 1 ? "s" : ""} sans gain sur ce critère</summary><div class="card" style="margin-top:10px">${rest.map((r, i) => row(r, positive.length + i)).join("")}</div></details>` : ""}
    ${gemRecos.length ? `<div class="section"><div class="section-title"><h2>Gemmes manquantes</h2><span class="muted">À ajouter selon le guide</span></div>
      <div class="card pad"><div class="row wrap">${gemRecos.map((g, i) => `<button class="tag tag-btn ${g.support ? "" : "accent"}" data-gr="${i}">${esc(g.name)}${g.group && g.group !== g.name ? ` <span class="muted">· ${esc(g.group)}</span>` : ""}</button>`).join("")}</div></div></div>` : ""}`;
  body.querySelectorAll("[data-r]").forEach((el) => el.onclick = () => {
    const r = recos[+el.dataset.r]; if (r && R._jump) R._jump(Object.assign(recoTarget(r), { from: r.name, back: "priorities" }));
  });
  body.querySelectorAll("[data-gr]").forEach((el) => el.onclick = () => {
    const g = gemRecos[+el.dataset.gr]; if (g && R._jump) R._jump(Object.assign(recoTarget(g), { from: g.name, back: "priorities" }));
  });
  $("#metric").onclick = (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    recoMetric = b.dataset.m; store.set("recoMetric", recoMetric);
    tabPriorities(body, R, { recos, gemRecos });
  };
}

function tabItems(body, R) {
  const gRows = (R.guardian || []).flatMap((g) => g.rows.map((r) => Object.assign({ guardian: g }, r)));
  const rows = R.items.concat(gRows);
  R.items.forEach((r) => { r._rows = R.items; });
  const view = store.get("cmpItemsView", "table");
  const ctx = { id: R.mine.id, stage: R.mine.stage };
  // détail d'un emplacement : les deux infobulles PoB côte à côte, recherche trade, stats qui bougent
  const detailHtml = (r) => r.guardian
    ? `<div class="side-by-side">${itemCard(r.mine, { label: "Porté par ton Guardian", raw: true, noCompare: true, ctx })}${itemCard(r.guide, { label: "Guardian du guide (évalué par PoB sur ton Guardian)", raw: true, noCompare: true, ctx })}</div>
        ${(r.minionDiff || []).length ? `<div class="card pad" style="margin-top:12px"><h3 style="margin-bottom:6px">Ton Guardian avec l'objet du guide</h3>${diffTable(r.minionDiff)}</div>` : ""}
        ${(r.diff || []).length ? `<div class="card pad" style="margin-top:12px"><h3 style="margin-bottom:6px">Effet sur ton personnage</h3>${diffTable(r.diff)}</div>` : ""}`
    : `${tradable(r) ? `<div class="trade-box"><div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div><b>Trouver un upgrade sur le site trade</b><div class="muted small">PoB teste chaque stat possible de cet emplacement sur ton build : la recherche ne garde que ce qui t'apporte vraiment quelque chose.</div></div>
          <button class="btn primary sm" data-trade="1">Générer les recherches</button></div></div>` : ""}
        <div class="side-by-side">${itemCard(r.mine, { label: "Mon objet", slot: r.slot, ctx })}${itemCard(r.guide, { label: "Guide (évalué par PoB dans ton build)", slot: r.slot, raw: true, ctx })}</div>
      ${r.diff ? `<div class="card pad" style="margin-top:12px"><h3 style="margin-bottom:6px">Si tu équipes l'objet du guide</h3>${diffTable(r.diff)}</div>` : ""}`;
  const bindTrade = (el, r) => { const tb = el.querySelector("[data-trade]"); if (tb) tb.onclick = () => tradeSearch(el.querySelector(".trade-box"), R, r); };
  const intro = `<div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px;margin:0 0 12px">
    <p class="muted small" style="margin:0;flex:1">Chaque objet du guide est testé <b>à la place du tien, sur ton build</b>. Les résistances feu, froid et foudre sont interchangeables (tu les places où tu veux et tu rééquilibres sur les autres pièces) : seul leur <b>total</b> compte, replacé là où tu en as besoin (les plus basses d'abord). ${view === "inv" ? "Clique un emplacement pour le détail." : "Clique une ligne pour le détail."}</p>
    <div class="seg sm" id="items-view"><button data-v="table" class="${view === "table" ? "on" : ""}">Tableau</button><button data-v="inv" class="${view === "inv" ? "on" : ""}">Inventaire</button></div></div>`;

  if (view === "inv") {
    // inventaire façon jeu : bordure selon le verdict (vert : le guide est mieux, orange : compromis, bleu : garde le tien)
    const kindOf = (r) => r.same ? "same" : (itemVerdict(r) || {}).kind || "same";
    const KIND = { up: "Le guide est mieux", mixed: "Compromis", keep: "Garde le tien", same: "Identique ou équivalent" };
    const cell = (r, i, style) => {
      const it = r.guide || r.mine, k = kindOf(r);
      return `<button class="inv-slot vd-slot vd-b-${k} ${it ? "" : "empty"}" data-i="${i}" ${it ? `data-tip="${r.guide ? "g" : "m"}${i}"` : ""} style="${style}" title="${esc((r.guardian ? r.slot : r.label) + " · " + KIND[k])}">
        ${it ? (it.icon ? itemIcon(it) : `<span class="inv-txt r-${esc(it.rarity)}">${esc(itemTitle(it))}</span>`) : `<span class="inv-lbl">${esc(r.label || r.slot)}</span>`}
        ${!r.same && r.head ? `<span class="vd-dot vd-${k}"></span>` : ""}</button>`;
    };
    const doll = (list) => `<div class="doll">${list.map(([r, i]) => { const pos = DOLL[r.slot]; if (!pos) return ""; const [x, y, w, h] = pos;
      return cell(r, i, `grid-column:${x} / span ${w};grid-row:${y} / span ${h}`); }).join("")}</div>`;
    const indexed = rows.map((r, i) => [r, i]);
    const main = indexed.filter(([r]) => !r.guardian);
    const extra = main.filter(([r]) => !DOLL[r.slot]);
    const groups = (R.guardian || []).map((g) => [g, indexed.filter(([r]) => r.guardian === g)]);
    body.innerHTML = `${intro}
      <div class="cmp-inv">
        <div class="card inventory">${doll(main)}${extra.length ? `<div class="inv-sep">Flasques, joyaux et emplacements spéciaux</div><div class="jewels">${extra.map(([r, i]) => cell(r, i, "")).join("")}</div>` : ""}
          <div class="vd-legend">${["up", "mixed", "keep", "same"].map((k) => `<span><i class="vd-b-${k}"></i>${KIND[k]}</span>`).join("")}</div></div>
        ${groups.map(([g, list]) => `<div class="card inventory guardian-inv"><div class="row guardian-head">${icon("skull", "--chaos")}<div><h3>${esc(g.skill)}</h3><div class="muted small">objets portés par le sbire</div></div></div>${doll(list)}</div>`).join("")}
      </div>
      <div id="inv-detail" style="margin-top:14px"></div>`;
    body.querySelector(".cmp-inv").onclick = (ev) => {
      const b = ev.target.closest(".inv-slot"); if (!b) return;
      const r = rows[+b.dataset.i];
      $$(".cmp-inv .inv-slot", body).forEach((x) => x.classList.toggle("sel", x === b));
      const el = $("#inv-detail", body);
      const v = r.same ? null : itemVerdict(r);
      el.innerHTML = `<div class="card pad"><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <h3>${esc(r.guardian ? r.guardian.skill + " · " + r.slot : r.label)}</h3>
        ${r.same ? `<span class="same">Identique</span>` : v ? `<span class="vd vd-${v.kind}">${v.label}</span>` : ""}</div>
        ${r.head && !r.same ? `<div class="row" style="gap:16px;margin-bottom:10px"><span class="delta ${deltaClass(r.head.dps)}">DPS ${pctText(r.head.dps)}</span><span class="delta ${deltaClass(r.head.ehp)}">Survie ${pctText(r.head.ehp)}</span></div>` : ""}
        ${v ? [v.reasons.join(" · "), v.cond.join(" · "), v.res, v.jewel].filter(Boolean).map((t) => `<div class="vd-why">${t}</div>`).join("") + v.warn.map((w) => `<div class="vd-why vd-warn">${icon("zap", "--warn")} ${w}</div>`).join("") : ""}
        <div style="margin-top:12px">${detailHtml(r)}</div></div>`;
      bindTrade(el, r);
      el.scrollIntoView({ block: "nearest" });
    };
  } else {
    body.innerHTML = `${intro}
  <div class="card" style="overflow:auto"><table class="cmp-items">
    <thead><tr><th>Emplacement</th><th>Mon objet</th><th>Objet du guide</th><th class="v">DPS</th><th class="v" title="Coup max encaissable, moyenne des 5 types de dégâts">Survie</th><th>Verdict pour ton build</th></tr></thead>
    <tbody>${rows.map((r, i) => `${r.guardian && r === gRows.find((x) => x.guardian === r.guardian) ? `<tr class="group-row"><td colspan="6">${icon("skull", "--chaos")}<b>${esc(r.guardian.skill)}</b>${(r.guardian.linked || []).length ? ` <span class="muted">+ armes animées (Chains of Command)</span>` : ""}
        <span class="muted small">objets portés par le sbire · guide : ${esc(r.guardian.guideTitle || "—")}${r.guardian.missing ? " · tu n'utilises pas cette compétence" : ""}</span></td></tr>` : ""}<tr class="row-click" data-i="${i}">
      <td class="slotname">${esc(r.guardian ? r.slot : r.label)}</td>
      <td data-tip="m${i}">${r.mine ? `${itemIcon(r.mine, "sm")}<div class="iname r-${esc(r.mine.rarity)}">${esc(itemTitle(r.mine))}</div><div class="ib">${esc(r.mine.base || "")}</div>` : `<span class="muted">—</span>`}</td>
      <td data-tip="g${i}">${r.same ? `<span class="same">Identique</span>` : r.guide ? `${itemIcon(r.guide, "sm")}<div class="iname r-${esc(r.guide.rarity)}">${esc(itemTitle(r.guide))}</div><div class="ib">${esc(r.guide.base || "")}</div>` : `<span class="muted">—</span>`}</td>
      ${r.same ? `<td></td><td></td>` : headCells(r.head)}
      ${verdictCell(r)}
    </tr>`).join("")}</tbody></table></div>`;
    body.querySelector("tbody").onclick = (ev) => {
      const tr = ev.target.closest("tr.row-click"); if (!tr) return;
      const nx = tr.nextElementSibling;
      const had = nx && nx.classList.contains("detail");
      $$(".detail", body).forEach((d) => d.parentNode.removeChild(d));
      if (had) return;
      const r = rows[+tr.dataset.i];
      const d = document.createElement("tr");
      d.className = "detail";
      d.innerHTML = `<td colspan="6">${detailHtml(r)}</td>`;
      tr.after(d);
      bindTrade(d, r);
    };
  }
  $("#items-view", body).onclick = (ev) => {
    const b = ev.target.closest("button[data-v]"); if (!b || b.classList.contains("on")) return;
    store.set("cmpItemsView", b.dataset.v); tabItems(body, R);
  };
  bindItemTips(body, (k) => {
    const r = rows[+k.slice(1)]; if (!r) return null;
    if (r.guardian) {
      const it = k[0] === "m" ? r.mine : r.guide;
      return it ? { route: "itemTooltip", body: Object.assign({ raw: it.raw, noCompare: true }, ctx) } : null;
    }
    if (k[0] === "m") return r.mine ? { route: "itemTooltip", body: Object.assign({ slot: r.slot }, ctx) } : null;
    return r.guide ? { route: "itemTooltip", body: Object.assign({ raw: r.guide.raw, slot: r.slot }, ctx) } : null;
  });
}
// emplacements pour lesquels une recherche trade a du sens (équipement, ou objet unique du guide)
function tradable(r) {
  if (!r.guide || r.guardian) return false;
  if (r.guide.rarity === "UNIQUE" || r.guide.rarity === "RELIC") return true;
  return !r.jewel && /^(Weapon [12]|Helmet|Body Armour|Gloves|Boots|Amulet|Ring \d|Belt)$/.test(r.slot);
}
async function tradeLeague() {
  if (!S.leagues) S.leagues = (await api("tradeLeagues")).leagues;
  const saved = store.get("tradeLeague", null);
  return S.leagues.includes(saved) ? saved : S.leagues[0];
}
// Recherches trade d'un emplacement : au plus deux, clairement nommées.
//  1. « Comme l'objet du guide » : de vrais filtres du site (chaque stat à ≥ 80 %, résistances en total, liens) —
//     ou, pour un unique, le même unique. C'est la recherche à utiliser d'abord.
//  2. « Moins cher, utile pour ton build » : une recherche par score (somme pondérée calculée par PoB) — le palier
//     intermédiaire s'il y a un gros écart, sinon « mieux que ton objet actuel ».
async function tradeSearch(box, R, r) {
  const league = await tradeLeague();
  box.innerHTML = `<div class="loading" style="padding:8px"><div class="spinner"></div>PoB prépare les recherches pour ton build…</div>`;
  let T;
  try { T = await api("trade", { id: R.mine.id, stage: R.mine.stage, slot: r.slot, guideRaw: r.guide.raw, league }); }
  catch (e) { box.innerHTML = `<div class="muted small" style="color:var(--bad)">${esc(e.message)}</div>`; return; }
  const by = (k) => T.searches.find((x) => x.kind === k);
  const main = by("unique") || by("mods") || by("guide");
  const cheap = T.grants ? null : (by("mid") || by("upgrade"));
  const top = (T.topStats || []).filter((x) => x.text).slice(0, 5);
  const btns = (x) => `<div class="row" style="gap:6px;flex:none"><button class="btn sm" data-copy="${esc(x.url)}">Copier</button><a class="btn sm primary" href="${esc(x.url)}" target="_blank" rel="noopener">Ouvrir sur le trade</a></div>`;
  box.innerHTML = `
    <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      <b>Chercher sur le trade · ${esc(r.label)}</b>
      <label class="small muted">Ligue <select class="select sm" data-league>${S.leagues.map((l) => `<option ${l === T.league ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    </div>
    ${T.grants ? `<p class="small trade-note">Ton objet actuel donne <b>${esc(T.grants)}</b> : un objet rare ne le remplace pas sans perdre cette compétence.</p>` : ""}
    ${main ? `<div class="trade-main">
      <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><div><div class="t">${main.kind === "unique" ? "Le même unique que le guide" : "Comme l'objet du guide"}</div>
        <div class="muted small">${main.kind === "unique" ? "Recherche par nom, la moins chère d'abord." : main.kind === "mods" ? "Filtres classiques du site, faciles à ajuster : chaque stat de l'objet du guide avec un minimum (80 % de sa valeur), le moins cher d'abord." : "Recherche par score (voir plus bas)."}</div></div>${btns(main)}</div>
      ${(main.chips || []).length ? `<div class="trade-chips">${main.chips.map((c) => `<span class="sd-chip">${esc(c)}</span>`).join("")}</div>` : ""}
    </div>` : ""}
    ${cheap ? `<div class="trade-alt">
      <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><div><div class="t">${cheap.kind === "mid" ? "Moins cher : un palier intermédiaire" : "Moins cher : mieux que ton objet actuel"}</div>
        <div class="muted small">Recherche par <b>score</b> : le site additionne les stats utiles pour ton build (poids calculés par PoB) et garde les objets ${cheap.kind === "mid" ? "à mi-chemin entre le tien et celui du guide" : "au moins 10 % meilleurs que le tien"}. Toutes les combinaisons de stats comptent.</div></div>${btns(cheap)}</div>
      ${top.length ? `<details class="trade-why"><summary class="muted small">Ce qui compte le plus dans le score</summary><div class="trade-chips">${top.map((x) => `<span class="sd-chip">${esc(x.text)}${x.share ? ` <small>${Math.round(x.share)} %</small>` : ""}</span>`).join("")}</div></details>` : ""}
    </div>` : ""}
    ${!main && !cheap ? `<p class="muted small">Aucune recherche utile pour cet emplacement.</p>` : ""}`;
  $$("[data-copy]", box).forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Lien de recherche copié"); }
    catch (e) { toast("Copie impossible : " + e.message, true); }
  });
  $("[data-league]", box).onchange = (ev) => { store.set("tradeLeague", ev.target.value); tradeSearch(box, R, r); };
}
async function tabTree(body, R) {
  const T = R.tree;
  const nodeRow = (n, extra) => `<div class="node-row" data-name="${esc(n.name)}"><div><div class="n">${esc(n.name)} <span class="tag">${n.kind === "keystone" ? "Keystone" : n.kind === "mastery" ? "Maîtrise" : "Notable"}</span></div>
    <div class="d">${esc((n.stats || []).join("\n"))}</div></div>
    <div class="meta">${extra(n)}</div></div>`;
  const take = T.toTake.slice().sort((a, b) => ((b.head?.dps || 0) + (b.head?.ehp || 0)) - ((a.head?.dps || 0) + (a.head?.ehp || 0)));
  body.innerHTML = `
    <div class="legend" style="margin-bottom:10px">
      <span>Ton arbre, comparé à celui du guide par PoB</span>
      <span><i class="lg-dot" style="background:#d8c48a"></i>En commun · ${T.common}</span><span><i class="lg-dot" style="background:#2ecc40"></i>À prendre (guide) · ${T.onlyGuide}</span><span><i class="lg-dot" style="background:#e5352b"></i>En trop (toi seul) · ${T.onlyMine}</span>
      ${T.version !== T.guideVersion ? `<span class="tag warn">Arbres de versions différentes : ${esc(T.version.replace("_", "."))} (toi) / ${esc(T.guideVersion.replace("_", "."))} (guide)</span>` : ""}
    </div>
    <div class="card tree-wrap" id="tw"></div>
    <div class="grid cols-2 section">
      <div class="card pad"><h3>À prendre</h3><p class="muted small" style="margin:2px 0 8px">Gain mesuré sur ton build, chemin depuis ton arbre compris.</p>
        <div class="node-list">${take.map((n) => nodeRow(n, (x) => x.head ? `<div class="delta ${deltaClass(x.head.dps)}">DPS ${pctText(x.head.dps)}</div><div class="delta ${deltaClass(x.head.ehp)}">Survie ${pctText(x.head.ehp)}</div><div class="muted small">${x.cost || "?"} pt${x.cost > 1 ? "s" : ""}</div>` : `<span class="muted small">—</span>`)).join("") || '<p class="muted">Rien à prendre.</p>'}</div></div>
      <div class="card pad"><h3>En trop</h3><p class="muted small" style="margin:2px 0 8px">Effet du retrait de chaque nœud sur ton build. Proche de 0 = bon candidat au respec.</p>
        <div class="node-list">${T.extra.map((n) => nodeRow(n, (x) => x.head ? `<div class="delta ${deltaClass(x.head.dps)}">DPS ${pctText(x.head.dps)}</div><div class="delta ${deltaClass(x.head.ehp)}">Survie ${pctText(x.head.ehp)}</div>` : "")).join("") || '<p class="muted">Rien en trop.</p>'}</div></div>
    </div>`;
  new PobTree($("#tw"), { target: () => ({ id: R.mine.id, stage: R.mine.stage }), compare: T.guideSpec });
}

function tabGems(body, R) {
  const key = (g) => (g.name || "").toLowerCase();

  // 1. Séparer en 3 catégories claires :
  // - À modifier (groupes du guide où il manque des gemmes ou des niveaux)
  // - Complets (groupes du guide déjà bons)
  // - Hors guide (gemmes en leveling, swap, ou groupes absents du guide)
  const guideRows = R.gems.filter((r) => r.guide);
  const extraRows = R.gems.filter((r) => !r.guide);

  const toFix = guideRows.filter((r) => !r.mine || r.missing.length > 0 || r.extra.length > 0 || r.level.length > 0);
  const completed = guideRows.filter((r) => !toFix.includes(r));

  const renderCard = (row) => {
    const gg = row.guide, mg = row.mine;
    const ref = gg || mg;
    const title = ref.label || (ref.gems.find((x) => !x.support) || ref.gems[0] || {}).name || "Groupe";
    const missing = new Set(row.missing.map(key));
    const extra = new Set(row.extra.map(key));
    const lvlMap = new Map(row.level.map((l) => [l.name.toLowerCase(), l]));
    const names = [...(gg ? gg.gems : []), ...(mg ? mg.gems : [])].map(key).join("|");

    const badge = !mg ? `<span class="tag accent">À équiper</span>`
      : !gg ? `<span class="tag warn">Hors guide</span>`
      : row.missing.length ? `<span class="tag accent">${row.missing.length} manquante(s)</span>`
      : row.level.length ? `<span class="tag">À monter</span>`
      : `<span class="tag good">Complet</span>`;

    const targetGems = gg ? gg.gems : [];
    const extraGems = mg ? mg.gems.filter((g) => !gg || extra.has(key(g))) : [];

    return `<div class="card ggroup" data-gems="${esc(names)}">
      <div class="gh">
        <div><div class="t">${esc(title)}</div><div class="s">${esc(ref.slot || "Emplacement libre")}</div></div>
        ${badge}
      </div>
      ${socketStrip(ref.gems)}
      <div style="margin-top:8px;display:grid;gap:4px">
        ${targetGems.map((g) => {
          const isMiss = missing.has(key(g));
          const lv = lvlMap.get(key(g));
          const state = isMiss ? `<span class="tag accent">+ Ajouter</span>`
            : lv ? `<span class="tag warn">Niv. ${lv.mine[0]} → ${lv.guide[0]}</span>`
            : `<span class="muted small">✓</span>`;
          return `<div class="gem ${g.support ? "support" : ""} ${isMiss ? "missing" : ""}">
            <span class="gd ${g.color}"></span><span>${esc(g.name)}</span><span class="lv">${state}</span>
          </div>`;
        }).join("")}
        ${extraGems.map((g) => `<div class="gem ${g.support ? "support" : ""} ${gg ? "extra" : ""}">
          <span class="gd ${g.color}"></span><span>${esc(g.name)}</span>
          <span class="lv">${gg ? `<span class="tag warn">− Retirer</span>` : `<span class="muted small">niv. ${g.level}</span>`}</span>
        </div>`).join("")}
      </div>
    </div>`;
  };

  body.innerHTML = `
    ${toFix.length
      ? `<div class="gem-groups">${toFix.map(renderCard).join("")}</div>`
      : `<div class="empty">Toutes tes gemmes correspondent au guide.</div>`}

    ${completed.length
      ? `<details class="section"><summary class="muted" style="cursor:pointer">Voir les ${completed.length} groupe(s) déjà complets</summary>
         <div class="gem-groups" style="margin-top:10px">${completed.map(renderCard).join("")}</div></details>`
      : ""}

    ${extraRows.length
      ? `<details class="section"><summary class="muted" style="cursor:pointer">Voir les ${extraRows.length} groupe(s) hors guide (swap, leveling, non équipés)</summary>
         <div class="gem-groups" style="margin-top:10px">${extraRows.map(renderCard).join("")}</div></details>`
      : ""}`;
}

// L'arbre d'une transition d'étape : l'étape précédente, comparée à la nouvelle (vert = à prendre, rouge = à retirer)
async function openTreeDiff(id, prev, cur, D, fromTitle, toTitle) {
  const m = modal(`<div class="card-head"><h3>Arbre : « ${esc(fromTitle)} » → « ${esc(toTitle)} »</h3><button class="icon-btn" data-act="close" aria-label="Fermer">✕</button></div>
    <div class="card-body"><div class="legend" style="margin-bottom:8px"><span><i class="lg-dot" style="background:#2ecc40"></i>à prendre à cette étape</span>
      <span><i class="lg-dot" style="background:#e5352b"></i>à retirer (respec)</span><span class="muted">survole un passif pour son effet</span></div>
      <div class="tree-wrap td-tree" id="td-tree"><div class="loading"><div class="spinner"></div>Chargement…</div></div></div>`);
  m.el.querySelector(".modal").classList.add("wide-modal");
  let spec;
  try { spec = treeSpecOf(await api("open", { id, stage: cur })); } catch (e) { toast(e.message, true); return; }
  delete S.snap[id];   // le moteur a chargé l'étape : la page relira son instantané
  const host = $("#td-tree", m.el);
  if (!host) return;
  // cadrage sur les changements de l'arbre principal (l'ascendance est loin, dans son cercle)
  const all = (D.tree.added || []).concat(D.tree.removed || []);
  const ids = (all.some((n) => !n.asc) ? all.filter((n) => !n.asc) : all).map((n) => n.id);
  // cadrage : les nœuds pris d'un seul côté (différences), hors ascendance, une fois la fenêtre à sa taille
  const fit = (t) => requestAnimationFrame(() => {
    const diff = t.s.nodes.filter((n) => !n.asc && !!n.alloc !== !!n.calloc).map((n) => n.id);
    t.fitNodes(diff.length ? diff : ids);
  });
  const tv = new PobTree(host, { target: () => ({ id, stage: prev }), compare: spec, onLoad: fit });
  const close = m.close;
  m.close = () => { tv.destroy(); close(); };
}
