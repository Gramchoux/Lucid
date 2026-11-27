-- Lucid — données de dessin de l'arbre passif, préparées par PoB.
-- Le navigateur exécute la boucle de dessin de PassiveTreeView:Draw portée en JavaScript ; tout ce qui dépend
-- des données de PoB (sprites résolus, préfixes Abyss/Blight/bloodline, joyaux sertis, liaisons, couleurs de
-- comparaison, chemins…) est calculé ici, avec le code et les structures de PoB.

local t_insert = table.insert

local function isAbyssConquered(node)
	local conqueror = node and node.conqueredBy and node.conqueredBy.conqueror
	return conqueror and conqueror.type and conqueror.type:match("^abyss_")
end

local function rgbOf(r, g, b)
	if type(r) == "string" then
		local hex = r:match("^%^x(%x%x%x%x%x%x)")
		if hex then return { tonumber(hex:sub(1, 2), 16) / 255, tonumber(hex:sub(3, 4), 16) / 255, tonumber(hex:sub(5, 6), 16) / 255 } end
		return { 1, 1, 1 }
	end
	return { r or 1, g or 1, b or 1 }
end

function Bridge.treeScene(a)
	local build = main.modes["BUILD"]
	local spec = build.spec
	local tree = spec.tree
	local viewer = build.treeTab.viewer
	local cmp = Bridge._compareSpec(a.compare)
	viewer.compareSpec = cmp

	-- images et « assets » (handle + taille + coordonnées de texture, comme DrawAsset)
	local imgs, imgIdx, assets, assetIdx = { }, { }, { }, { }
	local function img(handle)
		if not handle or not handle.path then return nil end
		local i = imgIdx[handle.path]
		if not i then i = #imgs + 1 imgs[i] = handle.path imgIdx[handle.path] = i end
		return i
	end
	local function A(data)
		if not data or not data.handle then return nil end
		local k = assetIdx[data]
		if k then return k end
		if (data.width or 0) == 0 then data.width, data.height = data.handle:ImageSize() end
		local i = img(data.handle)
		if not i then return nil end
		t_insert(assets, { i, data.width, data.height, data[1] or 0, data[2] or 0, data[3] or 1, data[4] or 1 })
		assetIdx[data] = #assets
		return #assets
	end
	local rawAssets = { }
	local function H(handle)    -- image brute (anneaux…) : asset couvrant toute la texture
		if not handle then return nil end
		local d = rawAssets[handle]
		if not d then
			local w, h = handle:ImageSize()
			d = { handle = handle, width = w, height = h }
			rawAssets[handle] = d
		end
		return A(d)
	end

	-- fond et art de classe (même « hack » que PoB)
	local bg = tree.assets.Background2 or tree.assets.Background1
	local classBg = ({ { "BackgroundStr", -2750, 1600 }, { "BackgroundDex", 2550, 1600 }, { "BackgroundInt", -250, -2200 },
		{ "BackgroundStrDex", -150, 2350 }, { "BackgroundStrInt", -2100, -1500 }, { "BackgroundDexInt", 2350, -1950 } })[spec.curClassId]

	-- groupes
	local groups = { }
	local function addGroup(group, isExpansion, tint)
		local g = { x = group.x, y = group.y, tint = tint }
		if group.ascendancyName then
			if not group.isAscendancyStart then return end
			local sel = group.ascendancyName == spec.curAscendClassBaseName or (spec.curSecondaryAscendClass and group.ascendancyName == spec.curSecondaryAscendClass.id)
			g.a = A(tree.assets["Classes" .. group.ascendancyName])
			g.alpha = sel and 1 or 0.5
			if tree.classes[1] and tree.classes[1].ascendancies then
				local data, alt
				for _, class in ipairs(tree.classes) do
					for _, asc in ipairs(class.ascendancies) do
						if asc.id == group.ascendancyName then data = asc break end
					end
					if data then break end
				end
				if not data and tree.alternate_ascendancies then
					for _, asc in pairs(tree.alternate_ascendancies) do
						if asc.id == group.ascendancyName then data = asc alt = true break end
					end
				end
				if data and data.flavourTextRect then
					local rect = data.flavourTextRect
					local colour = data.flavourTextColour
					local col = "^x" .. colour
					if not sel then
						col = string.format("^x%02X%02X%02X", math.floor(tonumber(colour:sub(1, 2), 16) * 0.5),
							math.floor(tonumber(colour:sub(3, 4), 16) * 0.5), math.floor(tonumber(colour:sub(5, 6), 16) * 0.5))
					end
					g.ft = { col .. data.flavourText, rect.x - (alt and 744 or 650), rect.y - (alt and 706 or 650) }
				end
			end
		elseif group.oo[3] then
			g.a = A(tree.assets[isExpansion and "GroupBackgroundLargeHalfAlt" or "PSGroupBackground3"]) g.half = true
		elseif group.oo[2] then
			g.a = A(tree.assets[isExpansion and "GroupBackgroundMediumAlt" or "PSGroupBackground2"])
		elseif group.oo[1] then
			g.a = A(tree.assets[isExpansion and "GroupBackgroundSmallAlt" or "PSGroupBackground1"])
		else
			return
		end
		t_insert(groups, g)
	end
	for _, group in pairs(tree.groups) do
		if not group.isProxy then addGroup(group) end
	end
	for _, subGraph in pairs(spec.subGraphs) do addGroup(subGraph.group, true) end
	if cmp then
		for id, subGraph in pairs(cmp.subGraphs) do
			if not spec.subGraphs[id] then addGroup(subGraph.group, true, { 0, 1, 0, 0.6 }) end
		end
	end

	-- liaisons
	local split = spec.splitPersonalityPath or { }
	local connectors = { }
	local function addConnector(c)
		local n1, n2 = spec.nodes[c.nodeId1], spec.nodes[c.nodeId2]
		if not n1 or not n2 or not c.vert then return end
		local prefix = ""
		if isAbyssConquered(n1) and isAbyssConquered(n2) then prefix = "Abyss"
		elseif n1.isBlightcore or n2.isBlightcore then prefix = "Blight" end
		local e = { c.nodeId1, c.nodeId2, { }, { }, { c.c[9], c.c[10], c.c[11], c.c[12], c.c[13], c.c[14], c.c[15], c.c[16] },
			c.ascendancyName or 0, (split[n1.id] and split[n2.id]) and 1 or 0 }
		for i, state in ipairs({ "Normal", "Intermediate", "Active" }) do
			local v = c.vert[state] or c.vert.Normal
			e[3][i] = { v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8] }
			e[4][i] = A(tree.assets[prefix .. c.type .. state] or tree.assets[c.type .. state])
		end
		t_insert(connectors, e)
	end
	for _, c in pairs(tree.connectors) do addConnector(c) end
	for _, subGraph in pairs(spec.subGraphs) do
		for _, c in pairs(subGraph.connectors) do addConnector(c) end
	end

	-- nœuds
	local granted = build.calcsTab.mainEnv and build.calcsTab.mainEnv.grantedPassives or { }
	local splitCol = rgbOf(colorCodes.SPLITPERSONALITY or "^xFFFFFF")
	local nodes = { }
	for id, node in pairs(spec.nodes) do
		if node.x and node.y then
			local cnode = cmp and cmp.nodes[id] or nil
			local isAlloc = (node.alloc or granted[id] or (cnode and cnode.alloc)) and true or false
			local defaultColor = split[id] and (colorCodes.SPLITPERSONALITY or "^xFFFFFF") or "^xFFFFFF"
			local n = {
				id = id, x = node.x, y = node.y, t = node.type, rsq = node.rsq, size = node.size,
				asc = node.ascendancyName, alloc = node.alloc and true or nil, isAlloc = isAlloc or nil,
				col = rgbOf(viewer:GetCompareNodeColor(node, cnode, spec, build, defaultColor)),
				calloc = cnode and cnode.alloc and true or nil,
				mfx = node.masteryEffects and true or nil,
			}
			if node.path and not node.alloc then
				n.path = { }
				if #(node.intuitiveLeapLikesAffecting or { }) == 0 then
					for _, p in ipairs(node.path) do t_insert(n.path, p.id) end
				end
			end
			if node.depends and node.alloc then
				n.dep = { }
				for _, d in ipairs(node.depends) do t_insert(n.dep, d.id) end
			end
			if node.type == "ClassStart" then
				n.ov = A(tree.assets[isAlloc and node.startArt or "PSStartNodeBackgroundInactive"])
			elseif node.type == "AscendClassStart" then
				local ov = treeVersions[tree.treeVersion].num >= 3.10 and "AscendancyMiddle" or "PassiveSkillScreenAscendancyMiddle"
				local prefix = node.ascendancyName and tree.bloodlineSpritePrefixes and tree.bloodlineSpritePrefixes[node.ascendancyName]
				n.ov = A(tree.assets[(prefix or "") .. ov])
			elseif node.type == "Socket" then
				local socket, jewel = build.itemsTab:GetSocketAndJewelForNodeID(id)
				local alt = node.expansionJewel and not (isAlloc and jewel and jewel.base.subType == "Blightcore")
				local pre = node.name == "Charm Socket" and "Azmeri" or ""
				n.b = { }
				for _, st in ipairs({ "alloc", "path", "unalloc" }) do
					n.b[st] = A(tree.assets[pre .. (node.overlay[st .. (alt and "Alt" or "")] or "")])
				end
				if isAlloc and jewel then
					local name = viewer:GetJewelSocketOverlay(jewel, alt)
					n.ovj = name and A(tree.assets[name])
				end
			elseif node.type == "Mastery" then
				local override = spec.hashOverrides and spec.hashOverrides[id]
				local sprites = override and tree.spriteMap[override.icon]
				local fxs = override and tree.spriteMap[override.activeEffectImage]
				local ms = node.masterySprites
				if node.masteryEffects then
					n.b = {
						alloc = A((sprites and sprites.masteryActiveSelected) or (ms and ms.activeIcon and ms.activeIcon.masteryActiveSelected)),
						hover = A((sprites and sprites.masteryConnected) or (ms and ms.inactiveIcon and ms.inactiveIcon.masteryConnected)),
						unalloc = A((sprites and sprites.masteryInactive) or (ms and ms.inactiveIcon and ms.inactiveIcon.masteryInactive)),
					}
					n.fx = A((fxs and fxs.masteryActiveEffect) or (ms and ms.activeEffectImage and ms.activeEffectImage.masteryActiveEffect))
				else
					local m = A((sprites and sprites.mastery) or (node.sprites and node.sprites.mastery))
					n.b = { alloc = m, hover = m, unalloc = m }
				end
			else
				if node.isTattoo and node.effectSprites then n.fx = A(node.effectSprites.tattooActiveEffect) end
				n.base = A(node.sprites and node.sprites[node.type:lower() .. (isAlloc and "Active" or "Inactive")])
				n.ov = { }
				for _, st in ipairs({ "alloc", "path", "unalloc" }) do
					local name = node.overlay and node.overlay[st .. (node.ascendancyName and "Ascend" or "") .. (node.isBlighted and "Blighted" or "")]
					local frameState = st == "alloc" and "Allocated" or st == "path" and "CanAllocate" or "Unallocated"
					if isAbyssConquered(node) and (node.type == "Notable" or node.type == "Keystone") then
						local ab = "Abyss" .. (node.ascendancyName and "Ascendancy" or node.type) .. "Frame" .. frameState
						if tree.assets[ab] then name = ab end
					elseif node.isBlightcore and node.type == "Notable" and tree.assets["BlightNotableFrame" .. frameState] then
						name = "BlightNotableFrame" .. frameState
					end
					if node.ascendancyName and name then
						local prefix = node.bloodlineOverlayPrefix or (tree.bloodlineSpritePrefixes and tree.bloodlineSpritePrefixes[node.ascendancyName])
						if prefix then name = prefix .. name end
					end
					n.ov[st] = name and A(tree.assets[name])
				end
			end
			t_insert(nodes, n)
		end
	end

	-- anneaux des joyaux (drawJewelRadius de PoB)
	local radius = { }
	for i, r in ipairs(data.jewelRadius) do radius[i] = { r.inner, r.outer, rgbOf(r.col) } end
	local function ringSet(jewel, x, y)
		if isAbyssConquered(jewel.jewelData) or not jewel.jewelRadiusIndex then return nil end
		local rad = data.jewelRadius[jewel.jewelRadiusIndex]
		local o, inner = rad.outer, rad.inner * 1.06
		local function rot(h, size, angle, px, py) return { H(h), size, angle, px or x, py or y } end
		local v = viewer
		local title = jewel.title or ""
		if title:match("Impossible Escape") then
			local out = { }
			for name in pairs(jewel.jewelData.impossibleEscapeKeystones or { }) do
				local k = tree.keystoneMap[name]
				if k and k.x then
					t_insert(out, rot(v.jewelShadedOuterRing, o, -0.8, k.x, k.y))
					t_insert(out, rot(v.jewelShadedOuterRingFlipped, o, 1, k.x, k.y))
					t_insert(out, rot(v.jewelShadedInnerRing, 150, -1.2, k.x, k.y))
					t_insert(out, rot(v.jewelShadedInnerRingFlipped, 150, 1.0, k.x, k.y))
				end
			end
			return out
		end
		for pattern, pair in pairs({ ["^Brutal Restraint"] = { v.maraketh1, v.maraketh2 }, ["^Elegant Hubris"] = { v.eternal1, v.eternal2 },
			["^Glorious Vanity"] = { v.vaal1, v.vaal2 }, ["^Lethal Pride"] = { v.karui1, v.karui2 },
			["^Militant Faith"] = { v.templar1, v.templar2 }, ["^Heroic Tragedy"] = { v.kalguur1, v.kalguur2 } }) do
			if title:match(pattern) then return { rot(pair[1], o, -0.7), rot(pair[2], o, 0.7) } end
		end
		return { rot(v.jewelShadedOuterRing, o, -0.7), rot(v.jewelShadedOuterRingFlipped, o, 0.7),
			rot(v.jewelShadedInnerRing, inner, -0.7), rot(v.jewelShadedInnerRingFlipped, inner, 0.7) }
	end
	local sockets = { }
	for nodeId in pairs(tree.sockets) do
		local node = spec.nodes[nodeId]
		if node and node.name ~= "Charm Socket" and (not node.expansionJewel or node.expansionJewel.size == 2) then
			local _, jewel = build.itemsTab:GetSocketAndJewelForNodeID(nodeId)
			local cnode = cmp and cmp.nodes[nodeId]
			local cJewel = cmp and viewer:GetCompareJewel(nodeId) or nil
			local s = { id = nodeId, x = node.x, y = node.y, toh = ((jewel or cJewel) and (jewel or cJewel).jewelRadiusLabel == "Variable") or nil }
			if node.alloc or (cnode and cnode.alloc) then
				local same = (not jewel and not cJewel) or (jewel and cJewel and jewel:BuildRaw() == cJewel:BuildRaw())
				if jewel and jewel.jewelRadiusIndex then
					s.rings = ringSet(jewel, node.x, node.y)
					s.tint = (not cmp or same) and { 1, 1, 1, 0.7 } or { 1, 0, 0, 0.7 }
				end
				if cJewel and cJewel.jewelRadiusIndex and not same then
					s.crings = ringSet(cJewel, node.x, node.y)
				end
			end
			t_insert(sockets, s)
		end
	end

	if (bg.width or 0) == 0 then bg.width, bg.height = bg.handle:ImageSize() end
	return {
		size = tree.size, imgs = imgs, assets = assets,
		bg = A(bg), bgW = bg.width,
		classBg = classBg and { A(tree.assets[classBg[1]]), classBg[2], classBg[3] } or nil,
		groups = groups, connectors = connectors, nodes = nodes, sockets = sockets, radius = radius,
		ring = H(viewer.ring), highlight = H(viewer.highlightRing),
		curAsc = spec.curAscendClassBaseName,
		view = { zoomLevel = viewer.zoomLevel, zoomX = viewer.zoomX, zoomY = viewer.zoomY },
		edgeSearch = main.edgeSearchHighlight and true or false,
		showAnimations = main.showAnimations ~= false,
	}
