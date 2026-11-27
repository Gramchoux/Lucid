// Lucid — components.js : Briques d'affichage partagées : stats, icônes, infobulles PoB, objets, gemmes, châsses, courbes.

// Verdict d'un objet testé (même lecture que l'onglet Équipement de la comparaison : raisons, garde-fous)
function testVerdict(x) {
  const v = itemVerdict({ head: x.head, diff: x.diff, conditions: x.conditions, resBalance: x.resBalance, abyss: x.abyss,
    brokenReqs: x.brokenReqs, duplicateUnique: x.duplicateUnique });
  if (!v) return "";
  const extra = [v.reasons.length ? v.reasons.join(" · ") : "", v.cond.join(" · "), v.res, v.jewel].filter(Boolean);
  return `<div class="test-verdict"><span class="vd vd-${v.kind}">${v.label}</span>
    ${extra.map((t) => `<div class="vd-why">${t}</div>`).join("")}
    ${v.warn.map((w) => `<div class="vd-why vd-warn">${icon("zap", "--warn")} ${w}</div>`).join("")}</div>`;
}
// ------------------------------------------------------------------ helpers stats
// DPS global : la même définition partout (calculée côté moteur, voir globalDps dans bridge.lua).
// « Full DPS » de PoB = somme des compétences cochées ; sinon la compétence principale (ses sbires si c'en est une).
function dpsSource(k) {
  if (k.GlobalDPSSource) return k.GlobalDPSSource;
  if ((k.FullDPS || 0) > 0) return "full";
  return (k.CombinedDPS || k.TotalDPS || 0) > 0 ? "skill" : (k.MinionCombinedDPS || 0) > 0 ? "minion" : "skill";
}
function mainDps(k) {
  if (k.GlobalDPS != null) return k.GlobalDPS;
  const s = dpsSource(k);
  return s === "full" ? k.FullDPS : s === "minion" ? k.MinionCombinedDPS : (k.CombinedDPS || k.TotalDPS || 0);
}
function dpsLabel() { return "DPS global"; }
function dpsSub(k) {
  const s = dpsSource(k);
  return s === "full" ? (k.FullDPSFromGuide ? "Mêmes compétences que le guide" : "Somme des compétences « Full DPS »")
    : s === "minion" ? "Sans Full DPS : sbires de la compétence principale"
    : "Sans Full DPS : compétence principale seule";
}
// DPS comparable entre deux builds : DPS global des deux côtés
// D'où vient l'écart de DPS avec le guide : parts mesurées par PoB sur ton build (multiplicatives, lues en logarithme)

