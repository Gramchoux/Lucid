// Lucid — ui_expert.js : Arbre & détails experts : arbre (puissance, allocation, anoint), gemmes, statistiques, « Pourquoi ce chiffre ? ».

// ------------------------------------------------------------------ « Pourquoi ce chiffre ? » (sources des stats lues dans PoB)
const WHY_KEYS = new Set(["Life", "Mana", "EnergyShield", "Armour", "Evasion", "FireResist", "ColdResist", "LightningResist", "ChaosResist",
  "Str", "Dex", "Int", "SpellSuppressionChance", "BlockChance", "SpellBlockChance", "EffectiveMovementSpeedMod", "ManaRegenRecovery"]);
const WHY_PART = {
  base: ["Ce qui s'additionne", "valeurs ajoutées par chaque source"],
  inc: ["Augmentations « increased »", "additionnées entre elles, puis appliquées une fois"],
  more: ["Multiplicateurs « more »", "chacun multiplie le total séparément"],
};
function whyUnit(w, part) { return part !== "base" || /Resist$|Chance$/.test(w.key) ? " %" : ""; }
function whyN(v, unit = "", sign = true) {
  if (v == null || !isFinite(v)) return "—";
  const d = Math.abs(v) < 10 && Math.abs(v % 1) > 0.05 ? 1 : 0;
  return (sign ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "") + nf(Math.abs(v), d) + unit;
}
function whyParts(w) {
  return ["base", "inc", "more"].filter((p) => w[p] && (w[p].groups || []).length).map((p) => ({ id: p, ...w[p] }));
}
// la formule de PoB, avec les vrais nombres
function whyFormula(w) {
  if (!w) return "";
  if (/Resist$/.test(w.key)) {
    const t = w.total ?? (w.base && w.base.total);
    return `Total ${whyN(t, " %", false)} · maximum ${whyN(w.max, " %", false)} → <b>${whyN(w.value, " %", false)}</b>${w.overCap > 0 ? ` <span class="muted">(${nf(w.overCap)} % au-delà du plafond : utiles seulement contre les malédictions et la pénétration)</span>` : ""}`;
  }
  if (/Chance$/.test(w.key)) return `Somme ${whyN(w.base && w.base.total, " %", false)} → <b>${whyN(w.value, " %", false)}</b>`;
  const b = w.base && w.base.total, i = w.inc && w.inc.total, m = w.more && w.more.total;
  const cap = w.cap ? `<br><span class="why-cap">${esc(w.cap.source)} : ES utile plafonnée à ton ${esc(w.cap.label)} (${nf(w.cap.def)}). Garde l'ES <b>juste au-dessus</b> : tu n'es jamais « full ES », ton vol et ta régénération d'ES ne s'arrêtent pas.</span>` : "";
  if (w.cap && b != null) return `${nf(b)} de base × (1 ${i < 0 ? "−" : "+"} ${nf(Math.abs(i || 0))} %)${m ? ` × (1 ${m < 0 ? "−" : "+"} ${nf(Math.abs(m), 1)} %)` : ""} ≈ <b>${nf(w.value)}</b>${cap}`;
  if (b == null) return `${whyN(i, " %")} → <b>${whyN(w.value, " %")}</b>`;
  return `${nf(b)} de base × (1 ${i < 0 ? "−" : "+"} ${nf(Math.abs(i || 0))} %)${m ? ` × (1 ${m < 0 ? "−" : "+"} ${nf(Math.abs(m), 1)} %)` : ""} ≈ <b>${nf(w.value)}</b>`;
}
function whyItems(items, unit, max = 6) {
  const show = items.slice(0, max), rest = items.length - show.length;
  return `<div class="why-items">${show.map((it) => `<div><span>${esc(it.name)}</span><span>${whyN(it.value, unit)}</span></div>`).join("")}
    ${rest > 0 ? `<div class="muted"><span>+ ${rest} autre${rest > 1 ? "s" : ""}</span><span>${whyN(items.slice(max).reduce((a, x) => a + x.value, 0), unit)}</span></div>` : ""}</div>`;
}
function whySingle(w) {
  return `<p class="why-formula">${whyFormula(w)}</p>
    ${whyParts(w).map((p) => `<div class="why-part"><div class="why-ph"><b>${WHY_PART[p.id][0]}</b><span class="muted small">${WHY_PART[p.id][1]}</span><span class="why-tot">${whyN(p.total, whyUnit(w, p.id))}</span></div>
      ${p.groups.map((g) => `<details class="why-g"><summary><span>${esc(g.label)}</span><span>${whyN(g.value, whyUnit(w, p.id))}</span></summary>${whyItems(g.items, whyUnit(w, p.id), 12)}</details>`).join("")}</div>`).join("")}`;
}
// perso et guide côte à côte, par source (Arbre, Objets…) : on voit tout de suite d'où vient l'écart
function whyCompare(m, g) {
  const ref = m || g;
  const parts = ["base", "inc", "more"].filter((p) => (m && m[p] && m[p].groups.length) || (g && g[p] && g[p].groups.length));
  return `<div class="why-cmp-f"><div><span class="muted small">Ton perso</span><p class="why-formula">${m ? whyFormula(m) : "—"}</p></div>
      <div><span class="muted small">Guide</span><p class="why-formula">${g ? whyFormula(g) : "—"}</p></div></div>
    ${parts.map((p) => {
      const unit = whyUnit(ref, p);
      const mg = (m && m[p] ? m[p].groups : []), gg = (g && g[p] ? g[p].groups : []);
      const labels = [...new Set([...mg.map((x) => x.label), ...gg.map((x) => x.label)])];
      const rows = labels.map((l) => {
        const a = mg.find((x) => x.label === l), b = gg.find((x) => x.label === l);
        return { l, a, b, d: (a ? a.value : 0) - (b ? b.value : 0) };
      }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      return `<div class="why-part"><div class="why-ph"><b>${WHY_PART[p][0]}</b><span class="muted small">${WHY_PART[p][1]}</span></div>
        <table class="stat-table why-t"><thead><tr><th>Source <span class="muted">(clique pour le détail)</span></th><th class="v">Toi</th><th class="v">Guide</th><th class="v">Écart</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="l"><details><summary>${esc(r.l)}</summary>
            <div class="why-cols"><div><span class="muted small">Toi</span>${r.a ? whyItems(r.a.items, unit, 10) : `<p class="muted small">rien</p>`}</div>
            <div><span class="muted small">Guide</span>${r.b ? whyItems(r.b.items, unit, 10) : `<p class="muted small">rien</p>`}</div></div></details></td>
          <td class="v">${r.a ? whyN(r.a.value, unit) : "—"}</td><td class="v muted">${r.b ? whyN(r.b.value, unit) : "—"}</td>
          <td class="v"><span class="delta ${deltaClass(r.d, false)}">${Math.abs(r.d) < 0.05 ? "" : whyN(r.d, unit)}</span></td></tr>`).join("")}
        </tbody></table></div>`;
    }).join("")}`;
}
async function showWhy(id, key, label) {
  const m = modal(`<div class="card-head"><h3>Pourquoi ce chiffre ? · ${esc(label || key)}</h3><button class="icon-btn" data-act="close" aria-label="Fermer">✕</button></div><div class="card-body" id="why-body"><p class="muted">Lecture des calculs de PoB…</p></div>`);
  m.el.querySelector(".modal").style.width = "min(620px, 100%)";
  try {
    const r = await api("explain", { id, stage: stageOf(id), keys: [key] });
    $("#why-body", m.el).innerHTML = r && r[key] ? whySingle(r[key]) : `<p class="muted">PoB ne détaille pas cette stat.</p>`;
  } catch (e) { $("#why-body", m.el).innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
}
function tabStats(body, R) {
  const rows = R.stats.filter((s) => s.mine != null || s.guide != null);
  const why = R.why || {};
  const score = (s) => Math.max(s.gain.dps || 0, s.gain.ehp || 0);
  const chips = rows.filter((s) => s.gain && !s.gain.pair && score(s) >= 1).map((s) => ({ k: s.key, label: STAT_FR[s.key] || s.label, val: `${fmtStat(s, s.mine)} → ${fmtStat(s, s.guide)}`, gain: s.gain }));
  // armure + ES (Divine Shield) : un seul écart, jugé ensemble
  const P = R.esCap;
  if (P && P.gain && P.guide) chips.push({ k: P.by, label: `${P.label[0].toUpperCase() + P.label.slice(1)} + ES (ensemble)`, val: `${nf(P.mine.def)} / ${nf(P.mine.es)} → ${nf(P.guide.def)} / ${nf(P.guide.es)}`, gain: Object.assign({}, P.gain, { pair: false }) });
  const top = chips.sort((a, b) => score(b) - score(a)).slice(0, 4);
  body.innerHTML = `
    ${esCapCard(R.esCap)}
    ${top.length ? `<div class="card pad" style="margin-bottom:12px"><h3 style="margin:0 0 4px">Les écarts qui comptent le plus</h3>
      <p class="muted small" style="margin:0 0 10px">Gain mesuré par PoB sur ton perso si tu avais la valeur du guide, le reste ne bougeant pas.</p>
      <div class="gap-top">${top.map((x) => `<button class="gap-chip" data-k="${esc(x.k)}"><span>${esc(x.label)}</span>
        <b>${x.val}</b><span>${gainText(x.gain)}</span></button>`).join("")}</div></div>` : ""}
    <div class="card pad"><table class="stat-table"><thead><tr><th>Statistique</th><th class="v">Mon perso</th><th class="v">Guide</th><th class="v">Écart</th><th class="v">Si tu avais la valeur du guide</th></tr></thead>
  <tbody>${rows.map((s) => {
    const d = s.mine != null && s.guide != null ? statValue(s, s.mine) - statValue(s, s.guide) : null;
    const w = why[s.key];
    return `<tr class="${w ? "why-row" : ""}" data-k="${esc(s.key)}"><td class="l" title="${esc(s.label)}">${esc(STAT_FR[s.key] || s.label)}${w ? ` <span class="why-q" title="Pourquoi ce chiffre ?">?</span>` : ""}</td><td class="v">${fmtStat(s, s.mine)}</td><td class="v muted">${fmtStat(s, s.guide)}</td>
      <td class="v"><span class="delta ${deltaClass(d, s.lower)}">${d == null || Math.abs(d) < 1e-9 ? "" : (d > 0 ? "+" : "−") + fmtStat(Object.assign({}, s, { pc: false, mod: false, fmt: (s.fmt || "d").replace("+", "") }), Math.abs(d))}</span></td>
      <td class="v small gain">${gainText(s.gain)}</td></tr>
      ${w ? `<tr class="why-detail" data-for="${esc(s.key)}" hidden><td colspan="5">${whyCompare(w.mine, w.guide)}</td></tr>` : ""}`;
  }).join("")}</tbody></table>
  <p class="muted small" style="margin:10px 0 0">Clique sur une ligne marquée <span class="why-q">?</span> pour voir d'où vient la valeur, chez toi et chez le guide.</p></div>`;
  const toggle = (k) => {
    const d = body.querySelector(`.why-detail[data-for="${CSS.escape(k)}"]`);
    if (!d) return;
    d.hidden = !d.hidden;
    if (!d.hidden) d.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  body.onclick = (ev) => {
    if (ev.target.closest(".why-detail")) return;
    const chip = ev.target.closest(".gap-chip");
    if (chip) return toggle(chip.dataset.k);
    const tr = ev.target.closest("tr.why-row");
    if (tr) toggle(tr.dataset.k);
  };
}

