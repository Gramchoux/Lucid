-- Famille D — Progression vs guide : ce qui sépare le joueur du build prévu à cette étape
-- (objets et passifs clés mesurés par PoB, ascendance, flasques).
local L = ...
local rules = { }

-- DPS très en dessous du guide
table.insert(rules, {
	id = "prog.dps", category = "DPS", severity = "CONSEIL",
	title = "DPS loin du guide",
	triggerCondition = function(guide) return guide.isGuide end,
	isFailing = function(stats, player, guide)
		-- on ne compare que des DPS de même nature : Full DPS des deux côtés, sinon sbires vs sbires,
		-- sinon compétence principale vs compétence principale (si c'est la même)
		local pk, gk = player.key, guide.key
		local m, g
		if (pk.FullDPS or 0) > 0 and (gk.FullDPS or 0) > 0 then m, g = pk.FullDPS, gk.FullDPS
		elseif player.mainSkill == guide.mainSkill and player.minion and guide.minion then m, g = player.minion.CombinedDPS or 0, guide.minion.CombinedDPS or 0
		elseif player.mainSkill == guide.mainSkill then m, g = pk.CombinedDPS or 0, gk.CombinedDPS or 0
		else return false end
		return g > 0 and m / g < 0.4, { g = g, m = m }
	end,
	formatMessage = function(stats, impact, player, guide, d)
		return string.format("Ton DPS (%s) est à %s de celui du guide (%s) dans les mêmes conditions. Les objets et passifs ci-dessous sont classés par gain réel.",
			L.n(d.m), L.pct(d.m / d.g * 100), L.n(d.g))
	end,
})

-- Objets du guide à fort impact (gain mesuré par PoB en mettant l'objet du guide dans ton build)
table.insert(rules, {
	id = "prog.keyitems", category = "DPS", severity = "ATTENTION",
	title = "Objet clé du guide",
	triggerCondition = function(guide, player) return guide.isGuide and player.compare.items ~= nil end,
	isFailing = function(stats, player)
		local best = { }
		for _, it in ipairs(player.compare.items or { }) do
			local h = it.head
			if h and ((h.dps or 0) >= 15 or (h.ehp or 0) >= 15) then table.insert(best, it) end
		end
		table.sort(best, function(a, b) return math.max(a.head.dps or 0, a.head.ehp or 0) > math.max(b.head.dps or 0, b.head.ehp or 0) end)
		return #best > 0, best
	end,
	calculateImpact = function(player, engine, best) return best[1].head end,
	formatMessage = function(stats, impact, player, guide, best)
		local parts = { }
		for i = 1, math.min(3, #best) do
			local it = best[i]
			table.insert(parts, string.format("%s en %s (%s)", it.name or "?", it.label or it.slot, L.impactText(it.head) or "?"))
		end
		return "Les objets du guide qui changent le plus ton build : " .. table.concat(parts, " ; ") .. "."
	end,
	fix = "Commence par le premier : c'est le meilleur rapport gain / effort mesuré sur ton perso.",
})

-- Keystones du guide non pris
table.insert(rules, {
	id = "prog.keystones", category = "MECANIQUE", severity = "ATTENTION",
	title = "Keystone du guide manquant",
	triggerCondition = function(guide) return guide.isGuide and #guide.keystones > 0 end,
	isFailing = function(stats, player, guide)
		local missing = { }
		for _, k in ipairs(guide.keystones) do if not player:hasKeystone(k) then table.insert(missing, k) end end
		return #missing > 0, missing
	end,
	calculateImpact = function(player, engine, missing)
		for _, n in ipairs(player.compare.toTake or { }) do
			if n.kind == "keystone" and n.name == missing[1] and n.head then return n.head end
		end
	end,
	formatMessage = function(stats, impact, player, guide, missing)
		local s = "Le guide repose sur " .. table.concat(missing, ", ") .. ", que tu n'as pas pris."
		local i = L.impactText(impact)
		if i then s = s .. " " .. missing[1] .. " seul : " .. i .. "." end
		return s
	end,
	fix = "Un keystone change la mécanique du build : prends-le avant les petits passifs.",
})

-- Ascendance en retard (labyrinthe)
table.insert(rules, {
	id = "prog.ascendancy", category = "DPS", severity = "CONSEIL",
	title = "Ascendance en retard",
	triggerCondition = function(guide) return guide.isGuide and #guide.ascNotables > 0 end,
	isFailing = function(stats, player, guide)
		local have = { }
		for _, n in ipairs(player.ascNotables) do have[n] = true end
		local missing = { }
		for _, n in ipairs(guide.ascNotables) do if not have[n] then table.insert(missing, n) end end
		return #missing > 0 and #player.ascNotables < #guide.ascNotables, missing
	end,
	formatMessage = function(stats, impact, player, guide, missing)
		return string.format("Tu as %d points d'ascendance notables, le guide %d à cette étape. Manquants : %s.",
			#player.ascNotables, #guide.ascNotables, table.concat(missing, ", "))
	end,
	fix = "Fais le prochain labyrinthe : niveau 33 (Normal), 55 (Cruel), 68 (Merciless), puis Eternal en maps.",
})

-- Mageblood : le guide l'a, pas toi. Ses flasques sont actives en permanence ; copiées sans lui, elles
-- se vident. L'enchantement « Gains no Charges during Effect » (Enkindling Orb) les bloque même à vide.
table.insert(rules, {
	id = "prog.mageblood", category = "SURVIE",
	severity = function(d) return #d.blocked > 0 and "CRITIQUE" or "CONSEIL" end,
	title = "Flasques prévues pour Mageblood",
	triggerCondition = function(guide, player) return guide.isGuide and guide:hasUnique("Mageblood") and not player:hasUnique("Mageblood") end,
	isFailing = function(stats, player)
		local blocked = { }
		for _, f in ipairs(player.flasks) do
			for _, l in ipairs(f.mods or { }) do
				if l:find("gains no charges during") then table.insert(blocked, f.name ~= "" and f.name or f.base) break end
			end
		end
		return true, { blocked = blocked }
	end,
	formatMessage = function(stats, impact, player, guide, d)
		local s = "Le guide porte Mageblood : ses flasques magiques restent actives en permanence. Sans lui, les tiennes durent quelques secondes et se vident."
		if #d.blocked > 0 then
			s = s .. " " .. table.concat(d.blocked, ", ") .. (#d.blocked > 1 and " ont" or " a") ..
				" « Gains no Charges during Effect » (enchantement Enkindling Orb ou mod de l'unique) : la flasque ne se recharge pas pendant son effet, elle sera vide quand tu en auras besoin."
		end
		return s
	end,
	fix = "En attendant Mageblood : enchante tes flasques à l'Instilling Orb (« Used when Charges reach full ») ou utilise-les à la main, et prends des mods de durée ou de recharge plutôt que d'effet.",
})

-- Flasques : emplacements vides ou pas de flasque de vie
table.insert(rules, {
	id = "prog.flasks", category = "SURVIE", severity = "CONSEIL",
	title = "Flasques incomplètes",
	triggerCondition = function(guide, player) return (player.level or 1) >= 12 end,
	isFailing = function(stats, player)
		local life = false
		for _, f in ipairs(player.flasks) do
			if (f.base or ""):find("Life Flask") or (f.base or ""):find("Hybrid Flask") or (f.name or ""):find("Life Flask") then life = true end
		end
		-- builds sans flasque de vie par conception : CI, low life, vie convertie ou ignorée
		local lowLife = player.cfg and player.cfg.conditionLowLife or ((player.key.LifeUnreservedPercent or 100) < 50)
		local noLifeOk = player.ci or lowLife or player:hasUnique("Coruscating Elixir")
			or player:hasKeystone("Dissolution of the Flesh") or player:hasKeystone("Divine Flesh") or player:hasKeystone("Eternal Youth")
		return #player.flasks < 5 or (not life and not noLifeOk), { n = #player.flasks, life = life or noLifeOk }
	end,
	formatMessage = function(stats, impact, player, guide, d)
		local s = string.format("Tu as %d flasque%s sur 5.", d.n, d.n > 1 and "s" or "")
		if not d.life then s = s .. " Aucune flasque de vie : c'est ta seule soin d'urgence." end
		return s
	end,
	fix = "Complète avec des flasques utilitaires (Quicksilver, Granite, Jade, Quartz…) et garde au moins une flasque de vie.",
})

return rules