function dpsGapCard(D) {
  if (!D || !D.parts) return "";
  const pctTxt = (p) => `${p > 0 ? "+" : ""}${nf(p, Math.abs(p) < 10 ? 1 : 0)} %`;
  const activeParts = D.parts.filter((p) => Math.abs(p.share) >= 0.02);
  const toGain = activeParts.filter((p) => p.dps > 0);
  const ahead = activeParts.filter((p) => p.dps < 0);

  const renderRow = (p, isGain) => {
    const w = Math.min(100, Math.abs(p.share) * 100);
    const top = (p.top || []).filter((x) => Math.abs(x.pct) >= 1).map((x) => `${esc(x.name)} ${pctTxt(x.pct)}`).join(" · ");
    return `<div class="gap-row">
      <div class="gap-h"><b>${esc(p.label)}</b><span class="${isGain ? "" : "good"}">+${compact(Math.abs(p.dps))} DPS</span></div>
      <div class="gap-bar"><i style="width:${w.toFixed(1)}%;background:var(${isGain ? "--accent" : "--good"})"></i></div>
      <div class="muted small">${esc(p.hint)}${top ? ` — ${top}` : ""}</div>
    </div>`;
  };

  return `<div class="section"><div class="section-title"><h2>Comparaison du DPS (${compact(D.mine)} vs ${compact(D.guide)})</h2>
    <span class="muted small">Impact mesuré par PoB sur ton personnage</span></div>
    <div class="card gap-card">
      ${toGain.length ? `<div><div class="small" style="font-weight:600;margin-bottom:8px;color:var(--accent)">Ce qu'il te manque par rapport au guide :</div>${toGain.map((p) => renderRow(p, true)).join("")}</div>` : ""}
      ${ahead.length ? `<div style="${toGain.length ? "margin-top:12px;padding-top:12px;border-top:1px solid var(--line)" : ""}"><div class="small" style="font-weight:600;margin-bottom:8px;color:var(--good)">Là où ton perso est déjà devant le guide :</div>${ahead.map((p) => renderRow(p, false)).join("")}</div>` : ""}
    </div></div>`;
}
function cmpDps(a, b) {
  const same = dpsSource(a) === dpsSource(b);
  return [same && dpsSource(a) === "full" ? "DPS global" : "DPS global ⚠ " + (same ? "compétence principale" : "périmètres différents"), mainDps(a), mainDps(b)];
}
// Survie affichée : le plus petit coup max encaissable (Max Hit), avec son type. L'EHP de PoB n'est plus mis en avant :
// le blocage et la récupération sur blocage le gonflent et il trompe les débutants.
const minHit = (k) => k ? (k.MinMaxHit ?? k.TotalEHP) : null;
const minHitType = (k) => k && k.MinMaxHitType ? k.MinMaxHitType : "";
const HIT_HELP = "Le plus gros coup que tu encaisses sans mourir, pour le type de dégâts où tu es le plus faible (Max Hit de PoB).";
// ------------------------------------------------------------------ icônes (traits simples)
const ICON = {
  sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>',
  es: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 7v10M8 10l4-3 4 3"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  skull: '<path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.4 3 5.6V20h10v-3.4c1.7-1.2 3-3 3-5.6a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/>',
  res: '<path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="9"/>',
};
const icon = (name, color) => `<span class="ico-chip" style="--c:var(${color})"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ICON.dots}</svg></span>`;

// ------------------------------------------------------------------ statistiques classées par thème
// Libellés français ; le libellé d'origine de PoB reste visible au survol.
const STAT_FR = {
  TotalDPS: "DPS des coups", CombinedDPS: "DPS combiné", FullDPS: "DPS global (Full DPS)", FullDotDPS: "DPS sur la durée total",
  WithDotDPS: "DPS total avec DoT", AverageHit: "Coup moyen", AverageDamage: "Dégâts moyens", AverageBurstDamage: "Dégâts en rafale",
  CombinedAvg: "Dégâts totaux combinés", CombinedAvgToMonsterLife: "Équivalent vie ennemie", MirageDPS: "DPS des mirages", CullingDPS: "DPS d'exécution (Culling)",
  ImpaleDPS: "DPS d'empalement", WithImpaleDPS: "DPS total avec empalement", ExplodeChance: "Chance d'explosion",
  TotalDot: "DPS sur la durée", TotalDotDPS: "DPS sur la durée total", BleedDPS: "DPS de saignement", BleedDamage: "Dégâts par saignement", WithBleedDPS: "DPS total avec saignement",
  CorruptingBloodDPS: "DPS de sang corrompu", IgniteDPS: "DPS d'embrasement", IgniteDamage: "Dégâts par embrasement", WithIgniteDPS: "DPS total avec embrasement",
  WithIgniteAverageDamage: "Dégâts moyens avec embrasement", BurningGroundDPS: "DPS de sol brûlant", PoisonDPS: "DPS d'un poison", PoisonDamage: "Dégâts par poison",
  WithPoisonDPS: "DPS total avec poison", CausticGroundDPS: "DPS de sol caustique", DecayDPS: "DPS de pourriture",
  Speed: "Vitesse (attaques ou sorts / s)", HitSpeed: "Coups par seconde", HitTime: "Temps de canalisation", WarcryCastTime: "Temps d'incantation",
  TrapThrowingTime: "Temps de lancer de piège", TrapCooldown: "Délai des pièges", MineLayingTime: "Temps de pose de mine", TotemPlacementTime: "Temps de pose de totem",
  Cooldown: "Délai de récupération", AreaOfEffectRadiusMetres: "Rayon de zone",
  PreEffectiveCritChance: "Chance de critique", CritChance: "Chance de critique effective", CritMultiplier: "Multiplicateur de critique", HitChance: "Chance de toucher",
  "MainHand.Accuracy": "Précision (main droite)", "OffHand.Accuracy": "Précision (main gauche)",
  ManaCost: "Coût en mana", ManaPercentCost: "Coût en mana (%)", ManaPerSecondCost: "Coût en mana / s", LifeCost: "Coût en vie", LifePercentCost: "Coût en vie (%)",
  LifePerSecondCost: "Coût en vie / s", ESCost: "Coût en bouclier d'énergie", RageCost: "Coût en rage", SoulCost: "Coût en âmes",
  Life: "Vie totale", "Spec:LifeInc": "% de vie augmentée par l'arbre", LifeUnreserved: "Vie non réservée", LifeRecoverable: "Vie récupérable",
  LifeRegenRecovery: "Régénération de vie / s", LifeRecharge: "Recharge de vie", LifeLeechGainRate: "Vol / gain de vie par seconde", LifeLeechGainPerHit: "Vol / gain de vie par coup",
  NetLifeRegen: "Récupération nette de vie",
  EnergyShield: "Bouclier d'énergie", EnergyShieldRecoveryCap: "ES récupérable", "Spec:EnergyShieldInc": "% d'ES augmenté par l'arbre",
  EnergyShieldRegenRecovery: "Régénération d'ES / s", EnergyShieldLeechGainRate: "Vol / gain d'ES par seconde", EnergyShieldLeechGainPerHit: "Vol / gain d'ES par coup",
  NetEnergyShieldRegen: "Récupération nette d'ES",
  Mana: "Mana totale", "Spec:ManaInc": "% de mana augmentée par l'arbre", ManaUnreserved: "Mana non réservée", ManaRegenRecovery: "Régénération de mana / s",
  ManaLeechGainRate: "Vol / gain de mana par seconde", ManaLeechGainPerHit: "Vol / gain de mana par coup", NetManaRegen: "Récupération nette de mana",
  Armour: "Armure", "Spec:ArmourInc": "% d'armure augmentée par l'arbre", PhysicalDamageReduction: "Réduction des dégâts physiques",
  Evasion: "Évasion", "Spec:EvasionInc": "% d'évasion augmentée par l'arbre", MeleeEvadeChance: "Chance d'éviter (mêlée)", ProjectileEvadeChance: "Chance d'éviter (projectiles)",
  EffectiveBlockChance: "Blocage des attaques", EffectiveSpellBlockChance: "Blocage des sorts", AttackDodgeChance: "Esquive des attaques", SpellDodgeChance: "Esquive des sorts",
  EffectiveSpellSuppressionChance: "Suppression des sorts", Ward: "Ward",
  TotalEHP: "Points de vie effectifs (EHP, gonflé par le blocage)", PhysicalMaximumHitTaken: "Coup max encaissable : physique", FireMaximumHitTaken: "Coup max : feu",
  ColdMaximumHitTaken: "Coup max : froid", LightningMaximumHitTaken: "Coup max : foudre", ChaosMaximumHitTaken: "Coup max : chaos",
  TotalBuildDegen: "Dégénération totale", TotalNetRegen: "Récupération nette totale", Rage: "Rage", RageRegenRecovery: "Régénération de rage",
  Str: "Force", Dex: "Dextérité", Int: "Intelligence", Omni: "Omniscience", Devotion: "Dévotion",
  EffectiveMovementSpeedMod: "Vitesse de déplacement", ActiveMinionLimit: "Sbires actifs max",
};
const STAT_GROUPS = [
  { id: "dmg", title: "Dégâts", icon: "sword", color: "--fire", re: /^(TotalDPS|PvpTotalDPS|CombinedDPS|FullDPS|WithDotDPS|AverageHit|PvpAverageHit|AverageDamage|PvpAverageDamage|AverageBurstDamage|CombinedAvg|CombinedAvgToMonsterLife|MirageDPS|CullingDPS|ReservationDPS|ImpaleDPS|WithImpaleDPS|ExplodeChance)$/ },
  { id: "dot", title: "Dégâts sur la durée", icon: "flame", color: "--chaos", re: /^(TotalDot|TotalDotDPS|FullDotDPS|BleedDPS|BleedDamage|WithBleedDPS|CorruptingBloodDPS|IgniteDPS|IgniteDamage|WithIgniteDPS|WithIgniteAverageDamage|BurningGroundDPS|MirageBurningGroundDPS|PoisonDPS|PoisonDamage|WithPoisonDPS|CausticGroundDPS|MirageCausticGroundDPS|DecayDPS)$/ },
  { id: "speed", title: "Vitesse, précision, critique", icon: "zap", color: "--light", re: /^(Speed|HitSpeed|HitTime|WarcryCastTime|KineticFusilladeMaxEffectiveAPS|ChannelTimeToTrigger|Trap|Mine|Totem|Cooldown|Seal|TimeMaxSeals|AreaOfEffect|Brand|PreEffectiveCritChance|CritChance|CritMultiplier|HitChance|MainHand\.Accuracy|OffHand\.Accuracy)/ },
  { id: "cost", title: "Coûts de la compétence", icon: "coin", color: "--warn", re: /Cost$/ },
  { id: "life", title: "Vie", icon: "heart", color: "--life", re: /^(Life|Spec:LifeInc|NetLifeRegen)/ },
  { id: "es", title: "Bouclier d'énergie", icon: "es", color: "--es", re: /^(EnergyShield|Spec:EnergyShieldInc|NetEnergyShieldRegen)/ },
  { id: "mana", title: "Mana", icon: "drop", color: "--mana", re: /^(Mana|Spec:ManaInc|NetManaRegen)/ },
  { id: "def", title: "Armure, évasion, blocage", icon: "shield", color: "--text-2", re: /^(Armour|Spec:ArmourInc|PhysicalDamageReduction|Evasion|Spec:EvasionInc|MeleeEvadeChance|ProjectileEvadeChance|EffectiveBlockChance|EffectiveSpellBlockChance|AttackDodgeChance|SpellDodgeChance|EffectiveSpellSuppressionChance|Ward)$/ },
  { id: "pool", title: "Coups encaissables", icon: "target", color: "--accent", re: /^(TotalEHP|PvPTotalTakenHit|.*MaximumHitTaken)$/ },
  { id: "regen", title: "Récupération globale", icon: "refresh", color: "--good", re: /^(TotalBuildDegen|TotalNetRegen|Rage|RageRegenRecovery)$/ },
  { id: "attr", title: "Attributs", icon: "user", color: "--text-2", re: /^(Str|Dex|Int|Omni|Devotion)$/ },
  { id: "misc", title: "Divers", icon: "dots", color: "--muted", re: /.*/ },
];
// les résistances, les prérequis et les doublons « en % » sont affichés autrement
const STAT_SKIP = /Resist|ResistOverCap|^Req(Str|Dex|Int|Omni)$|^SkillDPS$|^FullDPS$|^FullDotDPS$|UnreservedPercent$/; // Full DPS = DPS global, affiché dans la carte du haut

function groupStatsByTheme(stats) {
  const byKey = Object.fromEntries(stats.map((s) => [s.key, s]));
  const out = STAT_GROUPS.map((g) => Object.assign({ rows: [] }, g));
  const seen = new Set();
  for (const s of stats) {
    if (STAT_SKIP.test(s.key) || seen.has(s.key + "|" + s.label)) continue;
    if (!s.value || Math.abs(s.value) < 1e-9) continue;            // valeurs nulles : sans intérêt ici
    seen.add(s.key + "|" + s.label);
    const g = out.find((x) => x.re.test(s.key));
    const row = { s, key: s.key, label: STAT_FR[s.key] || s.label, pob: s.label, value: fmtStat(s, s.value) };
    // vie / mana non réservées : on y joint le pourcentage
    const pct = byKey[s.key + "Percent"];
    if (/Unreserved$/.test(s.key) && pct) row.extra = fmtStat(pct, pct.value);
    // attributs : comparés au prérequis
    const req = byKey["Req" + s.key];
    if (g.id === "attr" && req && req.value) { row.extra = "requis " + fmtStat(req, req.value); row.bad = s.value < req.value; }
    g.rows.push(row);
  }
  return out.filter((g) => g.rows.length);
}
function statGroupCard(g) {
  return `<div class="card stat-card">
    <div class="sc-head">${icon(g.icon, g.color)}<h3>${esc(g.title)}</h3></div>
    <div class="sc-rows">${g.rows.map((r) => `<div class="sc-row${WHY_KEYS.has(r.key) ? " why-row" : ""}" ${WHY_KEYS.has(r.key) ? `data-why="${esc(r.key)}" data-label="${esc(r.label)}"` : ""} title="${WHY_KEYS.has(r.key) ? "Clique : pourquoi ce chiffre ?" : "PoB : " + esc(r.pob)}">
      <span class="l">${esc(r.label)}</span>
      <span class="v${r.bad ? " bad" : ""}">${r.value}${r.extra ? `<small>${esc(r.extra)}</small>` : ""}</span></div>`).join("")}</div>
  </div>`;
}

const RES = [["Fire", "Feu", "--fire"], ["Cold", "Froid", "--cold"], ["Lightning", "Foudre", "--light"], ["Chaos", "Chaos", "--chaos"]];

function kpiCards(k) {
  const dps = mainDps(k);
  const cards = [
    { l: dpsLabel(k), v: compact(dps), c: "--fire", i: "sword", sub: dpsSub(k) },
    { l: "Coup max encaissable", v: compact(minHit(k)), c: "--accent", i: "target", sub: minHitType(k) ? "ton point faible : coups de " + minHitType(k) : "Max Hit calculé par PoB", tip: HIT_HELP },
    { l: "Vie", v: nf(k.Life), c: "--life", i: "heart", sub: k.LifeUnreserved != null && k.LifeUnreserved < k.Life ? nf(k.LifeUnreserved) + " non réservée" : "" },
  ];
  if ((k.EnergyShield || 0) > 50) cards.push({ l: "Bouclier d'énergie", v: nf(k.EnergyShield), c: "--es", i: "es" });
  cards.push({ l: "Mana", v: nf(k.Mana), c: "--mana", i: "drop", sub: k.ManaUnreserved != null && k.ManaUnreserved < k.Mana ? nf(k.ManaUnreserved) + " non réservée" : "" });
  if ((k.Ward || 0) > 0) cards.push({ l: "Ward", v: nf(k.Ward), c: "--text-2", i: "shield" });
  return `<div class="kpi-row">${cards.map((c) => `<div class="card kpi"${c.tip ? ` title="${esc(c.tip)}"` : ""}><div class="label">${icon(c.i, c.c)}${esc(c.l)}</div><div class="value">${c.v}</div>${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ""}</div>`).join("")}</div>`;
}
function resistCards(k) {
  return `<div class="resists">${RES.map(([key, label, c]) => {
    const v = k[key + "Resist"], over = k[key + "ResistOverCap"];
    const capped = v >= 75;
    const w = Math.max(0, Math.min(100, ((v ?? 0) + 60) / 150 * 100));
    return `<div class="card res why-row" data-why="${key}Resist" data-label="Résistance : ${label.toLowerCase()}" title="Clique : pourquoi ce chiffre ?"><div class="top"><span class="muted small">${label}</span><span class="v" style="color:${v < 0 ? "var(--bad)" : "inherit"}">${v == null ? "—" : nf(v) + " %"}</span></div>
      <div class="track"><i style="width:${w}%;background:var(${c})"></i></div>
      <div class="cap">${key === "Chaos" ? (v >= 75 ? "Plafonnée" : v >= 0 ? "Positive" : "Négative") : capped ? (over > 0 ? `Plafonnée · +${nf(over)} % au-delà` : "Plafonnée") : `<span style="color:var(--bad)">${nf(75 - (v || 0))} % sous le plafond</span>`}</div></div>`;
  }).join("")}</div>`;
}

// Courbe d'une stat le long des étapes du guide (une seule série : pas de légende, le titre la nomme).
// Ligne 2px + lavis 10 %, grille fine, étape affichée marquée d'un point cerclé, ton perso en ligne de référence.
// Survol : réticule + infobulle ; clic : ouvre cette étape.
function stageLine(el, { pts, fmt, log, you, active, onPick }) {
  const W = Math.max(220, el.clientWidth || 480), H = 160, m = { l: 46, r: 14, t: 12, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = pts.map((p) => p.v).filter((v) => v > 0).concat(you > 0 ? [you] : []);
  if (!vals.length) { el.innerHTML = `<p class="muted small">Pas de valeur à tracer.</p>`; return; }
  let lo = Math.min(...vals), hi = Math.max(...vals), ticks;
  if (log) {
    // au plus 4 décades : une étape quasi nulle (début de leveling) reste collée en bas au lieu d'écraser la courbe
    hi = 10 ** Math.ceil(Math.log10(hi)); lo = Math.max(10 ** Math.floor(Math.log10(lo)), hi / 1e4);
    const per = Math.max(1, Math.ceil(16 / (ih / Math.log10(hi / lo))));   // une graduation toutes les « per » décades
    ticks = []; for (let v = lo, i = 0; v <= hi * 1.001; v *= 10, i++) if (i % per === 0) ticks.push(v);
  } else {
    const step = 10 ** Math.floor(Math.log10(hi / 4 || 1)) * ([1, 2, 2.5, 5, 10].find((f) => hi / (10 ** Math.floor(Math.log10(hi / 4 || 1)) * f) <= 5) || 10);
    lo = 0; hi = Math.ceil(hi / step) * step; ticks = []; for (let v = 0; v <= hi + 1e-9; v += step) ticks.push(v);
  }
  const y = (v) => m.t + ih - (log ? (Math.log10(Math.min(Math.max(v, lo), hi)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo || 1)) * ih;
  const x = (i) => m.l + (pts.length > 1 ? i / (pts.length - 1) * iw : iw / 2);
  const ok = pts.map((p, i) => [p, i]).filter(([p]) => p.v > 0);
  const path = ok.map(([p, i], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = ok.length ? `${path}L${x(ok[ok.length - 1][1]).toFixed(1)},${m.t + ih}L${x(ok[0][1]).toFixed(1)},${m.t + ih}Z` : "";
  const ai = pts.findIndex((p) => p.id === active);
  el.innerHTML = `<svg class="sl-svg" width="${W}" height="${H}" role="img">
      ${ticks.map((t) => `<line class="sl-grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="sl-tick" x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join("")}
      ${pts.map((p, i) => `<line class="sl-grid" x1="${x(i)}" x2="${x(i)}" y1="${m.t + ih}" y2="${m.t + ih + 4}"/>`).join("")}
      <text class="sl-tick" x="${m.l}" y="${H - 6}">début</text><text class="sl-tick" x="${W - m.r}" y="${H - 6}" text-anchor="end">fin du guide</text>
      ${you > 0 ? `<line class="sl-you" x1="${m.l}" x2="${W - m.r}" y1="${y(you)}" y2="${y(you)}"/><text class="sl-you-t" x="${m.l + 4}" y="${y(you) - 5}" text-anchor="start">toi : ${fmt(you)}</text>` : ""}
      <path class="sl-area" d="${area}"/><path class="sl-line" d="${path}"/>
      ${ai >= 0 && pts[ai].v > 0 ? `<circle class="sl-dot" cx="${x(ai)}" cy="${y(pts[ai].v)}" r="5"/>` : ""}
      <line class="sl-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
      <circle class="sl-hover" r="4.5" visibility="hidden"/>
      <rect x="${m.l - 10}" y="0" width="${iw + 20}" height="${H}" fill="transparent" class="sl-hit"/>
    </svg><div class="sl-tip" hidden></div>`;
  const svg = $("svg", el), tip = $(".sl-tip", el), cross = $(".sl-cross", el), dot = $(".sl-hover", el);
  const pick = (ev) => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((ev.clientX - r.left - m.l) / (iw / Math.max(1, pts.length - 1)))));
    return i;
  };
  const hit = $(".sl-hit", el);
  hit.onmousemove = (ev) => {
    const i = pick(ev), p = pts[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    if (p.v > 0) { dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(p.v)); dot.setAttribute("visibility", "visible"); } else dot.setAttribute("visibility", "hidden");
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(p.title)}</b><div>${p.v > 0 ? fmt(p.v) : "—"}${p.sub ? ` <span class="muted small">${esc(p.sub)}</span>` : ""}</div>`;
    const left = Math.min(Math.max(x(i) - 80, 0), W - 170);
    tip.style.left = left + "px"; tip.style.top = Math.max(0, (p.v > 0 ? y(p.v) : m.t) - 70) + "px";
  };
  hit.onmouseleave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  hit.onclick = (ev) => { const p = pts[pick(ev)]; if (p && onPick) onPick(p.id); };
}
function gainBars(h, metric) {
  const rows = metric === "dps"
    ? [["DPS", h.dps], ["Survie", h.ehp]]
    : [["Survie", h.ehp], ["DPS", h.dps]];
  const max = 40;
  return rows.map(([l, v]) => {
    const w = Math.min(100, Math.abs(v || 0) / max * 100);
    return `<div class="gainbar"><div class="track" title="${l}"><i class="${(v || 0) < 0 ? "neg" : ""}" style="width:${w}%;${l !== (metric === "dps" ? "DPS" : "Survie") ? "opacity:.45" : ""}"></i></div><span class="delta ${deltaClass(v)}">${l} ${pctText(v)}</span></div>`;
  }).join("");
}
function itemCard(it, opts = {}) {
  if (!it) return `<div class="card pad muted">Emplacement vide</div>`;
  const body = Object.assign({}, opts.ctx || TT_CTX, opts.slot && !opts.raw ? { slot: opts.slot } : { raw: it.raw, slot: opts.slot || null }, opts.noCompare ? { noCompare: true } : {});
  return `<div class="item-sheet">
    ${opts.label ? `<div class="muted small">${esc(opts.label)}</div>` : ""}
    ${it.icon ? `<div class="item-art"><img src="${esc(it.icon)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : ""}
    <div class="pobtt" data-tt="${ttReq("itemTooltip", body)}"></div>
  </div>`;
}
function diffTable(diff) {
  if (!diff || !diff.length) return `<p class="muted small">Aucune différence de statistique.</p>`;
  return `<table class="stat-table">${diff.map((d) => `<tr><td class="l">${esc(d.label)}</td>
    <td class="v muted">${fmtStat(d, d.base)} → ${fmtStat(d, d.new)}</td>
    <td class="v"><span class="delta ${d.better ? "up" : "down"}">${fmtDelta(d)}</span>${d.pct != null && Math.abs(d.pct) >= 0.1 && !/%%/.test(d.fmt) ? ` <span class="muted small">(${pctText(d.pct)})</span>` : ""}</td></tr>`).join("")}</table>`;
}
function headCells(h) {
  if (!h) return `<td class="v muted">—</td><td class="v muted">—</td>`;
  return `<td class="v"><span class="delta ${deltaClass(h.dps)}">${pctText(h.dps)}</span></td><td class="v"><span class="delta ${deltaClass(h.ehp)}">${pctText(h.ehp)}</span></td>`;
}
// Verdict d'un échange d'objet, pour TON build : le guide n'a pas forcément mieux à cet emplacement
// (ex. ton objet porte une résistance que le guide trouve ailleurs). Raisons = les stats qui bougent le plus.
const VERDICT_KEYS = ["FireResist", "ColdResist", "LightningResist", "ChaosResist", "Life", "EnergyShield", "Ward", "Mana", "Armour", "Evasion",
  "SpellSuppressionChance", "BlockChance", "SpellBlockChance", "EffectiveMovementSpeedMod", "Str", "Dex", "Int",
  "PowerChargesMax", "FrenzyChargesMax", "EnduranceChargesMax", "CritChance", "Speed",
  "LifeRegenRecovery", "EnergyShieldRegenRecovery", "LifeLeechGainRate", "ManaRegenRecovery"];
