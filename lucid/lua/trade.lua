-- Lucid — recherches trade intelligentes, construites par le générateur de PoB (Classes/TradeQueryGenerator).
-- PoB teste chaque mod possible de l'emplacement sur le build et en déduit un poids (gain DPS / EHP réel) :
-- on obtient une recherche « somme pondérée » qui ne retient que les stats utiles au build.
-- Lucid ajoute l'ancrage sur l'objet du guide : seuil = valeur de l'objet du guide hors mods craftés,
-- et exigence d'affixes libres pour pouvoir re-crafter ces mods par-dessus.

local t_insert = table.insert
local NULL = require("dkjson").null

local function B() return main.modes["BUILD"] end

local function norm(line)
	line = StripEscapes(line or ""):lower()
	line = line:gsub("%(%-?[%d%.]+%-%-?[%d%.]+%)", "#"):gsub("%-?[%d%.]+", "#")
	return (line:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- Préfixe ou suffixe d'un mod crafté (table des crafts du banc de PoB)
local craftIndex
local function craftAffix(line)
	if not craftIndex then
		craftIndex = { }
		for _, m in ipairs(data.masterMods or { }) do
			for _, l in ipairs(m) do
				if type(l) == "string" then craftIndex[norm(l)] = m.type end
			end
		end
	end
	return craftIndex[norm(line)]
end

local function newItem(raw)
	local item = new("Item"):Item(raw)
	if not item.base then error("Objet non reconnu par PoB", 0) end
	item:NormaliseQuality()
	item:BuildModList()
	return item
end

-- Lignes de mods d'un objet (explicites, implicites…), avec l'indication « crafté »
local function modLinesOf(item)
	local out = { }
	for _, list in ipairs({ item.implicitModLines, item.explicitModLines, item.scourgeModLines, item.crucibleModLines }) do
		for _, ml in ipairs(list or { }) do
			if item:CheckModLineVariant(ml) then t_insert(out, ml) end
		end
	end
	return out
end

-- a = { slot, guideRaw (facultatif), league } → recherches prêtes à ouvrir sur le site trade
function Bridge.tradeQuery(a)
	local build = B()
	local tab = build.itemsTab
	local slot = tab.slots[a.slot]
	if not slot then error("Emplacement inconnu : " .. tostring(a.slot), 0) end
	local guideItem = a.guideRaw and a.guideRaw ~= NULL and newItem(a.guideRaw) or nil
	local current = tab.items[slot.selItemId]
	local out = { slot = a.slot, searches = { } }
	-- objet qui donne une compétence (Chains of Command…) : un objet rare « meilleur en stats » ferait perdre
	-- la compétence ; la recherche d'upgrade n'a pas de sens
	local grants
	if current and current.grantedSkills and #current.grantedSkills > 0 then
		local names = { }
		for _, gs in ipairs(current.grantedSkills) do
			local n = data.skills[gs.skillId] and data.skills[gs.skillId].name
			if n and not names[n] then names[n] = true; t_insert(names, n) end
		end
		grants = table.concat(names, ", ")
		out.grants = grants
	end

	-- Objet unique dans le guide : on cherche cet unique (le moins cher d'abord)
	if guideItem and (guideItem.rarity == "UNIQUE" or guideItem.rarity == "RELIC") then
		t_insert(out.searches, {
			kind = "unique", title = "Le même unique que le guide",
			why = "Un unique a toujours les mêmes mods : seul le prix compte. Tri du moins cher au plus cher.",
			query = {
				query = { status = { option = "available" }, name = StripEscapes(guideItem.title or guideItem.name), type = guideItem.baseName,
					filters = { type_filters = { filters = { rarity = { option = "unique" } } } } },
				sort = { price = "asc" },
			},
		})
		return out
	end

	-- Statistiques utiles : celles que PoB juge importantes pour ce build
	local output = build.calcsTab.mainOutput or { }
	-- survie : les 5 coups max encaissables (Max Hit), pas l'EHP de PoB (gonflé par le blocage)
	local function hits(mult)
		local w = { }
		for _, t in ipairs({ "Physical", "Fire", "Cold", "Lightning", "Chaos" }) do
			table.insert(w, { stat = t .. "MaximumHitTaken", weightMult = mult / 5 })
		end
		return w
	end
	local weights = { { stat = "FullDPS", weightMult = 1.0 } }
	for _, w in ipairs(hits(0.5)) do table.insert(weights, w) end
	if not (output.FullDPS and output.FullDPS > 0) and output.Minion then
		-- build de sbires sans « Full DPS » : la défense guide la recherche, les dégâts des sbires passent par les gemmes
		weights = hits(1.0)
	end

	-- Le générateur de PoB (sans son interface : popup neutralisée, coroutine déroulée d'un coup)
	local gen = new("TradeQueryGenerator"):TradeQueryGenerator({ itemsTab = tab })
	gen.tradeTypeIndex = 2 -- « available »
	local query, genErr
	gen.requesterCallback = function(_, q, e) query, genErr = q, e end
	local open, close = main.OpenPopup, main.ClosePopup
	-- la base testée par PoB est celle de l'objet en place : on prend celle du guide si l'emplacement est vide
	local restoreSel
	if not current and guideItem then
		local tmpId = 1
		while tab.items[tmpId] do tmpId = tmpId + 1 end
		tab.items[tmpId] = guideItem
		restoreSel = slot.selItemId
		slot.selItemId = tmpId
		guideItem.id = tmpId
	end
	local ok, err = pcall(function()
		main.OpenPopup = function() return { } end
		main.ClosePopup = function() end
		-- implicites Eldritch (Exarch / Eater) pris en compte, sans les variantes « présence de boss »
		gen:StartQuery(slot, { statWeights = weights, includeCorrupted = false, includeMirrored = false, includeScourge = false,
			includeTalisman = false, includeEldritch = "Keep regular", jewelType = "Base" })
		local guard = 0
		while gen.calcContext and gen.calcContext.co and guard < 1000000 do
			gen:OnFrame()
			guard = guard + 1
		end
	end)
	main.OpenPopup, main.ClosePopup = open, close
	if restoreSel then
		tab.items[slot.selItemId] = nil
		slot.selItemId = restoreSel
		guideItem.id = nil
	end
	if not ok then error(err, 0) end
	if genErr or not query then error(genErr or "PoB n'a pas pu générer la recherche", 0) end

	-- Valeur d'un objet selon les mêmes poids que la recherche (même méthode que PoB pour « ton objet »)
	local ctx = gen.calcContext
	local function valueOf(item, skipCrafted)
		local t = new("Item"):Item("Rarity: RARE\nStat Tester\n" .. (ctx.testItem.baseName or item.baseName))
		t.explicitModLines = { }
		for _, ml in ipairs(modLinesOf(item)) do
			if not (skipCrafted and ml.crafted) then t_insert(t.explicitModLines, ml) end
		end
		t:BuildAndParseRaw()
		local o = ctx.calcFunc({ repSlotName = slot.slotName, repItem = t })
		return gen.WeightedRatioOutputs(ctx.baseOutput, o, ctx.options.statWeights) * 1000 - (ctx.baseStatValue or 0)
	end

	-- poids lisibles : les stats que la recherche valorise le plus
	local textOf = { }
	for _, group in pairs(gen.modData or { }) do
		if type(group) == "table" then
			for _, e in pairs(group) do
				if type(e) == "table" and e.tradeMod and e.tradeMod.id then textOf[e.tradeMod.id] = e.tradeMod.text end
			end
		end
	end
	local top, best = { }, nil
	for i, w in ipairs(gen.modWeights or { }) do
		if i > 8 then break end
		best = best or w.meanStatDiff
		t_insert(top, { text = textOf[w.tradeModId] or w.tradeModId, share = best and best > 0 and (w.meanStatDiff / best * 100) or nil })
	end
	out.topStats = top

	local weightGroup = query.stats[1]
	local function clone(t)
		if type(t) ~= "table" then return t end
		local r = { }
		for k, v in pairs(t) do r[k] = clone(v) end
		return r
	end
	local function withMin(min, extra)
		local q = clone(query)
		q.stats[1].value = { min = math.floor(min * 10 + 0.5) / 10 }
		-- les filtres en plus remplacent les derniers poids (budget de complexité du site)
		for _, f in ipairs(extra or { }) do
			table.remove(q.stats[1].filters)
			t_insert(q.stats[2].filters, f)
		end
		return { query = q, sort = { ["statgroup.0"] = "desc" } }
	end

	local curValue = current and valueOf(current, false) or 0
	out.currentValue = curValue

	if guideItem then
		-- mods craftés du guide : on ne les exige pas, on exige la place pour les re-crafter
		local crafted, pre, suf = { }, 0, 0
		for _, ml in ipairs(modLinesOf(guideItem)) do
			if ml.crafted then
				local aff = craftAffix(ml.line)
				local shown = ml.range and itemLib.applyRange(ml.line, ml.range, ml.valueScalar) or ml.line
				t_insert(crafted, { line = StripEscapes(shown), affix = aff })
				if aff == "Prefix" then pre = pre + 1 elseif aff == "Suffix" then suf = suf + 1 end
			end
		end
		local guideFull = valueOf(guideItem, false)
		local guideBase = valueOf(guideItem, true)
		out.guideValue, out.guideBaseValue, out.crafted = guideFull, guideBase, crafted
		-- ton objet vaut déjà autant que celui du guide (hors craft) pour ton build ?
		out.currentBetter = current ~= nil and curValue >= guideBase * 0.95
		local extra = { }
		if pre > 0 then t_insert(extra, { id = "pseudo.pseudo_number_of_empty_prefix_mods", value = { min = pre } }) end
		if suf > 0 then t_insert(extra, { id = "pseudo.pseudo_number_of_empty_suffix_mods", value = { min = suf } }) end
		if #crafted > 0 and pre + suf < #crafted then
			t_insert(extra, { id = "pseudo.pseudo_number_of_empty_affix_mods", value = { min = #crafted - pre - suf } })
		end
		t_insert(out.searches, {
			kind = "guide", title = "Proche de l'objet du guide",
			why = #crafted > 0
				and string.format("Au moins 85 %% de la valeur de l'objet du guide hors craft, avec %s libre%s pour re-crafter : %s.",
					#crafted > 1 and (#crafted .. " affixes") or "1 affixe", #crafted > 1 and "s" or "", table.concat((function()
						local l = { } for _, c in ipairs(crafted) do t_insert(l, c.line) end return l end)(), " ; "))
				or "Au moins 85 % de la valeur de l'objet du guide pour ton build, toutes stats utiles confondues.",
			query = withMin(math.max(guideBase * 0.85, 0.1), extra),
		})
		if grants then
			out.searches[#out.searches].why = out.searches[#out.searches].why .. " Attention : l'objet que tu portes donne " .. grants .. ", que ces objets n'ont pas."
		end
		if guideItem.rarity ~= "UNIQUE" and guideItem.baseName then
			local q = withMin(math.max(guideBase * 0.85, 0.1), extra)
			q.query.type = guideItem.baseName
			t_insert(out.searches, {
				kind = "base", title = "Même base que le guide (" .. guideItem.baseName .. ")",
				why = "Même recherche, limitée à la base du guide (défenses, implicite et prérequis identiques).",
				query = q,
			})
		end
	end
	-- palier intermédiaire : à mi-chemin entre ton objet et celui du guide, quand l'écart est grand
	-- (début de maps contre équipement de fin de jeu : la recherche « proche du guide » serait hors de prix)
	if current and not grants and out.guideBaseValue then
		local low, high = math.max(curValue * 1.1, 0.1), out.guideBaseValue * 0.85
		local mid = curValue + (out.guideBaseValue - curValue) * 0.5
		if mid > low * 1.5 and mid < high then
			local q = withMin(mid)
			t_insert(out.searches, #out.searches + 1, {
				kind = "mid", title = "Palier intermédiaire",
				why = "À mi-chemin entre ton objet et celui du guide pour ton build : un vrai gain, bien moins cher que l'objet du guide.",
				query = q,
			})
		end
	end
	-- Recherche « en clair » : les mods de l'objet du guide en filtres du site (au moins 80 % de chaque valeur),
	-- résistances regroupées en totaux (pseudo), liens / châsses abyssales repris. C'est ce qu'on remplirait à la main.
	if guideItem and guideItem.rarity ~= "UNIQUE" and guideItem.rarity ~= "RELIC" then
		local ok2, s2 = pcall(function()
			-- index des mods du site connus de PoB pour cet emplacement : texte sans chiffres ni signes → identifiant
			local idx = { }
			local function key(t) return (t:gsub("[#()0-9%-%+%.]", ""):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")):lower() end
			for modType, group in pairs(gen.modData or { }) do
				if type(group) == "table" then
					for _, e in pairs(group) do
						if type(e) == "table" and e.tradeMod and e.tradeMod.id and e.tradeMod.text then
							local k = key(e.tradeMod.text)
							idx[modType] = idx[modType] or { }
							if not idx[modType][k] then idx[modType][k] = e.tradeMod.id end
						end
					end
				end
			end
			local function lookup(modType, line)
				local g = idx[modType] or { }
				return g[key(line .. " (Local)")] or g[key(line)]
			end
			local filters, shown = { }, { }
			local ele, chaos = 0, 0
			local function nums(line)
				local l = { }
				for n in line:gmatch("%-?%d+%.?%d*") do t_insert(l, tonumber(n)) end
				return l
			end
			local function addLines(list, modType)
				for _, ml in ipairs(list or { }) do
					if guideItem:CheckModLineVariant(ml) and not ml.crafted then
						local line = StripEscapes(ml.range and itemLib.applyRange(ml.line, ml.range, ml.valueScalar) or ml.line)
						local v = nums(line)
						local low = line:lower()
						-- résistances : regroupées en totaux, comme on les cherche vraiment
						local r = v[1]
						if r and low:match("to all elemental resistances") then ele = ele + 3 * r
						elseif r and low:match("resistances?$") and low:match("^%+?%-?%d+%% to ") then
							local n = 0
							for _, e in ipairs({ "fire", "cold", "lightning" }) do if low:match(e) then n = n + 1 end end
							ele = ele + n * r
							if low:match("chaos") then chaos = chaos + r end
						else
							local id = v[1] and lookup(modType, line)
							if id then
								-- « Adds # to # » : le site compare la moyenne des deux valeurs
								local val = (#v >= 2 and line:match("%d+ to %d+")) and (v[1] + v[2]) / 2 or v[1]
								local min = val >= 0 and math.floor(val * 0.8) or nil
								if min and min > 0 then
									t_insert(filters, { id = id, value = { min = min } })
									t_insert(shown, string.format("%s (min. %s)", line, min))
								elseif not min then
									t_insert(filters, { id = id })
									t_insert(shown, line)
								end
							end
						end
					end
				end
			end
			addLines(guideItem.implicitModLines, "Implicit")
			addLines(guideItem.explicitModLines, "Explicit")
			if ele > 0 then
				t_insert(filters, { id = "pseudo.pseudo_total_elemental_resistance", value = { min = math.floor(ele * 0.8) } })
				t_insert(shown, string.format("Résistances élémentaires : +%d%% au total (min. %d)", ele, math.floor(ele * 0.8)))
			end
			if chaos > 0 then
				t_insert(filters, { id = "pseudo.pseudo_total_chaos_resistance", value = { min = math.floor(chaos * 0.8) } })
				t_insert(shown, string.format("Résistance au chaos : +%d%% (min. %d)", chaos, math.floor(chaos * 0.8)))
			end
			if #filters == 0 then return nil end
			local q = {
				query = { status = { option = "available" }, type = guideItem.baseName,
					stats = { { type = "and", filters = filters } },
					filters = { type_filters = { filters = { rarity = { option = "nonunique" } } } } },
				sort = { price = "asc" },
			}
			-- liens et châsses : 5L / 6L exigés comme sur l'objet du guide
			local links = 0
			if guideItem.sockets then
				local groups = { }
				for _, so in ipairs(guideItem.sockets) do groups[so.group] = (groups[so.group] or 0) + 1 end
				for _, c in pairs(groups) do links = math.max(links, c) end
			end
			if links >= 5 then
				q.query.filters.socket_filters = { filters = { links = { min = links } } }
				t_insert(shown, links .. " liens")
			end
			return { kind = "mods", title = "Mêmes stats que l'objet du guide (" .. (guideItem.baseName or "même base") .. ")",
				why = "Chaque stat de l'objet du guide, à au moins 80 % de sa valeur (résistances en total), le moins cher d'abord : " .. table.concat(shown, " · ") .. ".",
				query = q, chips = shown }
		end)
		if ok2 and s2 then t_insert(out.searches, 1, s2) end
	end
	if current and not grants then
		t_insert(out.searches, {
			kind = "upgrade", title = "Meilleur que ton objet actuel",
			why = "Au moins 10 % de mieux que ton objet actuel selon ton build : un upgrade à petit prix.",
			query = withMin(math.max(curValue * 1.1, 0.1)),
		})
	end
	return out
end
