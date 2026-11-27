// Lucid — ui_sandbox.js : Tester un upgrade : testeur d'objets (perso et Guardian), trade, simulation de config.

// ------------------------------------------------------------------ ÉQUIPEMENT
async function pageItems(c, id, snap, token, opts = {}) {
  const mode = opts.mode || (ownerKind(id) === "guide" ? "guide" : "mine");
  const sandbox = mode === "sandbox";
  const [ebc, ebl] = MODE_EYEBROW[mode];
  const all = snap.items;
  const bySlot = new Map(all.map((s, i) => [s.slot, i]));
  const flasks = all.map((s, i) => [s, i]).filter(([s]) => /^Flask \d/.test(s.slot));
  const jewels = all.map((s, i) => [s, i]).filter(([s]) => s.item && (s.jewel || /Abyssal|Graft/.test(s.slot)));
  const equipped = all.filter((s) => s.item);
  const gear = Array.isArray(snap.minionGear) ? snap.minionGear.filter((g) => (g.slots || []).some((x) => x.item)) : [];
  c.innerHTML = `
    <div class="page-head"><div><span class="eyebrow ${ebc}">${ebl}</span><h1>${sandbox ? "Tester un objet" : mode === "guide" ? "Équipement visé" : "Équipement"}</h1>
      <p>${sandbox ? "Colle un objet copié en jeu (Ctrl+C) ou sur le trade : il est essayé sur ton build sans rien modifier. Choisis un emplacement dans l'inventaire (Guardian compris) pour le tester précisément là."
        : mode === "guide" && opts.perso ? `${equipped.length} objets à cette étape du guide. Clique un objet : son détail, et la recherche trade calculée pour ton perso.`
        : `${equipped.length} objets équipés. Clique sur un objet pour son détail et ce qu'il apporte à ${mode === "guide" ? "l'étape" : "ton build"}.`}</p></div></div>
    <div class="items-layout">
      <div class="stack">
        <div class="card inventory">
          <div class="doll">
            ${Object.entries(DOLL).map(([slot, [x, y, w, h]]) => {
              if (!bySlot.has(slot)) return "";
              const i = bySlot.get(slot);
              if (slot === "Ring 3" && !all[i].item) return "";
              return invSlot(all[i], i, `grid-column:${x} / span ${w};grid-row:${y} / span ${h}`);
            }).join("")}
          </div>
          ${flasks.length ? `<div class="flasks">${flasks.map(([s, i]) => invSlot(s, i, "")).join("")}</div>` : ""}
          ${jewels.length ? `<div class="inv-sep">Joyaux et emplacements spéciaux</div><div class="jewels">${jewels.map(([s, i]) => invSlot(s, i, "")).join("")}</div>` : ""}
        </div>
        ${gear.map((g, gi) => guardianDoll(g, gi, animatedWeapons(snap))).join("")}
        <div class="card pad">
          <div class="row" style="justify-content:space-between;margin-bottom:6px"><h3>Ce qui porte ton build</h3><span class="muted small">si tu retires l'objet</span></div>
          <div id="contrib" class="contrib-list"><div class="loading" style="padding:14px"><div class="spinner"></div>Calcul de chaque objet…</div></div>
        </div>
      </div>
      <div class="stack" style="position:sticky;top:72px">
        <div id="item-detail"><div class="card pad muted small">Sélectionne un objet dans l'inventaire.</div></div>
        ${sandbox ? `<div class="card pad" id="test-card">
          <h3>Tester un objet</h3>
          <div id="test-target"></div>
          <p class="muted small" style="margin:4px 0 10px">En jeu, survole un objet et fais Ctrl+C, puis colle-le ici. Le moteur l'essaie sur chaque emplacement compatible (ou seulement sur celui choisi).</p>
          <textarea class="input" id="test-raw" rows="6" placeholder="Item Class: Rings&#10;Rarity: Rare&#10;…" style="width:100%"></textarea>
          <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn primary" id="test-go">Tester</button></div>
        </div>
        <div id="test-res"></div>` : `<div id="test-res" hidden></div>`}
      </div>
    </div>`;
  const detail = $("#item-detail");
  const values = {};
  const showItem = (i) => {
    const s = all[i];
    $$(".inv-slot", c).forEach((x) => x.classList.toggle("sel", +x.dataset.i === i));
    if (!s.item) { detail.innerHTML = `<div class="card pad muted">${esc(s.label)} : emplacement vide.</div>`; return; }
    const v = values[s.slot];
    detail.innerHTML = itemCard(s.item, { label: s.label, slot: s.slot }) + testHereBtn() + (v ? `<div class="card pad" style="margin-top:10px"><div class="muted small">Sans cet objet</div>
      <div class="row" style="gap:16px;margin-top:4px"><span class="delta ${deltaClass(v.dps)}">DPS ${pctText(v.dps)}</span><span class="delta ${deltaClass(v.ehp)}">Survie ${pctText(v.ehp)}</span>
      ${v.life ? `<span class="delta ${deltaClass(v.life)}">${v.life > 0 ? "+" : "−"}${nf(Math.abs(v.life))} vie</span>` : ""}</div></div>` : "");
    $("#test-res").innerHTML = "";
    bindTestHere({ kind: "player", slot: s.slot, label: s.label, item: s.item });
  };
  c.querySelector(".inventory").onclick = (ev) => { const b = ev.target.closest(".inv-slot"); if (b) showItem(+b.dataset.i); };
  // Guardian : objets portés par le sbire (jeu d'objets de la gemme), valeur mesurée en les retirant
  const showGuardian = async (gi, si) => {
    const g = gear[gi], sl = g.slots[si];
    $$(".inv-slot", c).forEach((x) => x.classList.toggle("sel", x.dataset.g === `${gi}:${si}`));
    if (!sl.item) { detail.innerHTML = `<div class="card pad muted">Guardian · ${esc(sl.label)} : emplacement vide.</div>`; return; }
    detail.innerHTML = itemCard(sl.item, { label: `${g.skill} · ${sl.label}`, raw: true, noCompare: true }) + testHereBtn() + `<div class="card pad" style="margin-top:10px" id="g-val"><div class="loading"><div class="spinner"></div>Calcul…</div></div>`;
    $("#test-res").innerHTML = "";
    bindTestHere({ kind: "guardian", setId: g.setId, slot: sl.slot, label: `${g.skill} · ${sl.label}`, item: sl.item });
    try {
      const v = (await api("minionItem", { id, stage: stageOf(id), setId: g.setId, slot: sl.slot })).head;
      const el = $("#g-val"); if (!el) return;
      el.innerHTML = `<div class="muted small">Si le Guardian ne porte plus cet objet</div>
        <div class="row" style="gap:16px;margin-top:4px"><span class="delta ${deltaClass(v.dps)}">DPS ${pctText(v.dps)}</span><span class="delta ${deltaClass(v.ehp)}">Survie ${pctText(v.ehp)}</span></div>`;
    } catch (e) { const el = $("#g-val"); if (el) el.innerHTML = `<span class="muted small">${esc(e.message)}</span>`; }
  };
  $$(".guardian-inv", c).forEach((el) => { el.onclick = (ev) => {
    const b = ev.target.closest(".inv-slot"); if (!b) return;
    ev.stopPropagation();
    const [gi, si] = b.dataset.g.split(":").map(Number); showGuardian(gi, si);
  }; });
  // « Tester un autre objet ici » : le testeur vise cet emplacement (perso ou sbire)
  let testTarget = null;
  const testHereBtn = () => sandbox ? `<button class="btn sm" data-test-here style="margin-top:10px;width:100%">${icon("zap")} Tester un autre objet ici</button>`
    : tradeHere();
  // guide vu depuis le perso : recherche trade de cet objet, calculée pour ton perso
  const tradeHere = () => opts.perso ? `<div class="trade-box" style="margin-top:10px"><div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div><b>Chercher sur le trade</b><div class="muted small">Recherche calculée pour ton perso, à partir de cet objet du guide.</div></div>
      <button class="btn primary sm" data-trade-here>Générer les recherches</button></div></div>` : "";
  const renderTarget = () => {
    const el = $("#test-target"); if (!el) return;
    el.innerHTML = testTarget ? `<div class="test-target"><span>À la place de <b>${esc(itemTitle(testTarget.item))}</b> <span class="muted">· ${esc(testTarget.label)}</span></span>
      <button class="icon-btn" data-untarget title="Tester sur tous les emplacements compatibles">✕</button></div>` : "";
    const x = $("[data-untarget]", el); if (x) x.onclick = () => { testTarget = null; renderTarget(); };
  };
  function bindTestHere(tg) {
    const tb = $("[data-trade-here]", detail);
    if (tb && opts.perso && tg.kind === "player") {
      const r = { slot: tg.slot, label: tg.label, guide: tg.item };
      if (!tradable(r)) tb.closest(".trade-box").hidden = true;
      tb.onclick = () => tradeSearch(tb.closest(".trade-box"), { mine: { id: opts.perso, stage: stageOf(opts.perso) } }, r);
    } else if (tb) tb.closest(".trade-box").hidden = true;
    const b = $("[data-test-here]", detail); if (!b) return;
    b.onclick = () => { testTarget = tg; renderTarget(); const ta = $("#test-raw"); ta.focus(); ta.scrollIntoView({ block: "center" }); };
  }
  const sideBySide = (tg, raw, tested) => `<div class="tt-pair">
      <div>${itemCard(tg.item, { label: "Ton objet · " + tg.label, raw: true, noCompare: true })}</div>
      <div>${itemCard(tested || { raw }, { label: "Objet testé", raw: true, noCompare: true })}</div></div>`;
  bindItemTips(c, (i) => {
    if (i[0] === "g") {
      const [gi, si] = i.slice(1).split(":").map(Number);
      const it = gear[gi] && gear[gi].slots[si] && gear[gi].slots[si].item;
      return it ? { route: "itemTooltip", body: { id, stage: stageOf(id), raw: it.raw, noCompare: true } } : null;
    }
    return all[+i] && all[+i].item ? { route: "itemTooltip", body: { id, stage: stageOf(id), slot: all[+i].slot } } : null;
  });
  // coller un objet (Ctrl+V) lance le test tout de suite, sans bouton à cliquer
  if ($("#test-raw")) $("#test-raw").addEventListener("paste", () => setTimeout(() => { if ($("#test-raw").value.trim()) $("#test-go").click(); }, 0));
  if ($("#test-go")) $("#test-go").onclick = async () => {
    const raw = $("#test-raw").value.trim(); if (!raw) return;
    const out = $("#test-res");
    out.innerHTML = `<div class="loading" style="padding:12px"><div class="spinner"></div>Calcul…</div>`;
    const tg = testTarget;
    try {
      if (tg && tg.kind === "guardian") {
        const r = await api("minionItem", { id, stage: stageOf(id), setId: tg.setId, slot: tg.slot, raw });
        out.innerHTML = `${sideBySide(tg, raw, r.item)}<div class="card pad" style="margin-top:10px">
          <div class="row" style="justify-content:space-between"><b>${esc(tg.label)}</b><span class="muted small">porté par le sbire</span></div>
          <div class="row" style="gap:16px;margin:8px 0"><span class="delta ${deltaClass(r.head.dps)}">DPS ${pctText(r.head.dps)}</span><span class="delta ${deltaClass(r.head.ehp)}">Survie ${pctText(r.head.ehp)}</span></div>
          ${testVerdict({ head: r.head, diff: r.diff || [] })}
          ${(r.minionDiff || []).length ? `<details><summary class="muted small" style="cursor:pointer">Statistiques du sbire</summary>${diffTable(r.minionDiff)}</details>` : ""}
          <details><summary class="muted small" style="cursor:pointer">Détail des ${(r.diff || []).length} statistiques</summary>${diffTable(r.diff || [])}</details></div>`;
        return;
      }
      const r = await api("testItem", Object.assign({ id, stage: stageOf(id), raw }, tg ? { slot: tg.slot } : {}));
      if (!r.results.length) { out.innerHTML = `<div class="card pad muted">${tg ? `Cet objet ne peut pas aller dans l'emplacement « ${esc(tg.label)} ».` : "Aucun emplacement compatible pour cet objet."}</div>`; return; }
      out.innerHTML = `${testBanner(r.results, id)}${tg ? sideBySide(tg, raw, r.item) : itemCard(r.item)}${r.results.map((x) => `<div class="card pad" style="margin-top:10px">
        <div class="row" style="justify-content:space-between"><b>${esc(x.slot)}</b><span class="muted small">${x.current ? "à la place de " + esc(x.current) : "emplacement vide"}</span></div>
        <div class="row" style="gap:16px;margin:8px 0"><span class="delta ${deltaClass(x.head.dps)}">DPS ${pctText(x.head.dps)}</span><span class="delta ${deltaClass(x.head.ehp)}">Survie ${pctText(x.head.ehp)}</span>
        ${x.head.life ? `<span class="delta ${deltaClass(x.head.life)}">${x.head.life > 0 ? "+" : "−"}${nf(Math.abs(x.head.life))} vie</span>` : ""}</div>
        ${testVerdict(x)}
        <details><summary class="muted small" style="cursor:pointer">Détail des ${x.diff.length} statistiques</summary>${diffTable(x.diff)}</details></div>`).join("")}`;
    } catch (e) { out.innerHTML = `<div class="card pad" style="color:var(--bad)">${esc(e.message)}</div>`; }
  };
  // contribution de chaque objet (calcul séquentiel, ~20 ms par objet)
  const list = equipped.filter((s) => !/Swap/.test(s.slot));
  for (const s of list) {
    if (token !== routeToken) return;
    try { values[s.slot] = (await api("itemValue", { id, stage: stageOf(id), slot: s.slot })).head; } catch (e) { /* ignoré */ }
  }
  if (token !== routeToken) return;
  const rows = list.filter((s) => values[s.slot]).sort((a, b) => (values[a.slot].dps + values[a.slot].ehp) - (values[b.slot].dps + values[b.slot].ehp));
  const maxLoss = Math.max(1, ...rows.map((s) => Math.max(-values[s.slot].dps, -values[s.slot].ehp)));
  const bar = (v, label) => `<div class="gainbar"><div class="track"><i class="neg" style="width:${Math.min(100, Math.max(0, -v) / maxLoss * 100)}%"></i></div><span class="delta ${deltaClass(v)}">${label} ${pctText(v)}</span></div>`;
  $("#contrib").innerHTML = rows.map((s) => {
    const v = values[s.slot];
    const neutral = Math.abs(v.dps) < 0.05 && Math.abs(v.ehp) < 0.05;
    return `<button class="contrib-row" data-i="${bySlot.get(s.slot)}" data-tip="${bySlot.get(s.slot)}">
      <span class="ci">${itemIcon(s.item)}</span>
      <span class="cn"><span class="r-${esc(s.item.rarity)}">${esc(itemTitle(s.item))}</span><span class="muted small">${esc(s.label)}</span></span>
      <span class="cg">${neutral ? `<span class="muted small">aucun effet mesuré</span>` : bar(v.dps, "DPS") + bar(v.ehp, "Survie")}</span>
    </button>`;
  }).join("") || `<p class="muted">Rien à mesurer.</p>`;
  $("#contrib").onclick = (ev) => { const b = ev.target.closest(".contrib-row"); if (b) showItem(+b.dataset.i); };
}

// ------------------------------------------------------------------ CONFIGURATION
async function pageConfig(c, id, snap, token, opts = {}) {
  const focusCfg = S.cfgFocus || null;
  S.cfgFocus = null;
  const cfg = await api("configList", Object.assign({ id, stage: stageOf(id) }, focusCfg ? { focus: [focusCfg.var] } : {}));
  if (focusCfg) { cfg.active = cfg.active.filter((o) => o.var !== focusCfg.var); cfg.key = cfg.key.filter((o) => o.var !== focusCfg.var); }
  if (token !== routeToken) return;
  const control = (o) => {
    if (o.type === "check") return `<label class="switch"><input type="checkbox" data-var="${esc(o.var)}" ${o.value ? "checked" : ""}><span></span></label>`;
    if (o.type === "list") return `<select class="select" data-var="${esc(o.var)}">${(o.options || []).map((x) => `<option value="${esc(x.val)}" ${String(x.val) === String(o.value) ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>`;
    if (o.type === "count" || o.type === "integer" || o.type === "countAllowZero" || o.type === "float") return `<input class="input" type="number" data-var="${esc(o.var)}" data-num="1" value="${o.value ?? ""}">`;
    return `<input class="input" data-var="${esc(o.var)}" value="${esc(o.value ?? "")}">`;
  };
  const row = (o) => `<div class="cfg"><div><div class="cl">${esc(stripPob(o.label))}</div><div class="cs">${esc(o.section || "")}</div></div>${control(o)}</div>`;
  const k = snap.key;
  c.innerHTML = `
    <div class="page-head"><div><span class="eyebrow sandbox">Essai · rien n'est enregistré</span><h1>Simuler la config</h1><p>Coche ou décoche des charges, buffs ou conditions de boss : l'impact sur le DPS et la survie (coup max encaissable) s'affiche tout de suite. Rien n'est enregistré, et tout revient à ${ownerKind(id) === "guide" ? "la config du guide" : "ton perso"} quand tu quittes l'onglet « Tester un upgrade ».</p></div>
      <button class="btn" id="cfg-reset">${icon("refresh")} Réinitialiser sur ${ownerKind(id) === "guide" ? "le guide" : "mon perso"}</button></div>
    <div class="kpi-row" id="cfg-kpi">
      <div class="card kpi"><div class="label">${dpsLabel(k)}</div><div class="value">${compact(mainDps(k))}</div><div class="sub">${esc(dpsSub(k))}</div></div>
      <div class="card kpi" title="${HIT_HELP}"><div class="label">Coup max encaissable</div><div class="value">${compact(minHit(k))}</div><div class="sub">${minHitType(k) ? "point faible : " + esc(minHitType(k)) : ""}</div></div>
      <div class="card kpi"><div class="label">Vie</div><div class="value">${nf(k.Life)}</div></div>
    </div>
    ${focusCfg ? `<div class="fix-banner">${icon("target", "--accent")}<span>Pour corriger <b>${esc(focusCfg.from || "")}</b> : coche ou décoche l'option et regarde le DPS et la survie changer (avant → après).</span></div>
      <div class="card pad focus-hl" style="margin-top:10px"><div class="cfg-list">${(cfg.focus || []).map(row).join("") || `<p class="muted small">Option introuvable dans cette version de PoB.</p>`}</div></div>` : ""}
    <div class="grid cols-2 section">
      <div class="card pad"><h3>Options actives de ce build</h3><div class="cfg-list">${cfg.active.map(row).join("") || '<p class="muted">Aucune option hors défaut.</p>'}</div></div>
      <div class="card pad"><h3>Accès rapide</h3><div class="cfg-list">${cfg.key.map(row).join("")}</div></div>
    </div>`;
  const onChange = async (el) => {
    let value = el.type === "checkbox" ? el.checked : el.dataset.num ? (el.value === "" ? null : +el.value) : el.value;
    if (el.tagName === "SELECT") {
      const n = Number(value); value = el.value !== "" && String(n) === el.value ? n : el.value;
    }
    try {
      const s = await api("config", { id, stage: stageOf(id), var: el.dataset.var, value });
      S.snap[id] = s;
      S.cfgDirty = Object.assign(S.cfgDirty || {}, { [id]: true });
      const kk = s.key;
      $("#cfg-kpi").innerHTML = `
        <div class="card kpi"><div class="label">${dpsLabel(kk)}</div><div class="value">${compact(mainDps(kk))}</div><div class="sub">${pctText((mainDps(kk) - mainDps(k)) / (mainDps(k) || 1) * 100)} vs config du build</div></div>
        <div class="card kpi" title="${HIT_HELP}"><div class="label">Coup max encaissable</div><div class="value">${compact(minHit(kk))}</div><div class="sub">${pctText(((kk.HitPool || 0) - (k.HitPool || 0)) / (k.HitPool || 1) * 100)} survie</div></div>
        <div class="card kpi"><div class="label">Vie</div><div class="value">${nf(kk.Life)}</div></div>`;
    } catch (e) { toast(e.message, true); }
  };
  $$("[data-var]", c).forEach((el) => el.addEventListener("change", () => onChange(el)));
  $("#cfg-reset").onclick = async () => { if (S.cfgDirty) delete S.cfgDirty[id]; S.snap[id] = await openBuild(id, { force: true, stage: stageOf(id) }); route(); };
}

// Verdict d'un objet testé, en une ligne, avant tout le reste : meilleur emplacement, DPS, survie, et ce qui casse
// (résistances qui baissent, prérequis non tenus, unique en double, emplacement verrouillé par le créateur du guide)
function testBanner(results, id) {
  if (!results || !results.length) return "";
  const best = results.slice().sort((a, b) => (b.head.dps + b.head.ehp) - (a.head.dps + a.head.ehp))[0];
  const h = best.head, warn = [];
  const RES = { FireResist: "feu", ColdResist: "froid", LightningResist: "foudre", ChaosResist: "chaos" };
  const lostRes = (best.diff || []).filter((d) => RES[d.key] && d.delta < -0.5 && (d.key === "ChaosResist" ? d.new < 0 : d.new < 75));
  if (lostRes.length) warn.push("résistance " + lostRes.map((d) => `${RES[d.key]} ${fmtDelta(d)} (${nf(d.new)} %)`).join(", ") + " sous le plafond");
  if ((best.brokenReqs || []).length) warn.push("prérequis non tenus : " + best.brokenReqs.map((x) => `il manque ${nf(x.missing)} ${{ Str: "Force", Dex: "Dextérité", Int: "Intelligence" }[x.attr] || x.attr}${x.source ? " (" + x.source + ")" : ""}`).join(", "));
  if (best.duplicateUnique) warn.push("unique déjà porté");
  const H = (S.health || {})[id];
  const locked = H && H.readiness ? H.readiness.locked || [] : [];
  if (locked.includes(best.slot)) warn.push("le guide exige un objet précis ici 🔒");
  const good = h.dps > 0.5 || h.ehp > 0.5, bad = h.dps < -0.5 && h.ehp < -0.5;
  const cls = warn.length ? "warn" : bad ? "bad" : good ? "good" : "flat";
  const label = warn.length ? "À vérifier" : bad ? "Moins bien que ton objet" : good ? "Upgrade" : "Équivalent";
  return `<div class="test-banner ${cls}"><span class="tb-v">${label}</span>
    <span class="tb-main"><b>${esc(best.slot)}</b> · <span class="delta ${deltaClass(h.dps)}">DPS ${pctText(h.dps)}</span> · <span class="delta ${deltaClass(h.ehp)}">Survie ${pctText(h.ehp)}</span>
      ${h.life ? ` · <span class="delta ${deltaClass(h.life)}">${h.life > 0 ? "+" : "−"}${nf(Math.abs(h.life))} vie</span>` : ""}${results.length > 1 ? ` <span class="muted small">(meilleur des ${results.length} emplacements)</span>` : ""}</span>
    ${warn.length ? `<span class="tb-warn">${icon("zap", "--warn")} ${warn.map(esc).join(" · ")}</span>` : ""}</div>`;
}