const VERDICT_FR = { FireResist: "Rés. feu", ColdResist: "Rés. froid", LightningResist: "Rés. foudre", ChaosResist: "Rés. chaos",
  SpellSuppressionChance: "Suppression", BlockChance: "Blocage", SpellBlockChance: "Blocage des sorts", EffectiveMovementSpeedMod: "Vitesse de déplacement",
  Str: "Force", Dex: "Dextérité", Int: "Intelligence", PowerChargesMax: "Charges de puissance max", FrenzyChargesMax: "Charges de frénésie max",
  EnduranceChargesMax: "Charges d'endurance max", Speed: "Vitesse", CritChance: "Chance de critique",
  LifeRegenRecovery: "Régén. de vie", EnergyShieldRegenRecovery: "Régén. d'ES", LifeLeechGainRate: "Vol de vie", ManaRegenRecovery: "Régén. de mana" };
function itemVerdict(r) {
  const h = r.head;
  if (!h) return null;
  const d = h.dps || 0, e = h.ehp || 0, T = 0.5;
  const kind = (d >= -T && e >= -T && (d > T || e > T)) ? "up" : (d <= T && e <= T && (d < -T || e < -T)) ? "keep" : (d > T || e > T) ? "mixed" : "same";
  const label = { up: "Le guide est mieux", keep: "Garde le tien", mixed: "Compromis", same: "Équivalent" }[kind];
  const seen = new Set();
  const diffs = (r.diff || []).filter((x) => VERDICT_KEYS.includes(x.key) && !seen.has(x.key) && seen.add(x.key));
  const want = kind === "up" ? (x) => x.better : kind === "keep" ? (x) => !x.better : () => true;
  const score = (x) => {
    // une résistance qui passe sous le plafond compte double
    const cap = /Resist$/.test(x.key) && x.key !== "ChaosResist" && x.base >= 75 && x.new < 75 ? 100 : 0;
    return cap + Math.abs(x.pct ?? x.delta);
  };
  const top = (f, n) => diffs.filter(f).sort((a, b) => score(b) - score(a)).slice(0, n);
  // compromis : ce qu'on gagne ET ce qu'on perd
  const picked = kind === "mixed" ? top((x) => x.better, 1).concat(top((x) => !x.better, 1)) : top(want, 2);
  const reasons = picked.map((x) => {
    const cap = /Resist$/.test(x.key) && x.key !== "ChaosResist" && x.base >= 75 && x.new < 75;
    return `<span class="${x.better ? "up" : "down"}">${esc(VERDICT_FR[x.key] || STAT_FR[x.key] || x.label)} ${fmtDelta(x)}${cap ? " (sous le plafond)" : ""}</span>`;
  });
  const cond = (r.conditions || []).map((c) => `${c.on ? "+" : "−"} ${esc(c.label)}`);
  const rb = r.resBalance;
  const res = rb ? `Rés. élémentaires : ${nf(rb.from)} % → ${nf(rb.to)} % au total, replacées là où tu en as besoin` : "";
  // joyaux abyssaux sertis dans ton objet, sans socket sur l'objet du guide : perdus
  const lost = (r.abyss && r.abyss.lost) || [];
  const jewel = lost.length ? `Perd ${lost.length > 1 ? "les joyaux abyssaux sertis" : "le joyau abyssal serti"} dedans : ${lost.map(esc).join(", ")}` : "";
  const ATTR = { Str: "Force", Dex: "Dextérité", Int: "Intelligence" };
  const warn = (r.brokenReqs || []).map((b) => `Il te manquera ${nf(b.missing)} ${ATTR[b.attr] || b.attr}${b.source ? ` (pour ${esc(b.source)})` : ""} : à compenser sur une autre pièce`);
  if (r.duplicateUnique) warn.push("Unique limité à 1 : tu le portes déjà ailleurs, les deux ne peuvent pas être actifs");
  return { kind, label, reasons, cond, res, jewel, warn };
}
function verdictCell(r) {
  if (r.same) return `<td></td>`;
  const v = itemVerdict(r);
  if (!v) return `<td class="muted">—</td>`;
  return `<td class="verdict"><span class="vd vd-${v.kind}">${v.label}</span>
    ${v.reasons.length ? `<div class="vd-why">${v.reasons.join(" · ")}</div>` : ""}
    ${v.cond.length ? `<div class="vd-why" title="Condition de simulation activée ou coupée par l'échange (ex. source de charges)">${v.cond.join(" · ")}</div>` : ""}
    ${v.jewel ? `<div class="vd-why">${v.jewel}</div>` : ""}
    ${v.warn.map((w) => `<div class="vd-why vd-warn">${icon("zap", "--warn")} ${w}</div>`).join("")}
    ${v.res ? `<div class="vd-why" title="Feu, froid et foudre se placent librement sur n'importe quelle pièce : seul le total de l'objet compte, tu rééquilibres sur les autres.">${v.res}</div>` : ""}</td>`;
}
// Châsses liées, comme en jeu : une châsse par gemme (couleur de la gemme), reliées entre elles.
// La gemme active est cerclée ; une gemme désactivée laisse sa châsse vide.
function socketStrip(gems, title, opts = {}) {
  const list = (gems || []).filter(Boolean);
  if (!list.length) return "";
  // opts.icons : la gemme dessinée dans sa châsse ; opts.tip(i) : clé d'infobulle PoB (sinon le nom en title)
  return `<div class="sockets ${opts.icons ? "big" : ""}" ${opts.icons ? "" : `title="${esc(title || "Châsses liées : une par gemme")}"`}>${list.map((g, i) =>
    `${i ? `<i class="lk"></i>` : ""}<span class="sk sk-${esc(g.color || "w")} ${g.support ? "" : "act"} ${g.enabled === false ? "off" : ""}" ${opts.tip ? `data-sheet-tip="${opts.tip(i)}"` : `title="${esc(g.name || "")}${g.level ? " · niv. " + g.level : ""}${g.quality ? " / " + g.quality + " %" : ""}"`}>${opts.icons && g.icon ? `<img src="${esc(g.icon)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`).join("")}</div>`;
}
function gemList(gems, cls = () => "", group = null) {
  return gems.map((g, i) => `<div class="gem ${g.support ? "support" : ""} ${g.enabled ? "" : "off"} ${cls(g)}"${group != null ? ` data-tip="${group}:${i + 1}"` : ""}>${g.icon ? `<img class="gico" src="${esc(g.icon)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;gd ${g.color}&quot;></span>'">` : `<span class="gd ${g.color}"></span>`}${esc(g.name)}<span class="lv">${g.level || ""}${g.quality ? " / " + g.quality + " %" : ""}</span></div>`).join("");
}
function gainText(g) {
  if (!g) return "";
  const p = [];
  if (g.pair) p.push(`<span class="muted">avec l'autre stat de la paire :</span>`);
  if (Math.abs(g.dps || 0) >= 0.5) p.push(`<span class="${g.dps > 0 ? "up" : "down"}">${pctText(g.dps)} DPS</span>`);
  if (Math.abs(g.ehp || 0) >= 0.5) p.push(`<span class="${g.ehp > 0 ? "up" : "down"}">${pctText(g.ehp)} survie</span>`);
  return p.length ? p.join(" · ") : `<span class="muted">aucun effet mesurable</span>`;
}

