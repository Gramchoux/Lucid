// Lucid — ui_settings.js : Menu ⚙️ : vue Simple / Experte, export PoB, import / export .lucid, Mode Création.

// ------------------------------------------------------------------ réglages (gardés dans le navigateur)
const SETTINGS = {
  view: () => store.get("viewMode", "simple"),          // "simple" | "expert"
  creator: () => !!store.get("creatorMode", false),     // Mode Création de guide
  clipboard: () => !!store.get("clipboardWatch", false), // écoute du presse-papier en jeu (Ctrl+C sur un objet)
};
function applySettings() {
  document.body.classList.toggle("view-expert", SETTINGS.view() === "expert");
  document.body.classList.toggle("view-simple", SETTINGS.view() !== "expert");
  document.body.classList.toggle("creator", SETTINGS.creator() && !S.previewPlayer);
  creatorBanner();
}
// build ouvert (s'il y en a un) : les actions « ce build » du menu portent sur lui
function currentBuild() {
  const r = parseRoute();
  return r.page === "build" ? buildMeta(r.id) : null;
}
function creatorBanner() {
  let b = $("#creator-banner");
  if (!SETTINGS.creator()) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement("div"); b.id = "creator-banner"; document.body.insertBefore(b, $("#app")); }
  b.className = "creator-banner" + (S.previewPlayer ? " preview" : "");
  b.innerHTML = S.previewPlayer
    ? `<span>${icon("user")} Aperçu joueur : tu vois le guide comme un joueur le verra.</span><button class="btn sm" data-cb="back">Revenir à l'édition</button>`
    : `<span>${icon("dots")} <b>Mode création</b> · ignore des règles par étape, ordonne et annote les transitions.</span>
       <span class="row" style="gap:6px"><button class="btn sm" data-cb="preview">Prévisualiser comme un joueur</button><button class="btn sm" data-cb="quit">Quitter</button></span>`;
  b.onclick = (ev) => {
    const a = ev.target.closest("[data-cb]")?.dataset.cb; if (!a) return;
    if (a === "quit") { store.set("creatorMode", false); S.previewPlayer = false; }
    if (a === "preview") S.previewPlayer = true;
    if (a === "back") S.previewPlayer = false;
    applySettings(); route();
  };
}

