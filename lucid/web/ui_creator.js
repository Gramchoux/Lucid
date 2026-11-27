// Lucid — ui_creator.js : Mode Création de guide : règles ignorées par étape, chronologie des transitions, notes.

// ------------------------------------------------------------------ règles ignorées (guideMeta)
// Le moteur garde ses règles automatiques ; le créateur ne fait que retirer un faux positif :
// sur une étape (clé = titre de l'étape dans PoB) ou sur tout le guide.
async function getGuideMeta(guideId) {
  return (await api("guideMeta", { id: guideId })).meta || {};
}
async function setRuleIgnored(guideId, step, ruleId, scope, on) {
  const gm = await getGuideMeta(guideId);
  let set;
  if (scope === "global") {
    const l = new Set(gm.globalDisabledRules || []);
    if (on) l.add(ruleId); else l.delete(ruleId);
    set = { globalDisabledRules: [...l] };
  } else {
    const steps = Object.assign({}, gm.steps || {});
    const st = Object.assign({}, steps[step] || {});
    const l = new Set(st.disabledRules || []);
    if (on) l.add(ruleId); else l.delete(ruleId);
    st.disabledRules = [...l];
    steps[step] = st;
    set = { steps };
  }
  await api("guideMetaSet", { id: guideId, set });
}
// boutons sous une alerte (visibles seulement en Mode Création)
function creatorRuleButtons(f) {
  return `<div class="creator-only cr-rule"><button class="btn sm" data-ign="step" data-rid="${esc(f.id)}" title="Faux positif pour cette étape du guide">Ignorer sur cette étape</button>
    <button class="btn sm" data-ign="global" data-rid="${esc(f.id)}" title="Faux positif pour tout le guide">Ignorer partout</button></div>`;
}
// liste des règles ignorées (avec « Réactiver »)
function ignoredRulesHtml(list, step) {
  if (!list || !list.length) return "";
  return `<details class="creator-only cr-ignored"><summary>${list.length} règle${list.length > 1 ? "s" : ""} ignorée${list.length > 1 ? "s" : ""} par le guide</summary>
    ${list.map((f) => `<div class="cr-ig-row"><span><b>${esc(f.title || f.id)}</b> <small>${f.ignoredBy === "global" ? "partout" : "sur « " + esc(step || "") + " »"}</small></span>
      <button class="btn sm" data-unign="${esc(f.ignoredBy)}" data-rid="${esc(f.id)}">Réactiver</button></div>`).join("")}</details>`;
}
// branche les boutons d'un conteneur ; after() relance l'affichage
function bindCreatorRules(root, guideId, step, after) {
  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-ign],[data-unign]"); if (!b || !root.contains(b)) return;
    ev.stopPropagation();
    const on = !!b.dataset.ign, scope = b.dataset.ign || b.dataset.unign;
    b.disabled = true;
    try {
      step = root.dataset.crStep || step; guideId = root.dataset.crGuide || guideId;
      await setRuleIgnored(guideId, step, b.dataset.rid, scope, on);
      toast(on ? (scope === "global" ? "Règle ignorée sur tout le guide" : `Règle ignorée sur « ${step} »`) : "Règle réactivée");
      after();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
}