// ES plafonnée par l'armure / l'évasion (Divine Shield) : les deux stats se lisent ensemble, avec leur marge
function esCapCard(c) {
  if (!c || !c.mine) return "";
  const L = c.label, m = c.mine, g = c.guide || {};
  const margin = (x) => x.es != null && x.def != null ? x.es - x.def : null;
  const mm = margin(m), gm = margin(g);
  const state = (x) => x == null ? "" : x <= 0 ? `<span class="tag bad">${L} au-dessus : full ES</span>` : x > Math.max(100, (gm || 0) * 2, (m.es || 0) * 0.05) ? `<span class="tag warn">${nf(x)} d'ES inutile</span>` : `<span class="tag good">bon équilibre</span>`;
  const row = (who, x, mg) => `<tr><td class="l">${who}</td><td class="v">${x.def != null ? nf(x.def) : "—"}</td><td class="v">${x.es != null ? nf(x.es) : "—"}</td><td class="v">${mg == null ? "—" : (mg > 0 ? "+" : "") + nf(mg)}</td><td class="v">${state(mg)}</td></tr>`;
  return `<div class="card pad escap-card" style="margin-bottom:12px">
    <h3 style="margin:0 0 4px">${esc(c.source)} : ${esc(L)} et ES vont ensemble</h3>
    <p class="muted small" style="margin:0 0 8px">Ton ES ne se recharge pas au-dessus de ton ${esc(L)}. Le build garde l'ES <b>juste au-dessus</b> : tu n'es jamais « full ES », donc ton vol et ta régénération d'ES ne s'arrêtent jamais. ${esc(L[0].toUpperCase() + L.slice(1))} au-dessus de l'ES = mécanisme perdu ; ES très au-dessus = points qui ne protègent pas.</p>
    <table class="stat-table"><thead><tr><th></th><th class="v">${esc(L[0].toUpperCase() + L.slice(1))}</th><th class="v">ES</th><th class="v">Marge ES − ${esc(L)}</th><th class="v"></th></tr></thead>
      <tbody>${row("Ton perso", m, mm)}${row("Guide", g, gm)}</tbody></table>
    ${c.gain ? `<p class="small" style="margin:8px 0 0">Avec l'${esc(L)} <b>et</b> l'ES du guide (les deux ensemble) : ${gainText(Object.assign({}, c.gain, { pair: false }))}</p>` : ""}
  </div>`;
}
// ------------------------------------------------------------------ infobulles dessinées par PoB (Tooltip, AddItemTooltip, GemTooltip)
// Le contenu (stats, comparaison avec l'objet équipé…) et le rendu (cadres, polices) sont ceux de PoB.
let TT_CTX = { id: null, stage: null };   // build dans le contexte duquel PoB calcule les infobulles
const TT_REG = [];
function ttReq(route, body) { TT_REG.push({ route, body }); return TT_REG.length - 1; }
class PobStatic {
  constructor(host, res, k) {
    this.host = host; this.res = res; this.k = k || 1;
    this.cv = document.createElement("canvas"); host.appendChild(this.cv);
    this.ctx = this.cv.getContext("2d");
    PobGfx.loadFonts().then((f) => { this.fontMeta = f; this.paint(); });
  }
  paint() {
    const ds = (devicePixelRatio || 1) * this.k;
    this.cv.width = Math.round(this.res.w * ds); this.cv.height = Math.round(this.res.h * ds);
    renderPobList(this.ctx, this.res.dl, this.res.w, this.res.h, ds, this.fontMeta, () => {
      if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = null; this.paint(); });
    });
  }
}
const PobTip = {
  cache: new Map(),
  get(req) {
    const k = req.route + JSON.stringify(req.body);
    if (!this.cache.has(k)) this.cache.set(k, api(req.route, req.body).catch((e) => { this.cache.delete(k); throw e; }));
    return this.cache.get(k);
  },
  mount(host, res, fit) {
    const wrap = document.createElement("div");
    wrap.className = "pob-canvas";
    host.innerHTML = ""; host.appendChild(wrap);
    const avail = fit ? host.clientWidth : Infinity;
    const k = Math.min(1, avail / res.w);
    wrap.style.width = res.w * k + "px"; wrap.style.height = res.h * k + "px";
    new PobStatic(wrap, res, k);
  },
};
// rendu automatique des infobulles PoB insérées dans la page (<div class="pobtt" data-tt="n">)
new MutationObserver(() => {
  for (const el of document.querySelectorAll(".pobtt:not([data-done])")) {
    el.dataset.done = "1";
    const req = TT_REG[+el.dataset.tt]; if (!req) continue;
    el.innerHTML = `<div class="loading" style="padding:10px"><div class="spinner"></div></div>`;
    PobTip.get(req).then((res) => PobTip.mount(el, res, true)).catch((e) => { el.innerHTML = `<div class="muted small">${esc(e.message)}</div>`; });
  }
}).observe(document.body, { childList: true, subtree: true });
window.addEventListener("hashchange", () => PobTip.cache.clear());

