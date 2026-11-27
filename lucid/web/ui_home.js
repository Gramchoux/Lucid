// Lucid — ui_home.js : Accueil : bibliothèque des builds, import, compte Path of Exile, partage.

// ------------------------------------------------------------------ ACCUEIL
async function renderHome(app, token) {
  app.dataset.build = "";
  app.innerHTML = `<div class="page">
    <div class="hero">
      <div><h1>Tes builds</h1><p>Importe un guide, garde ton personnage à côté, et vois exactement ce qui vous sépare. Tous les calculs viennent du moteur Path of Building.</p></div>
    </div>
    <div class="card import" id="import">
      <div class="import-row">
        <input class="input big" id="imp-text" placeholder="Colle un code PoB ou un lien : pobb.in, poe.ninja, maxroll, pastebin…" autocomplete="off" spellcheck="false">
        <div class="seg" id="imp-role"><button data-r="guide" class="on">Guide</button><button data-r="perso">Mon perso</button></div>
        <button class="btn primary" id="imp-go" style="height:44px">Importer</button>
      </div>
      <div class="import-opts">
        <input class="input" id="imp-name" placeholder="Nom (facultatif)" style="width:280px">
        <span class="import-status muted" id="imp-status">Le build est enregistré dans ton dossier Path of Building : il apparaît aussi dans Path of Building.</span>
      </div>
    </div>
    <div id="lib"><div class="loading"><div class="spinner"></div>Lecture de la bibliothèque…</div></div>
  </div>`;
  let role = "guide";
  $("#imp-role").onclick = (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    role = b.dataset.r; $$("#imp-role button").forEach((x) => x.classList.toggle("on", x === b));
  };
  const doImport = async () => {
    const text = $("#imp-text").value.trim();
    if (!text) return $("#imp-text").focus();
    const st = $("#imp-status"), btn = $("#imp-go");
    btn.disabled = true; st.className = "import-status muted"; st.innerHTML = `<span class="row"><span class="spinner"></span> Import et calcul…</span>`;
    try {
      // contenu d'un fichier .lucid collé : guide + notes de son créateur
      if (/^\{[\s\S]*"pobCode"/.test(text)) {
        const r = await api("lucidImport", { text, name: $("#imp-name").value.trim() || null });
        await loadLibrary(true);
        toast("Guide .lucid importé");
        return go(r.id, "guide", "etapes");
      }
      const r = await api("import", { text, name: $("#imp-name").value.trim() || null, role });
      await loadLibrary(true);
      toast(`Importé${r.source ? " depuis " + r.source : ""}`);
      go(r.id, role === "guide" ? "guide" : "overview");
    } catch (e) {
      st.className = "import-status"; st.style.color = "var(--bad)"; st.textContent = e.message;
    } finally { btn.disabled = false; }
  };
  $("#imp-go").onclick = doImport;
  $("#imp-text").onkeydown = (ev) => { if (ev.key === "Enter") doImport(); };

  let lib;
  try { lib = await loadLibrary(true); } catch (e) { $("#lib").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (token !== routeToken) return;
  renderLibrary(lib);
}

function renderLibrary(lib) {
  // au moins un build enregistré : la zone d'import se réduit à une ligne, les cartes passent devant
  const imp = $("#import"); if (imp) imp.classList.toggle("compact", (lib.builds || []).length > 0);
  const hero = $(".page .hero"); if (hero) hero.classList.toggle("compact", (lib.builds || []).length > 0);
  const q = store.get("libFilter", "");
  const filter = (b) => !q || (b.name + " " + (b.asc || "") + " " + (b.cls || "") + " " + (b.mainSkill || "")).toLowerCase().includes(q.toLowerCase());
  const persos = lib.builds.filter((b) => b.role === "perso" && filter(b));
  const guides = lib.builds.filter((b) => b.role === "guide" && filter(b));
  const st = S.status || {};
  const e = st.engine || {};
  $("#lib").innerHTML = `
    <div class="section">
      <div class="section-title"><h2>Mes personnages</h2>
        <div class="lib-tools"><input class="input" id="lib-q" placeholder="Filtrer…" value="${esc(q)}" style="height:32px;width:200px">
        <button class="btn sm" id="poe-import" style="height:32px">Importer depuis mon compte PoE</button></div></div>
      ${persos.length ? `<div class="build-grid">${persos.map(card).join("")}</div>` :
        `<div class="empty">Aucun personnage. Clique sur « Importer depuis mon compte PoE », ou marque un build existant comme « Mon perso ».</div>`}
    </div>
    <div class="section">
      <div class="section-title"><h2>Guides</h2><span class="muted">${guides.length} build${guides.length > 1 ? "s" : ""}</span></div>
      ${guides.length ? `<div class="build-grid">${guides.map(card).join("")}</div>` : `<div class="empty">Colle le lien d'un guide ci-dessus pour commencer.</div>`}
    </div>
    <div class="footer-info">
      <span>${esc(lib.dir)}</span><a href="#" id="open-folder">Ouvrir le dossier</a>
      <span class="sep"></span>
      <span>Moteur ${esc(e.version || "…")} via ${esc(e.origin || "…")}${e.synced ? " · synchronisé le " + esc(syncedText(e)) : ""}</span>
      <a href="#" id="engine-link">Mise à jour…</a>
    </div>`;
  $("#lib-q").oninput = (ev) => { store.set("libFilter", ev.target.value); renderLibrary(lib); const i = $("#lib-q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  $("#poe-import").onclick = () => poeDialog();
  $("#open-folder").onclick = (ev) => { ev.preventDefault(); api("openFolder", {}); };
  $("#engine-link").onclick = (ev) => { ev.preventDefault(); engineDialog(); };
  $$(".bcard").forEach((el) => {
    const id = el.dataset.id;
    el.onclick = (ev) => {
      if (ev.target.closest(".menu-btn")) return;
      if (ev.target.closest("[data-cmp]")) { ev.stopPropagation(); return go(id, "compare"); }
      const b = buildMeta(id);
      go(id, b?.role === "guide" ? "guide" : "overview");
    };
    el.querySelector(".menu-btn").onclick = (ev) => { ev.stopPropagation(); cardMenu(ev.currentTarget, buildMeta(id)); };
  });
}

function card(b) {
  const s = b.stats || {};
  const dps = mainDps(s);
  const guide = b.guide && buildMeta(b.guide);
  return `<div class="card bcard" data-id="${esc(b.id)}">
    <button class="icon-btn menu-btn" title="Options" aria-label="Options"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>
    <div class="bhead">${portrait(b.asc || b.cls)}<div>
      <div class="asc">${esc(b.asc || b.cls || "Build")}</div>
      <div class="bname">${esc(b.name)}</div>
    </div></div>
    <div class="row wrap" style="gap:6px">
      ${b.level ? `<span class="tag">Niv. ${b.level}</span>` : ""}
      ${b.mainSkill ? `<span class="tag">${esc(b.mainSkill)}</span>` : ""}
      ${b.role === "guide" && b.stages > 1 ? `<span class="tag accent">${b.stages} étapes</span>` : ""}
      ${b.poe ? `<span class="tag" title="Importé du compte le ${new Date(b.poe.imported * 1000).toLocaleString("fr-FR")}">${esc(b.poe.league || "Compte PoE")}</span>` : ""}
    </div>
    ${b.role === "perso" ? (guide ? `<div class="follow">Suit <b>${esc(guide.name)}</b> <button class="btn sm" data-cmp>Comparer</button></div>` : `<div class="follow">Aucun guide associé</div>`) : ""}
    <div class="kpis">
      <div title="DPS global"><b>${compact(dps)}</b><span>DPS</span></div>
      <div><b>${compact(s.Life)}</b><span>Vie</span></div>
      ${s.EnergyShield > 50 ? `<div><b>${compact(s.EnergyShield)}</b><span>ES</span></div>` : ""}
      ${s.MinMaxHit != null || s.TotalEHP != null ? `<div title="${HIT_HELP}${s.MinMaxHitType ? " Point faible : " + esc(s.MinMaxHitType) + "." : ""}"><b>${compact(s.MinMaxHit ?? s.TotalEHP)}</b><span>Coup max</span></div>` : ""}
    </div>
  </div>`;
}

function cardMenu(anchor, b) {
  const items = [
    { label: "Ouvrir", run: () => go(b.id, "overview") },
    b.role === "guide" ? { label: "Voir le guide", run: () => go(b.id, "guide") } : { label: "Comparer avec un guide…", run: () => go(b.id, "compare") },
    "-",
    { label: b.role === "guide" ? "Classer dans « Mes personnages »" : "Classer dans « Guides »", run: async () => { await api("meta", { id: b.id, role: b.role === "guide" ? "perso" : "guide" }); renderLibrary(await loadLibrary(true)); } },
    b.poe ? { label: "Mettre à jour depuis le compte PoE", run: () => refreshCharacter(b) } : null,
    b.role === "guide" ? { label: "Mettre à jour ce guide (nouveau PoB)…", run: () => reimportDialog(b) } : null,
    { label: "Renommer…", run: () => renameDialog(b) },
    { label: "Partager (lien court pobb.in)…", run: () => shareDialog(b) },
    { label: "Copier le code PoB (long)", run: async () => { const r = await api("code", { id: b.id, stage: stageOf(b.id) }); await navigator.clipboard.writeText(r.code); toast("Code copié"); } },
  ];
  menu(anchor, items.filter(Boolean));
}
// Partager : comme Generate → Share → Copy dans PoB. Le code brut est trop long pour Discord ou Twitch ;
// pobb.in donne un lien court. Le build devient public : on le dit avant d'envoyer quoi que ce soit.
function shareDialog(b) {
  modal(`<div class="card-head"><h3>Partager « ${esc(b.name)} »</h3></div>
    <div class="card-body">
      <p style="margin-top:0">Lucid envoie le code PoB de ce build (étape affichée) sur <b>pobb.in</b>, le site utilisé par le bouton « Share » de Path of Building, et te donne un lien court à coller sur Discord ou Twitch.</p>
      <p class="muted small">Le lien est <b>public</b> : toute personne qui l'a peut voir le build (arbre, objets, gemmes, notes). Rien d'autre n'est envoyé.</p>
      <div id="share-out"></div></div>
    <div class="modal-actions"><button class="btn ghost" data-act="close">Annuler</button><button class="btn primary" data-act="go" id="share-go">Publier et copier le lien</button></div>`, {
    go: async (m, bt) => {
      if (bt.disabled) return;
      bt.disabled = true; bt.textContent = "Envoi…";
      try {
        const r = await api("share", { id: b.id, stage: stageOf(b.id) });
        try { await navigator.clipboard.writeText(r.url); } catch (e) { /* copie à la main */ }
        $("#share-out").innerHTML = `<div class="test-target"><span>Lien copié : <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></span></div>`;
        bt.textContent = "Publié";
      } catch (e) { toast(e.message, true); bt.disabled = false; bt.textContent = "Réessayer"; }
    },
  });
}
// Guide mis à jour par son créateur : même fichier, mêmes notes / règles ignorées / chronologie (réconciliées)
function reimportDialog(b) {
  modal(`<div class="card-head"><h3>Mettre à jour « ${esc(b.name)} »</h3></div>
    <div class="card-body"><p style="margin-top:0">Colle le nouveau code PoB ou le lien (pobb.in, poe.ninja…). Le fichier est remplacé (l'ancienne version est gardée en .bak) et tes notes de créateur sont conservées pour les étapes qui existent toujours.</p>
      <textarea class="input" id="ri-text" rows="4" style="width:100%" placeholder="Code PoB ou lien"></textarea><div id="ri-out"></div></div>
    <div class="modal-actions"><button class="btn ghost" data-act="close">Fermer</button><button class="btn primary" data-act="go">Mettre à jour</button></div>`, {
    go: async (m, bt) => {
      bt.disabled = true;
      try {
        const r = await api("reimport", { id: b.id, text: $("#ri-text").value });
        delete S.snap[b.id]; delete S.sets[b.id]; setStageOf(b.id, null, false);
        $("#ri-out").innerHTML = `<div class="test-target" style="display:block">✓ Guide mis à jour.
          ${r.kept.length ? `<div>🟢 Conservé : ${r.kept.map(esc).join(", ")}</div>` : ""}
          ${r.orphans.length ? `<div>🔴 Orphelin (à réassigner dans le Mode Création, page du guide) : ${r.orphans.map(esc).join(", ")}</div>` : ""}
          <div>🟡 Les nouveaux changements entre étapes apparaîtront avec le badge NOUVEAU.</div></div>`;
        await loadLibrary(true);
      } catch (e) { toast(e.message, true); bt.disabled = false; }
    },
  });
}
function renameDialog(b) {
  modal(`<div class="card-head"><h3>Renommer</h3></div>
    <div class="card-body"><input class="input" id="rn" value="${esc(b.name)}" style="width:100%"></div>
    <div class="modal-actions"><button class="btn ghost" data-act="close">Annuler</button><button class="btn primary" data-act="ok">Renommer</button></div>`, {
    ok: async (m) => {
      try {
        const r = await api("rename", { id: b.id, name: $("#rn").value });
        if (S.stage[b.id]) { S.stage[r.id] = S.stage[b.id]; setStageOf(b.id, null); }
        m.close(); renderLibrary(await loadLibrary(true));
      } catch (e) { toast(e.message, true); }
    },
  });
}

// ------------------------------------------------------------------ COMPTE PATH OF EXILE
const needsLogin = (msg) => /connecté|reconnecte/i.test(msg || "");

async function refreshCharacter(b) {
  toast(`Mise à jour de ${b.poe.name}…`);
  try {
    await api("poe/import", { name: b.poe.name, realm: b.poe.realm });
    delete S.snap[b.id];
    toast(`${b.poe.name} mis à jour`);
    if (parseRoute().page === "home") renderLibrary(await loadLibrary(true)); else route();
  } catch (e) {
    if (needsLogin(e.message)) poeDialog(); else toast(e.message, true);
  }
}

function poeDialog() {
  let realm = store.get("poeRealm", "pc");
  let chars = null, busy = false, pollT = null;
  const picked = new Set();
  const m = modal(`<div class="card-head"><h3>Importer depuis mon compte Path of Exile</h3><button class="icon-btn" data-act="close" aria-label="Fermer">✕</button></div><div id="poe-body"></div>`);
  m.el.querySelector(".modal").style.width = "min(640px, 100%)";
  const body = () => $("#poe-body", m.el);
  const alive = () => document.body.contains(m.el);

  async function show() {
    clearTimeout(pollT);
    if (!alive()) return;
    let st;
    try { st = await api("poe/status"); } catch (e) { body().innerHTML = `<div class="card-body" style="color:var(--bad)">${esc(e.message)}</div>`; return; }
    if (!alive()) return;
    if (st.pending) {
      body().innerHTML = `<div class="card-body stack">
        <div class="row"><span class="spinner"></span><b>Connexion en cours dans ton navigateur…</b></div>
        <p class="muted small">Connecte-toi sur pathofexile.com et autorise l'accès. Cette fenêtre se met à jour toute seule.
        Si la page ne s'est pas ouverte : <a href="${esc(st.url)}" target="_blank" rel="noopener">ouvrir la page de connexion</a>.</p></div>`;
      pollT = setTimeout(show, 1200);
      return;
    }
    if (!st.connected) {
      body().innerHTML = `<div class="card-body stack">
        <p style="margin:0">Comme dans Path of Building : tu te connectes <b>toi-même sur le site de GGG</b>, puis Lucid reçoit un accès en lecture à tes personnages. Ton mot de passe ne passe jamais par Lucid.</p>
        <p class="muted small" style="margin:0">La page d'autorisation affichera « Path of Building » : Lucid utilise la même connexion que PoB. L'accès reste sur ce PC ; tu peux le révoquer ici ou dans les réglages de ton compte sur pathofexile.com.</p>
        ${st.error ? `<div class="tag bad">${esc(st.error)}</div>` : ""}
      </div>
      <div class="modal-actions"><button class="btn ghost" data-act="close">Annuler</button><button class="btn primary" id="poe-login">Se connecter sur pathofexile.com</button></div>`;
      $("#poe-login", m.el).onclick = async () => {
        try { await api("poe/login", {}); } catch (e) { return toast(e.message, true); }
        show();
      };
      return;
    }
    body().innerHTML = `<div class="card-body"><div class="loading" style="padding:20px"><div class="spinner"></div>Lecture de tes personnages…</div></div>`;
    try { chars = (await api("poe/characters", { realm })).characters; }
    catch (e) {
      if (needsLogin(e.message)) return show();
      body().innerHTML = `<div class="card-body" style="color:var(--bad)">${esc(e.message)}</div>`; return;
    }
    if (alive()) renderList(st);
  }

  function renderList(st) {
    const leagues = {};
    chars.forEach((c) => (leagues[c.league || "—"] = leagues[c.league || "—"] || []).push(c));
    const perm = (l) => /^(standard|hardcore)$/i.test(l) ? 1 : 0;
    const order = Object.keys(leagues).sort((a, b) => perm(a) - perm(b) || a.localeCompare(b));
    body().innerHTML = `
      <div class="card-body" style="padding-bottom:0">
        <div class="row" style="justify-content:space-between">
          <span class="muted small">Connecté${st.account ? ` : <b style="color:var(--text)">${esc(st.account)}</b>` : ""} · <a href="#" id="poe-out">se déconnecter</a></span>
          <select class="select" id="poe-realm" style="height:30px">${Object.entries({ pc: "PC", xbox: "Xbox", sony: "PlayStation" }).map(([k, v]) => `<option value="${k}" ${k === realm ? "selected" : ""}>${v}</option>`).join("")}</select>
        </div>
      </div>
      <div class="card-body" style="max-height:52vh;overflow:auto">
        ${chars.length ? order.map((lg) => `
          <div class="nav-label" style="padding-left:0">${esc(lg)} <a href="#" data-league="${esc(lg)}" style="text-transform:none;letter-spacing:0;margin-left:8px">tout cocher</a></div>
          ${leagues[lg].sort((a, b) => b.level - a.level).map((c) => `
            <label class="cfg" style="cursor:pointer">
              <div class="row"><input type="checkbox" data-name="${esc(c.name)}" ${picked.has(c.name) ? "checked" : ""}>
                <div><div class="cl"><b>${esc(c.name)}</b> ${c.current ? '<span class="tag accent">actuel</span>' : ""} ${c.imported ? '<span class="tag good">déjà importé</span>' : ""}</div>
                <div class="cs">${esc(c.class)} · niveau ${c.level}</div></div></div>
              <span class="small muted" data-st="${esc(c.name)}"></span>
            </label>`).join("")}`).join("") : `<p class="muted">Aucun personnage sur ce royaume.</p>`}
      </div>
      <div class="modal-actions" style="justify-content:space-between">
        <span class="muted small" id="poe-count"></span>
        <div class="row"><button class="btn" id="poe-all" ${chars.length ? "" : "disabled"}>Tout importer (${chars.length})</button><button class="btn primary" id="poe-go">Importer la sélection</button></div>
      </div>`;
    const count = () => {
      $("#poe-count", m.el).textContent = `${picked.size} sélectionné${picked.size > 1 ? "s" : ""}`;
      $("#poe-go", m.el).disabled = !picked.size || busy;
    };
    count();
    $$("input[data-name]", m.el).forEach((cb) => cb.onchange = () => { cb.checked ? picked.add(cb.dataset.name) : picked.delete(cb.dataset.name); count(); });
    $$("a[data-league]", m.el).forEach((a) => a.onclick = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      leagues[a.dataset.league].forEach((c) => picked.add(c.name));
      $$("input[data-name]", m.el).forEach((cb) => cb.checked = picked.has(cb.dataset.name));
      count();
    });
    $("#poe-realm", m.el).onchange = (ev) => { realm = ev.target.value; store.set("poeRealm", realm); picked.clear(); show(); };
    $("#poe-out", m.el).onclick = async (ev) => { ev.preventDefault(); await api("poe/logout", {}); show(); };
    $("#poe-go", m.el).onclick = () => run([...picked]);
    $("#poe-all", m.el).onclick = () => run(chars.map((c) => c.name));
  }

  async function run(names) {
    if (busy || !names.length) return;
    busy = true;
    $$(".modal-actions button", m.el).forEach((b) => b.disabled = true);
    let ok = 0, lastId = null;
    for (const name of names) {
      if (!alive()) break;
      const el = $(`[data-st="${CSS.escape(name)}"]`, m.el);
      if (el) { el.innerHTML = `<span class="row"><span class="spinner" style="width:14px;height:14px"></span>import…</span>`; el.scrollIntoView({ block: "nearest" }); }
      try {
        const r = await api("poe/import", { name, realm });
        ok++; lastId = r.id;
        if (el) el.innerHTML = `<span class="delta up">${r.updated ? "mis à jour" : "importé"}</span>`;
      } catch (e) {
        if (el) el.innerHTML = `<span class="delta down" title="${esc(e.message)}">échec</span>`;
        if (needsLogin(e.message)) { busy = false; return show(); }
      }
    }
    busy = false;
    S.snap = {};
    await loadLibrary(true);
    if (parseRoute().page === "home") renderLibrary(S.library);
    if (!alive()) return;
    const actions = $(".modal-actions", m.el);
    actions.innerHTML = `<span class="muted small">${ok}/${names.length} personnage${names.length > 1 ? "s" : ""} importé${ok > 1 ? "s" : ""} dans ton dossier PoB.</span>
      <div class="row"><button class="btn" data-act="close">Fermer</button>${ok === 1 && lastId ? `<button class="btn primary" id="poe-open">Ouvrir</button>` : ""}</div>`;
    if ($("#poe-open", m.el)) $("#poe-open", m.el).onclick = () => { m.close(); go(lastId, "overview"); };
  }
  show();
}
