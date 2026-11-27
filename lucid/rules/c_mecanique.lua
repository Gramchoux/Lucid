-- Famille C — Mécanique : les prérequis qui empêchent le build de fonctionner en jeu
-- (attributs, mana, réservation, précision, gemmes du lien principal).
local L = ...
local rules = { }

-- Attributs manquants : en jeu, la gemme ou l'objet est désactivé
for _, a in ipairs({ { "Str", "Force" }, { "Dex", "Dextérité" }, { "Int", "Intelligence" } }) do
	table.insert(rules, {
		id = "meca.attr." .. a[1]:lower(), category = "MECANIQUE", severity = "CRITIQUE",
		title = a[2] .. " insuffisante",
		-- exigences ignorées (Supreme Ostentation…) : rien n'est désactivé en jeu
		triggerCondition = function(guide, player) return not player.ignoreAttrReq end,
		isFailing = function(stats, player)
			local have, req = player.key[a[1]] or 0, player.key["Req" .. a[1]] or 0
			return have < req, { have = have, req = req }
		end,
		formatMessage = function(stats, impact, player, guide, d)
			local src = player.reqSrc and player.reqSrc[a[1]]
			return string.format("Tu as %s en %s mais %s en demande %s : en jeu, il est désactivé (PoB, lui, le compte quand même).",
				L.n(d.have), a[2], src and ("« " .. src .. " »") or "une gemme ou un objet", L.n(d.req))
		end,
		fix = function(player, guide, d)
			return string.format("Il te manque %s points de %s : un +%s sur un anneau, l'amulette ou un passif d'attribut proche suffit.",
				L.n(d.req - d.have), a[2], a[1] == "Str" and "Strength" or a[1] == "Dex" and "Dexterity" or "Intelligence")
		end,
	})
end

-- Réservation : plus de vie ou de mana que disponible
table.insert(rules, {
	id = "meca.reservation", category = "MECANIQUE", severity = "CRITIQUE",
	title = "Réservation impossible",
	isFailing = function(stats, player)
		return (player.key.ManaUnreserved or 0) < 0 or ((player.key.Life or 0) > 1 and (player.key.LifeUnreserved or 1) < 1)
	end,
	formatMessage = function(stats, impact, player)
		return string.format("Tes auras réservent plus que ce que tu as : mana libre %s, vie libre %s. En jeu, tu ne pourras pas toutes les activer.",
			L.n(player.key.ManaUnreserved or 0), L.n(player.key.LifeUnreserved or 0))
	end,
	fix = "Ajoute de l'efficacité de réservation (passifs, Enlighten de bon niveau) ou retire une aura.",
})

-- Mana : budget calculé par PoB sur toutes les compétences (Bridge.manaBudget) —
-- la compétence qui fait le plus de dégâts (celle que tu spammes) + tous les sorts déclenchés, quelle qu'en soit la source.
local function trigLine(t)
	return string.format("%s %s/s (%s lancer%s/s%s)", t.name, L.n(t.perSec), L.n(t.rate, 2), t.rate >= 2 and "s" or "",
		t.by and (", via " .. t.by) or t.fromItem and (", via " .. t.fromItem:gsub(",.*", "")) or "")
end
local function castable(mb)
	local list = { }
	if mb.spam then table.insert(list, mb.spam) end
	for _, t in ipairs(mb.triggers) do table.insert(list, t) end
	return list
end