// infobulle flottante au survol
const FloatTip = {
  el: null, cur: null, ev: null,
  show(req, ev) {
    if (!this.el) { this.el = document.createElement("div"); this.el.className = "float-tip"; document.body.appendChild(this.el); }
    this.cur = req; this.ev = ev;
    PobTip.get(req).then((res) => {
      if (this.cur !== req) return;
      PobTip.mount(this.el, res);
      this.el.style.display = "block"; this.move(this.ev);
    }).catch(() => {});
  },
  move(ev) {
    this.ev = ev;
    if (!this.el || this.el.style.display !== "block") return;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    let x = ev.clientX + 20, y = ev.clientY + 16;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 20;
    if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
    this.el.style.left = Math.max(8, x) + "px"; this.el.style.top = y + "px";
  },
  hide() { this.cur = null; if (this.el) this.el.style.display = "none"; },
  // infobulle déjà calculée (ex. nœud de l'arbre : liste de dessin de PoB) affichée telle quelle
  showData(res, ev) {
    if (!this.el) { this.el = document.createElement("div"); this.el.className = "float-tip"; document.body.appendChild(this.el); }
    this.cur = res;
    PobTip.mount(this.el, res);
    this.el.style.display = "block";
    if (ev) this.move(ev);
  },
};
function bindItemTips(root, getReq) {
  // un seul jeu de gestionnaires par conteneur (le conteneur de page est réutilisé d'une page à l'autre)
  if (root._tipCleanup) root._tipCleanup();
  const over = (ev) => {
    const el = ev.target.closest("[data-tip]"); if (!el || !root.contains(el)) return;
    const req = getReq(el.dataset.tip); if (req) FloatTip.show(req, ev);
  };
  const move = (ev) => FloatTip.move(ev);
  const out = (ev) => { const el = ev.target.closest("[data-tip]"); if (el && !el.contains(ev.relatedTarget)) FloatTip.hide(); };
  root.addEventListener("mouseover", over); root.addEventListener("mousemove", move); root.addEventListener("mouseout", out);
  root._tipCleanup = () => { root.removeEventListener("mouseover", over); root.removeEventListener("mousemove", move); root.removeEventListener("mouseout", out); root._tipCleanup = null; };
}
window.addEventListener("hashchange", () => FloatTip.hide());
// menu « plus de réglages » de la barre du haut : ouvert vers la gauche s'il sortirait de l'écran
document.addEventListener("toggle", (ev) => {
  const d = ev.target; if (!(d instanceof HTMLDetailsElement) || !d.classList.contains("sb-more") || !d.open) return;
  const pop = d.querySelector(".sb-pop"); if (!pop) return;
  pop.style.left = ""; pop.style.right = "";
  if (pop.getBoundingClientRect().right > document.documentElement.clientWidth - 8) { pop.style.left = "auto"; pop.style.right = "0"; }
}, true);