// ------------------------------------------------------------------ chronologie des transitions (guideMeta.transitions)
// Entre deux étapes, Lucid détecte les changements (clés stables : item:<emplacement>, tree:<passif>, gem:<groupe>,
// config:<option>). Le créateur les met dans l'ordre « anti-casse » et les annote ; le joueur voit la liste numérotée.
// Clés de transition = titres d'étapes PoB (« A->B ») : elles survivent aux réimports tant que les titres restent.
const KIND_ICON = { item: "shield", tree: "target", gem: "zap", config: "dots" };
async function transitionCard(host, guideId, fromTitle, toTitle, D, titles, opts = {}) {
  const box = document.createElement("div");
  box.className = "tl-wrap";
  const cats = host.querySelector(".sd-cards");
  host.insertBefore(box, cats || null);
  let gm;
  try { gm = await getGuideMeta(guideId); } catch (e) { return; }
  const tkey = fromTitle + "->" + toTitle;
  const saved = (gm.transitions || {})[tkey] || [];
  const byKey = new Map(saved.map((x) => [x.key, x]));
  const auto = D.changes || [];
  const known = auto.filter((c) => byKey.has(c.key)).sort((a, b) => byKey.get(a.key).order - byKey.get(b.key).order);
  const fresh = auto.filter((c) => !byKey.has(c.key));
  let list = known.concat(fresh).map((c) => Object.assign({}, c, { creatorNote: (byKey.get(c.key) || {}).creatorNote || "", isNew: !byKey.has(c.key) }));
  const stepNote = ((gm.steps || {})[toTitle] || {}).note || "";
  const locked = new Set(((gm.steps || {})[toTitle] || {}).lockedSlots || []);
  const editing = SETTINGS.creator() && !S.previewPlayer;
  // vue joueur : rien à montrer tant que le créateur n'a ni ordonné ni annoté cette transition
  if (!editing && !saved.length && !stepNote && !locked.size) { box.remove(); return; }
  // créateur : l'éditeur en tête, les cartes repliées dessous ; lecteur : rien que les cartes, annotées
  if (editing && cats && !cats.closest(".sd-bycat")) {
    const det = document.createElement("details");
    det.className = "sd-bycat";
    det.innerHTML = `<summary>Voir par catégorie (objets, arbre, gemmes, réglages)</summary>`;
    cats.replaceWith(det); det.appendChild(cats);
  }
  // image de l'objet visé (comme dans les cartes par catégorie)
  const itemOf = (c) => { if (c.kind !== "item" || !c.slot) return null; const r = (D.items || []).concat(D.guardian || []).find((x) => x.slot === c.slot); return r && r.to && r.to.icon ? r.to : null; };
  // case « fait » partagée avec les cartes par catégorie (même clé, même mémoire)
  const checks = opts.checks || {};
  const ckKey = (c) => {
    const name = c.key.replace(/^\w+:-?/, "");
    if (c.kind === "item" && c.slot) return "i:" + c.slot;
    if (c.kind === "tree") return "t:tree";
    if (c.kind === "gem") return c.key.startsWith("gem:-") ? "g:-" + name : /^Nouveau groupe/.test(c.autoSummary) ? "g:+" + name : "g:" + name;
    return "tl:" + c.key;
  };
  if (!editing) { annotateCards(); return; }
  // Lecteur : chaque ligne des cartes reçoit son numéro d'ordre et la note du créateur, et les lignes d'une même
  // catégorie suivent cet ordre. Une seule liste à lire, rangée par catégorie.
  function annotateCards() {
    box.innerHTML = stepNote ? `<div class="tl-callout">${icon("target", "--good")}<span><b>Note du créateur :</b> ${esc(stepNote)}</span></div>` : "";
    if (!stepNote) box.remove();
    if (!saved.length || !cats) return;
    const moved = new Set();
    list.forEach((c, i) => {
      const k = ckKey(c);
      const btn = cats.querySelector(`[data-ck="${CSS.escape(k)}"]`);
      const row = btn && btn.closest(".sd-it"); if (!row) return;
      row.insertAdjacentHTML("afterbegin", `<span class="tl-order" title="Ordre conseillé par le créateur">${i + 1}</span>`);
      const main = row.querySelector(".sd-it-main");
      if (main && c.creatorNote) main.insertAdjacentHTML("beforeend", `<div class="tl-cnote">${esc(c.creatorNote)}</div>`);
      if (main && c.kind === "item" && locked.has(c.key.slice(5))) main.querySelector(".sd-it-top")?.insertAdjacentHTML("beforeend", `<span class="tl-lockro" title="Objet exigé par le créateur">🔒</span>`);
      // ordre du créateur à l'intérieur de la catégorie
      const parent = row.parentNode;
      if (!moved.has(parent)) { moved.add(parent); parent._n = 0; }
      parent.appendChild(row);
    });
    cats.classList.add("ordered");
  }
  const draw = () => {
    box.innerHTML = `<div class="card pad tl-card ${editing ? "editing" : ""}">
      <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><h3 style="margin:0">${editing ? "Ordre des changements" : "À faire, dans l'ordre"} pour « ${esc(toTitle)} »</h3>
        ${editing ? `<span class="muted small">Glisse les blocs pour l'ordre anti-casse · une note par bloc</span>` : `<span class="muted small">Ordre conseillé par le créateur · coche au fur et à mesure</span>`}</div>
      ${editing ? `<label class="tl-stepnote"><span>Note de l'étape</span><textarea class="input" rows="2" data-stepnote placeholder="Ex. : ne passe pas CI avant 450 ES sur le torse.">${esc(stepNote)}</textarea></label>`
        : stepNote ? `<div class="tl-callout">${icon("target", "--good")}<span>${esc(stepNote)}</span></div>` : ""}
      <ol class="tl-list ${editing ? "" : "as-check"}">${list.map((c, i) => `<li class="tl-it sd-it ${!editing && checks[ckKey(c)] ? "done" : ""}" data-i="${i}" ${editing ? `draggable="true"` : ""}>
          ${editing ? "" : `<button class="sd-check ${checks[ckKey(c)] ? "on" : ""}" data-ck="${esc(ckKey(c))}" title="Fait">✓</button>`}
          <span class="tl-n">${i + 1}</span>${itemOf(c) ? `<span class="tl-ico">${itemIcon(itemOf(c), "sm")}</span>` : icon(KIND_ICON[c.kind] || "dots")}
          <div class="tl-body"><div>${esc(c.autoSummary)}${editing && c.isNew ? ` <span class="tag warn">NOUVEAU</span>` : ""}</div>
            ${editing ? `<input class="input tl-note" data-note="${i}" value="${esc(c.creatorNote)}" placeholder="Note pour ce changement (facultatif)">`
              : c.creatorNote ? `<div class="tl-cnote">${esc(c.creatorNote)}</div>` : ""}</div>
          ${editing && c.kind === "item" ? `<button class="tl-lock ${locked.has(c.key.slice(5)) ? "on" : ""}" data-lock="${esc(c.key.slice(5))}" title="Verrouiller : le joueur doit avoir exactement cet objet pour être « prêt »">🔒</button>`
            : !editing && c.kind === "item" && locked.has(c.key.slice(5)) ? `<span class="tl-lockro" title="Objet exigé par le créateur">🔒</span>` : ""}
          ${editing ? `<span class="tl-grip" title="Glisser pour réordonner">⋮⋮</span>` : ""}</li>`).join("") || `<li class="muted small">Aucun changement détecté.</li>`}</ol>
      ${editing ? `<div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><span class="muted small" data-state></span><button class="btn primary sm" data-save>Enregistrer l'ordre et les notes</button></div>` : ""}
    </div>`;
    if (!editing) return;
    box.querySelectorAll("[data-lock]").forEach((b) => b.onclick = (ev) => {
      ev.stopPropagation();
      const sl = b.dataset.lock;
      if (locked.has(sl)) locked.delete(sl); else locked.add(sl);
      b.classList.toggle("on", locked.has(sl));
      $("[data-state]", box).textContent = "Modifié, pas encore enregistré";
    });
    // glisser-déposer natif
    let dragI = null;
    box.querySelectorAll(".tl-it").forEach((li) => {
      li.ondragstart = (ev) => { dragI = +li.dataset.i; li.classList.add("dragging"); ev.dataTransfer.effectAllowed = "move"; };
      li.ondragend = () => li.classList.remove("dragging");
      li.ondragover = (ev) => { ev.preventDefault(); li.classList.add("over"); };
      li.ondragleave = () => li.classList.remove("over");
      li.ondrop = (ev) => {
        ev.preventDefault();
        const to = +li.dataset.i; if (dragI == null || dragI === to) return;
        keepNotes();
        const [m] = list.splice(dragI, 1); list.splice(to, 0, m); draw();
        $("[data-state]", box).textContent = "Modifié, pas encore enregistré";
      };
    });
    $("[data-save]", box).onclick = async (ev) => {
      keepNotes();
      ev.target.disabled = true;
      try {
        const cur = await getGuideMeta(guideId);
        const transitions = Object.assign({}, cur.transitions || {}, { [tkey]: list.map((c, i) => ({ key: c.key, order: i + 1, autoSummary: c.autoSummary, creatorNote: c.creatorNote || "" })) });
        const steps = Object.assign({}, cur.steps || {});
        steps[toTitle] = Object.assign({}, steps[toTitle] || {}, { note: $("[data-stepnote]", box).value.trim(), lockedSlots: [...locked] });
        await api("guideMetaSet", { id: guideId, set: { transitions, steps } });
        list.forEach((c) => { c.isNew = false; });
        draw();
        $("[data-state]", box).textContent = "Enregistré ✓";
      } catch (e) { toast(e.message, true); ev.target.disabled = false; }
    };
  };
  function keepNotes() { box.querySelectorAll("[data-note]").forEach((inp) => { list[+inp.dataset.note].creatorNote = inp.value.trim(); }); }
  draw();
}

// Notes orphelines : étape renommée ou supprimée dans PoB depuis l'annotation (réimport d'un guide mis à jour).
// Chaque note se réassigne en un clic à une étape (ou transition) existante.
async function orphanNotesCard(host, guideId, titles) {
  if (!(SETTINGS.creator() && !S.previewPlayer) || !host) return;
  let gm;
  try { gm = await getGuideMeta(guideId); } catch (e) { return; }
  const T = new Set(titles);
  const pairs = titles.slice(1).map((t, i) => titles[i] + "->" + t);
  const orphanT = Object.keys(gm.transitions || {}).filter((k) => { const [a, b] = k.split("->"); return !T.has(a) || !T.has(b); });
  const orphanS = Object.keys(gm.steps || {}).filter((k) => !T.has(k));
  if (!orphanT.length && !orphanS.length) { host.innerHTML = ""; return; }
  host.innerHTML = `<div class="card pad tl-orphans"><h3 style="margin:0 0 4px">Notes orphelines</h3>
    <p class="muted small" style="margin:0 0 10px">Ces étapes ont été renommées ou supprimées dans PoB depuis que tu les as annotées. Réassigne chaque note à une étape actuelle (ou supprime-la).</p>
    ${orphanS.map((k) => `<div class="tl-orow"><span>Étape <b>${esc(k)}</b>${gm.steps[k].note ? ` · « ${esc(gm.steps[k].note.slice(0, 60))} »` : ""}${(gm.steps[k].disabledRules || []).length ? ` · ${gm.steps[k].disabledRules.length} règle(s) ignorée(s)` : ""}</span>
      <select class="select sm" data-os="${esc(k)}"><option value="">Réassigner à…</option>${titles.map((t) => `<option>${esc(t)}</option>`).join("")}<option value="__del">Supprimer</option></select></div>`).join("")}
    ${orphanT.map((k) => `<div class="tl-orow"><span>Transition <b>${esc(k.replace("->", " → "))}</b> · ${(gm.transitions[k] || []).length} bloc(s)</span>
      <select class="select sm" data-ot="${esc(k)}"><option value="">Réassigner à…</option>${pairs.map((p) => `<option value="${esc(p)}">${esc(p.replace("->", " → "))}</option>`).join("")}<option value="__del">Supprimer</option></select></div>`).join("")}
  </div>`;
  host.onchange = async (ev) => {
    const sel = ev.target.closest("select"); if (!sel || !sel.value) return;
    const cur = await getGuideMeta(guideId);
    const set = {};
    if (sel.dataset.os != null) {
      const steps = Object.assign({}, cur.steps || {}); const v = steps[sel.dataset.os]; delete steps[sel.dataset.os];
      if (sel.value !== "__del") steps[sel.value] = Object.assign({}, steps[sel.value] || {}, v);
      set.steps = steps;
    } else {
      const tr = Object.assign({}, cur.transitions || {}); const v = tr[sel.dataset.ot]; delete tr[sel.dataset.ot];
      if (sel.value !== "__del") tr[sel.value] = v;
      set.transitions = tr;
    }
    await api("guideMetaSet", { id: guideId, set });
    toast(sel.value === "__del" ? "Note supprimée" : "Note réassignée");
    orphanNotesCard(host, guideId, titles);
  };
}