// ------------------------------------------------------------------ menu ⚙️
function settingsMenu(anchor) {
  closeMenus();
  const b = currentBuild();
  const m = document.createElement("div");
  m.className = "menu settings-menu";
  const seg = (key, cur, opts) => `<div class="seg sm" data-set="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const theme = document.documentElement.dataset.theme || "auto";
  m.innerHTML = `
    <div class="sm-row"><span>Vue</span>${seg("viewMode", SETTINGS.view(), [["simple", "Simple"], ["expert", "Experte"]])}</div>
    <p class="sm-help">Simple : l'essentiel, sans tableaux. Experte : tous les chiffres, messages et conseils.</p>
    <div class="sm-row"><span>Thème</span>${seg("theme", theme, [["auto", "Auto"], ["light", "Clair"], ["dark", "Sombre"]])}</div>
    <hr>
    ${b ? `<div class="sm-title">Ce build · ${esc(b.name)}</div>
      <button data-a="pob">${icon("refresh")} Exporter vers Path of Building <small>copie le code PoB à jour</small></button>
      <button data-a="share">${icon("zap")} Partager (lien court pobb.in)…</button>
      ${b.role === "guide" ? `<button data-a="lucid-out">${icon("target")} Exporter le guide en .lucid <small>PoB + notes, chronologie, règles</small></button>` : ""}
      <hr>` : ""}
    <button data-a="lucid-in">${icon("target")} Importer un guide .lucid…</button>
    <hr>
    <label class="sm-check"><input type="checkbox" data-c="clipboardWatch" ${SETTINGS.clipboard() ? "checked" : ""}> Presse-papier en jeu
      <small>Ctrl+C sur un objet dans Path of Exile : Lucid le teste tout de suite (onglet « Tester un upgrade »). Rien n'est lu quand c'est décoché.</small></label>
    <label class="sm-check"><input type="checkbox" data-c="creatorMode" ${SETTINGS.creator() ? "checked" : ""}> Mode Création de guide
      <small>Pour les créateurs : ignorer une règle sur une étape, ordonner et annoter les transitions.</small></label>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = r.bottom + 6 + "px";
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
  m.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const sb = ev.target.closest("[data-set] button[data-v]");
    if (sb) {
      const key = sb.closest("[data-set]").dataset.set, v = sb.dataset.v;
      $$("button", sb.parentNode).forEach((x) => x.classList.toggle("on", x === sb));
      if (key === "theme") setTheme(v);
      else { store.set(key, v); applySettings(); const rr = parseRoute(); if (rr.page === "build") renderHealth(rr.id, buildMeta(rr.id), routeToken, true); }
      return;
    }
    const a = ev.target.closest("button[data-a]")?.dataset.a; if (!a) return;
    closeMenus();
    if (a === "pob") {
      try { const c = await api("code", { id: b.id, stage: stageOf(b.id) }); await navigator.clipboard.writeText(c.code); toast("Code PoB copié : dans Path of Building, Import/Export → Import from code."); }
      catch (e) { toast(e.message, true); }
    }
    if (a === "share") shareDialog(b);
    if (a === "lucid-out") exportLucid(b);
    if (a === "lucid-in") importLucidDialog();
  });
  m.addEventListener("change", (ev) => {
    const c = ev.target.closest("[data-c]"); if (!c) return;
    store.set(c.dataset.c, c.checked);
    if (c.dataset.c === "creatorMode") { S.previewPlayer = false; applySettings(); route(); }
    if (c.dataset.c === "clipboardWatch") clipboardWatch();
  });
  setTimeout(() => document.addEventListener("click", closeMenus, { once: true }), 0);
}
function setTheme(v) {
  if (v === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
  try { if (v === "auto") localStorage.removeItem("lucid.theme"); else localStorage.setItem("lucid.theme", v); } catch (e) { /* stockage indisponible */ }
  resolveTheme();
}
$("#settings-btn").onclick = (ev) => { ev.stopPropagation(); settingsMenu(ev.currentTarget); };
$("#sync-btn").onclick = () => {
  const b = currentBuild();
  if (b && b.poe) return refreshCharacter(b);
  location.hash = "#/";
  setTimeout(() => { const i = $("#imp-text"); if (i) { i.focus(); i.scrollIntoView({ block: "center" }); } }, 300);
};

// ------------------------------------------------------------------ .lucid : un seul fichier, PoB + métadonnées du créateur
async function exportLucid(b) {
  try {
    const d = await api("lucidExport", { id: b.id });
    const blob = new Blob([JSON.stringify(d, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (b.name || "guide").replace(/[\\/:*?"<>|]+/g, "_") + ".lucid";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Guide exporté en .lucid");
  } catch (e) { toast(e.message, true); }
}
function importLucidDialog() {
  modal(`<div class="card-head"><h3>Importer un guide .lucid</h3></div>
    <div class="card-body"><p style="margin-top:0">Un fichier .lucid contient le PoB du guide et les notes de son créateur (ordre des transitions, règles ignorées, objets verrouillés).</p>
      <input type="file" id="lu-file" accept=".lucid,.json" class="input" style="width:100%">
      <p class="muted small">ou colle son contenu :</p><textarea class="input" id="lu-text" rows="4" style="width:100%" placeholder='{"version": "1.0", "pobCode": …}'></textarea></div>
    <div class="modal-actions"><button class="btn ghost" data-act="close">Annuler</button><button class="btn primary" data-act="go">Importer</button></div>`, {
    go: async (m, bt) => {
      bt.disabled = true;
      try {
        const f = $("#lu-file").files[0];
        const text = f ? await f.text() : $("#lu-text").value;
        const r = await api("lucidImport", { text });
        m.close();
        await loadLibrary(true);
        toast(`Guide importé${r.orphans && r.orphans.length ? ` · ${r.orphans.length} note(s) orpheline(s) à réassigner` : ""}`);
        go(r.id, "guide", "etapes");
      } catch (e) { toast(e.message, true); bt.disabled = false; }
    },
  });
}

// ------------------------------------------------------------------ presse-papier en jeu (option ⚙️, désactivée par défaut)
// Ctrl+C sur un objet dans Path of Exile : le serveur le voit (seulement si l'option est cochée) et Lucid le teste.
let clipTimer = null, clipLast = 0;
async function clipboardWatch() {
  const on = SETTINGS.clipboard();
  try { await api("clipboardWatch", { on }); } catch (e) { /* moteur pas prêt */ }
  clearInterval(clipTimer); clipTimer = null;
  if (!on) return;
  clipLast = 0;
  clipTimer = setInterval(async () => {
    let r;
    try { r = await api("clipboardItem", {}); } catch (e) { return; }
    const it = r.item;
    if (!it || it.n === clipLast) return;
    const first = clipLast === 0; clipLast = it.n;
    if (first && Date.now() - (clipboardWatch._t || 0) < 1500) return;
    onClipboardItem(it.text);
  }, 1200);
  clipboardWatch._t = Date.now();
}
function onClipboardItem(text) {
  const r = parseRoute();
  const ta = $("#test-raw");
  if (r.page === "build" && r.tab === "upgrade" && r.view === "objet" && ta) {
    ta.value = text; $("#test-go").click(); return;
  }
  const b = currentBuild();
  if (!b) return;
  const name = (text.split(/\r?\n/).find((l, i) => i >= 2 && l.trim() && !/^Rarity|^Item Class|^-+$/.test(l)) || "Objet").trim();
  const n = document.createElement("div");
  n.className = "toast clip-toast";
  n.innerHTML = `<span>Objet copié en jeu : <b>${esc(name)}</b></span><button class="btn sm primary">Tester</button>`;
  document.body.appendChild(n);
  $("button", n).onclick = () => { S.clipText = text; n.remove(); go(b.id, "upgrade", "objet"); };
  setTimeout(() => n.remove(), 9000);
}