// Arbre d'un snapshot, au format attendu pour la comparaison d'arbre (nœuds, classe, ascendance, maîtrises)
function treeSpecOf(snap) {
  const t = snap && snap.tree; if (!t) return null;
  return { nodes: t.alloc, classId: t.classId, ascendClassId: t.ascendClassId, secondaryAscendClassId: t.secondaryAscendClassId,
    masterySelections: t.masterySelections, version: t.version };
}
const MODE_EYEBROW = { mine: ["mine", "Ton perso"], guide: ["guide", "Le guide"], sandbox: ["sandbox", "Essai · rien n'est enregistré"] };
// Recette d'huiles d'un anoint (3 huiles, de la moins chère à la plus chère selon PoB)
const OIL_COL = { Clear: "#d9d9d9", Sepia: "#b48a5a", Amber: "#e8a43a", Verdant: "#5fbf5a", Teal: "#3fb7a8", Azure: "#3f8fe0", Indigo: "#5a5fd6",
  Violet: "#a05ad6", Crimson: "#d64a4a", Black: "#666", Opalescent: "#e8e3f5", Silver: "#c9ced6", Golden: "#e8c23a", Prismatic: "#ff7ad9" };
function oilRecipe(rec) {
  return (rec || []).map((o) => { const n = String(o).replace(/Oil$/, "").trim(); return `<span class="oil"><i style="background:${OIL_COL[n] || "#999"}"></i>${esc(n)}</span>`; }).join(" ");
}