table.insert(rules, {
	id = "meca.mana.cast", category = "MECANIQUE", severity = "CRITIQUE",
	title = "Pas assez de mana pour lancer tes sorts",
	triggerCondition = function(guide, player) return player.mana ~= nil and not player.mana.eb end,
	isFailing = function(stats, player)
		local mb, over = player.mana, { }
		for _, r in ipairs(castable(mb)) do
			if r.cost > mb.pool then table.insert(over, r) end
		end
		return #over > 0, over
	end,
	formatMessage = function(stats, impact, player, guide, over)
		local t = { }
		for _, r in ipairs(over) do table.insert(t, string.format("%s coûte %s", r.name, L.n(r.cost))) end
		return string.format("Il ne te reste que %s mana non réservée (%s réservée par tes auras) : %s. En jeu, ce%s sort%s ne part%s pas.",
			L.n(player.mana.pool), L.pct(player.mana.reservedPct), table.concat(t, ", "),
			#over > 1 and "s" or "", #over > 1 and "s" or "", #over > 1 and "ent" or "")
	end,
	fix = "Retire une aura ou ajoute de l'efficacité de réservation, ou baisse le coût (Inspiration, Arcane Surge, mods « reduced Mana Cost »).",
})

-- Compétence principale sans dégâts (Dash, aura…) alors que le DPS global repose dessus (pas de « Full DPS ») :
-- tous les gains mesurés (objets, arbre) sont faux.
table.insert(rules, {
	id = "meca.mainskill", category = "MECANIQUE", severity = "CRITIQUE",
	title = "Ta compétence principale ne fait pas de dégâts",
	triggerCondition = function(guide, player)
		return player.mainCheck ~= nil and player.mainCheck.best ~= nil and (player.key.FullDPS or 0) <= 0
	end,
	isFailing = function(stats, player)
		local m = player.mainCheck
		return m.dps <= 0 and m.best.dps > 0 and m.best.name ~= m.name, m
	end,
	formatMessage = function(stats, impact, player, guide, m)
		return string.format("La compétence principale choisie est %s%s : elle ne fait aucun dégât, donc chaque gain de DPS mesuré (objets, passifs) est faux. Ta compétence qui fait le plus de dégâts est %s.",
			m.name or "?", m.movement and " (un déplacement)" or "", m.best.name)
	end,
	fix = "Choisis ta vraie compétence principale (page Gemmes de ton perso, ou les réglages de la comparaison) : Lucid la retient pour ce build.",
})

-- Salve : un déclencheur (Cast on Ward Break…) lance tous ses sorts au même moment ; chacun paie son coût.
-- Si la somme dépasse la mana libre, les derniers sorts ne partent pas, même réserve pleine.
table.insert(rules, {
	id = "meca.mana.burst", category = "MECANIQUE", severity = "ATTENTION",
	title = "Une salve de sorts déclenchés coûte plus que ta mana libre",
	triggerCondition = function(guide, player) return player.mana ~= nil and not player.mana.eb and #(player.mana.bursts or { }) > 0 end,
	isFailing = function(stats, player)
		for _, g in ipairs(player.mana.bursts) do
			if #g.fail > 0 and #g.fail < #g.spells then return true, g end   -- tout échoue : déjà couvert par meca.mana.cast
		end
		return false
	end,
	formatMessage = function(stats, impact, player, guide, g)
		return string.format("%s lance %d sorts d'un coup pour %s mana, mais tu n'en as que %s de libre : %s ne part%s pas.",
			g.by, #g.spells, L.n(g.cost), L.n(player.mana.pool), table.concat(g.fail, ", "), #g.fail > 1 and "ent" or "")
	end,
	fix = "Libère de la mana (moins de réservation), baisse le coût des sorts liés, ou retire du groupe le sort le moins utile.",
})

table.insert(rules, {
	id = "meca.mana.reserved", category = "MECANIQUE", severity = "ATTENTION",
	title = "Trop de mana réservée",
	triggerCondition = function(guide, player) return player.mana ~= nil and not player.mana.eb and player.mana.reservedPct > 0 end,
	isFailing = function(stats, player, guide)
		local mb = player.mana
		local top
		for _, r in ipairs(castable(mb)) do if r.cost > 0 and (not top or r.cost > top.cost) then top = r end end
		if not top or top.cost > mb.pool then return false end   -- impossible à lancer : règle précédente
		local casts = mb.pool / top.cost
		-- le guide garde-t-il plus de marge ? (sinon c'est le fonctionnement normal du build)
		local g = guide.isGuide and guide.mana
		local guideCasts
		if g and g.pool and (g.spam or (g.triggers and g.triggers[1])) then
			local gt = 0
			for _, r in ipairs(castable(g)) do if r.cost > gt then gt = r.cost end end
			guideCasts = gt > 0 and g.pool / gt or nil
		end
		return casts < 4 and (not guideCasts or guideCasts > casts * 1.5), { top = top, casts = casts, guideCasts = guideCasts }
	end,
	formatMessage = function(stats, impact, player, guide, d)
		local mb, res = player.mana, { }
		for i, r in ipairs(mb.reserved) do if i <= 4 then table.insert(res, r.name .. " " .. L.n(r.value)) end end
		local s = string.format("Tes auras réservent %s de ta mana (%s). Il te reste %s : à peine %s lancer%s de %s (%s mana) d'avance.",
			L.pct(mb.reservedPct), table.concat(res, ", "), L.n(mb.pool), L.n(math.floor(d.casts)), d.casts >= 2 and "s" or "", d.top.name, L.n(d.top.cost))
		if d.guideCasts then
			s = s .. string.format(" Le guide garde de quoi en lancer %s (%s réservé).", L.n(math.floor(d.guideCasts)), L.pct(guide.mana.reservedPct))
		end
		return s
	end,
	fix = "Compare tes auras à celles du guide : une aura en trop, un niveau de gemme différent ou un passif d'efficacité de réservation manquant.",
})

table.insert(rules, {
	id = "meca.mana.sustain", category = "MECANIQUE",
	severity = function(d) return d.secs < 3 and not d.guideToo and "CRITIQUE" or d.guideToo and "CONSEIL" or "ATTENTION" end,
	title = function(d) return d.guideToo and "Mana juste (le guide aussi)" or "Ta mana ne tient pas" end,
	triggerCondition = function(guide, player) return player.mana ~= nil and not player.mana.eb and player.mana.use > 0 end,
	isFailing = function(stats, player, guide)
		local mb = player.mana
		-- on tolère une pause : la réserve doit tenir au moins 8 s d'utilisation continue
		if not mb.secs or mb.secs >= 8 then return false end
		local g = guide.isGuide and guide.mana
		return true, { secs = mb.secs, guideToo = g and g.secs ~= nil and g.secs < 8 and g.secs <= mb.secs * 1.25 or false,
			guideSecs = g and g.secs, guideNet = g and g.net }
	end,
	formatMessage = function(stats, impact, player, guide, d)
		local mb, parts = player.mana, { }
		if mb.spam and mb.spam.perSec > 0 then
			table.insert(parts, string.format("%s %s/s (%s lancers/s, ta compétence la plus forte)", mb.spam.name, L.n(mb.spam.perSec), L.n(mb.spam.rate, 1)))
		end
		local s = string.format("En lançant %s en continu, tu dépenses %s mana/s. Tu en récupères %s/s (régénération %s%s%s). Ta réserve libre de %s est vide en %s s.",
			mb.spam and mb.spam.name or "ton sort", L.n(mb.use), L.n(mb.regen + mb.leech + (mb.recoup or 0)), L.n(mb.regen),
			mb.leech > 0 and (", vol " .. L.n(mb.leech)) or "", (mb.recoup or 0) > 0 and (", Recoup " .. L.n(mb.recoup)) or "",
			L.n(mb.pool), L.n(d.secs, 1))
		if d.guideToo then
			s = s .. string.format(" Le guide est dans le même cas (vide en %s s) : c'est voulu par le build, prévois une flasque de mana.", L.n(d.guideSecs, 1))
		elseif d.guideSecs == nil and guide.isGuide and guide.mana then
			s = s .. " Le guide, lui, tient en continu."
		end
		return s
	end,
	fix = function(player, guide, d)
		if d.guideToo then return "Garde une flasque de mana dans ta barre, ou ajoute de la régénération (Clarity, passifs)." end
		return "Regarde ce qui te manque par rapport au guide : régénération de mana, vol de mana, réduction de coût, ou un support de déclenchement en trop."
	end,
})

-- Précision des attaques
table.insert(rules, {
	id = "meca.accuracy", category = "DPS", severity = "ATTENTION",
	title = "Tu rates trop souvent",
	triggerCondition = function(guide, player) return player.flags.attack and not player:isMinionBuild() end,
	-- la précision ne compte que si tes propres coups font les dégâts : sur un build de sbires (même avec une
	-- attaque choisie comme compétence principale dans PoB), la perte mesurée est nulle → pas d'alerte
	dropIfNoImpact = true,
	isFailing = function(stats, player)
		-- build critique (souvent des déclenchements sur critique) : chaque coup raté coûte plus cher, seuil plus haut
		local h = player.key.HitChance or 100
		local crit = (player.key.CritChance or 0) >= 40
		return h < (crit and 95 or 90), h
	end,
	calculateImpact = function(player, engine)
		local i = engine:simulateMods("Hits can't be Evaded")
		if i then i.dps = i.dps and -i.dps * 100 / (100 + i.dps) end -- perte réelle par rapport au « toujours touché »
		return i and { dps = i.dps } or nil
	end,
	formatMessage = function(stats, impact, player, guide, h)
		local s = string.format("Ta chance de toucher est de %s : une attaque sur %s est esquivée.", L.pct(h), L.n(100 / math.max(1, 100 - h), 0))
		local i = impact and impact.dps and L.n(math.abs(impact.dps), 0)
		if i then s = s .. " Tu perds " .. i .. " % de ton DPS potentiel." end
		return s
	end,
	fix = "Ajoute de la précision (gants, casque, anneaux, Precision en aura) jusqu'à environ 95 % (100 % pour un build critique).",
})

-- Lien principal : on compare au groupe du guide qui contient la même compétence active
local function guideGroupOf(player, guide)
	local actives = { }
	for _, g in ipairs(player.mainGems) do if not g.support then actives[g.name] = true end end
	local gid
	for _, g in ipairs(guide.gems) do if not g.support and actives[g.name] then gid = g.group break end end
	if not gid then return nil end
	local out = { }
	for _, g in ipairs(guide.gems) do if g.group == gid then table.insert(out, g) end end
	return out
end

table.insert(rules, {
	id = "meca.mainlink", category = "DPS", severity = "ATTENTION",
	title = "Lien principal incomplet",
	triggerCondition = function(guide, player) return guide.isGuide and #player.mainGems > 0 end,
	isFailing = function(stats, player, guide)
		local group = guideGroupOf(player, guide)
		if not group then return false end

		-- Compte uniquement les gemmes de soutien de chaque côté
		local guideSup, mySup = 0, 0
		local missing = { }
		for _, g in ipairs(group) do
			if g.support then
				guideSup = guideSup + 1
				if not player:hasGem(g.name) then table.insert(missing, g.name) end
			end
		end
		for _, g in ipairs(player.mainGems) do
			if g.support then mySup = mySup + 1 end
		end

		-- On ne déclenche l'alerte QUE si tu as strictement moins de supports que le guide
		-- (si tu as le même nombre de supports avec un nom différent, c'est déjà géré dans l'onglet Gemmes)
		if mySup >= guideSup then return false end

		return true, { missing = missing, myLinks = mySup + 1, guideLinks = guideSup + 1 }
	end,
	formatMessage = function(stats, impact, player, guide, d)
		local missTxt = #d.missing > 0 and (" Supports manquants : " .. table.concat(d.missing, ", ") .. ".") or ""
		return string.format("Ta compétence principale (%s) tourne avec %d gemmes (%d supports), contre %d (%d supports) dans le guide.%s",
			player.mainSkill or "?", d.myLinks, d.myLinks - 1, d.guideLinks, d.guideLinks - 1, missTxt)
	end,
	fix = "Ajoute un support actif : s'il s'agit d'un objet classique, relie les châsses (Fusing) ; si la compétence est donnée par un objet (ex: Chains of Command), remplace simplement une gemme inutile dans une châsse libre.",
})

-- Gemme principale sous-niveau ou sans qualité
table.insert(rules, {
	id = "meca.gemlevel", category = "DPS", severity = "CONSEIL",
	title = "Gemmes principales en retard",
	triggerCondition = function(guide) return guide.isGuide end,
	isFailing = function(stats, player, guide)
		local late = { }
		for _, g in ipairs(guideGroupOf(player, guide) or { }) do
			local m = player:hasGem(g.name)
			if m and ((m.level or 1) <= (g.level or 1) - 3 or ((m.quality or 0) == 0 and (g.quality or 0) >= 20)) then
				table.insert(late, string.format("%s %d/%d %% (guide %d/%d %%)", g.name, m.level or 1, m.quality or 0, g.level or 1, g.quality or 0))
			end
		end
		return #late > 0, late
	end,
	formatMessage = function(stats, impact, player, guide, late)
		return "Niveau / qualité en retard sur ton lien principal : " .. table.concat(late, " ; ") .. "."
	end,
	fix = "Monte les gemmes en retard (Gemcutter's Prism pour la qualité, gemmes de rechange en arme secondaire pour les niveaux).",
})

-- Gemmes que le guide garde volontairement à bas niveau (et que le joueur a montées)
-- Raisons habituelles : niveau de Cast when Damage Taken (il limite le niveau des sorts déclenchés),
-- réservation ou coût en mana plus bas, prérequis d'attributs.
table.insert(rules, {
	id = "meca.gemlow", category = "MECANIQUE", severity = "ATTENTION",
	title = "Gemmes que le guide garde à bas niveau",
	triggerCondition = function(guide) return guide.isGuide end,
	isFailing = function(stats, player, guide)
		local out, seen = { }, { }
		for _, g in ipairs(guide.gems or { }) do
			local key = g.name:lower()
			if not seen[key] and (g.level or 20) <= 5 and (g.maxLevel or 20) >= 20 then
				local m = player:hasGem(g.name)
				if m and (m.level or 1) >= (g.level or 1) + 5 then
					seen[key] = true
					local why
					if key == "cast when damage taken" then why = "il limite le niveau des sorts qu'il déclenche ; trop haut, il ne déclenche plus rien en dessous du seuil de dégâts"
					else
						for _, t in ipairs(g.tags or { }) do
							if t == "aura" or t == "herald" then why = "réserve moins de mana à bas niveau" break end
						end
						-- gemme liée à Cast when Damage Taken dans le guide
						if not why then
							for _, x in ipairs(guide.gems) do
								if x.group == g.group and x.name:lower() == "cast when damage taken" then why = "déclenchée par Cast when Damage Taken, son niveau doit rester sous celui de CWDT" break end
							end
						end
					end
					table.insert(out, { name = g.name, guide = g.level, mine = m.level, why = why or "coût en mana ou prérequis plus bas" })
				end
			end
		end
		return #out > 0, out
	end,
	formatMessage = function(stats, impact, player, guide, out)
		local parts = { }
		for _, x in ipairs(out) do
			table.insert(parts, string.format("%s niveau %d chez toi, %d dans le guide (%s)", x.name, x.mine, x.guide, x.why))
		end
		return "Le guide garde ces gemmes à bas niveau exprès : " .. table.concat(parts, " ; ") .. "."
	end,
	fix = "Remplace-les par une gemme du niveau du guide (achat chez un vendeur, ou gemme de niveau 1 montée seulement jusqu'au niveau voulu).",
})

-- Auras / heralds / malédictions du guide absentes
table.insert(rules, {
	id = "meca.auras", category = "DPS", severity = "ATTENTION",
	title = "Auras ou malédictions du guide absentes",
	triggerCondition = function(guide) return guide.isGuide end,
	isFailing = function(stats, player, guide)
		local missing, seen = { }, { }
		for _, tag in ipairs({ "aura", "herald", "curse", "warcry", "guard" }) do
			for _, g in ipairs(guide:gemsTagged(tag)) do
				if not g.support and not seen[g.name] and not player:hasGem(g.name) then
					seen[g.name] = true
					table.insert(missing, g.name)
				end
			end
		end
		return #missing > 0, missing
	end,
	formatMessage = function(stats, impact, player, guide, missing)
		return "Le guide utilise " .. table.concat(missing, ", ") .. " ; toi non. Ces gemmes donnent un bonus permanent que tes autres gemmes ne compensent pas."
	end,
	fix = "Ajoute-les dans des liens libres (casque, bottes, gants) dès que ta réservation le permet.",
})

return rules