async function pageTree(c, id, snap, token, opts = {}) {
  const t = snap.tree;
  const mode = opts.mode || (ownerKind(id) === "guide" ? "guide" : "mine");
  const [ebc, ebl] = MODE_EYEBROW[mode];
  // repère : sur l'arbre visé, tes nœuds déjà pris ; sur ton arbre, l'étape du guide (au choix)
  const persoSpec = opts.persoSnap ? treeSpecOf(opts.persoSnap) : null;
  const meta = buildMeta(id), gid = mode === "mine" && meta?.guide && buildMeta(meta.guide) ? meta.guide : null;
  const list = (title, arr) => arr.length ? `<div class="grp"><h4>${title}<span>${arr.length}</span></h4>${arr.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((n) => `<button class="ni" data-id="${n.id}" title="${esc((n.stats || []).join("\n"))}">${esc(n.name)}</button>`).join("")}</div>` : "";
  c.innerHTML = `
    <div class="page-head compact"><div><span class="eyebrow ${ebc}">${ebl}</span><h1>${mode === "guide" ? "Arbre visé" : "Arbre passif"}</h1>
      <p>${t.points} points · ${t.ascPoints} points d'ascendance · arbre ${esc(t.version.replace("_", "."))}${mode === "sandbox" ? " · clique un nœud pour voir ce qu'il rapporte (et son coût en points)" : persoSpec ? " · en surbrillance : tes nœuds déjà pris" : ""}</p></div>
      ${gid ? `<label class="small row" style="gap:6px;cursor:pointer"><input type="checkbox" id="tree-guide"> Montrer l'étape du guide</label>` : ""}</div>
    <div class="tree-layout full">
      <div class="card tree-wrap" id="tw"></div>
      <div class="card tree-side">
        ${list("Keystones", t.keystones)}${list("Ascendance", t.ascendancy_nodes.filter((n) => n.kind === "notable"))}${list("Notables", t.notables)}${list("Maîtrises", t.masteries)}
      </div>
    </div>`;
  // outils : puissance des nœuds (partout sauf l'arbre visé), allocation + meilleur anoint (bac à sable)
  const sb = mode === "sandbox";
  $("#tw").insertAdjacentHTML("beforebegin", `<div class="tree-bar">
      ${mode !== "guide" ? `<label class="small tb-item" title="Comme « Show Node Power » de PoB : chaque passif non pris coloré selon ce qu'il rapporte (rouge : dégâts, bleu : défense)"><input type="checkbox" id="tree-heat"> Puissance des nœuds <span class="heat-key"><i style="background:#e33"></i>dégâts <i style="background:#36f"></i>défense</span></label>` : ""}
      ${sb ? `<div class="seg sm" id="tree-mode" title="Que fait un clic sur un nœud ?"><button data-m="preview" class="on">Clic : aperçu</button><button data-m="edit">Clic : allouer / retirer</button></div>
        <button class="btn sm" id="tree-undo" disabled title="Annuler la dernière modification (Ctrl+Z)">${icon("refresh")} Annuler</button>
        <button class="btn sm" id="tree-anoint">Meilleur anoint</button>
        <span class="small muted" id="tree-delta"></span>` : ""}
    </div>${sb ? `<div id="tree-anoints"></div>` : ""}`);
  let editMode = false, undoCount = 0, heatOn = false;
  const base = snap.key;
  const showDelta = (k) => {
    const el = $("#tree-delta"); if (!el) return;
    if (!undoCount) { el.innerHTML = ""; return; }
    const d = (mainDps(k) - mainDps(base)) / (mainDps(base) || 1) * 100;
    const h = ((k.HitPool || 0) - (base.HitPool || 0)) / (base.HitPool || 1) * 100;
    el.innerHTML = `Arbre modifié (${undoCount} changement${undoCount > 1 ? "s" : ""}) · <span class="delta ${deltaClass(d)}">DPS ${pctText(d)}</span> · <span class="delta ${deltaClass(h)}">Survie ${pctText(h)}</span> · rien n'est enregistré`;
  };
  const edit = async (body) => {
    try {
      const r = await api("treeEdit", Object.assign({ id, stage: stageOf(id) }, body));
      if (r.skipped) return;
      undoCount = r.undo;
      S.snap[id] = r.snapshot;
      S.cfgDirty = Object.assign(S.cfgDirty || {}, { [id]: true });   // remis sur ton perso en quittant le bac à sable
      $("#tree-undo").disabled = !undoCount;
      showDelta(r.snapshot.key);
      await tv.reload();
      if (heatOn) loadHeat();
    } catch (e) { toast(e.message, true); }
  };
  const treeOpts = () => ({ target: () => ({ id, stage: stageOf(id) }), compare: opts.compare || persoSpec || null, preview: sb,
    onClick: sb ? (n) => { if (!editMode) return false; edit({ id_node: n.id }); return true; } : null,
    onUndo: sb ? () => { if (undoCount) edit({ undo: true }); } : null });
  let tv = new PobTree($("#tw"), treeOpts());
  const loadHeat = async () => {
    const hb = $("#tree-heat"); if (hb) hb.disabled = true;
    try { tv.setHeat(await api("nodePower", { id, stage: stageOf(id) })); }
    catch (e) { toast(e.message, true); }
    if (hb) hb.disabled = false;
  };
  const heatBox = $("#tree-heat");
  if (heatBox) heatBox.onchange = () => { heatOn = heatBox.checked; if (heatOn) loadHeat(); else tv.setHeat(null); };
  if (sb) {
    $("#tree-mode").onclick = (ev) => {
      const b = ev.target.closest("button[data-m]"); if (!b) return;
      editMode = b.dataset.m === "edit";
      $$("#tree-mode button").forEach((x) => x.classList.toggle("on", x === b));
      tv.closePreview();
      $(".tree-hint", $("#tw")).textContent = editMode ? "Clic : allouer / retirer (chemin compris) · Ctrl+Z : annuler · rien n'est enregistré" : "Molette : zoom · glisser : déplacer · clic sur un nœud : ce qu'il rapporte";
    };
    $("#tree-undo").onclick = () => edit({ undo: true });
    $("#tree-anoint").onclick = async () => {
      const box = $("#tree-anoints");
      box.innerHTML = `<div class="card pad"><div class="loading"><div class="spinner"></div>PoB grave chaque notable possible sur ton amulette…</div></div>`;
      let r;
      try { r = await api("bestAnoints", { id, stage: stageOf(id) }); } catch (e) { box.innerHTML = ""; return toast(e.message, true); }
      if (r.none) { box.innerHTML = `<div class="card pad muted">${esc(r.none)}</div>`; return; }
      box.innerHTML = `<div class="card pad anoint-box"><div class="row" style="justify-content:space-between;gap:10px">
          <h3 style="margin:0">Meilleurs anoints pour ton amulette</h3><button class="icon-btn" data-x title="Fermer">✕</button></div>
        <p class="muted small" style="margin:4px 0 10px">${r.tested} notables testés par PoB <b>à la place</b> de ton anoint actuel${r.current ? ` (<b>${esc(r.current)}</b>)` : " (aucun)"}, triés par DPS. Clique un nom pour le voir sur l'arbre.</p>
        <table class="stat-table"><tbody>${r.list.map((x) => `<tr><td class="l"><button class="link" data-n="${x.id}">${esc(x.name)}</button><div class="muted small">${esc((x.stats || []).join(" · "))}</div></td>
          <td class="v"><span class="delta ${deltaClass(x.head.dps)}">DPS ${pctText(x.head.dps)}</span><br><span class="delta ${deltaClass(x.head.ehp)}">Survie ${pctText(x.head.ehp)}</span></td>
          <td class="small">${oilRecipe(x.recipe)}</td></tr>`).join("")}</tbody></table></div>`;
      $("[data-x]", box).onclick = () => { box.innerHTML = ""; };
      box.querySelectorAll("[data-n]").forEach((b) => b.onclick = () => { tv.focus(+b.dataset.n); $("#tw").scrollIntoView({ block: "center" }); });
    };
  }
  $(".tree-side").onclick = (ev) => { const b = ev.target.closest(".ni"); if (b) tv.focus(+b.dataset.id); };
  const tg = $("#tree-guide");
  if (tg) tg.onchange = async () => {
    let spec = null;
    if (tg.checked) { const gsnap = await openBuild(gid); spec = treeSpecOf(gsnap); await openBuild(id); }
    tv.destroy();
    tv = new PobTree($("#tw"), { target: () => ({ id, stage: stageOf(id) }), compare: spec });
    if (heatOn) loadHeat();
  };
}
// ------------------------------------------------------------------ GEMMES
async function pageSkills(c, id, snap, token, opts = {}) {
  const cards = skillCards(snap.skills);
  const itemName = (src) => (src || "").replace(/^Item:\d+:/, "").split(",")[0];
  c.innerHTML = `
    <div class="page-head"><div><span class="eyebrow ${MODE_EYEBROW[opts.mode || (ownerKind(id) === "guide" ? "guide" : "mine")][0]}">${MODE_EYEBROW[opts.mode || (ownerKind(id) === "guide" ? "guide" : "mine")][1]}</span><h1>${(opts.mode || ownerKind(id)) === "guide" ? "Gemmes visées" : "Gemmes"}</h1><p>${cards.length} groupes${(opts.mode || ownerKind(id)) === "guide" ? " attendus à cette étape" : " · clique sur un groupe pour en faire la compétence principale"}.</p></div></div>
    <div class="gem-groups">${cards.map(({ g, merged }) => {
      const a = g.gems.find((x) => !x.support) || g.gems[0] || {};
      const main = merged.some((x) => x.main), full = merged.find((x) => x.includeInFullDPS);
      const copies = full && full.count > 1 ? full.count : null;
      const src = g.source ? (/^Item:/.test(g.source) ? "donnée par " + itemName(g.source) : g.source) : "";
      const trig = merged.length > 1 ? GRANTED_TRIGGER[a.name] : null;
      return `<div class="card ggroup ${merged.some((x) => x.enabled) ? "" : "off"}" data-i="${(full || g).index}" style="cursor:pointer">
        <div class="gh"><div><div class="t">${esc(g.label || a.name || "Groupe")}${copies ? ` <span class="tag accent">×${copies} copies</span>` : ""}</div><div class="s">${esc(g.slot || "Sans emplacement")}${src ? " · " + esc(src) : ""}</div></div>
        ${main ? `<span class="tag accent">Principale</span>` : full ? `<span class="tag">Full DPS</span>` : ""}</div>
        ${merged.length > 1 ? "" : socketStrip(g.gems, `${g.gems.length} châsses liées`)}
        ${main && g.parts ? `<label class="part-pick small">Partie calculée ${partSelect(g)}</label>` : ""}
        ${merged.length > 1
          ? `<div class="granted-list">${merged.map((m, k) => { const x = m.gems[0]; return `<div class="granted"><span class="lvl">niv. ${x.level}</span><span>${esc(trig ? trig[k] || "" : "déclenchée par l'objet")}</span></div>`; }).join("")}</div>`
          : gemList(g.gems, () => "", g.index)}
      </div>`;
    }).join("")}</div>`;
  // infobulle de gemme dessinée par PoB
  bindItemTips(c, (k) => { const [gr, gm] = k.split(":").map(Number); return { route: "gemTooltip", body: { id, stage: stageOf(id), group: gr, gem: gm } }; });
  $$("[data-part]", c).forEach((sel) => {
    sel.onclick = (ev) => ev.stopPropagation();
    sel.onchange = () => setMainPart(c, id, +sel.dataset.part, +sel.value);
  });
  $(".gem-groups").onclick = async (ev) => {
    if (ev.target.closest(".part-pick")) return;
    const el = ev.target.closest(".ggroup"); if (!el) return;
    c.style.opacity = .6;
    try { S.snap[id] = await api("mainSkill", { id, stage: stageOf(id), index: +el.dataset.i }); toast("Compétence principale changée"); }
    catch (e) { toast(e.message, true); }
    c.style.opacity = 1; route();
  };
}