// Groupes de gemmes à afficher : les compétences données par un même objet (même compétence active, sans support)
// sont réunies en une carte — ex. Chains of Command donne Animate Guardian's Weapon deux fois (niv. 20 et niv. 18).
const GRANTED_TRIGGER = {
  "Animate Guardian's Weapon": ["quand ton Guardian tue", "10 % de chance quand une arme animée tue"],
};
function skillCards(skills) {
  const out = [], byKey = new Map();
  for (const g of skills) {
    const actives = g.gems.filter((x) => !x.support);
    const fromItem = /^Item:/.test(g.source || "") && actives.length === 1 && g.gems.length === 1;
    const key = fromItem ? g.source.replace(/^Item:\d+:/, "") + "|" + actives[0].name : null;
    if (key && byKey.has(key)) { byKey.get(key).merged.push(g); continue; }
    const card = { g, merged: [g] };
    if (key) byKey.set(key, card);
    out.push(card);
  }
  return out;
}
// Sous-partie d'une compétence (Lightning Strike : Melee / Projectiles…) : PoB ne calcule que celle choisie
const partSelect = (g) => `<select class="select sm" data-part="${g.index}" title="La partie de la compétence que PoB calcule">${g.parts.map((n, i) =>
  `<option value="${i + 1}" ${(g.part || 1) === i + 1 ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
async function setMainPart(c, id, index, part) {
  c.style.opacity = .6;
  try { S.snap[id] = await api("mainSkill", { id, stage: stageOf(id), index, part }); toast("Partie calculée changée"); }
  catch (e) { toast(e.message, true); }
  c.style.opacity = 1; route();
}
// Inventaire façon jeu : emplacement → position dans une grille de 8 × 6 cases
const DOLL = {
  "Weapon 1": [1, 1, 2, 4], "Helmet": [4, 1, 2, 2], "Weapon 2": [7, 1, 2, 4],
  "Amulet": [6, 2, 1, 1], "Body Armour": [4, 3, 2, 3], "Ring 1": [3, 3, 1, 1], "Ring 2": [6, 3, 1, 1],
  "Gloves": [1, 5, 2, 2], "Belt": [4, 6, 2, 1], "Boots": [7, 5, 2, 2], "Ring 3": [3, 4, 1, 1],
};
function itemIcon(it, cls = "") {
  if (!it || !it.icon) return "";
  if (it.iconFrames) return `<span class="ico3 ${cls}" style="background-image:url('${esc(it.icon)}')"></span>`;
  return `<img class="ico ${cls}" src="${esc(it.icon)}" alt="" loading="lazy" onerror="this.remove()">`;
}
function invSlot(s, i, style) {
  const it = s.item;
  return `<button class="inv-slot ${it ? "r-b-" + esc(it.rarity) : "empty"}" data-i="${i}" ${it ? `data-tip="${i}"` : `title="${esc(s.label)}"`} style="${style}">
    ${it ? (it.icon ? itemIcon(it) : `<span class="inv-txt r-${esc(it.rarity)}">${esc(itemTitle(it))}</span>`) : `<span class="inv-lbl">${esc(s.label)}</span>`}
  </button>`;
}

// Inventaire du Guardian (Animated Guardian) : mêmes positions que l'inventaire du personnage
// Chains of Command : les armes animées (Animate Guardian's Weapon) sont des copies de l'arme du Guardian.
// Nombre de copies = champ « Count » de PoB sur le groupe compté dans le Full DPS (1 si non renseigné).
function animatedWeapons(snap) {
  const groups = (snap.skills || []).filter((g) => g.enabled !== false && g.gems.some((x) => !x.support && x.name === "Animate Guardian's Weapon" && x.enabled !== false));
  if (!groups.length) return null;
  const counted = groups.find((g) => g.includeInFullDPS) || groups[0];
  return { copies: counted.count || 1, groups };
}
function guardianDoll(g, gi, aw) {
  const slots = g.slots || [];
  const filled = slots.filter((x) => x.item).length;
  const linked = Array.isArray(g.linked) ? g.linked : [];
  const weapon = (slots.find((x) => x.slot === "Weapon 1") || {}).item;
  return `<div class="card inventory guardian-inv">
    <div class="row guardian-head">
      ${icon("skull", "--chaos")}
      <div><h3>${esc(g.skill)}</h3><div class="muted small">${esc(g.title || "")} · ${filled} objet${filled > 1 ? "s" : ""} porté${filled > 1 ? "s" : ""} par le sbire${g.enabled ? "" : " · gemme désactivée"}</div></div>
    </div>
    ${linked.length && aw ? `<div class="guardian-linked">${icon("sword", "--fire")}<span><b>+ ${aw.copies} arme${aw.copies > 1 ? "s" : ""} animée${aw.copies > 1 ? "s" : ""}</b> <span class="muted">· Chains of Command · copie${aw.copies > 1 ? "s" : ""} de ${weapon ? esc(weapon.name.split(",")[0]) : "l'arme du Guardian"}</span></span></div>` : ""}
    <div class="doll guardian">
      ${slots.map((sl, si) => {
        const pos = DOLL[sl.slot]; if (!pos) return "";
        const [x, y, w, h] = pos;
        return invSlot(sl, si, `grid-column:${x} / span ${w};grid-row:${y} / span ${h}`)
          .replace(`data-i="${si}"`, `data-g="${gi}:${si}"`).replace(`data-tip="${si}"`, `data-tip="g${gi}:${si}"`);
      }).join("")}
    </div>
  </div>`;
}