end

-- Infobulle d'un nœud : AddNodeTooltip de PoB (et l'infobulle de compétence associée), rendue par PoB
function Bridge.treeTooltip(a)
	local build = main.modes["BUILD"]
	local viewer = build.treeTab.viewer
	viewer.compareSpec = Bridge._compareSpec(a.compare)
	local node = build.spec.nodes[tonumber(a.id)]
	if not node then viewer.compareSpec = nil; return { } end
	local tt = new("Tooltip"):Tooltip()
	viewer:AddNodeTooltip(tt, node, build)
	-- on garde l'effet et l'impact sur les stats ; les aides clavier propres à PoB (« Tip: Press Ctrl+C… ») n'ont
	-- pas de sens dans Lucid
	local kept = { }
	for _, l in ipairs(tt.lines) do
		local txt = l.text and StripEscapes(l.text) or nil
		if not (txt and txt:match("^%s*Tip:")) then table.insert(kept, l) end
	end
	-- séparateurs / lignes vides restés en fin d'infobulle
	while #kept > 0 and (not kept[#kept].text or StripEscapes(kept[#kept].text):match("^%s*$")) do table.remove(kept) end
	tt.lines = kept
	tt.center = true
	local out = { main = #tt.lines > 0 and Bridge._drawTooltip(tt, a.vh) or nil }
	if #viewer.skillTooltip.lines > 0 then
		viewer.skillTooltip.center = true
		out.skill = Bridge._drawTooltip(viewer.skillTooltip, a.vh)
	end
	return out
end

-- Recherche : même logique que PoB (searchStrResults calculés par PassiveTreeView)
function Bridge.treeSearch(a)
	local build = main.modes["BUILD"]
	local viewer = build.treeTab.viewer
	viewer.compareSpec = nil
	viewer.searchStr = a.str or ""
	__cursorX, __cursorY = -1, -1
	viewer:Draw(build, { x = 0, y = 0, width = 800, height = 600 }, { })   -- hors enregistrement : met à jour searchStrResults
	local ids = { }
	for id, hit in pairs(viewer.searchStrResults) do if hit then t_insert(ids, id) end end
	return { ids = ids }
end

return "ok"
