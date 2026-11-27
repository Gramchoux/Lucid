// Lucid — ui_health.js : Santé du build : voyants vitaux, alertes du linter (P1 / P2), carte mana.

// ------------------------------------------------------------------ VUE D'ENSEMBLE
async function pageOverview(c, id, snap) {
  const k = snap.key, info = snap.info;
  const groups = groupStatsByTheme(snap.stats);
  const stage = snap.sets.trees.find((t) => t.active);
  const off = groups.filter((g) => ["dmg", "dot", "speed", "cost"].includes(g.id));
  const def = groups.filter((g) => ["life", "es", "mana", "def", "pool", "regen"].includes(g.id));
  const other = groups.filter((g) => ["attr", "misc"].includes(g.id));
  const minion = snap.minionStats && snap.minionStats.length ? groupStatsByTheme(snap.minionStats) : null;
  c.innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow ${ownerKind(id) === "guide" ? "guide" : "mine"}">${ownerKind(id) === "guide" ? "Guide" : "Ton perso"}</span>
        <h1>${ownerKind(id) === "guide" ? "Chiffres de l'étape" : "État du perso"}</h1>
        <p>${ownerKind(id) === "guide"
          ? `Ce que le guide atteint${stage && snap.sets.trees.length > 1 ? ` à l'étape « ${esc(stage.title)} »` : ""} : les valeurs à viser.`
          : "Ton build seul, calculé par PoB. Clique sur une stat pour voir d'où elle vient."}
          <span class="muted"> · ${esc(info.ascendancy || info.class)} niveau ${info.level}${info.bandit && info.bandit !== "None" ? " · bandit " + esc(info.bandit) : ""}</span></p></div>
      <div class="row">
        ${buildMeta(id)?.poe ? `<button class="btn" id="poe-refresh" title="Réimporter ce personnage depuis ton compte Path of Exile (après un achat ou un craft)">${icon("zap")} Mettre à jour depuis PoE</button>` : ""}
        <label class="muted small">Compétence principale</label>
        <select class="select" id="main-skill" style="max-width:320px">
          ${snap.skills.map((g) => {
            const a = g.gems.find((x) => !x.support) || g.gems[0];
            if (!a) return "";
            return `<option value="${g.index}" ${g.main ? "selected" : ""}>${esc(g.label || a.name)}${g.slot ? " — " + esc(g.slot) : ""}</option>`;
          }).join("")}
        </select>
        ${(() => { const m = snap.skills.find((g) => g.main && g.parts); return m ? partSelect(m) : ""; })()}
      </div>
    </div>
    ${kpiCards(k)}
    <div class="section"><div class="section-title"><h2 class="with-ico">${icon("res", "--cold")}Résistances</h2></div>${resistCards(k)}</div>
    ${off.length ? `<div class="section"><div class="section-title"><h2>Compétence sélectionnée</h2><span class="muted">${esc(info.mainSkill || "")} · détail de cette compétence seule</span></div><div class="stat-grid">${off.map(statGroupCard).join("")}</div></div>` : ""}
    ${def.length ? `<div class="section"><div class="section-title"><h2>Défense</h2></div><div class="stat-grid">${def.map(statGroupCard).join("")}</div></div>` : ""}
    ${other.length ? `<div class="section"><div class="section-title"><h2>Personnage</h2></div><div class="stat-grid">${other.map(statGroupCard).join("")}</div></div>` : ""}
    ${minion ? `<div class="section"><div class="section-title"><h2 class="with-ico">${icon("skull", "--chaos")}Sbires</h2></div><div class="stat-grid">${minion.map(statGroupCard).join("")}</div></div>` : ""}
    <p class="muted small" style="margin-top:24px">Valeurs et formats calculés par Path of Building. Clique sur la vie, la mana, une défense, une résistance ou un attribut pour voir d'où vient le chiffre.</p>`;
  c.querySelectorAll("[data-why]").forEach((el) => { el.onclick = () => showWhy(id, el.dataset.why, el.dataset.label); });
  const pr = $("#poe-refresh");
  if (pr) pr.onclick = () => { const b = buildMeta(id); if (b) refreshCharacter(b); };
  $$("[data-part]", c).forEach((sel) => sel.onchange = () => setMainPart(c, id, +sel.dataset.part, +sel.value));
  $("#main-skill").onchange = async (ev) => {
    c.style.opacity = .6;
    try { S.snap[id] = await api("mainSkill", { id, stage: stageOf(id), index: +ev.target.value }); } catch (e) { toast(e.message, true); }
    c.style.opacity = 1; route();
  };
}

