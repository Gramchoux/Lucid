-- Famille B — Survie : les trous de défense qui tuent un débutant avant son manque de DPS.
-- Les seuils suivent le guide quand il en a un (son étape dit ce qui est « normal » à ce niveau).
local L = ...
local rules = { }

local ELEMENTS = { { "Fire", "au feu" }, { "Cold", "au froid" }, { "Lightning", "à la foudre" } }

-- Résistances élémentaires non plafonnées (à partir de l'acte 6, la pénalité les rend vitales)
for _, e in ipairs(ELEMENTS) do
	local key, fr = e[1], e[2]
	table.insert(rules, {
		id = "survie.res." .. key:lower(), category = "SURVIE",
		-- gravité selon l'écart : 1 % manquant n'est pas 40 %
		severity = function(miss) return miss >= 20 and "CRITIQUE" or miss >= 6 and "ATTENTION" or "CONSEIL" end,
		title = "Résistance " .. fr .. " non plafonnée",
		triggerCondition = function(guide, player)
			-- le guide la plafonne à cette étape, ou le perso a passé la pénalité de résistance
			return (guide.isGuide and (guide.key["Missing" .. key .. "Resist"] or 99) <= 0) or (player.level or 1) >= 45
		end,
		isFailing = function(stats, player)
			local miss = player.key["Missing" .. key .. "Resist"] or 0
			return miss > 0, miss
		end,
		calculateImpact = function(player, engine, miss)
			return engine:simulateMods(string.format("+%d%% to %s Resistance", math.ceil(miss), key))
		end,
		formatMessage = function(stats, impact, player, guide, miss)
			local s = string.format("Ta résistance %s est à %s : il te manque %s pour atteindre le maximum (%s).",
				fr, L.pct(player.key[key .. "Resist"] or 0), L.pct(miss), L.pct((player.key[key .. "Resist"] or 0) + miss))
			if impact and impact.ehp and impact.ehp > 0.5 then
				s = s .. string.format(" La plafonner te donnerait %s de survie (coup max encaissable).", "+" .. L.pct(impact.ehp))
			end
			return s
		end,
		fix = "Priorise la résistance sur tes prochains anneaux, ceinture, bottes ou gants (c'est le gain de survie le moins cher du jeu).",
	})
end

-- Résistance au chaos très négative en fin de campagne / maps
table.insert(rules, {
	id = "survie.res.chaos", category = "SURVIE", severity = "CONSEIL",
	title = "Résistance au chaos très basse",
	triggerCondition = function(guide, player) return (player.level or 1) >= 75 and not player.ci end,
	isFailing = function(stats, player, guide)
		local c = player.key.ChaosResist or 0
		local g = guide and guide.isGuide and guide.key.ChaosResist
		return c < -20 and (g == nil or c < g - 15), c
	end,
	calculateImpact = function(player, engine, c)
		return engine:simulateMods(string.format("+%d%% to Chaos Resistance", math.ceil(math.min(75, 0 - c))))
	end,
	formatMessage = function(stats, impact, player, guide, c)
		local s = string.format("Ta résistance au chaos est à %s%s.", L.pct(c),
			guide.isGuide and (" (le guide : " .. L.pct(guide.key.ChaosResist or 0) .. ")") or "")
		if impact and impact.ehp and impact.ehp > 0.5 then s = s .. " La remonter à 0 % te donnerait +" .. L.pct(impact.ehp) .. " de survie (coup max encaissable)." end
		return s
	end,
	fix = "Cherche du chaos en suffixe sur les anneaux, l'amulette ou la ceinture, ou une flasque Amethyst.",
})

-- Survie très inférieure à celle du guide à la même étape : coups max encaissables (Max Hit), pas l'EHP
-- (l'EHP de PoB est gonflé par le blocage et la récupération sur blocage)
table.insert(rules, {
	id = "survie.ehp.guide", category = "SURVIE", severity = "ATTENTION",
	title = "Tu encaisses beaucoup moins de dégâts que le guide",
	triggerCondition = function(guide) return guide.isGuide and (guide.key.HitPool or 0) > 0 end,
	isFailing = function(stats, player, guide)
		local r = (player.key.HitPool or 0) / guide.key.HitPool
		return r < 0.6, r
	end,
	formatMessage = function(stats, impact, player, guide, r)
		return string.format("En moyenne sur les 5 types de coups, tu encaisses %s de ce que le guide encaisse à cette étape. Ton point faible : un coup de %s de %s (guide : %s). Vie : %s (guide %s), ES : %s (guide %s).",
			L.pct(r * 100), player.key.MinMaxHitType or "?", L.n(player.key.MinMaxHit or 0), L.n(guide.key.MinMaxHit or 0),
			L.n(player.key.Life or 0), L.n(guide.key.Life or 0), L.n(player.key.EnergyShield or 0), L.n(guide.key.EnergyShield or 0))
	end,
	fix = "Regarde l'onglet Statistiques : les Max Hit et les résistances face au guide, puis les objets qui les montent.",
})

-- ES plafonnée par l'armure (Divine Shield) : l'ES doit rester JUSTE au-dessus de l'armure.
-- Armure au-dessus : tu es full ES, ton vol d'ES et la régénération de Divine Shield s'arrêtent.
-- ES très au-dessus : les points d'ES au-delà de l'armure ne protègent pas.
table.insert(rules, {
	id = "survie.escap", category = "SURVIE",
	severity = function(d) return d.over and "CRITIQUE" or "CONSEIL" end,
	title = function(d) return d.over and ("Ton " .. d.cap.label .. " dépasse ton ES (" .. d.cap.source .. ")") or ("ES gaspillée au-dessus de ton " .. d.cap.label) end,
	triggerCondition = function(guide, player) return player.esCap ~= nil and (player.esCap.es or 0) > 0 end,
	isFailing = function(stats, player, guide)
		local c = player.esCap
		local margin = c.es - c.def
		if margin <= 0 then return true, { cap = c, over = true, margin = margin } end
		-- marge « normale » : celle du guide si elle existe, sinon 5 % de l'ES
		local gc = guide.isGuide and guide.esCap
		local ok = math.max(c.es * 0.05, gc and (gc.es - gc.def) * 2 or 0, 100)
		return margin > ok, { cap = c, over = false, margin = margin, keep = gc and math.max(gc.es - gc.def, 1) or math.max(math.floor(c.es * 0.02), 20) }
	end,
	calculateImpact = function(player, engine, d)
		if d.over then return nil end
		-- remonter l'armure jusqu'à garder la petite marge du guide
		local add = d.margin - d.keep
		if add < 1 then return nil end
		return engine:simulateMods(string.format(d.cap.by == "Armour" and "+%d to Armour" or "+%d to Evasion Rating", add))
	end,
	formatMessage = function(stats, impact, player, guide, d)
		local c, gc = d.cap, guide.isGuide and guide.esCap
		local s
		if d.over then
			s = string.format("%s : ton ES ne se recharge pas au-dessus de ton %s. Avec %s d'%s pour %s d'ES, tu es toujours « full ES » : ton vol d'ES et la régénération de %s s'arrêtent.",
				c.source, c.label, L.n(c.def), c.label, L.n(c.es), c.source)
		else
			s = string.format("%s : ton ES utile s'arrête à ton %s (%s). Tu as %s d'ES, soit %s points qui ne protègent pas.",
				c.source, c.label, L.n(c.def), L.n(c.es), L.n(d.margin))
		end
		if gc then s = s .. string.format(" Le guide : %s d'%s pour %s d'ES (marge %s).", L.n(gc.def), c.label, L.n(gc.es), L.n(gc.es - gc.def)) end
		return s
	end,
	fix = function(player, guide, d)
		if d.over then return "Garde ton ES juste au-dessus de ton " .. d.cap.label .. " : ajoute de l'ES ou retire un peu d'" .. d.cap.label .. "." end
		return "Monte ton " .. d.cap.label .. " jusqu'à " .. L.n(d.cap.es - d.keep) .. " environ (juste sous ton ES) : c'est de la protection en plus sans perdre le mécanisme."
	end,
})

-- Coup maximum encaissable (risque de « one-shot »)
table.insert(rules, {
	id = "survie.maxhit", category = "SURVIE", severity = "ATTENTION",
	title = "Risque de mort en un coup",
	triggerCondition = function(guide) return guide.isGuide and (guide.key.PhysicalMaximumHitTaken or 0) > 0 end,
	isFailing = function(stats, player, guide)
		local worst, wk, wr = nil, nil, 1
		for _, k in ipairs({ "Physical", "Fire", "Cold", "Lightning", "Chaos" }) do
			local p, g = player.key[k .. "MaximumHitTaken"], guide.key[k .. "MaximumHitTaken"]
			if p and g and g > 0 and p / g < wr then wr, wk, worst = p / g, k, p end
		end
		return wr < 0.5, { k = wk, v = worst, g = wk and guide.key[wk .. "MaximumHitTaken"], r = wr }
	end,
	formatMessage = function(stats, impact, player, guide, d)
		local fr = { Physical = "physique", Fire = "de feu", Cold = "de froid", Lightning = "de foudre", Chaos = "de chaos" }
		return string.format("Le plus gros coup %s que tu encaisses est de %s, contre %s pour le guide (%s). Un boss peut te tuer en un seul coup.",
			fr[d.k], L.n(d.v), L.n(d.g), L.pct(d.r * 100))
	end,
	fix = function(player, guide, d)
		if d.k == "Physical" then return "Armure, Determination / Grace, Basalt / Granite flask, ou vie supplémentaire." end
		if d.k == "Chaos" then return "Résistance au chaos et vie." end
		return "Plafonne cette résistance, puis monte ta vie ou ton ES."
	end,
})

-- Suppression de sorts : le guide est conçu autour, le joueur en est loin
table.insert(rules, {
	id = "survie.suppress", category = "SURVIE",
	-- sous 75 % : ATTENTION ; entre 75 et 99 % alors que le guide est au plafond : CONSEIL
	-- (les sorts non supprimés frappent à pleins dégâts, d'où des morts imprévisibles sur les boss)
	severity = function(s) return s < 75 and "ATTENTION" or "CONSEIL" end,
	title = "Suppression des sorts insuffisante",
	triggerCondition = function(guide) return guide.isGuide and (guide.key.SpellSuppressionChance or 0) >= 90 end,
	isFailing = function(stats, player, guide)
		local s = player.key.SpellSuppressionChance or 0
		local g = guide.key.SpellSuppressionChance or 0
		return s < 75 or (g >= 99 and s < 99), s
	end,
	calculateImpact = function(player, engine, s)
		return engine:simulateMods(string.format("+%d%% chance to Suppress Spell Damage", math.ceil(100 - s)))
	end,
	formatMessage = function(stats, impact, player, guide, s)
		local m = s < 75
			and string.format("Le guide plafonne la suppression des sorts (%s), tu n'en as que %s : la moitié des dégâts de sorts n'est pas réduite aussi souvent que prévu.",
				L.pct(guide.key.SpellSuppressionChance), L.pct(s))
			or string.format("Suppression des sorts à %s contre %s dans le guide : %s des sorts te frappent encore à pleins dégâts, de quoi mourir de façon imprévisible sur un boss.",
				L.pct(s), L.pct(guide.key.SpellSuppressionChance), L.pct(100 - s))
		if impact and impact.ehp and impact.ehp > 0.5 then m = m .. " La plafonner : +" .. L.pct(impact.ehp) .. " de survie (coup max encaissable)." end
		return m
	end,
	fix = "Suppression sur les bottes, gants, casque et bouclier (préfixes d'objets à Dextérité), et les passifs du guide.",
})

-- Régénération nette négative (dégénération non compensée)
table.insert(rules, {
	id = "survie.netregen", category = "SURVIE", severity = "CRITIQUE",
	title = "Tu perds de la vie en permanence",
	triggerCondition = function(guide, player) return (player.key.TotalBuildDegen or 0) > 0 end,
	isFailing = function(stats, player)
		local net = (player.key.LifeRegenRecovery or 0) + (player.key.LifeLeechGainRate or 0) - (player.key.TotalBuildDegen or 0)
		return net < 0, net
	end,
	formatMessage = function(stats, impact, player, guide, net)
		return string.format("Tu subis %s de dégâts par seconde (dégénération de ton build) et n'en récupères que %s : ta vie baisse de %s PV/s hors combat.",
			L.n(player.key.TotalBuildDegen), L.n((player.key.LifeRegenRecovery or 0) + (player.key.LifeLeechGainRate or 0)), L.n(-net))
	end,
	fix = "Augmente ta régénération de vie ou réduis la source de dégénération (Righteous Fire, Blood Rage…).",
})

-- Immunités aux altérations que le guide a et pas le joueur (flasques, mods)
local IMMUNITIES = {
	{ "freeze", "au gel", { "immun.-freez", "cannot be frozen", "of heat", "removes? .-chill.-freez", "unaffected by freeze" } },
	{ "bleed", "au saignement", { "immun.-bleed", "cannot be inflicted with bleeding", "of staunching", "removes? .-bleed", "corrupted blood cannot" } },
	{ "poison", "au poison", { "immun.-poison", "cannot be poisoned", "of curing", "removes? .-poison" } },
	{ "shock", "à l'électrocution", { "immun.-shock", "cannot be shocked", "of grounding", "removes? .-shock" } },
	{ "ignite", "à l'embrasement", { "immun.-ignit", "cannot be ignited", "of dousing", "removes? .-burn", "removes? .-ignit" } },
}
for _, im in ipairs(IMMUNITIES) do
	table.insert(rules, {
		id = "survie.immune." .. im[1], category = "SURVIE", severity = im[1] == "freeze" and "ATTENTION" or "CONSEIL",
		title = "Pas d'immunité " .. im[2],
		triggerCondition = function(guide) return guide.isGuide and guide:has(im[3]) end,
		isFailing = function(stats, player, guide) return not player:has(im[3]), guide:find(im[3]) end,
		formatMessage = function(stats, impact, player, guide, src)
			return string.format("Le guide se protège %s (« %s »), toi non.%s", im[2], src or "?",
				im[1] == "freeze" and " Être gelé face à un boss, c'est souvent mourir." or "")
		end,
		fix = "Ajoute le suffixe de flasque correspondant (ou le mod du guide) : c'est un emplacement gratuit.",
	})
end

return rules
