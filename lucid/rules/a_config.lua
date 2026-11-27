-- Famille A — Les « faux positifs » de configuration (les pièges PoB).
-- Le guide coche une case qui gonfle le DPS, mais le joueur n'a pas la mécanique pour l'activer en jeu.
local L = ...
local rules = { }

-- Fabrique : « l'option X du guide suppose une source Y que le joueur n'a pas »
--   var, title, severity, what (ce que l'option suppose), sources = motifs Lua cherchés dans
--   les objets / l'arbre / les gemmes du joueur, exclude = motifs qui disqualifient une ligne,
--   has(player) = test supplémentaire (stats PoB), fix = conseil
local function needsSource(d)
	-- conditions réalistes (Bridge.gateConfig) : la liste des options qui demandent une source
	if L.gates then table.insert(L.gates, d) end
	-- La source est-elle visible dans un build (objets, arbre, gemmes, stats PoB) ?
	local function hasSource(p, stats)
		if d.has and d.has(p, stats) then return true end
		return p:has(d.sources, d.exclude)
	end
	table.insert(rules, {
		id = d.id, category = d.category or "CONFIG",
		-- si le guide lui-même n'a aucune source visible, c'est une hypothèse invérifiable (sbire équipé,
		-- allié, effet non modélisé…) et non une erreur du joueur : simple conseil
		severity = function(data) return data.unverified and "CONSEIL" or (d.severity or "ATTENTION") end,
		title = function(data) return data.unverified and (d.title:gsub(" sans .*$", "") .. " : à vérifier en jeu") or d.title end,
		triggerCondition = function(guide, player)
			return guide:opt(d.var) ~= nil and player:opt(d.var) ~= nil
		end,
		isFailing = function(stats, player, guide)
			if hasSource(player, stats) then return false end
			local guideSrc = guide.isGuide and guide:find(d.sources, d.exclude)
			return true, { unverified = guide.isGuide and not guideSrc and not (d.has and d.has(guide)), guideSrc = guideSrc }
		end,
		calculateImpact = function(player, engine)
			return engine:simulate({ [d.var] = false })
		end,
		formatMessage = function(stats, impact, player, guide, data)
			local s
			if data.unverified then
				s = string.format("Le guide coche « %s » : %s Ni le guide ni ton build n'en montrent la source (elle vient peut-être d'un sbire équipé, d'un allié ou d'un effet que PoB ne modélise pas). Vérifie en jeu que c'est vraiment actif.",
					L.label(d.var), d.what)
			else
				s = string.format("Le guide coche « %s » : %s Lucid ne trouve aucune source dans ton équipement, ton arbre ou tes gemmes%s.",
					L.label(d.var), d.what, data.guideSrc and (", alors que le guide l'obtient avec « " .. data.guideSrc .. " »") or "")
			end
			local i = L.impactText(impact)
			if i then s = s .. " Sans cette condition, ton DPS réel : " .. i .. "." end
			return s
		end,
		fix = function(player, guide, data)
			if data.unverified then return "Si ce n'est pas actif en jeu, décoche l'option pour voir ton DPS réel." end
			return d.fix
		end,
	})
end

------------------------------------------------------------------------ charges
local GAIN = { "%f[%a]gain", "%f[%a]grant", "%f[%a]generat", "%f[%a]steal", "on kill", "on hit", "when you" }

local function chargeSources(kind)
	local p = { }
	for _, v in ipairs(GAIN) do
		table.insert(p, v .. ".-" .. kind .. " charge")
		table.insert(p, kind .. " charge.-" .. v)
	end
	return p
end

needsSource({
	id = "config.charges.power", var = "usePowerCharges", severity = "CRITIQUE",
	title = "Charges de puissance sans source",
	what = "tu es censé avoir tes charges de puissance au maximum en permanence.",
	sources = chargeSources("power"), exclude = { "^item:%+%d+ to maximum power charges$", "^tree:%+%d+ to maximum power charges$" },
	has = function(p) return (p:stat("PowerChargesMin") or 0) > 0 or p:hasGem("Assassin's Mark") or p:hasGem("Power Charge On Critical") end,
	fix = "Ajoute une source de charges de puissance (Assassin's Mark, Power Charge On Critical, passif ou objet) ou ignore ce DPS.",
})
needsSource({
	id = "config.charges.frenzy", var = "useFrenzyCharges", severity = "CRITIQUE",
	title = "Charges de frénésie sans source",
	what = "tu es censé avoir tes charges de frénésie au maximum en permanence.",
	sources = chargeSources("frenzy"),
	has = function(p) return (p:stat("FrenzyChargesMin") or 0) > 0 or p:hasGem("Blood Rage") or p:hasGem("Frenzy") or p:hasGem("Poacher's Mark") end,
	fix = "Ajoute une source de charges de frénésie (Blood Rage, Frenzy, Poacher's Mark, passif ou objet) ou ignore ce DPS.",
})
needsSource({
	id = "config.charges.endurance", var = "useEnduranceCharges", severity = "ATTENTION", category = "SURVIE",
	title = "Charges d'endurance sans source",
	what = "tu es censé avoir tes charges d'endurance au maximum (résistance physique et élémentaire en plus).",
	sources = chargeSources("endurance"),
	has = function(p) return (p:stat("EnduranceChargesMin") or 0) > 0 or p:hasGem("Enduring Cry") or p:hasGem("Warlord's Mark") end,
	fix = "Ajoute Enduring Cry, Warlord's Mark ou une autre source de charges d'endurance.",
})
needsSource({
	id = "config.charges.minionpower", var = "minionsUsePowerCharges", severity = "ATTENTION",
	title = "Charges de puissance des sbires sans source",
	what = "tes sbires sont censés avoir des charges de puissance.",
	sources = { "minion.-power charge", "power charge.-minion" },
})
needsSource({
	id = "config.charges.minionfrenzy", var = "minionsUseFrenzyCharges", severity = "ATTENTION",
	title = "Charges de frénésie des sbires sans source",
	what = "tes sbires sont censés avoir des charges de frénésie.",
	sources = { "minion.-frenzy charge", "frenzy charge.-minion" },
})

------------------------------------------------------------------------ altérations d'état (ailments)
-- Le joueur doit infliger l'altération lui-même (chance sur coup calculée par PoB),
-- ou avoir une autre source dans son build (aura, gemme, ligne d'objet).
local AFFLICTED = { "avoid", "immun", "cannot be", "while you are", "when you are", "you are ", "against you",
	"reduced effect of .- on you", "duration on you" }

local function ailment(id, var, name, noun, chanceKeys, dmgKey, patterns, sev)
	needsSource({
		id = id, var = var, severity = sev or "ATTENTION",
		title = "Ennemi « " .. name .. " » sans moyen de l'appliquer",
		what = "l'ennemi est supposé " .. name .. " en permanence, mais ta compétence principale n'a aucune chance de l'infliger.",
		sources = patterns, exclude = AFFLICTED,
		has = function(p)
			for _, k in ipairs(chanceKeys) do if p:stat(k) > 0 then return dmgKey == nil or p:stat(dmgKey) > 0 end end
			return false
		end,
		fix = "Décoche l'option dans la simulation, ou ajoute une source " .. noun .. " (gemme, aura, mod d'objet).",
	})
end

ailment("config.ailment.shock", "conditionEnemyShocked", "électrocuté", "d'électrocution", { "ShockChanceOnHit", "ShockChanceOnCrit" }, "LightningMax",
	{ "shock" }, "CRITIQUE")
ailment("config.ailment.chill", "conditionEnemyChilled", "refroidi", "de refroidissement", { "ChillChanceOnHit" }, "ColdMax", { "chill" })
ailment("config.ailment.freeze", "conditionEnemyFrozen", "gelé", "de gel", { "FreezeChanceOnHit", "FreezeChanceOnCrit" }, "ColdMax", { "freez" })
ailment("config.ailment.ignite", "conditionEnemyIgnited", "embrasé", "d'embrasement", { "IgniteChanceOnHit", "IgniteChanceOnCrit" }, "FireMax",
	{ "ignit" }, "CRITIQUE")
ailment("config.ailment.burning", "conditionEnemyBurning", "en feu", "de brûlure", { "IgniteChanceOnHit", "IgniteChanceOnCrit" }, "FireMax",
	{ "ignit", "burning", "burn" })
ailment("config.ailment.brittle", "conditionEnemyBrittle", "fragilisé (Brittle)", "de Brittle", { }, nil, { "brittle" })
ailment("config.ailment.sapped", "conditionEnemySapped", "épuisé (Sapped)", "de Sap", { }, nil, { "sapped", "chance to sap" })
ailment("config.ailment.scorched", "conditionEnemyScorched", "brûlé (Scorched)", "de Scorch", { }, nil, { "scorch" })
ailment("config.ailment.bleeding", "conditionEnemyBleeding", "en saignement", "de saignement", { "BleedChanceOnHit" }, nil, { "bleed" })
ailment("config.ailment.poisoned", "conditionEnemyPoisoned", "empoisonné", "de poison", { "PoisonChanceOnHit" }, nil, { "poison" })

------------------------------------------------------------------------ autres états de l'ennemi / buffs
local function debuff(id, var, title, what, patterns, sev)
	needsSource({ id = id, var = var, title = title, what = what, sources = patterns, exclude = AFFLICTED, severity = sev })
end

debuff("config.enemy.intimidated", "conditionEnemyIntimidated", "Ennemi intimidé sans source",
	"l'ennemi est supposé intimidé (il subit 10 % de dégâts d'attaque en plus).", { "intimidat" })
debuff("config.enemy.unnerved", "conditionEnemyUnnerved", "Ennemi déstabilisé sans source",
	"l'ennemi est supposé déstabilisé (Unnerve : 10 % de dégâts de sort en plus).", { "unnerve" })
debuff("config.enemy.maimed", "conditionEnemyMaimed", "Ennemi mutilé sans source",
	"l'ennemi est supposé mutilé (Maim).", { "maim" })
debuff("config.enemy.blinded", "conditionEnemyBlinded", "Ennemi aveuglé sans source",
	"l'ennemi est supposé aveuglé.", { "blind" })
debuff("config.enemy.hindered", "conditionEnemyHindered", "Ennemi entravé sans source",
	"l'ennemi est supposé entravé (Hinder).", { "hinder" })
debuff("config.enemy.ash", "conditionEnemyCoveredInAsh", "Ennemi couvert de cendres sans source",
	"l'ennemi est supposé couvert de cendres (Covered in Ash).", { "covered in ash" })
debuff("config.enemy.consecrated", "conditionEnemyOnConsecratedGround", "Sol consacré sans source",
	"l'ennemi est supposé sur un sol consacré.", { "consecrated ground" })
debuff("config.enemy.profane", "conditionEnemyOnProfaneGround", "Sol profane sans source",
	"l'ennemi est supposé sur un sol profane.", { "profane ground" })
debuff("config.enemy.cursed", "conditionEnemyCursed", "Ennemi maudit sans malédiction",
	"l'ennemi est supposé maudit.", { "^tag:curse$", "curse enemies", "curse on hit", "apply .-curse" })
debuff("config.enemy.wither", "multiplierWitheredStackCount", "Wither sans source",
	"l'ennemi est supposé avoir des cumuls de Wither (jusqu'à +90 % de dégâts de chaos subis).",
	{ "^gem:wither$", "^gem:withering touch", "inflicts? .-wither", "chance to wither", "wither.- on hit", "apply .-wither", "withered for %d" }, "CRITIQUE")
for _, e in ipairs({ { "Fire", "au feu" }, { "Cold", "au froid" }, { "Lightning", "à la foudre" } }) do
	debuff("config.enemy.exposure" .. e[1]:lower(), "conditionEnemy" .. e[1] .. "Exposure", "Exposition " .. e[2] .. " sans source",
		"l'ennemi est supposé exposé " .. e[2] .. " (résistance réduite).", { "exposure" })
end
debuff("config.buff.onslaught", "buffOnslaught", "Onslaught sans source",
	"tu es censé être sous Onslaught (vitesses d'attaque, de lancement et de déplacement augmentées).", { "onslaught", "silver flask" })
debuff("config.buff.fortify", "buffFortification", "Fortification sans source",
	"tu es censé être fortifié.", { "fortif" })
debuff("config.buff.leeching", "conditionLeeching", "Vol de vie supposé sans vol de vie",
	"tu es censé voler de la vie en permanence.", { "leech" })

------------------------------------------------------------------------ états du joueur et des sbires
table.insert(rules, {
	id = "config.player.fulllife", category = "CONFIG", severity = "ATTENTION",
	title = "Toujours à pleine vie : impossible",
	triggerCondition = function(guide, player) return guide:opt("conditionFullLife") and player:opt("conditionFullLife") end,
	isFailing = function(stats, player)
		local degen, regen = player:stat("TotalBuildDegen"), player:stat("LifeRegenRecovery")
		return degen > regen or player:stat("LifeCost") > 0, { degen = degen, regen = regen }
	end,
	calculateImpact = function(player, engine) return engine:simulate({ conditionFullLife = false }) end,
	formatMessage = function(stats, impact, player, guide, d)
		local s = string.format("Le guide suppose que tu es toujours à pleine vie, mais tu perds %s PV/s et n'en régénères que %s (ou tes compétences coûtent de la vie).",
			L.n(d.degen), L.n(d.regen))
		local i = L.impactText(impact)
		if i then s = s .. " Hors de cette condition : " .. i .. "." end
		return s
	end,
	fix = "Augmente ta régénération de vie, ou décoche « pleine vie » pour voir ton DPS réel.",
})

table.insert(rules, {
	id = "config.player.lowlife", category = "CONFIG", severity = "CRITIQUE",
	title = "Toujours à vie basse : réservation insuffisante",
	triggerCondition = function(guide, player) return guide:opt("conditionLowLife") and player:opt("conditionLowLife") end,
	isFailing = function(stats, player)
		local p = player.key.LifeUnreservedPercent or 100
		return not player.ci and p > 50, p
	end,
	calculateImpact = function(player, engine) return engine:simulate({ conditionLowLife = false }) end,
	formatMessage = function(stats, impact, player, guide, p)
		local s = string.format("Le guide suppose que tu es en permanence à vie basse (≤ 50 %%), mais il te reste %s de vie non réservée : tu ne seras jamais à vie basse.", L.pct(p))
		local i = L.impactText(impact)
		if i then s = s .. " Ton DPS et ta défense réels : " .. i .. "." end
		return s
	end,
	fix = "Réserve plus de vie (auras sur vie, Blood Magic / Petrified Blood) avant de compter sur les bonus de vie basse.",
})

-- Exemple de la spec : sbires « toujours à pleine vie » alors qu'Infernal Legion les brûle plus vite qu'ils ne régénèrent
table.insert(rules, {
	id = "config.minion.fulllife", category = "MECANIQUE", severity = "CRITIQUE",
	title = "Sustain des sbires insuffisant",
	triggerCondition = function(guide, player)
		return guide:opt("minionsConditionFullLife") and player:opt("minionsConditionFullLife") and player.minion ~= nil
	end,
	isFailing = function(stats, player)
		local m = player.minion
		local life = m.Life or 0
		if life <= 0 then return false end
		local degen = m.TotalBuildDegen or 0
		local regen = (m.LifeRegenRecovery or 0) + (m.LifeLeechGainRate or 0)
		return degen > 0 and regen <= degen, { regen = regen / life * 100, degen = degen / life * 100,
			legion = player:hasGem("Infernal Legion") ~= nil }
	end,
	calculateImpact = function(player, engine) return engine:simulate({ minionsConditionFullLife = false }) end,
	formatMessage = function(stats, impact, player, guide, d)
		local s = string.format("Tes sbires régénèrent %s de leur vie par seconde mais en perdent %s%s. Ils ne sont jamais à pleine vie, ce qui désactive les bonus « Full Life ».",
			L.pct(d.regen), L.pct(d.degen), d.legion and " à cause d'Infernal Legion" or "")
		local i = L.impactText(impact)
		if i then s = s .. " DPS réel : " .. i .. "." end
		return s
	end,
	fix = "Ajoute de la régénération de vie aux sbires (Convocation, maîtrise de sbires, objets) ou retire Infernal Legion.",
})

return rules