// ------------------------------------------------------------------ analyse de cohérence (linter)
// Règles indépendantes (lucid/rules/*.lua) évaluées par le moteur PoB sur ton build aligné sur l'étape du guide.
const LINT_SEV = {
  CRITIQUE: { label: "Critique", cls: "bad", ico: "skull" },
  ATTENTION: { label: "Attention", cls: "warn", ico: "zap" },
  CONSEIL: { label: "Conseil", cls: "accent", ico: "target" },
};
const LINT_CAT = { SURVIE: ["Survie", "shield", "--life"], DPS: ["DPS", "sword", "--fire"], MECANIQUE: ["Mécanique", "refresh", "--mana"], CONFIG: ["Config", "dots", "--chaos"] };
function lintCount(R) {
  const f = (R.lint && R.lint.findings) || [];
  const crit = f.filter((x) => x.severity === "CRITIQUE").length;
  return crit ? `${f.length} · ${crit} crit.` : f.length;
}
// Budget de mana (PoB) : réserve libre, dépense (compétence la plus forte + sorts déclenchés), récupération
function manaCard(mb) {
  if (!mb || mb.eb || (!mb.use && !mb.reservedPct && !(mb.bursts || []).length)) return "";
  // dépense continue : seulement si tu lances un sort toi-même (un sort déclenché part sur un événement)
  const cast = !!(mb.spam && mb.spam.perSec > 0);
  const burstBad = (mb.bursts || []).some((g) => g.fail.length || (g.sim && g.sim.miss.length));
  const ok = cast ? mb.secs == null : !burstBad;
  const recov = mb.regen + mb.leech + (mb.recoup || 0);
  const leechTxt = mb.leechNote === "none" ? `<span title="Seuls tes propres coups volent de la mana, pas ceux de tes sbires">vol 0 (sbires)</span>`
    : mb.leechNote === "zero" ? `vol de mana 0 sur ${esc(mb.spam.name)}` : "vol " + nf(mb.leech, 1);
  // salve : tous les sorts d'un même déclencheur partent en même temps et paient chacun leur coût
  const burstHtml = (g) => {
    const fits = !g.fail.length;
    const w = (v) => Math.min(100, v / Math.max(g.cost, mb.pool) * 100).toFixed(1);
    return `<div class="mana-burst ${fits ? "" : "short"}">
      <div class="row" style="justify-content:space-between;gap:10px"><span><b>Une salve de ${esc(g.by)}</b> <span class="muted small">${g.spells.length} sort${g.spells.length > 1 ? "s" : ""} en même temps</span></span>
        <span class="tag ${fits ? "good" : "bad"}">${fits ? "Passe en entier" : "Incomplète"}</span></div>
      <div class="mb-bar" title="Coût d'une salve face à ta réserve libre">
        <i style="width:${w(Math.min(g.cost, mb.pool))}%"></i>${fits ? "" : `<i class="over" style="width:${w(g.cost - mb.pool)}%"></i>`}
        <span class="mb-pool" style="left:${w(mb.pool)}%"></span></div>
      <div class="muted small">${g.spells.map((x) => `${esc(x.name)} ${nf(x.cost)}`).join(" + ")} = <b>${nf(g.cost)} mana</b> · réserve libre ${nf(mb.pool)}</div>
      <p class="small" style="margin:6px 0 0">${fits
        ? `Ta réserve paie ${g.inRow > 1 ? `<b>${g.inRow} salves d'affilée</b>` : "<b>une salve complète</b>"}, ensuite il faut attendre que ta mana remonte`
        : `Il manque <b>${nf(g.cost - mb.pool)} mana</b> : ${g.fail.map(esc).join(", ")} ne part${g.fail.length > 1 ? "ent" : ""} pas même réserve pleine`}${g.refill ? ` : ta récupération (${nf(recov, 1)}/s) regagne une salve en <b>${nf(g.refill, 1)} s</b>` : " : rien ne te rend de mana entre deux salves"}.
</p>
      ${g.wardDelay ? `<p class="small muted" style="margin:4px 0 0">Ta ward met <b>${nf(g.wardDelay, 1)} s</b> à revenir après une cassure : au mieux une salve toutes les ${nf(g.wardDelay, 1)} s (PoB en compte ${nf(g.pobRate, 2)}/s car il ne regarde que la recharge du support).</p>` : ""}
      ${g.sim ? `<p class="small" style="margin:4px 0 0">${simTxt(g)}</p>` : ""}
    </div>`;
  };
  // combat simulé sur 60 s : une salve dès que possible, chaque sort selon sa propre recharge
  const simTxt = (g) => {
    const s = g.sim, every = `une salve toutes les ${nf(s.period, 1)} s pendant une minute`;
    if (!s.miss.length) return `${icon("check", "--good")} <b>Ta mana suit</b> : ${every}, tous les sorts partent à chaque fois qu'ils sont prêts.`;
    return `${icon("zap", "--bad")} <b>Ta mana ne suit pas</b> : ${every}, ${s.miss.map((x) => `${esc(x.name)} rate ${x.miss} fois`).join(", ")} faute de mana (dès ${nf(s.firstFail, 0)} s de combat). Hors combat continu, la mana a le temps de remonter.`;
  };
  return `<div class="card pad mana-card ${ok ? "" : "short"}">
    <div class="mana-head">${icon("drop", "--mana")}<div><b>Mana</b> <span class="muted small">${mb.minionBuild ? "build de sbires : seuls les sorts que tu lances ou déclenches coûtent" : "calculée par PoB sur toutes tes compétences"}</span></div>
      ${cast ? `<span class="tag ${ok ? "good" : "bad"}">${ok ? "Tient en continu" : "À sec en " + nf(mb.secs, 1) + " s"}</span>`
        : (mb.bursts || []).length ? `<span class="tag ${ok ? "good" : "bad"}">${ok ? "Tes salves passent" : "Salve incomplète"}</span>` : ""}</div>
    <div class="mana-kpi">
      <div><span class="muted small">Réserve libre</span><b>${nf(mb.pool)}</b><span class="muted small">sur ${nf(mb.mana)} · ${nf(mb.reservedPct)} % réservée</span></div>
      ${cast ? `<div><span class="muted small">Dépense</span><b>${nf(mb.use, 1)}/s</b><span class="muted small">${esc(mb.spam.name)} · ${nf(mb.spam.rate, 1)} lancer/s</span></div>` : ""}
      <div><span class="muted small">Récupération</span><b>${nf(recov, 1)}/s</b><span class="muted small">régén. ${nf(mb.regen, 1)}${mb.recoup > 0 ? ` · <span title="Moyenne de PoB : dépend des coups que tu encaisses">Recoup ${nf(mb.recoup, 1)}</span>` : ""} · ${leechTxt}</span></div>
    </div>
    ${(mb.bursts || []).map(burstHtml).join("")}
    ${(mb.reserved || []).length ? `<p class="muted small" style="margin:8px 0 0">Réservé : ${mb.reserved.map((r) => esc(r.name) + " " + nf(r.value)).join(" · ")}</p>` : ""}
  </div>`;
}
function tabAnalysis(body, R) {
  const L = R.lint || { findings: [] };
  const all = L.findings || [];
  const counts = {};
  all.forEach((f) => { counts[f.category] = (counts[f.category] || 0) + 1; });
  const list = all.filter((f) => lintCat === "all" || f.category === lintCat);
  const card = (f) => {
    const sv = LINT_SEV[f.severity] || LINT_SEV.CONSEIL;
    const ct = LINT_CAT[f.category] || LINT_CAT.MECANIQUE;
    const neg = f.impact && ((f.impact.dps || 0) < 0 || (f.impact.ehp || 0) < 0);
    return `<div class="lint lint-${sv.cls}">
      ${icon(ct[1], ct[2])}
      <div class="lint-body">
        <div class="lint-head"><b>${esc(f.title || f.id)}</b>
          <span class="tag ${sv.cls}">${sv.label}</span><span class="tag">${ct[0]}</span>
          ${f.impactText ? `<span class="lint-impact ${neg ? "neg" : "pos"}">${esc(f.impactText)}</span>` : ""}</div>
        <p>${esc(f.message || "")}</p>
        ${f.fix ? `<p class="lint-fix">→ ${esc(f.fix)}</p>` : ""}
        ${fixTarget(f) ? `<button class="btn sm fix-go" data-fix="${esc(f.id)}">Voir où corriger · ${esc(fixTarget(f).label)} ${icon("arrow")}</button>` : ""}
        ${creatorRuleButtons(f)}
      </div>
    </div>`;
  };
  const groups = ["CRITIQUE", "ATTENTION", "CONSEIL"].map((sev) => [sev, list.filter((f) => f.severity === sev)]).filter(([, l]) => l.length);
  body.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:12px;gap:12px;flex-wrap:wrap">
      <p class="muted small" style="margin:0;max-width:640px">Lucid croise la configuration du guide, ton équipement / arbre / gemmes réels et les stats calculées par PoB.
        Les impacts sont mesurés par une simulation PoB sur <b>ton</b> perso (la condition est corrigée, le reste ne bouge pas).</p>
      <div class="seg" id="lint-cat">${[["all", "Tout", all.length], ...Object.entries(LINT_CAT).map(([k, v]) => [k, v[0], counts[k] || 0])]
        .map(([k, l, n]) => `<button data-c="${k}" class="${lintCat === k ? "on" : ""}" ${n ? "" : "disabled"}>${l} <span class="muted">${n}</span></button>`).join("")}</div>
    </div>
    ${manaCard(L.mana)}
    ${groups.length ? groups.map(([sev, l]) => `<div class="section" style="margin-top:6px">
        <div class="section-title"><h2>${LINT_SEV[sev].label}</h2><span class="muted">${l.length}</span></div>
        <div class="lint-list">${l.map(card).join("")}</div></div>`).join("")
      : `<div class="empty">Aucune incohérence détectée : ton build peut réellement activer ce que le guide suppose à cette étape.</div>`}
    ${(L.errors || []).length ? `<details class="section"><summary class="muted small" style="cursor:pointer">${L.errors.length} règle(s) en erreur</summary><pre class="small">${esc(L.errors.join(" | "))}</pre></details>` : ""}
    <p class="muted small" style="margin-top:14px">${L.rules || 0} règles évaluées · ${L.simulations || 0} simulations PoB · règles dans <code>lucid/rules</code> (relues à chaque analyse).</p>`;
  $("#lint-cat").onclick = (ev) => {
    const b = ev.target.closest("button"); if (!b || b.disabled) return;
    lintCat = b.dataset.c; tabAnalysis(body, R);
  };
  const gStep = (R.guide.sets.trees.find((t) => t.active) || R.guide.sets.trees[0] || {}).title;
  body.dataset.crStep = gStep || ""; body.dataset.crGuide = R.guide.id;
  if (!body._crBound) { body._crBound = true; bindCreatorRules(body, R.guide.id, gStep, () => route()); }
  body.querySelectorAll("[data-fix]").forEach((b) => b.onclick = () => {
    const f = all.find((x) => x.id === b.dataset.fix);
    if (f && R._jump) R._jump(Object.assign(fixTarget(f), { from: f.title || f.id, back: "analysis" }));
  });
}

// ------------------------------------------------------------------ COLONNE « SANTÉ DU BUILD » (toujours visible)
// Voyants vitaux et alertes du linter, calculés par PoB dans les mêmes conditions que la comparaison au guide
// (route « health », mise en cache côté serveur). Vue Simple : titres des alertes ; Vue Experte : messages et conseils.
const VIEW_EXPERT = () => store.get("viewMode", "simple") === "expert";
function healthArgs(id, meta) {
  const g = meta?.role !== "guide" && meta?.guide && buildMeta(meta.guide) ? meta.guide : null;
  return g ? { mine: id, guide: g, stage: stageOf(g), mineSets: stageOf(id), cfgSource: meta.cfgSource || "guide", fullDps: meta.fullDps || "guide" }
    : { mine: id, mineSets: stageOf(id) };
}
async function renderHealth(id, meta, token, force) {
  const box = $("#health"); if (!box) return;
  const args = healthArgs(id, meta);
  const sig = JSON.stringify(args) + "|" + store.get("viewMode", "simple");
  if (!force && box.dataset.sig === sig && box.dataset.ok) return;   // déjà à jour
  box.dataset.sig = sig; delete box.dataset.ok;
  const info = S.snap[id]?.info || {};
  box.innerHTML = `${healthWho(meta, info)}<div class="loading" style="padding:14px 0"><div class="spinner"></div>PoB vérifie la santé du build…</div>`;
  let H;
  try { H = await api("health", args); } catch (e) { if (box.dataset.sig === sig) box.innerHTML = `${healthWho(meta, info)}<p class="muted small">${esc(e.message)}</p>`; return; }
  if (box.dataset.sig !== sig) return;
  box.dataset.ok = "1";
  S.health = Object.assign(S.health || {}, { [id]: H });
  drawHealth(box, id, meta, H);
}
function healthWho(meta, info) {
  return `<div class="hl-who">${portrait(info.ascendancy || info.class || meta?.asc || meta?.cls, "lg")}
    <div><div class="hl-name">${esc(meta?.name || "")}</div><div class="muted small">${esc(info.ascendancy || info.class || meta?.asc || "")}${info.level ? " · niv. " + info.level : ""}</div></div></div>`;
}
function drawHealth(box, id, meta, H) {
  // une seule source à la fois : tes chiffres (cible du guide en petit dessous), ou ceux du guide (bouton)
  const hasGuide = !!H.guideKey;
  const showGuide = hasGuide && !!S.healthShowGuide;
  const k = (showGuide ? H.guideKey : H.key) || {}, info = H.info || {};
  const tgt = hasGuide && !showGuide ? H.guideKey : null;
  const cible = (v, fmt = compact) => tgt && v != null ? `<small class="hl-tgt">cible ${fmt(v)}</small>` : "";
  const expert = VIEW_EXPERT();
  const res = [["Feu", "Fire", "--fire"], ["Froid", "Cold", "--cold"], ["Foudre", "Lightning", "--light"], ["Chaos", "Chaos", "--chaos"]];
  const resRow = ([l, t, c]) => {
    const v = k[t + "Resist"], low = v != null && (t === "Chaos" ? v < 0 : v < 75);
    return `<div class="hl-res ${low ? "low" : ""}" title="${l} : ${v == null ? "—" : nf(v) + " %"}${k[t + "ResistOverCap"] ? " · +" + nf(k[t + "ResistOverCap"]) + " % au-delà du plafond" : ""}">
      <span>${l}</span><span class="hl-bar"><i style="width:${Math.max(0, Math.min(100, (v || 0) / 75 * 100)).toFixed(0)}%;background:var(${c})"></i></span><b>${v == null ? "—" : nf(v) + " %"}${tgt && tgt[t + "Resist"] != null ? `<small class="hl-tgt"> / ${nf(tgt[t + "Resist"])}</small>` : ""}</b></div>`;
  };
  const attr = [["For", "Str", "Force"], ["Dex", "Dex", "Dextérité"], ["Int", "Int", "Intelligence"]].map(([l, t, full]) => {
    const v = k[t], req = H.ignoreAttrReq ? null : k["Req" + t], miss = req && v != null && v < req;
    return `<span class="hl-attr ${miss ? "miss" : ""}" title="${full} : ${nf(v)}${req ? " · besoin le plus haut " + nf(req) : ""}">${l} <b>${nf(v)}</b>${req ? `<small>/${nf(req)}</small>` : ""}</span>`;
  }).join("");
  const F = H.findings || [];
  const crit = F.filter((f) => f.severity === "CRITIQUE"), warn = F.filter((f) => f.severity === "ATTENTION"), tips = F.filter((f) => f.severity === "CONSEIL");
  const canFix = meta?.role !== "guide" && meta?.guide && buildMeta(meta.guide);
  const alert = (f, cls) => `<details class="hl-alert ${cls}"><summary>${esc(f.title || f.id)}${f.impactText ? ` <small>${esc(f.impactText)}</small>` : ""}</summary>
      <p>${esc(f.message || "")}</p>${f.fix ? `<p class="hl-fix">→ ${esc(f.fix)}</p>` : ""}
      ${canFix ? `<button class="btn sm" data-hfix="${esc(f.id)}">Voir où corriger</button>` : ""}${creatorRuleButtons(f)}</details>`;
  const group = (label, list, cls, all) => list.length ? `<div class="hl-group"><div class="hl-glabel ${cls}">${label} <span>${list.length}</span></div>
      ${(all ? list : list.slice(0, 4)).map((f) => alert(f, cls)).join("")}${!all && list.length > 4 ? `<p class="muted small">+ ${list.length - 4} autres (Vue Experte)</p>` : ""}</div>` : "";
  box.innerHTML = `${healthWho(meta, info)}
    ${hasGuide ? `<div class="hl-src"><span class="hl-badge ${showGuide ? "guide" : "mine"}">${showGuide ? "Le guide" : "Ton perso"}</span>
      <button class="btn sm" data-hsrc>${showGuide ? "Revenir à mes stats" : "Voir stats du guide"}</button></div>` : ""}
    <div class="hl-vitals ${showGuide ? "is-guide" : ""}">
      <div class="hl-big"><div><span>DPS global</span><b>${compact(k.GlobalDPS)}</b>${cible(tgt && tgt.GlobalDPS)}</div>
        <div title="${HIT_HELP}"><span>Coup max</span><b>${compact(k.MinMaxHit ?? k.TotalEHP)}</b>${k.MinMaxHitType ? `<small>faible : ${esc(k.MinMaxHitType)}</small>` : ""}${cible(tgt && (tgt.MinMaxHit ?? tgt.TotalEHP))}</div></div>
      <div class="hl-pool"><span>Vie <b>${nf(k.Life)}</b>${tgt ? `<small class="hl-tgt"> / cible ${nf(tgt.Life)}</small>` : ""}${!tgt && k.LifeUnreserved != null && k.LifeUnreserved < k.Life ? ` <small>(${nf(k.LifeUnreserved)} libre)</small>` : ""}</span>${k.EnergyShield > 50 || (tgt && tgt.EnergyShield > 50) ? `<span>ES <b>${nf(k.EnergyShield)}</b>${tgt ? `<small class="hl-tgt"> / ${nf(tgt.EnergyShield)}</small>` : ""}</span>` : ""}${k.Ward ? `<span>Ward <b>${nf(k.Ward)}</b></span>` : ""}</div>
      <div class="hl-resists">${res.map(resRow).join("")}</div>
      <div class="hl-attrs">${attr}${H.ignoreAttrReq ? `<span class="hl-attr" title="Supreme Ostentation ou équivalent : aucun objet ni gemme ne demande d'attributs">exigences ignorées</span>` : ""}</div>
      ${showGuide ? `<p class="hl-note">Chiffres du guide à cette étape (ce qu'il vise), pas les tiens.</p>`
        : canFix ? `<p class="hl-note">Dans les conditions de combat de l'étape du guide (réglage « Conditions » de la comparaison).</p>` : ""}
    </div>
    ${showGuide ? "" : readinessHtml(H.readiness, expert)}
    <div class="hl-ask">${[["die", "Pourquoi je meurs ?"], ["mana", "Problème de mana"], ["attr", "Attribut manquant"], ["dps", "Chute de DPS"]]
      .map(([k, l]) => `<button class="hl-q" data-ask="${k}">${l}</button>`).join("")}</div>
    <div class="hl-alerts" ${showGuide ? "hidden" : ""}>
      ${!F.length ? `<div class="hl-ok">${icon("check", "--good")} Rien d'alarmant à cette étape.</div>` : ""}
      ${group("Critique", crit, "p1", expert)}${group("Attention", warn, "p2", expert)}
      ${expert ? group("Conseils", tips, "p3", true) : tips.length ? `<p class="muted small">${tips.length} conseil${tips.length > 1 ? "s" : ""} en Vue Experte</p>` : ""}
      ${ignoredRulesHtml(H.ignored, H.step)}
      ${(H.ignored || []).length ? `<p class="muted small cr-player-note">${H.ignored.length} alerte${H.ignored.length > 1 ? "s" : ""} masquée${H.ignored.length > 1 ? "s" : ""} par le créateur du guide pour cette étape.</p>` : ""}
    </div>
    <a class="navlink hl-back" href="#/">← Bibliothèque</a>`;
  if (expert) $$(".hl-alert.p1", box).forEach((d) => { d.open = true; });
  box.dataset.crStep = H.step || ""; box.dataset.crGuide = H.guideId || "";
  if (H.guideId && H.step && !box._crBound) { box._crBound = true; bindCreatorRules(box, H.guideId, H.step, () => renderHealth(id, meta, routeToken, true)); }
  box.onclick = (ev) => {
    if (ev.target.closest("[data-hsrc]")) { S.healthShowGuide = !S.healthShowGuide; return drawHealth(box, id, meta, H); }
    const q = ev.target.closest("[data-ask]");
    if (q) return askHealth(q.dataset.ask, id, meta, H);
    const b = ev.target.closest("[data-hfix]"); if (!b) return;
    S.pendingFix = F.find((f) => f.id === b.dataset.hfix);
    go(id, "guide", "ecarts");
  };
}


// Score de préparation à l'étape (validation souple) : 40 % santé, 60 % piliers fixes (compétence liée,
// keystones / ascendance, objets verrouillés par le créateur). Prêt dès 80 %.
function readinessHtml(R, expert) {
  if (!R) return "";
  const col = R.ready ? "--good" : R.score >= 50 ? "--warn" : "--bad";
  const miss = expert ? R.missing : R.missing.slice(0, 3);
  return `<div class="hl-ready" style="--c:var(${col})">
    <div class="row" style="justify-content:space-between"><span>Préparation à l'étape</span><b>${R.score} %</b></div>
    <div class="hl-bar"><i style="width:${R.score}%;background:var(${col})"></i></div>
    <div class="hl-rlabel">${R.ready ? "Prêt pour l'étape suivante 🟢" : "Pas encore prêt"}</div>
    ${miss.length ? `<ul class="hl-miss">${miss.map((m) => `<li>${esc(m)}</li>`).join("")}${!expert && R.missing.length > 3 ? `<li class="muted">+ ${R.missing.length - 3} (Vue Experte)</li>` : ""}</ul>` : ""}
    <p class="hl-note">Les objets rares ne sont jamais identiques au guide : seuls comptent la santé, la compétence liée, les passifs clés${R.locked && R.locked.length ? " et les objets verrouillés par le créateur" : ""}. Tu peux toujours valider une étape à la main.</p>
  </div>`;
}

// Assistants par question : une réponse courte, construite avec les chiffres déjà calculés par PoB
function askHealth(kind, id, meta, H) {
  const k = H.key || {}, F = H.findings || [];
  const list = (fs) => fs.length ? `<ul class="ask-list">${fs.map((f) => `<li><b>${esc(f.title)}</b><br><span class="muted small">${esc(f.message || "")}</span>${f.fix ? `<br><span class="small">→ ${esc(f.fix)}</span>` : ""}</li>`).join("")}</ul>` : "";
  let title = "", body = "";
  if (kind === "die") {
    title = "Pourquoi je meurs ?";
    const hits = [["Physique", "Physical"], ["Feu", "Fire"], ["Froid", "Cold"], ["Foudre", "Lightning"], ["Chaos", "Chaos"]].map(([l, t]) => [l, k[t + "MaximumHitTaken"]]).filter((x) => x[1] > 0);
    const max = Math.max(1, ...hits.map((x) => x[1])), weak = hits.reduce((a, b) => (!a || b[1] < a[1] ? b : a), null);
    body = `<p>Le plus gros coup que tu encaisses sans mourir, par type de dégâts :</p>
      <div class="sh-hits">${hits.map(([l, v]) => `<div class="sh-hit ${weak && weak[0] === l ? "weak" : ""}"><span>${l}</span><span class="sh-bar"><i style="width:${(v / max * 100).toFixed(0)}%;background:var(--accent)"></i></span><b>${compact(v)}</b></div>`).join("")}</div>
      ${weak ? `<p>Ton point faible : les coups de <b>${esc(weak[0].toLowerCase())}</b> (${compact(weak[1])}). Un boss qui tape plus fort que ça dans ce type te tue en un coup.</p>` : ""}
      <p class="muted small">Blocage ${nf(k.BlockChance)} % · blocage des sorts ${nf(k.SpellBlockChance)} % · suppression ${nf(k.SpellSuppressionChance)} % · armure ${nf(k.Armour)} · évasion ${nf(k.Evasion)}</p>
      ${list(F.filter((f) => f.category === "SURVIE"))}`;
  } else if (kind === "mana") {
    title = "Problème de mana";
    body = H.mana ? manaCard(H.mana) + list(F.filter((f) => /^meca\.(mana|reservation)/.test(f.id))) : `<p class="muted">Pas de données de mana pour ce build.</p>`;
  } else if (kind === "attr") {
    title = "Attribut manquant pour équiper un objet";
    const A = H.attrs || {};
    body = H.ignoreAttrReq ? `<p>Ton build ignore les exigences d'attributs (Supreme Ostentation ou équivalent) : aucun objet ni gemme ne sera désactivé.</p>`
      : `<table class="stat-table"><tr><th></th><th class="v">Tu as</th><th class="v">Besoin le plus haut</th></tr>${[["Force", "Str"], ["Dextérité", "Dex"], ["Intelligence", "Int"]].map(([l, t]) =>
        `<tr><td class="l">${l}</td><td class="v ${A["Req" + t] && A[t] < A["Req" + t] ? "bad-text" : ""}">${nf(A[t])}</td><td class="v">${A["Req" + t] ? nf(A["Req" + t]) : "—"}</td></tr>`).join("")}</table>
        ${list(F.filter((f) => /^meca\.attr/.test(f.id))) || `<p>Aucune gemme ni aucun objet n'est désactivé faute d'attributs.</p>`}
        <p class="muted small">Pour un objet que tu veux acheter : colle-le dans « Tester un upgrade », Lucid signale s'il te manque des attributs pour le porter.</p>`;
  } else if (kind === "dps") {
    title = "Chute de DPS";
    const canCmp = meta?.role !== "guide" && meta?.guide && buildMeta(meta.guide);
    body = `${list(F.filter((f) => f.category === "DPS" || /^meca\.(mainskill|mainlink|accuracy|gemlevel|gemlow)|^config\./.test(f.id)))}
      ${canCmp ? `<p>La décomposition de l'écart de DPS avec l'étape (équipement, arbre, gemmes, conditions…) est dans « Écarts & améliorations ».</p><button class="btn primary sm" data-go-gap>Voir d'où vient l'écart de DPS</button>`
        : `<p class="muted small">Associe ce perso à un guide pour voir d'où vient l'écart de DPS, part par part.</p>`}`;
  }
  const m = modal(`<div class="card-head"><h3>${title}</h3><button class="icon-btn" data-act="close" aria-label="Fermer">✕</button></div><div class="card-body ask-body">${body}</div>`);
  const g = m.el.querySelector("[data-go-gap]");
  if (g) g.onclick = () => { m.close(); cmpTab = "priorities"; store.set("cmpTab", cmpTab); go(id, "guide", "ecarts"); };
}
