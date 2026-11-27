-- Lucid — pont entre l'interface et le moteur Path of Building.
-- Chaque fonction Bridge.xxx(args) reçoit une table et renvoie une table (sérialisée en JSON).
-- Tous les calculs passent par le moteur PoB (calcs.getMiscCalculator), rien n'est réimplémenté.

local dkjson = require("dkjson")
local t_insert = table.insert

Bridge = { }

local NULL = dkjson.null

local function strip(s)
	if type(s) ~= "string" then return s end
	return StripEscapes(s)
end

local function B() return main.modes["BUILD"] end

-- (copie de la fonction locale de Modules/Build.lua)
local function matchFlags(reqFlags, notFlags, flags)
	if type(reqFlags) == "string" then reqFlags = { reqFlags } end
	if reqFlags then
		for _, flag in ipairs(reqFlags) do if not flags[flag] then return end end
	end
	if type(notFlags) == "string" then notFlags = { notFlags } end
	if notFlags then
		for _, flag in ipairs(notFlags) do if flags[flag] then return end end
	end
	return true
end

local function frame()
	runCallback("OnFrame")
	if launch.promptMsg then
		local msg = launch.promptMsg
		launch.promptMsg = nil
		error(strip(msg), 0)
	end
end

-- Nombre JSON-safe (pas d'inf/nan)
local function num(v)
	if type(v) ~= "number" then return nil end
	if v ~= v then return nil end
	if v == math.huge then return 1e300 end
	if v == -math.huge then return -1e300 end
	return v
end

------------------------------------------------------------------------ dispatch
function Bridge.dispatch(cmd, argsJson)
	local args = dkjson.decode(argsJson) or { }
	local f = Bridge[cmd]
	if not f then return dkjson.encode({ __error = "commande inconnue: " .. tostring(cmd) }) end
	local ok, res = xpcall(function() return f(args) end, debug.traceback)
	if not ok then return dkjson.encode({ __error = tostring(res) }) end
	return dkjson.encode(res == nil and { } or res)
end

function Bridge.ping()
	return { ok = true, version = launch.versionNumber, tree = latestTreeVersion }
end

------------------------------------------------------------------------ codes
function Bridge.decode(a)
	local code = (a.code or ""):gsub("%s", "")
	local xmlText = Inflate(common.base64.decode(code:gsub("-", "+"):gsub("_", "/")))
	if not xmlText or not xmlText:match("<PathOfBuilding") then
		error("Code de build invalide", 0)
	end
	return { xml = xmlText }
end

function Bridge.encode(a)
	local xmlText = a.xml or B():SaveDB("code")
	return { code = (common.base64.encode(Deflate(xmlText)):gsub("+", "-"):gsub("/", "_")) }
end

function Bridge.sites()
	local out = { }
	for _, s in ipairs(buildSites.websiteList) do
		t_insert(out, { label = s.label, regex = s.regexURL, download = s.downloadURL })
	end
	return out
end

-- Résout une URL de site de builds vers l'URL de téléchargement du code brut
function Bridge.resolveUrl(a)
	local url = a.url or ""
	for _, s in ipairs(buildSites.websiteList) do
		if url:match(s.regexURL) then
			local dl = url:gsub(".-" .. s.regexURL, s.downloadURL)
			return { site = s.label, url = "https://" .. dl }
		end
	end
	return { }
end

------------------------------------------------------------------------ load
function Bridge.load(a)
	Bridge._gates = nil  -- conditions réalistes : propres au build chargé
	main:SetMode("BUILD", false, a.name or "Build", a.xml, true)
	frame()
	local build = B()
	if not build.calcsTab or not build.calcsTab.mainOutput then
		error("Le build n'a pas pu être chargé", 0)
	end
	-- un 2e frame pour stabiliser (Full DPS, minions…)
	frame()
	return Bridge.snapshot({ })
end

-- Import d'un personnage depuis le JSON de l'API GGG (même chemin que l'onglet Import de PoB)
function Bridge.importCharacter(a)
	local char = a.char
	if type(char) ~= "table" or not char.passives then error("Données de personnage incomplètes", 0) end
	char.equipment = char.equipment or { }
	char.jewels = char.jewels or { }
	char.league = char.league or "Standard"
	char.passives.hashes = char.passives.hashes or { }
	char.passives.hashes_ex = char.passives.hashes_ex or { }
	char.passives.mastery_effects = char.passives.mastery_effects or { }
	char.passives.jewel_data = char.passives.jewel_data or { }
	main:SetMode("BUILD", false, a.name or char.name or "Personnage")
	frame()
	local build = B()
	local imp = build.importTab
	imp:ImportPassiveTreeAndJewels(char, true)
	imp:ImportItemsAndSkills(char, true, true, false)
	build.mainSocketGroup = imp:GuessMainSocketGroup()
	build.buildFlag = true
	frame()
	frame()
	return { xml = build:SaveDB("code") }
end

local function recalc()
	local build = B()
	-- deux passes, comme au chargement : après un changement de jeu (étape), une seule passe laisse des stats
	-- non stabilisées (ex. EHP −6,7 % à l'étape 22 du guide Animate Guardian)
	build.buildFlag = true
	frame()
	build.buildFlag = true
	frame()
end

------------------------------------------------------------------------ stats
local function statList(build, output, actor, list)
	local out = { }
	local flags = actor and actor.mainSkill and actor.mainSkill.skillFlags or { }
	for _, sd in ipairs(list) do
		if sd.stat and matchFlags(sd.flag, sd.notFlag, flags) then
			local v = output[sd.stat]
			if v ~= nil and sd.childStat and type(v) == "table" then v = v[sd.childStat] end
			if type(v) == "number" then
				local show = true
				if sd.condFunc then
					local ok, r = pcall(sd.condFunc, v, output)
					show = ok and r and true or false
				end
				if show then
					t_insert(out, {
						key = sd.stat .. (sd.childStat and ("." .. sd.childStat) or ""),
						label = strip(sd.label or sd.stat),
						value = num(v),
						fmt = sd.fmt or "d",
						pc = (sd.pc or sd.mod) and true or nil,
						mod = sd.mod and true or nil,
						lower = sd.lowerIsBetter and true or nil,
						compact = sd.compactValue and true or nil,
						comp = sd.compPercent and true or nil,
					})
				end
			end
		end
	end
	return out
end

local KEY_OUTPUT = {
	"TotalDPS", "CombinedDPS", "FullDPS", "TotalDot", "TotalDotDPS", "WithBleedDPS", "WithIgniteDPS", "WithPoisonDPS",
	"AverageHit", "Speed", "CritChance", "CritMultiplier", "HitChance",
	"Life", "LifeUnreserved", "EnergyShield", "Mana", "ManaUnreserved", "Ward", "TotalEHP",
	"Armour", "Evasion", "MeleeEvadeChance", "ProjectileEvadeChance", "BlockChance", "SpellBlockChance", "SpellSuppressionChance",
	"FireResist", "ColdResist", "LightningResist", "ChaosResist",
	"FireResistOverCap", "ColdResistOverCap", "LightningResistOverCap", "ChaosResistOverCap",
	"PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
	"LifeRegenRecovery", "LifeLeechGainRate", "EnergyShieldRegenRecovery", "NetLifeRegen",
	"EffectiveMovementSpeedMod", "Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt",
	"PowerChargesMax", "FrenzyChargesMax", "EnduranceChargesMax", "ManaCost", "LifeCost",
}

-- DPS global d'un build, la même définition partout dans Lucid :
-- « Full DPS » de PoB (somme des compétences cochées) ; sinon la compétence principale (ses sbires si c'en est une).
-- Survie : le coup max encaissable (Max Hit) de PoB, type par type. L'EHP de PoB est gonflé par le blocage
-- et la récupération sur blocage, et trompe les débutants. On mesure la survie par la moyenne géométrique
-- des 5 Max Hit (une hausse de 10 % sur un seul type compte pour +2 %), et on montre le plus faible.
local HIT_TYPES = { { "Physical", "physique" }, { "Fire", "feu" }, { "Cold", "froid" }, { "Lightning", "foudre" }, { "Chaos", "chaos" } }
local function survival(o)
	local logSum, n, minV, minT = 0, 0, nil, nil
	for _, t in ipairs(HIT_TYPES) do
		local v = o[t[1] .. "MaximumHitTaken"]
		if type(v) == "number" and v > 0 and v < 1e12 then
			logSum = logSum + math.log(v); n = n + 1
			if not minV or v < minV then minV, minT = v, t[2] end
		end
	end
	if n == 0 then return o.TotalEHP or 0, nil, nil end
	return math.exp(logSum / n), minV, minT
end
Bridge._survival = survival

local function globalDps(o)
	if (o.FullDPS or 0) > 0 then return o.FullDPS, "full" end
	if o.Minion and (o.Minion.CombinedDPS or 0) > 0 then return o.Minion.CombinedDPS, "minion" end
	return o.CombinedDPS or o.TotalDPS or 0, "skill"
end
Bridge._globalDps = globalDps
-- même mesure de DPS avant / après (sinon retirer la dernière compétence Full DPS comparerait Full DPS et Guardian)
local function dpsLike(o, src)
	if src == "full" then return o.FullDPS or 0 end
	if src == "minion" then return o.Minion and o.Minion.CombinedDPS or 0 end
	return o.CombinedDPS or o.TotalDPS or 0
end
Bridge._dpsLike = dpsLike

local function keyOutput(output)
	local o = { }
	for _, k in ipairs(KEY_OUTPUT) do
		if type(output[k]) == "number" then o[k] = num(output[k]) end
	end
	if output.Minion then
		o.MinionTotalDPS = num(output.Minion.TotalDPS)
		o.MinionCombinedDPS = num(output.Minion.CombinedDPS)
		o.MinionLife = num(output.Minion.Life)
	end
	local g, src = globalDps(output)
	o.GlobalDPS, o.GlobalDPSSource = num(g), src
	local hp, mh, mt = survival(output)
	o.HitPool, o.MinMaxHit, o.MinMaxHitType = num(hp), num(mh), mt
	return o
end

------------------------------------------------------------------------ gems / skills
local function gemColor(gemData)
	if not gemData then return "w" end
	local t = gemData.tags or { }
	if t.strength then return "r" elseif t.dexterity then return "g" elseif t.intelligence then return "b" end
	return "w"
end

local function skillsSnapshot(build)
	local groups = { }
	for i, g in ipairs(build.skillsTab.socketGroupList) do
		local gems = { }
		for _, gem in ipairs(g.gemList) do
			local gd = gem.gemData
			local ge = gd and gd.grantedEffect or gem.grantedEffect
			t_insert(gems, {
				name = gd and gd.name or (ge and ge.name) or gem.nameSpec,
				nameSpec = gem.nameSpec,
				level = gem.level, quality = gem.quality,
				enabled = gem.enabled ~= false,
				support = ge and ge.support and true or false,
				color = gemColor(gd),
				gemId = gem.gemId, skillId = gem.skillId,
				gameId = gd and gd.gameId or nil,
				-- effets cochés d'une gemme à deux effets (gemme Vaal : partie normale / partie Vaal)
				g1 = gem.enableGlobal1 ~= false, g2 = gem.enableGlobal2 ~= false,
			})
		end
		local active = { }
		for _, s in ipairs(g.displaySkillList or { }) do
			t_insert(active, s.activeEffect and s.activeEffect.grantedEffect and s.activeEffect.grantedEffect.name or "?")
		end
		-- sous-parties de la compétence (Lightning Strike : Melee / Projectiles…) : PoB ne calcule que celle choisie
		local parts, part
		local ms = g.displaySkillList and g.displaySkillList[g.mainActiveSkill or 1]
		local mge = ms and ms.activeEffect and ms.activeEffect.grantedEffect
		if mge and mge.parts and #mge.parts > 1 then
			parts = { }
			for _, p in ipairs(mge.parts) do t_insert(parts, p.name or "?") end
			part = ms.activeEffect.srcInstance and ms.activeEffect.srcInstance.skillPart or 1
		end
		-- Supports réellement actifs selon le moteur PoB (gère Chains of Command, The Squire, etc.)
		local activeSupports = { }
		if ms and ms.supportList then
			for _, sup in ipairs(ms.supportList) do
				local sName = sup.grantedEffect and sup.grantedEffect.name
				if sName then t_insert(activeSupports, sName) end
			end
		end
		t_insert(groups, {
			parts = parts, part = part,
			index = i,
			label = g.label ~= "" and g.label or nil,
			slot = g.slot,
			enabled = g.enabled ~= false,
			includeInFullDPS = g.includeInFullDPS and true or false,
			count = g.groupCount,
			main = (i == build.mainSocketGroup),
			imbued = g.imbuedSupport and tostring(g.imbuedSupport) or nil,  -- support imprégné (3.27)
			gems = gems,
			active = active,
			source = g.source,
		})
	end
	return groups
end

------------------------------------------------------------------------ items
local function modLines(item, list, kind)
	local out = { }
	for _, ml in ipairs(list or { }) do
		if item:CheckModLineVariant(ml) then
			local txt = itemLib.formatModLine(ml)
			if txt then
				t_insert(out, {
					text = strip(txt),
					kind = kind,
					crafted = ml.crafted and true or nil,
					fractured = ml.fractured and true or nil,
					custom = ml.custom and true or nil,
				})
			end
		end
	end
	return out
end

local function itemSnapshot(item)
	if not item then return nil end
	local lines = { }
	for _, l in ipairs(modLines(item, item.enchantModLines, "enchant")) do t_insert(lines, l) end
	for _, l in ipairs(modLines(item, item.scourgeModLines, "scourge")) do t_insert(lines, l) end
	for _, l in ipairs(modLines(item, item.implicitModLines, "implicit")) do t_insert(lines, l) end
	for _, l in ipairs(modLines(item, item.explicitModLines, "explicit")) do t_insert(lines, l) end
	for _, l in ipairs(modLines(item, item.crucibleModLines, "crucible")) do t_insert(lines, l) end
	local sockets = nil
	if item.sockets and #item.sockets > 0 then
		local s, lastGroup = "", nil
		for i, sk in ipairs(item.sockets) do
			if i > 1 then s = s .. (sk.group == lastGroup and "-" or " ") end
			s = s .. (sk.color or "?")
			lastGroup = sk.group
		end
		sockets = s
	end
	local defence = nil
	if item.armourData then
		local d = item.armourData
		defence = { armour = num(d.Armour), evasion = num(d.Evasion), es = num(d.EnergyShield), ward = num(d.Ward), block = num(d.BlockChance) }
	end
	local weapon = nil
	if item.weaponData and item.weaponData[1] then
		local w = item.weaponData[1]
		weapon = { dps = num(w.TotalDPS), pdps = num(w.PhysicalDPS), edps = num(w.ElementalDPS), aps = num(w.AttackRate), crit = num(w.CritChance), range = num(w.range) }
		for _, t in ipairs({ "Physical", "Fire", "Cold", "Lightning", "Chaos" }) do
			if w[t .. "Min"] and w[t .. "Max"] and w[t .. "Max"] > 0 then
				weapon[t] = { num(w[t .. "Min"]), num(w[t .. "Max"]) }
			end
		end
	end
	local req = item.requirements or { }
	local reqs = { level = num(req.level), str = num(req.strMod or req.str), dex = num(req.dexMod or req.dex), int = num(req.intMod or req.int) }
	local influences = { }
	for _, inf in ipairs({ "shaper", "elder", "crusader", "redeemer", "hunter", "warlord", "fractured", "synthesised" }) do
		if item[inf] then t_insert(influences, inf) end
	end
	return {
		id = item.id,
		name = strip(item.name),
		title = strip(item.title),
		base = item.baseName,
		type = item.type,
		rarity = item.rarity,
		quality = item.quality,
		ilvl = item.itemLevel,
		corrupted = item.corrupted and true or nil,
		mirrored = item.mirrored and true or nil,
		sockets = sockets,
		lines = lines,
		defence = defence,
		weapon = weapon,
		reqs = reqs,
		influences = influences,
		baseType = item.base and item.base.type or nil,
		limit = item.limit, radius = item.jewelRadiusLabel,
		raw = item.raw or item:BuildRaw(),
	}
end

local function slotShown(slot)
	local ok, r = pcall(slot.IsShown, slot)
	return not ok or r and true or false
end

local function itemsSnapshot(build)
	local tab = build.itemsTab
	local slots = { }
	for _, slot in ipairs(tab.orderedSlots) do
		local id = slot.selItemId or 0
		local isJewel = slot.nodeId ~= nil
		local include = true
		if isJewel then include = build.spec.allocNodes[slot.nodeId] ~= nil and id ~= 0 end
		if slot.slotName:match("Swap") and id == 0 then include = false end
		if slot.slotName:match("^Flask") == nil and slot.slotName:match("Abyssal") and id == 0 then include = false end
		if slot.slotName:match("Graft") and id == 0 then include = false end
		if include and (isJewel or slotShown(slot)) then
			t_insert(slots, {
				slot = slot.slotName,
				label = slot.label or slot.slotName,
				jewel = isJewel or nil,
				nodeId = slot.nodeId,
				active = slot.slotName:match("^Flask") and (slot.active and true or false) or nil,
				item = id ~= 0 and itemSnapshot(tab.items[id]) or nil,
			})
		end
	end
	return slots
end

------------------------------------------------------------------------ tree
local function nodeKind(node)
	if node.type == "Keystone" or node.isKeystone then return "keystone" end
	if node.type == "Notable" or node.isNotable then return "notable" end
	if node.type == "Mastery" then return "mastery" end
	if node.type == "Socket" or node.isJewelSocket then return "socket" end
	if node.type == "ClassStart" then return "start" end
	if node.type == "AscendClassStart" then return "ascstart" end
	return "normal"
end

local function treeSnapshot(build)
	local spec = build.spec
	local alloc, keystones, notables, masteries, ascend = { }, { }, { }, { }, { }
	local points, ascPoints = 0, 0
	for id, node in pairs(spec.allocNodes) do
		t_insert(alloc, id)
		local k = nodeKind(node)
		local entry = { id = id, name = node.dn, stats = node.sd, kind = k, asc = node.ascendancyName }
		if node.ascendancyName then
			if k ~= "ascstart" then
				ascPoints = ascPoints + (node.isMultipleChoiceOption and 0 or 1)
				t_insert(ascend, entry)
			end
		else
			if k ~= "start" and k ~= "ascstart" and not node.isProxy then
				if k ~= "mastery" then points = points + 1 end
			end
			if k == "keystone" then t_insert(keystones, entry)
			elseif k == "notable" then t_insert(notables, entry)
			elseif k == "mastery" then t_insert(masteries, entry) end
		end
	end
	table.sort(alloc)
	local used, ascUsed = spec:CountAllocNodes()
	local masteries = { }
	for nodeId, effect in pairs(spec.masterySelections or { }) do masteries[tostring(nodeId)] = effect end
	-- tatouages (nœud remplacé → nom du tatouage)
	local tattoos = { }
	for nodeId, o in pairs(spec.hashOverrides or { }) do if o.dn then tattoos[tostring(nodeId)] = o.dn end end
	return {
		tattoos = tattoos,
		version = spec.treeVersion,
		classId = spec.curClassId, ascendClassId = spec.curAscendClassId, secondaryAscendClassId = spec.curSecondaryAscendClassId,
		masterySelections = masteries,
		class = spec.curClassName,
		ascendancy = spec.curAscendClassName ~= "None" and spec.curAscendClassName or nil,
		secondaryAscendancy = spec.curSecondaryAscendClassName ~= "None" and spec.curSecondaryAscendClassName or nil,
		alloc = alloc,
		points = used or points,
		ascPoints = ascUsed or ascPoints,
		keystones = keystones, notables = notables, masteries = masteries, ascendancy_nodes = ascend,
	}
end

-- Arbre passif dessiné par PoB lui-même (PassiveTreeView:Draw), enregistré en liste d'affichage.
-- a = { w, h, mx, my, down, shift, ctrl, events = { {"KeyUp","WHEELUP"}, … }, search, compare = {…} }
local compareCache = { }
local function compareSpec(c)
	if type(c) ~= "table" or not c.nodes then return nil end
	local build = B()
	local key = tostring(build) .. "|" .. table.concat(c.nodes, ",") .. "|" .. tostring(c.classId) .. "|" .. tostring(c.ascendClassId) .. "|" .. tostring(c.version)
	if compareCache.key == key then return compareCache.spec end
	local spec = new("PassiveSpec"):PassiveSpec(build, c.version or build.spec.treeVersion)
	local masteries = { }
	for k, v in pairs(c.masterySelections or { }) do masteries[tonumber(k)] = v end
	local className = spec.tree.classes[c.classId] and spec.tree.classes[c.classId].name
	spec:ImportFromNodeList(nil, c.classId, c.ascendClassId or 0, c.secondaryAscendClassId or 0, c.nodes, { }, masteries, c.version)
	spec.build = build
	compareCache.key, compareCache.spec = key, spec
	return spec
end

Bridge._compareSpec = compareSpec

-- Infobulles d'objets et de gemmes dessinées par PoB (Tooltip + ItemsTab:AddItemTooltip / GemTooltip)
-- maxH : hauteur disponible ; au-delà, PoB répartit l'infobulle en colonnes (Tooltip:CalculateColumns)
local function drawTooltip(tt, maxH)
	local w, h = tt:GetSize()
	if tt.tooltipHeader and tt.lines[1] and tt.lines[1].text then
		local font = main.showFlavourText and "FONTIN SC" or "VAR"
		w = math.max(w, DrawStringWidth(tt.lines[1].size, font, tt.lines[1].text) + 50)
	end
	local vp = { x = 0, y = 0, width = 6000, height = maxH or (h + 4000) }
	local totalW, totalH = w, h
	if maxH then
		local columns, maxColumnHeight, _, extra = tt:CalculateColumns(0, 0, h, w, vp)
		extra = (columns > 1 and extra and extra > 0) and extra or w
		totalW = w + math.max(columns - 1, 0) * extra
		totalH = math.min(h, maxColumnHeight or h)
	end
	GFX_Begin(totalW, totalH)
	tt:Draw(0, 0, nil, nil, vp)
	return { dl = GFX_End(), w = math.ceil(totalW), h = math.ceil(totalH) }
end

Bridge._drawTooltip = drawTooltip

function Bridge.itemTooltip(a)
	local build = B()
	local tab = build.itemsTab
	local item, slot
	if a.raw then
		item = new("Item"):Item(a.raw)
		if not item.base then error("Objet non reconnu par PoB", 0) end
		item:NormaliseQuality()
		item:BuildModList()
	else
		slot = tab.slots[a.slot]
		item = slot and tab.items[slot.selItemId]
	end
	if not item then error("Aucun objet", 0) end
	local tt = new("Tooltip"):Tooltip()
	if a.noCompare then
		-- objet porté par un sbire (Guardian) : la comparaison de PoB porterait sur l'emplacement du personnage
		local show = tab.showStatDifferences
		tab.showStatDifferences = false
		tab:AddItemTooltip(tt, item, nil)
		tab.showStatDifferences = show
		-- retire l'astuce « Ctrl+D » ajoutée par PoB à la place des différences
		for _ = 1, 2 do if #tt.lines > 0 then table.remove(tt.lines) end end
	else
		tab:AddItemTooltip(tt, item, a.raw and (a.slot and tab.slots[a.slot]) or slot)
	end
	return drawTooltip(tt)
end

local gemTooltip = require("Classes.GemTooltip")
function Bridge.gemTooltip(a)
	local build = B()
	local group = build.skillsTab.socketGroupList[a.group]
	local gem = group and group.gemList[a.gem]
	if not gem or not gem.gemData then error("Gemme introuvable", 0) end
	local tt = new("Tooltip"):Tooltip()
	gemTooltip.AddGemTooltip(tt, build, gem)
	return drawTooltip(tt)
end

function Bridge.nodeInfo(a)
	local tree = B().spec.tree
	local node = tree.nodes[tonumber(a.id)]
	if not node then return { } end
	return { id = node.id, name = node.dn, stats = node.sd, kind = nodeKind(node), asc = node.ascendancyName }
end

------------------------------------------------------------------------ config
local configVarList = require("Modules.ConfigOptions")

local function configInput(build)
	local ct = build.configTab
	local set = ct.configSets and ct.configSets[ct.activeConfigSetId]
	return set and set.input or ct.input or { }
end

local function configEntry(build, vd, section)
	local input = configInput(build)
	local v = input[vd.var]
	local def = build.configTab.defaultState[vd.var]
	if v == nil then v = def end
	local e = { var = vd.var, label = strip(vd.label or vd.var), type = vd.type, value = v, default = def, section = section,
		tip = type(vd.tooltip) == "string" and strip(vd.tooltip) or nil }
	if vd.type == "list" and vd.list then
		e.options = { }
		for _, o in ipairs(vd.list) do t_insert(e.options, { val = o.val, label = strip(o.label) }) end
	end
	return e
end

local function isDefault(v, def)
	if v == nil then return true end
	if def == nil then return v == false or v == 0 or v == "" end
	return v == def
end

-- Options actives (différentes du défaut), dans l'ordre de PoB
local function configSnapshot(build)
	local out, section = { }, nil
	local input = configInput(build)
	for _, vd in ipairs(configVarList) do
		if vd.section then section = vd.section end
		if vd.var and vd.type and vd.label and vd.type ~= "text" then
			if not isDefault(input[vd.var], build.configTab.defaultState[vd.var]) then
				t_insert(out, configEntry(build, vd, section))
			end
		end
	end
	return out
end

-- Options influentes proposées en accès rapide
local CONFIG_KEYS = {
	"enemyIsBoss", "conditionFullLife", "conditionLowLife", "usePowerCharges", "useFrenzyCharges", "useEnduranceCharges",
	"conditionOnslaught", "buffOnslaught", "conditionFortify", "buffFortification", "conditionLeeching", "conditionUsingFlask",
	"conditionKilledRecently", "conditionCritRecently", "conditionBeenHitRecently", "conditionMoving",
	"conditionEnemyShocked", "conditionEnemyChilled", "conditionEnemyIgnited", "conditionEnemyFrozen",
	"conditionEnemyIntimidated", "conditionEnemyUnnerved", "conditionEnemyMaimed", "conditionEnemyBlinded",
	"conditionEnemyHindered", "conditionEnemyCoveredInAsh", "conditionEnemyOnConsecratedGround",
	"multiplierWitheredStackCount", "enemyPhysicalHitDamage",
}

function Bridge.config(a)
	a = a or { }
	local build = B()
	local byVar, sectionOf, section = { }, { }, nil
	for _, vd in ipairs(configVarList) do
		if vd.section then section = vd.section end
		if vd.var and vd.type then byVar[vd.var] = vd sectionOf[vd.var] = section end
	end
	local key, seen = { }, { }
	for _, v in ipairs(CONFIG_KEYS) do
		if byVar[v] and byVar[v].label then
			t_insert(key, configEntry(build, byVar[v], sectionOf[v])) seen[v] = true
		end
	end
	local active = { }
	for _, c in ipairs(configSnapshot(build)) do
		if not seen[c.var] then t_insert(active, c) end
	end
	-- options visées par un « Corriger » (même si elles sont à leur valeur par défaut)
	local focus = { }
	for _, v in ipairs(type(a.focus) == "table" and a.focus or { }) do
		if byVar[v] and byVar[v].label then t_insert(focus, configEntry(build, byVar[v], sectionOf[v])) end
	end
	return { key = key, active = active, focus = focus }
end

function Bridge.setConfig(a)
	local build = B()
	local v = a.value
	if v == NULL then v = nil end
	configInput(build)[a.var] = v
	build.configTab:BuildModList()
	build.configTab.modFlag = true
	recalc()
	return Bridge.snapshot({ })
end

-- Configuration de simulation du jeu actif (copie brute des options, pour l'appliquer à un autre build)
function Bridge.configInput()
	local out = { }
	for k, v in pairs(configInput(B())) do
		if type(v) ~= "table" then out[k] = v end
	end
	return { input = out }
end

-- Choix réels du personnage, jamais écrasés par la configuration d'un guide
local CHARACTER_CHOICES = { bandit = true, pantheonMajorGod = true, pantheonMinorGod = true }

-- Remplace la configuration de simulation du build actif par celle fournie (étape d'un guide)
function Bridge.applyConfig(a)
	local build = B()
	local input = configInput(build)
	local keep = { }
	for k in pairs(CHARACTER_CHOICES) do keep[k] = input[k] end
	for k in pairs(input) do input[k] = nil end
	for k, v in pairs(a.input or { }) do
		if v ~= NULL and not CHARACTER_CHOICES[k] then input[k] = v end
	end
	for k, v in pairs(keep) do input[k] = v end
	build.configTab:BuildModList()
	build.configTab.modFlag = true
	recalc()
	return Bridge.snapshot({ })
end

------------------------------------------------------------------------ sets / stages
local function setsSnapshot(build)
	local trees, items, skills, configs = { }, { }, { }, { }
	for id, spec in ipairs(build.treeTab.specList) do
		t_insert(trees, { id = id, title = strip(spec.title or "Default"), active = (id == build.treeTab.activeSpec) })
	end
	for _, id in ipairs(build.itemsTab.itemSetOrderList) do
		local s = build.itemsTab.itemSets[id]
		t_insert(items, { id = id, title = strip(s.title or "Default"), active = (id == build.itemsTab.activeItemSetId) })
	end
	for _, id in ipairs(build.skillsTab.skillSetOrderList) do
		local s = build.skillsTab.skillSets[id]
		t_insert(skills, { id = id, title = strip(s.title or "Default"), active = (id == build.skillsTab.activeSkillSetId) })
	end
	if build.configTab.configSetOrderList then
		for _, id in ipairs(build.configTab.configSetOrderList) do
			local s = build.configTab.configSets[id]
			t_insert(configs, { id = id, title = strip(s.title or "Default"), active = (id == build.configTab.activeConfigSetId) })
		end
	end
	return { trees = trees, items = items, skills = skills, configs = configs }
end

function Bridge.setStage(a)
	local build = B()
	if a.tree and build.treeTab.specList[a.tree] and a.tree ~= build.treeTab.activeSpec then
		build.treeTab:SetActiveSpec(a.tree)
	end
	if a.items and build.itemsTab.itemSets[a.items] and a.items ~= build.itemsTab.activeItemSetId then
		build.itemsTab:SetActiveItemSet(a.items)
	end
	if a.skills and build.skillsTab.skillSets[a.skills] and a.skills ~= build.skillsTab.activeSkillSetId then
		build.skillsTab:SetActiveSkillSet(a.skills)
	end
	if a.config and build.configTab.configSets and build.configTab.configSets[a.config] and a.config ~= build.configTab.activeConfigSetId then
		build.configTab:SetActiveConfigSet(a.config)
	end
	recalc()
	return Bridge.snapshot({ })
end

-- Compétences comptées dans le « Full DPS » : celles du guide, appliquées au joueur (par nom de compétence active),
-- pour comparer le même périmètre de dégâts. a.skills = { "Animate Guardian's Weapon", … } (une entrée par groupe du guide)
function Bridge.setFullDPS(a)
	local build = B()
	local want = a.skills or { }
	if #want == 0 then return Bridge.snapshot({ }) end
	local function actives(g)
		local out = { }
		for _, gem in ipairs(g.gemList) do
			local gd = gem.gemData
			local ge = gd and gd.grantedEffect or gem.grantedEffect
			if ge and not ge.support then out[gd and gd.name or ge.name] = true end
		end
		return out
	end
	local list = build.skillsTab.socketGroupList
	local pick, used = { }, { }
	for _, w in ipairs(want) do
		local name = type(w) == "table" and w.name or w
		local count = type(w) == "table" and tonumber(w.count) or nil
		for i, g in ipairs(list) do
			if not used[i] and g.enabled ~= false and actives(g)[name] then
				used[i] = true
				pick[i] = { count = count }
				break
			end
		end
	end
	if next(pick) == nil then return Bridge.snapshot({ }) end  -- aucune compétence en commun : on garde le réglage du joueur
	for i, g in ipairs(list) do
		g.includeInFullDPS = pick[i] and true or false
		-- même nombre de copies que le guide (ex. armes animées de Chains of Command)
		if pick[i] and pick[i].count and pick[i].count > 1 and not g.groupCount then g.groupCount = pick[i].count end
	end
	recalc()
	return Bridge.snapshot({ })
end

function Bridge.setMainSkill(a)
	local build = B()
	local g = build.skillsTab.socketGroupList[a.index]
	if g then
		build.mainSocketGroup = a.index
		-- sous-partie choisie (index dans grantedEffect.parts), portée par la gemme active
		if a.part then
			local ms = g.displaySkillList and g.displaySkillList[g.mainActiveSkill or 1]
			local src = ms and ms.activeEffect and ms.activeEffect.srcInstance
			if src then src.skillPart = tonumber(a.part) end
		end
		recalc()
	end
	return Bridge.snapshot({ })
end

------------------------------------------------------------------------ snapshot
------------------------------------------------------------------------ équipement des sbires (Animated Guardian)
-- PoB équipe le Guardian avec un jeu d'objets du build, désigné par la gemme (skillMinionItemSet).
local MINION_SLOTS = { "Weapon 1", "Weapon 2", "Helmet", "Body Armour", "Gloves", "Boots" }

local function minionSetSlot(set, slotName)
	if set.useSecondWeaponSet and slotName:match("^Weapon") then return slotName .. " Swap" end
	return slotName
end

local function minionGear(build)
	local tab = build.itemsTab
	local out, seen = { }, { }
	for gi, g in ipairs(build.skillsTab.socketGroupList) do
		for _, gem in ipairs(g.gemList) do
			local ge = gem.gemData and gem.gemData.grantedEffect or gem.grantedEffect
			if ge and ge.minionHasItemSet then
				-- skillMinionItemSet : le jeu utilisé par le calcul (skillMinionItemSetCalcs ne sert qu'à l'onglet Calcs de PoB)
				local setId = tab.itemSets[gem.skillMinionItemSet] and gem.skillMinionItemSet or tab.itemSetOrderList[1]
				local set = tab.itemSets[setId]
				local enabled = (g.enabled ~= false and gem.enabled ~= false)
				-- une entrée par (compétence, jeu d'objets) : plusieurs groupes d'une même compétence = un seul sbire à équiper
				local sk = ge.name .. "|" .. tostring(setId)
				local full = enabled and g.includeInFullDPS and true or false
				if set and seen[sk] then
					if enabled then seen[sk].enabled = true end
					if full then seen[sk].full = true end
				elseif set then
					local slots, weaponOnly = { }, true
					for _, sn in ipairs(MINION_SLOTS) do
						if not ge.minionUses or ge.minionUses[sn] then
							if not sn:match("^Weapon") then weaponOnly = false end
							local key = minionSetSlot(set, sn)
							local id = set[key] and set[key].selItemId or 0
							t_insert(slots, { slot = sn, label = sn, item = id ~= 0 and tab.items[id] and itemSnapshot(tab.items[id]) or nil })
						end
					end
					local e = { skill = ge.name, group = gi, setId = setId, title = set.title or "Default",
						enabled = enabled, full = full, main = (gi == build.mainSocketGroup), slots = slots, weaponOnly = weaponOnly }
					seen[sk] = e
					t_insert(out, e)
				end
			end
		end
	end
	-- Sbire « arme seule » (Animate Guardian's Weapon, donné par Chains of Command) : il anime une copie de l'arme
	-- du Guardian. PoB lui demande quand même son propre jeu d'objets ; si c'est le même jeu ou la même arme,
	-- on le rattache au Guardian au lieu d'afficher un deuxième mannequin.
	local function weapon(e)
		for _, s in ipairs(e.slots) do if s.slot == "Weapon 1" then return s.item end end
	end
	local merged = { }
	-- plusieurs groupes de la même compétence « arme seule » : celui du Full DPS compte, les autres sont ignorés
	for _, w in ipairs(out) do
		if w.weaponOnly and not w.full then
			for _, o in ipairs(out) do
				if o ~= w and o.weaponOnly and o.full and o.skill == w.skill then merged[w] = true break end
			end
		end
	end
	for _, w in ipairs(out) do
		if w.weaponOnly and not merged[w] then
			local wi = weapon(w)
			-- Guardian actif de préférence, quel que soit le jeu d'objets choisi dans PoB pour l'arme
			local host
			for _, h in ipairs(out) do
				if not h.weaponOnly and (not host or (h.enabled and not host.enabled)) then host = h end
			end
			-- rattaché seulement si l'arme animée est bien celle du Guardian (même jeu ou exactement la même arme) ;
			-- sinon (jeu à part avec une autre arme), c'est un sbire à équiper à part
			local hw = host and weapon(host)
			local same = host and (host.setId == w.setId or (hw and wi and (hw.raw or hw.name) == (wi.raw or wi.name)) or (not hw and not wi))
			if host and same then
				host.linked = host.linked or { }
				local dup = false
				for _, l in ipairs(host.linked) do if l.skill == w.skill then dup = true end end
				if not dup then t_insert(host.linked, { skill = w.skill }) end
				merged[w] = true
			end
		end
	end
	local final = { }
	for _, e in ipairs(out) do if not merged[e] then t_insert(final, e) end end
	return final
end
Bridge._minionGear = minionGear

local function estimatedLevel(build, points)
	local raw = build.characterLevel or 1
	local pts = points or 0
	if pts <= 0 then return raw end

	local questPts = pts < 25 and math.floor(pts * 0.25)
		or pts < 60 and math.floor(pts * 0.28)
		or 24
	local est = math.max(1, math.min(100, pts - questPts + 1))

	if (raw == 100 and pts < 115) or (raw <= 1 and pts > 5) or math.abs(raw - est) > 12 then
		return est
	end
	return raw
end

function Bridge.snapshot(a)
	local build = B()
	local output = build.calcsTab.mainOutput
	local env = build.calcsTab.mainEnv
	local mainGroup = build.skillsTab.socketGroupList[build.mainSocketGroup]
	local mainSkillName = nil
	if env and env.player and env.player.mainSkill and env.player.mainSkill.activeEffect then
		mainSkillName = env.player.mainSkill.activeEffect.grantedEffect.name
	end
	local stats = statList(build, output, env and env.player, build.displayStats)
	local minionStats = nil
	if env and env.minion and output.Minion then
		minionStats = statList(build, output.Minion, env.minion, build.minionDisplayStats)
	end
	local tree = treeSnapshot(build)
	local notes = build.notesTab and build.notesTab.notesText or ""
	return {
		info = {
			name = build.buildName,
			level = estimatedLevel(build, tree.points),
			rawLevel = build.characterLevel,
			class = tree.class,
			ascendancy = tree.ascendancy,
			mainSkill = mainSkillName,
			mainSocketGroup = build.mainSocketGroup,
			bandit = build.bandit,
			pantheonMajor = build.pantheonMajorGod,
			pantheonMinor = build.pantheonMinorGod,
			treeVersion = build.spec.treeVersion,
		},
		stats = stats,
		minionStats = minionStats,
		minionGear = minionGear(build),
		key = keyOutput(output),
		skills = skillsSnapshot(build),
		items = itemsSnapshot(build),
		tree = tree,
		notes = notes,
		config = configSnapshot(build),
		sets = setsSnapshot(build),
	}
end

------------------------------------------------------------------------ comparaisons (moteur PoB)
local function diffOutputs(build, base, new, list, actor)
	local env = build.calcsTab.mainEnv
	actor = actor or env.player
	local flags = actor and actor.mainSkill and actor.mainSkill.skillFlags or { }
	local out = { }
	for _, sd in ipairs(list or build.displayStats) do
		if sd.stat and matchFlags(sd.flag, sd.notFlag, flags) then
			local b, n = base[sd.stat], new[sd.stat]
			if sd.childStat then
				b = type(b) == "table" and b[sd.childStat] or nil
				n = type(n) == "table" and n[sd.childStat] or nil
			end
			if type(b) == "number" or type(n) == "number" then
				b, n = b or 0, n or 0
				local d = n - b
				if math.abs(d) > 0.0001 and d == d and math.abs(d) ~= math.huge then
					local mult = (sd.pc or sd.mod) and 100 or 1
					t_insert(out, {
						key = sd.stat .. (sd.childStat and ("." .. sd.childStat) or ""),
						label = strip(sd.label or sd.stat),
						base = num(b), new = num(n), delta = num(d),
						pct = (b ~= 0) and num(d / math.abs(b) * 100) or nil,
						fmt = sd.fmt or "d", pc = (sd.pc or sd.mod) and true or nil, mod = sd.mod and true or nil,
						lower = sd.lowerIsBetter and true or nil,
						better = (sd.lowerIsBetter and d < 0) or (not sd.lowerIsBetter and d > 0),
					})
				end
			end
		end
	end
	return out
end

local function headline(base, new)
	local _, src = globalDps(base)
	local function pick(o)
		local dps = dpsLike(o, src)
		return dps, (o.Life or 0), (o.EnergyShield or 0), (survival(o))
	end
	local d0, l0, e0, h0 = pick(base)
	local d1, l1, e1, h1 = pick(new)
	local function pct(a, b) if a == 0 then return b ~= 0 and 100 or 0 end return (b - a) / math.abs(a) * 100 end
	return {
		dps = num(pct(d0, d1)), life = num(l1 - l0), es = num(e1 - e0), ehp = num(pct(h0, h1)),
		dpsAbs = num(d1 - d0), ehpAbs = num(h1 - h0),
	}
end

local function calculator()
	return B().calcsTab:GetMiscCalculator()
end

-- Compétences données par un objet (Chains of Command, Mjölner, Cospri…) : PoB ne met à jour leurs groupes
-- qu'au calcul complet du build (mode MAIN). Le calcul rapide « objet remplacé » garderait donc les compétences
-- de l'objet retiré et ignorerait celles du nouvel objet. On aligne les groupes le temps d'un calcul.
-- lignes d'un objet, en minuscules (comme le corpus du linter)
local function itemLines(item)
	local out = { }
	if not item then return out end
	for _, list in ipairs({ item.enchantModLines, item.scourgeModLines, item.implicitModLines, item.explicitModLines, item.crucibleModLines }) do
		for _, ml in ipairs(list or { }) do
			if item:CheckModLineVariant(ml) then t_insert(out, StripEscapes(ml.line):lower()) end
		end
	end
	return out
end
local function srcCount(lines, d)
	local n = 0
	for _, line in ipairs(lines) do
		for _, pat in ipairs(d.sources or { }) do
			if line:find(pat) then
				local bad = false
				for _, x in ipairs(d.exclude or { }) do if line:find(x) then bad = true break end end
				if not bad then n = n + 1 end
				break
			end
		end
	end
	return n
end
-- Conditions réalistes pendant un échange d'objet : l'objet testé apporte la source d'une condition retirée
-- (ex. charges de frénésie) → on l'active ; l'objet retiré était la seule source d'une condition → on la coupe.
local function gateChanges(build, cur, newItem)
	local G = Bridge._gates
	if not G then return nil end
	local input = configInput(build)
	local changes, why = { }, { }
	local newL, curL = itemLines(newItem), itemLines(cur)
	for _, d in ipairs(G.drop or { }) do
		if srcCount(newL, d) > 0 then changes[d.var] = d.value; t_insert(why, { var = d.var, label = d.label, on = true }) end
	end
	for _, d in ipairs(G.keep or { }) do
		local inCur = srcCount(curL, d)
		if inCur > 0 and inCur >= (d.count or 0) and srcCount(newL, d) == 0 and input[d.var] then
			changes[d.var] = false; t_insert(why, { var = d.var, label = d.label, on = false })
		end
	end
	if not next(changes) then return nil end
	return changes, why
end

-- Résistances élémentaires d'un objet (feu / froid / foudre ; « all Elemental » compte pour les trois).
-- Mods sans condition seulement.
local function itemRes(item, slotName)
	local r = { Fire = 0, Cold = 0, Lightning = 0 }
	local list = item.modList or (item.slotModList and item.slotModList[(slotName or ""):match("2$") and 2 or 1]) or { }
	for _, m in ipairs(list) do
		if m.type == "BASE" and not m[1] and type(m.value) == "number" then
			local e = m.name:match("^(%a+)Resist$")
			if r[e] then r[e] = r[e] + m.value
			elseif m.name == "ElementalResist" then for k in pairs(r) do r[k] = r[k] + m.value end end
		end
	end
	return r
end

-- Feu, froid et foudre sont interchangeables quand on monte un build : on place ses résistances où l'on veut
-- (anneau froid au lieu de feu…) et on rééquilibre sur les autres pièces. Pour juger un objet, on garde donc
-- la répartition de l'objet retiré et on ne compte que le TOTAL de résistance élémentaire du nouvel objet.
-- Renvoie les lignes de mods qui corrigent la répartition, et le résumé.
local function resRebalance(cur, newItem, slotName)
	if not (cur and newItem) then return nil end
	local a, b = itemRes(cur, slotName), itemRes(newItem, slotName)
	local ta, tb = a.Fire + a.Cold + a.Lightning, b.Fire + b.Cold + b.Lightning
	if ta <= 0 or tb <= 0 then return nil end
	-- répartition « comme un joueur » : on part de celle de l'objet retiré (rien ne bouge ailleurs), puis
	-- le surplus va aux résistances les plus basses, et une perte est prise d'abord là où l'on dépasse le plafond
	local o = B().calcsTab.mainOutput or { }
	local total, c = { }, { }
	for _, e in ipairs({ "Fire", "Cold", "Lightning" }) do
		total[e] = (o[e .. "Resist"] or 0) + (o[e .. "ResistOverCap"] or 0)
		c[e] = a[e]
	end
	local delta = math.floor(tb - ta + 0.5)
	for _ = 1, math.min(math.abs(delta), 500) do
		local pick
		for _, e in ipairs({ "Fire", "Cold", "Lightning" }) do
			local v = total[e] + c[e] - a[e]
			if delta > 0 then
				if not pick or v < total[pick] + c[pick] - a[pick] then pick = e end
			elseif c[e] > 0 and (not pick or v > total[pick] + c[pick] - a[pick]) then pick = e end
		end
		if not pick then break end
		c[pick] = c[pick] + (delta > 0 and 1 or -1)
	end
	local lines, moved = { }, false
	for _, e in ipairs({ "Fire", "Cold", "Lightning" }) do
		local d = math.floor(c[e] - b[e] + 0.5)
		if d ~= 0 then
			moved = true
			t_insert(lines, string.format("%+d%% to %s Resistance", d, e))
		end
	end
	if not moved then return nil end
	return lines, { from = ta, to = tb, cur = a, new = b }
end
Bridge._resRebalance = resRebalance

-- Joyaux abyssaux sertis dans l'objet retiré et qui n'ont plus de socket sur le nouvel objet :
-- PoB les retire déjà du calcul ; on ne fait que donner leurs noms pour le verdict.
local function isAbyss(item) return item and item.type == "Jewel" and item.base and item.base.subType == "Abyss" end
local function abyssLost(build, slotName, cur, newItem)
	if not cur or slotName:match("Swap") then return nil end
	local tab = build.itemsTab
	local newN = newItem and newItem.abyssalSocketCount or 0
	local names = { }
	for _, s in ipairs(tab.orderedSlots) do
		if s.parentSlot and s.parentSlot.slotName == slotName and s.slotNum <= (cur.abyssalSocketCount or 0)
			and s.slotNum > newN and isAbyss(tab.items[s.selItemId]) then
			t_insert(names, strip(tab.items[s.selItemId].name))
		end
	end
	return #names > 0 and names or nil
end

local function calcSwap(calcFunc, slotName, newItem)
	local build = B()
	local list = build.skillsTab.socketGroupList
	local slot = build.itemsTab.slots[slotName]
	local cur = slot and build.itemsTab.items[slot.selItemId] or nil
	local function fromItem(g, item)
		return item and (g.sourceItem == item or (item.id and g.source and g.source:match("^Item:" .. item.id .. ":")))
	end
	local disabled, added = { }, { }
	-- Toutes les modifications temporaires du build sont faites dans run() ; la restauration plus bas
	-- s'exécute toujours, même si une étape lève une erreur (le build ne reste jamais à moitié modifié).
	local tab, oldSel, tmpId = build.itemsTab, slot and slot.selItemId, nil
	local input, saved = configInput(build), { }
	local ct = build.configTab
	local cset = ct.configSets and ct.configSets[ct.activeConfigSetId]
	local block, cfgDirty, gwhy, rinfo, abLost
	local function run()
	if cur and cur.grantedSkills and #cur.grantedSkills > 0 then
		for _, g in ipairs(list) do
			if g.enabled ~= false and fromItem(g, cur) then g.enabled = false; t_insert(disabled, g) end
		end
	end
	if newItem and newItem.grantedSkills and #newItem.grantedSkills > 0 then
		local anyFull = false
		for _, g in ipairs(list) do if g.includeInFullDPS then anyFull = true end end
		for k, gs in ipairs(newItem.grantedSkills) do
			-- même compétence que celle de l'objet retiré : on reprend son groupe (réglages Full DPS, copies…)
			local reuse
			for _, g in ipairs(disabled) do
				local gem = g.gemList[1]
				if gem and gem.skillId == gs.skillId and not g._lucidReused then reuse = g; break end
			end
			if reuse then
				reuse._lucidReused = true
				reuse.enabled = true
				reuse.gemList[1]._lucidLevel = reuse.gemList[1].level
				reuse.gemList[1].level = gs.level
			elseif data.skills[gs.skillId] then
				-- sbire à équipement (Animate Guardian's Weapon…) : même jeu d'objets que les autres sbires du build
				local itemSet
				for _, g in ipairs(list) do
					for _, gem in ipairs(g.gemList) do if gem.skillMinionItemSet then itemSet = itemSet or gem.skillMinionItemSet end end
				end
				local g = { label = "", enabled = true, source = "Item:Lucid:" .. (newItem.name or ""), slot = slotName, sourceItem = newItem,
					includeInFullDPS = anyFull and k == 1 or nil, noSupports = gs.noSupports,
					gemList = { { skillId = gs.skillId, nameSpec = data.skills[gs.skillId].name, level = gs.level, quality = 0, enabled = true,
						enableGlobal1 = true, fromItem = true, triggered = gs.triggered, triggerChance = gs.triggerChance, noSupports = gs.noSupports,
						skillMinionItemSet = itemSet, skillMinionItemSetCalcs = itemSet } } }
				build.skillsTab:ProcessSocketGroup(g)
				t_insert(list, g)
				t_insert(added, g)
			end
		end
	end
	-- l'objet est aussi posé « pour de vrai » le temps du calcul : certaines règles de PoB lisent l'équipement
	-- en place au lieu du remplacement demandé (ex. Mageblood et ses flasques actives)
	if slot then
		if newItem then
			tmpId = 1
			while tab.items[tmpId] do tmpId = tmpId + 1 end
			tab.items[tmpId] = newItem
		end
		slot.selItemId = tmpId or 0
	end
	-- conditions de simulation liées à l'objet (charges…), le temps du calcul
	local gch
	gch, gwhy = gateChanges(build, cur, newItem)
	if gch then
		cfgDirty = true
		for k, v in pairs(gch) do saved[k] = { input[k] }; if v == false then input[k] = nil else input[k] = v end end
	end
	-- résistances élémentaires rééquilibrées (seul le total de l'objet compte)
	local rlines
	rlines, rinfo = resRebalance(cur, newItem, slotName)
	if rlines and cset then
		cset.customModsList = cset.customModsList or { }
		block = { title = "Lucid", enabled = true, text = table.concat(rlines, "\n") }
		t_insert(cset.customModsList, block)
		cfgDirty = true
	end
	if cfgDirty then build.configTab:BuildModList() end
	abLost = abyssLost(build, slotName, cur, newItem)
	return calcFunc({ repSlotName = slotName, repItem = newItem }, true)
	end
	local ok, out = pcall(run)
	-- restauration (toujours)
	for k, v in pairs(saved) do input[k] = v[1] end
	if block and cset and cset.customModsList then
		for i, x in ipairs(cset.customModsList) do if x == block then table.remove(cset.customModsList, i) break end end
	end
	if ok and type(out) == "table" then
		if next(saved) then out._lucidGates = gwhy end
		if block then out._lucidRes = rinfo end
		if abLost then out._lucidAbyss = { lost = abLost } end
	end
	if slot then
		slot.selItemId = oldSel
		if tmpId then tab.items[tmpId] = nil end
	end
	for _, g in ipairs(added) do
		for i = #list, 1, -1 do if list[i] == g then table.remove(list, i) end end
	end
	for _, g in ipairs(disabled) do
		g.enabled = true
		if g._lucidReused then g._lucidReused = nil; g.gemList[1].level = g.gemList[1]._lucidLevel; g.gemList[1]._lucidLevel = nil end
	end
	-- en dernier : l'équipement et les gemmes sont déjà remis, la liste de mods de config est reconstruite sur le vrai build
	if cfgDirty then pcall(build.configTab.BuildModList, build.configTab) end
	if not ok then error(out, 0) end
	return out
end
Bridge._calcSwap = calcSwap

-- Ce qui demande le plus d'un attribut (objet ou gemme), d'après la sortie « Req<Attr>Item » de PoB
local function reqSourceName(r)
	if type(r) ~= "table" then return nil end
	if r.sourceItem then return strip(r.sourceItem.name or "") end
	if r.sourceGem then return r.sourceGem.nameSpec end
	return nil
end

-- Teste un objet (texte brut copié du jeu ou d'un autre build) sur un ou plusieurs emplacements
function Bridge.testItem(a)
	local build = B()
	local item = new("Item"):Item(a.raw)
	if not item.base then error("Objet non reconnu par PoB", 0) end
	item:NormaliseQuality()
	item:BuildModList()
	local calcFunc = calculator()
	local base = calcFunc({ }, true)
	local slots = { }
	if a.slot then
		-- emplacement imposé : seulement s'il peut porter cet objet (un anneau ne se teste pas à la place d'une arme)
		if build.itemsTab:IsItemValidForSlot(item, a.slot) then slots = { a.slot } end
	else
		for _, slot in ipairs(build.itemsTab.orderedSlots) do
			if slotShown(slot) and not slot.nodeId and not slot.slotName:match("Swap") and build.itemsTab:IsItemValidForSlot(item, slot.slotName) then
				t_insert(slots, slot.slotName)
			end
		end
		-- joyaux : tester dans les sockets d'arbre, les vides d'abord ; un joyau à rayon (Timeless,
		-- Thread of Hope…) dépend de sa position : on teste alors tous les sockets alloués
		if #slots == 0 and item.type and item.type:match("Jewel") then
			local empty, used = { }, { }
			for _, slot in ipairs(build.itemsTab.orderedSlots) do
				if slot.nodeId and build.spec.allocNodes[slot.nodeId] then
					t_insert((slot.selItemId or 0) == 0 and empty or used, slot.slotName)
				end
			end
			local max = item.jewelRadiusLabel and math.huge or 8
			for _, l in ipairs({ empty, used }) do
				for _, s in ipairs(l) do if #slots < max then t_insert(slots, s) end end
			end
		end
	end
	local results = { }
	for _, slotName in ipairs(slots) do
		local out = calcSwap(calcFunc, slotName, item)
		local cur = build.itemsTab.items[build.itemsTab.slots[slotName] and build.itemsTab.slots[slotName].selItemId or 0]
		-- attributs : prérequis tenus avant l'échange et plus après (PoB ne désactive rien, mais en jeu
		-- tu ne pourrais plus porter l'objet ou la gemme qui les demande)
		local broken
		for _, at in ipairs({ "Str", "Dex", "Int" }) do
			local had = (base[at] or 0) >= (base["Req" .. at] or 0)
			local miss = (out["Req" .. at] or 0) - (out[at] or 0)
			if had and miss > 0 then
				broken = broken or { }
				t_insert(broken, { attr = at, missing = num(miss), source = reqSourceName(out["Req" .. at .. "Item"]) })
			end
		end
		-- unique « Limited to 1 » déjà porté ailleurs : en jeu les deux ne peuvent pas être actifs
		local dup
		if item.limit and (item.rarity == "UNIQUE" or item.rarity == "RELIC") then
			-- nom de l'unique : le titre, sinon la 1re partie du nom (« Nimis, Topaz Ring » → « Nimis »)
			local function uniqueName(x)
				local t = x.title and x.title ~= "" and x.title or (x.name or ""):match("^([^,]+)")
				return strip(t or "")
			end
			local want = uniqueName(item)
			local n = 0
			for _, s in ipairs(build.itemsTab.orderedSlots) do
				local it = s.slotName ~= slotName and not s.slotName:match("Swap") and build.itemsTab.items[s.selItemId]
				if it and uniqueName(it) == want and (not s.nodeId or build.spec.allocNodes[s.nodeId]) then n = n + 1 end
			end
			dup = n >= item.limit or nil
		end
		t_insert(results, {
			slot = slotName,
			current = cur and strip(cur.name) or nil,
			head = headline(base, out),
			diff = diffOutputs(build, base, out),
			conditions = out._lucidGates,
			resBalance = out._lucidRes,
			abyss = out._lucidAbyss,
			brokenReqs = broken,
			duplicateUnique = dup,
		})
	end
	return { item = itemSnapshot(item), results = results }
end

-- Retire un objet d'un emplacement → mesure sa contribution
function Bridge.itemValue(a)
	local build = B()
	local calcFunc = calculator()
	local base = calcFunc({ }, true)
	local out = calcSwap(calcFunc, a.slot, nil)
	-- variation relative à l'état actuel si l'on retire l'objet (valeurs négatives = perte)
	return { head = headline(base, out), diff = diffOutputs(build, base, out), conditions = out._lucidGates }
end

-- Objet d'un sbire (Animated Guardian) : a = { setId, slot, raw } ; raw absent = on retire l'objet
-- Le jeu d'objets du sbire est modifié le temps d'un calcul, puis restauré.
function Bridge.testMinionItem(a)
	local build = B()
	local tab = build.itemsTab
	local set = tab.itemSets[a.setId]
	if not set then error("Jeu d'objets du sbire introuvable", 0) end
	local key = minionSetSlot(set, a.slot)
	set[key] = set[key] or { selItemId = 0 }
	local base = calculator()({ }, true)
	local item, tmpId
	if a.raw and a.raw ~= NULL then
		item = new("Item"):Item(a.raw)
		if not item.base then error("Objet non reconnu par PoB", 0) end
		item:NormaliseQuality()
		item:BuildModList()
		tmpId = 1
		while tab.items[tmpId] do tmpId = tmpId + 1 end
		tab.items[tmpId] = item
	end
	local old = set[key].selItemId
	set[key].selItemId = tmpId or 0
	local ok, out = pcall(function() return calculator()({ }, true) end)
	set[key].selItemId = old
	if tmpId then tab.items[tmpId] = nil end
	if not ok then error(out, 0) end
	local res = { head = headline(base, out), diff = diffOutputs(build, base, out), item = item and itemSnapshot(item) or nil }
	if base.Minion and out.Minion then
		res.minionDiff = diffOutputs(build, base.Minion, out.Minion, build.minionDisplayStats, build.calcsTab.mainEnv.minion)
	end
	return res
end

-- Valeur de nœuds d'arbre (avec le chemin nécessaire pour les atteindre)
function Bridge.testNodes(a)
	local build = B()
	local spec = build.spec
	local calcFunc = calculator()
	local base = calcFunc({ }, true)
	local results = { }
	for _, id in ipairs(a.ids or { }) do
		local node = spec.nodes[id]
		if node and not spec.allocNodes[id] then
			local add = { }
			local cost = 0
			if node.path then
				for _, pn in ipairs(node.path) do add[pn] = true cost = cost + 1 end
			else
				add[node] = true cost = 1
			end
			local out = calcFunc({ addNodes = add }, true)
			local r = { id = id, name = node.dn, kind = nodeKind(node), stats = node.sd, cost = cost, recipe = node.recipe,
				head = headline(base, out), diff = diffOutputs(build, base, out) }
			-- build de sbires : ce que le nœud change chez eux (vie, dégâts… absents des stats du personnage)
			if base.Minion and out.Minion then
				r.minionDiff = diffOutputs(build, base.Minion, out.Minion, build.minionDisplayStats, build.calcsTab.mainEnv.minion)
			end
			t_insert(results, r)
		end
	end
	return results
end

------------------------------------------------------------------------ arbre : puissance, anoint, édition (bac à sable)
-- Puissance des nœuds (Show Node Power de PoB) : CalcsTab:PowerBuilder, limité en distance pour rester rapide.
-- offence = part de DPS gagnée, defence = mélange vie / armure / ES / évasion / régénération (formule de PoB).
function Bridge.nodePower(a)
	local build = B()
	local ct = build.calcsTab
	local savedStat, savedDepth = ct.powerStat, ct.nodePowerMaxDepth
	ct.powerStat = nil
	ct.nodePowerMaxDepth = tonumber(a and a.maxDepth) or 8
	local ok, err = pcall(function()
		local co = coroutine.create(ct.PowerBuilder)
		local res, e = coroutine.resume(co, ct)
		while res and coroutine.status(co) ~= "dead" do res, e = coroutine.resume(co) end
		if not res then error(e, 0) end
	end)
	ct.powerStat, ct.nodePowerMaxDepth = savedStat, savedDepth
	if not ok then error(err, 0) end
	local nodes = { }
	for id, node in pairs(build.spec.nodes) do
		local p = node.power
		if p and not node.alloc and ((p.offence or 0) > 0 or (p.defence or 0) > 0) then
			t_insert(nodes, { id, num(p.offence or 0), num(p.defence or 0), p.distance or 0 })
		end
	end
	local m = ct.powerMax or { }
	return { max = { offence = num(m.offence or 0), defence = num(m.defence or 0) }, nodes = nodes }
end

-- Meilleur anoint : chaque notable « anointable » (recette d'huiles) gravé sur TON amulette, à la place de l'anoint actuel.
function Bridge.bestAnoints(a)
	local build = B()
	local slot = build.itemsTab.slots["Amulet"]
	local amulet = slot and build.itemsTab.items[slot.selItemId]
	if not amulet then return { none = "Pas d'amulette équipée." } end
	local current
	for _, ml in ipairs(amulet.enchantModLines or { }) do
		current = current or (ml.line or ""):match("^Allocates (.+)$")
	end
	local raw = amulet:BuildRaw()
	local calcFunc = calculator()
	local base = calcFunc({ }, true)
	local res = { }
	for _, node in pairs(build.spec.nodes) do
		if node.recipe and node.type == "Notable" and not node.alloc and not node.ascendancyName and node.dn ~= current then
			local item = new("Item"):Item(raw)
			item.id = amulet.id
			if #item.enchantModLines >= 1 then table.remove(item.enchantModLines, 1) end
			t_insert(item.enchantModLines, 1, { crafted = true, line = "Allocates " .. node.dn })
			item:BuildAndParseRaw()
			local ok, out = pcall(calcFunc, { repSlotName = "Amulet", repItem = item }, true)
			if ok and out then
				t_insert(res, { id = node.id, name = node.dn, recipe = node.recipe, stats = node.sd, head = headline(base, out) })
			end
		end
	end
	local key = (a and a.metric) == "ehp" and "ehp" or "dps"
	table.sort(res, function(x, y) return (x.head[key] or 0) > (y.head[key] or 0) end)
	local top = { }
	for i = 1, math.min(12, #res) do top[i] = res[i] end
	return { current = current, list = top, tested = #res }
end

-- Bac à sable : allouer / retirer des passifs sur le build chargé (jamais enregistré), avec annulation.
local function allocIds(spec)
	local ids = { }
	for id in pairs(spec.allocNodes) do t_insert(ids, id) end
	return ids
end
local function restoreAlloc(spec, ids)
	local want = { }
	for _, id in ipairs(ids) do want[id] = true end
	for id, node in pairs(spec.nodes) do
		local on = want[id] or false
		if (node.alloc and true or false) ~= on then
			node.alloc = on
			spec.allocNodes[id] = on and node or nil
		end
	end
	spec:BuildAllDependsAndPaths()
end
function Bridge.treeEdit(a)
	local build = B()
	local spec = build.spec
	spec._lucidUndo = spec._lucidUndo or { }
	if a.undo then
		local prev = table.remove(spec._lucidUndo)
		if prev then
			-- annulation de PoB (celle de son Ctrl+Z) : maîtrises, joyaux à amas et tatouages compris
			local st = prev.state
			local ok = st and pcall(spec.ImportFromNodeList, spec, nil, st.classId, st.ascendClassId, st.secondaryAscendClassId,
				st.hashList, st.hashOverrides, st.masteryEffects, st.treeVersion)
			if not ok then restoreAlloc(spec, prev.ids) end
			if spec.BuildClusterJewelGraphs then pcall(spec.BuildClusterJewelGraphs, spec) end
		end
	else
		local node = spec.nodes[tonumber(a.id)]
		if not node then error("Nœud introuvable", 0) end
		if node.type == "ClassStart" or node.type == "AscendClassStart" or node.type == "Mastery" then
			return { undo = #spec._lucidUndo, skipped = true }
		end
		local okS, state = pcall(spec.CreateUndoState, spec)
		t_insert(spec._lucidUndo, { state = okS and state or nil, ids = allocIds(spec) })
		if node.alloc then spec:DeallocNode(node) else spec:AllocNode(node) end
	end
	recalc()
	return { undo = #spec._lucidUndo }
end

-- Onglet Party de PoB : buffs d'alliés importés (auras, malédictions, liens, mods sur l'ennemi)
local function partyHas(pt)
	if not pt or not pt.actor then return false end
	for _, k in ipairs({ "Aura", "Curse", "Warcry", "Link" }) do
		if next(pt.actor[k] or { }) then return true end
	end
	if pt.actor.modDB and next(pt.actor.modDB.mods or { }) then return true end
	return pt.enemyModList and #pt.enemyModList > 0 or false
end
function Bridge.partyInfo()
	return { has = partyHas(B().partyTab) }
end

-- Lignes ajoutées à la main dans Configuration > Custom Modifiers (blocs actifs du jeu de config courant)
function Bridge.customMods()
	local ct = B().configTab
	local cset = ct.configSets and ct.configSets[ct.activeConfigSetId]
	local parts = { }
	for _, b in ipairs(cset and cset.customModsList or { }) do
		if b.enabled ~= false and b.title ~= "Lucid" and (b.text or ""):match("%S") then t_insert(parts, b.text) end
	end
	return { text = table.concat(parts, "\n") }
end

-- Étapes cumulées vers le guide, sur ton build : équipement du guide, puis + son arbre, puis + ses gemmes.
-- Chaque étape part de la précédente : les parts s'additionnent exactement (en multiplicateur), sans « effet combiné ».
-- a = { items = { {slot, raw} }, minion = { {setId, slot, raw} }, spec = arbre du guide (sinon add / remove : ids de nœuds), groups = { {index, set = {name, level, quality}, add = {gemId, skillId, nameSpec, level, quality}} } }
function Bridge.stepsToGuide(a)
	local build = B()
	local tab, spec, list = build.itemsTab, build.spec, build.skillsTab.socketGroupList
	local calcFunc = calculator()
	local base = calcFunc({ }, true)
	local _, src = globalDps(base)
	local res = { base = dpsLike(base, src) }
	local placed, savedGems, addedGems, touched = { }, { }, { }, { }
	local oldLevel, flaskSaved, groupSaved, addedGroups = nil, { }, { }, { }
	local cset, oldMods
	local choiceSaved = { }
	local oldParty
	local itemGroupSaved = { }
	local imbuedSaved, imbuedSlotSaved = { }, { }
	local ok, err = pcall(function()
		-- 1. équipement
		for _, x in ipairs(a.items or { }) do
			local slot = tab.slots[x.slot]
			if slot and x.clear then
				-- emplacement vide chez le guide : on retire ton objet
				t_insert(placed, { slot, slot.selItemId, nil })
				slot.selItemId = 0
			elseif slot and x.raw then
				local it = new("Item"):Item(x.raw)
				if it.base then
					local id = 1
					while tab.items[id] do id = id + 1 end
					it.id = id  -- avant BuildModList : la source des compétences données par l'objet (« Item:<id>:… ») en dépend
					it:NormaliseQuality(); it:BuildModList()
					tab.items[id] = it
					t_insert(placed, { slot, slot.selItemId, id })
					slot.selItemId = id
				end
			end
		end
		-- compétences données par les objets : la calculatrice de PoB ne régénère pas leurs groupes (seul le mode
		-- principal le fait). Un groupe rattaché à l'objet retiré passe au nouvel objet s'il donne la même
		-- compétence, sinon il est coupé.
		do
			local bySlot = { }
			for _, p in ipairs(placed) do bySlot[p[1].slotName] = { old = p[2], new = p[3] and tab.items[p[3]] } end
			for _, g in ipairs(list) do
				local oldId = g.source and tonumber(tostring(g.source):match("^Item:(%-?%d+):"))
				local p = oldId and g.slot and bySlot[g.slot]
				if p and p.old == oldId then
					local gem1 = g.gemList[1]
					local keep = false
					for _, gs in ipairs(p.new and p.new.grantedSkills or { }) do
						if gem1 and gs.skillId == gem1.skillId then keep = gs break end
					end
					t_insert(itemGroupSaved, { g, g.source, g.sourceItem, g.enabled, gem1, gem1 and gem1.level })
					if keep then
						g.source, g.sourceItem = p.new.modSource, p.new
						if gem1 then gem1.level = keep.level end
					else
						g.enabled = false
					end
				end
			end
		end
		-- équipement des sbires (Animated Guardian) : jeu d'objets du sbire. On vide d'abord tous les emplacements
		-- de sbire de tes jeux concernés, puis on pose ceux du guide (rien de ton Guardian ne reste par oubli)
		for _, setId in ipairs(a.minionClear or { }) do
			local set = tab.itemSets[setId]
			if set then
				for _, sn in ipairs(MINION_SLOTS) do
					local key = minionSetSlot(set, sn)
					if set[key] and (set[key].selItemId or 0) ~= 0 then
						t_insert(placed, { set[key], set[key].selItemId, nil })
						set[key].selItemId = 0
					end
				end
			end
		end
		for _, x in ipairs(a.minion or { }) do
			local set = tab.itemSets[x.setId]
			if set and x.clear then
				local key = minionSetSlot(set, x.slot)
				if set[key] then
					t_insert(placed, { set[key], set[key].selItemId, nil })
					set[key].selItemId = 0
				end
			elseif set and x.raw then
				local it = new("Item"):Item(x.raw)
				if it.base then
					it:NormaliseQuality(); it:BuildModList()
					local key = minionSetSlot(set, x.slot)
					local had = set[key] ~= nil
					set[key] = set[key] or { selItemId = 0 }
					local id = 1
					while tab.items[id] do id = id + 1 end
					tab.items[id] = it
					t_insert(placed, { set[key], set[key].selItemId, id, set, key, had })
					set[key].selItemId = id
				end
			end
		end
		res.gear = dpsLike(calcFunc({ }, true), src)
		-- 2. + arbre : l'arbre complet du guide (maîtrises et joyaux Timeless compris), avec les joyaux déjà posés
		local ov
		local c = a.spec
		if type(c) == "table" and c.nodes then
			local gs = new("PassiveSpec"):PassiveSpec(build, c.version or spec.treeVersion)
			for _, s in ipairs(tab.orderedSlots) do
				if s.nodeId and (s.selItemId or 0) > 0 then gs.jewels[s.nodeId] = s.selItemId end
			end
			local masteries = { }
			for k, v in pairs(c.masterySelections or { }) do masteries[tonumber(k)] = v end
			local className = gs.tree.classes[c.classId] and gs.tree.classes[c.classId].name
			local conv = build.treeTab.showConvert
			local overrides = { }
			for k, dn in pairs(c.tattoos or { }) do
				local t = gs.tree.tattoo and gs.tree.tattoo.nodes[dn]
				if t then overrides[tonumber(k)] = copyTable(t, true); overrides[tonumber(k)].id = tonumber(k) end
			end
			gs:ImportFromNodeList(nil, c.classId, c.ascendClassId or 0, c.secondaryAscendClassId or 0, c.nodes, overrides, masteries, c.version)
			-- cluster jewels : PoB construit leurs nœuds à part (sous-arbres), puis les alloue d'après la liste importée
			gs:BuildClusterJewelGraphs()
			build.treeTab.showConvert = conv
			gs.build = build
			ov = { spec = gs }
		else
			local add, remove = { }, { }
			for _, id in ipairs(a.add or { }) do
				local n = spec.nodes[id]
				if n and not spec.allocNodes[id] and n.type ~= "Mastery" then add[n] = true end
			end
			for _, id in ipairs(a.remove or { }) do
				local n = spec.allocNodes[id]
				if n and n.type ~= "ClassStart" and n.type ~= "AscendClassStart" and n.type ~= "Mastery" then remove[n] = true end
			end
			ov = { addNodes = add, removeNodes = remove }
		end
		res.tree = dpsLike(calcFunc(ov, true), src)
		local skTab = build.skillsTab
		skTab.imbuedSupportBySlot = skTab.imbuedSupportBySlot or { }
		local function setImbued(g, name)
			t_insert(imbuedSaved, { g, g.imbuedSupport or false })
			g.imbuedSupport = name ~= "" and name or nil
			if g.slot and name ~= "" then
				local gem = skTab:FindImbuedSupport(name)
				if gem then
					if not imbuedSlotSaved[g.slot] then imbuedSlotSaved[g.slot] = { skTab.imbuedSupportBySlot[g.slot] or false } end
					skTab.imbuedSupportBySlot[g.slot] = gem.grantedEffect
				end
			end
		end
		-- 3. + gemmes : celles du guide (niveaux et qualités exacts, gemmes en trop coupées, groupes absents ajoutés)
		local function gname(gem)
			local gd = gem.gemData
			return ((gd and gd.name) or gem.nameSpec or ""):lower()
		end
		local function newGem(w)
			return { nameSpec = w.nameSpec, gemId = w.gemId, skillId = w.skillId, level = w.level or 20, quality = w.quality or 0,
				enabled = true, enableGlobal1 = w.g1 ~= false, enableGlobal2 = w.g2 ~= false, count = 1 }
		end
		for _, x in ipairs(a.groups or { }) do
			local g = list[x.index]
			if g then
				for _, w in ipairs(x.set or { }) do
					for _, gem in ipairs(g.gemList) do
						if gname(gem) == (w.name or ""):lower() then
							t_insert(savedGems, { gem, gem.level, gem.quality, gem.enabled, gem.enableGlobal1, gem.enableGlobal2 })
							if w.level then gem.level = w.level end
							if w.quality then gem.quality = w.quality end
							if w.g1 ~= nil then gem.enableGlobal1 = w.g1 end
							if w.g2 ~= nil then gem.enableGlobal2 = w.g2 end
							gem.enabled = true  -- active chez le guide (seules ses gemmes actives sont envoyées)
							break
						end
					end
				end
				-- même emplacement que le guide (les mods « Socketed gems… » de l'objet en dépendent)
				-- nombre de copies de la compétence (ex. 14 armes animées)
				if x.count ~= nil and (g.groupCount or 1) ~= x.count then
					t_insert(groupSaved, { g, g.enabled, nil, g.groupCount or false })
					g.groupCount = x.count
				end
				-- (« » = groupe sans emplacement chez le guide)
				if x.slot ~= nil then
					local want = x.slot ~= "" and x.slot or nil
					if want ~= g.slot then
						t_insert(groupSaved, { g, g.enabled, g.slot or false })
						g.slot = want
					end
				end
				-- support imprégné du guide sur ce groupe et son emplacement (« » = aucun)
				if x.imbued ~= nil then setImbued(g, x.imbued) end
				local off = { }
				for _, n in ipairs(x.disable or { }) do off[n:lower()] = true end
				for _, gem in ipairs(g.gemList) do
					if off[gname(gem)] and gem.enabled ~= false then
						t_insert(savedGems, { gem, gem.level, gem.quality, gem.enabled })
						gem.enabled = false
					end
				end
				for _, w in ipairs(x.add or { }) do
					local gem = newGem(w)
					t_insert(g.gemList, gem)
					t_insert(addedGems, { g, gem })
				end
				touched[g] = true
			end
		end
		-- tes groupes sans équivalent dans le guide : coupés
		for _, idx in ipairs(a.disableGroups or { }) do
			local g = list[idx]
			if g and g.enabled ~= false then
				-- sans emplacement aussi : PoB compte les gemmes de tous les groupes d'un emplacement pour savoir
				-- dans quel socket (et donc quelle couleur, +10 % de qualité) tombe chaque gemme
				t_insert(groupSaved, { g, g.enabled, g.slot or false })
				g.enabled = false
				g.slot = nil
			end
		end
		-- groupes du guide absents chez toi : ajoutés
		for _, x in ipairs(a.newGroups or { }) do
			local g = { label = "Lucid", enabled = true, slot = x.slot, source = nil, gemList = { } }
			for _, w in ipairs(x.gems or { }) do t_insert(g.gemList, newGem(w)) end
			if x.imbued and x.imbued ~= "" then setImbued(g, x.imbued) end
			-- groupe d'une compétence donnée par un objet chez le guide : rattaché à l'objet posé à l'étape 1
			if x.fromItem and x.slot and tab.slots[x.slot] then
				local it = tab.items[tab.slots[x.slot].selItemId or 0]
				local gem1 = g.gemList[1]
				for _, gs in ipairs(it and it.grantedSkills or { }) do
					if gem1 and gs.skillId == gem1.skillId then
						g.source, g.sourceItem = it.modSource, it
						gem1.fromItem, gem1.level, gem1.gemId = true, gs.level, nil
						g.noSupports, gem1.noSupports = gs.noSupports, gs.noSupports
						break
					end
				end
			end
			if #g.gemList > 0 then
				build.skillsTab:ProcessSocketGroup(g)
				-- à la place des groupes qu'il remplace (même ordre de sockets que chez le guide)
				local at = x.at and list[x.at] and x.at or #list + 1
				t_insert(list, at, g)
				t_insert(addedGroups, g)
			end
		end
		for g in pairs(touched) do build.skillsTab:ProcessSocketGroup(g) end
		local fin = calcFunc(ov, true)
		res.gems = dpsLike(fin, src)
		-- 4. + réglages du perso hors config : niveau du personnage, flasques cochées actives
		if a.level and a.level ~= build.characterLevel then
			oldLevel = build.characterLevel
			build.characterLevel = a.level
		end
		-- bandit et panthéon du guide (choix du personnage, gardés partout ailleurs dans la comparaison)
		local cin = configInput(build)
		local chDirty = false
		for k, v in pairs(a.choices or { }) do
			if v ~= NULL and cin[k] ~= v then
				t_insert(choiceSaved, { k, cin[k] })
				cin[k] = v
				chDirty = true
			end
		end
		if chDirty then build.configTab:BuildModList() end
		for slotName, on in pairs(a.flasks or { }) do
			local sl = tab.slots[slotName]
			if sl and (sl.active and true or false) ~= on then
				t_insert(flaskSaved, { sl, sl.active })
				sl.active = on
			end
		end
		fin = calcFunc(ov, true)
		res.settings = dpsLike(fin, src)
		-- 5. onglet Party : tes buffs de groupe importés (auras, malédictions, objets d'un allié) retirés
		local pt = build.partyTab
		if a.clearParty and pt and partyHas(pt) then
			oldParty = { pt.actor, pt.enemyModList }
			pt.actor = { Aura = { }, Curse = { }, Warcry = { }, Link = { }, modDB = new("ModDB"):ModDB(), output = { } }
			pt.actor.modDB.actor = pt.actor
			pt.enemyModList = new("ModList"):ModList()
			fin = calcFunc(ov, true)
		end
		res.party = dpsLike(fin, src)
		-- 6. + lignes ajoutées à la main par l'auteur du guide (Custom Modifiers), à la place des tiennes
		if a.customMods then
			local ct = build.configTab
			cset = ct.configSets and ct.configSets[ct.activeConfigSetId]
			if cset then
				oldMods = cset.customModsList or { }
				cset.customModsList = { { title = "Guide", enabled = true, text = a.customMods } }
				ct:BuildModList()
				fin = calcFunc(ov, true)
			end
		end
		res.customMods = dpsLike(fin, src)
	end)
	-- restauration (toujours)
	for i = #itemGroupSaved, 1, -1 do
		local x = itemGroupSaved[i]
		x[1].source, x[1].sourceItem, x[1].enabled = x[2], x[3], x[4]
		if x[5] then x[5].level = x[6] end
	end
	for i = #imbuedSaved, 1, -1 do imbuedSaved[i][1].imbuedSupport = imbuedSaved[i][2] or nil end
	for slotName, v in pairs(imbuedSlotSaved) do build.skillsTab.imbuedSupportBySlot[slotName] = v[1] or nil end
	if oldParty then build.partyTab.actor, build.partyTab.enemyModList = oldParty[1], oldParty[2] end
	if #choiceSaved > 0 then
		local cin = configInput(build)
		for i = #choiceSaved, 1, -1 do cin[choiceSaved[i][1]] = choiceSaved[i][2] end
		if not oldMods then pcall(build.configTab.BuildModList, build.configTab) end
	end
	if oldMods then
		cset.customModsList = oldMods
		pcall(build.configTab.BuildModList, build.configTab)
	end
	if oldLevel then build.characterLevel = oldLevel end
	for _, x in ipairs(flaskSaved) do x[1].active = x[2] end
	for i = #addedGems, 1, -1 do
		local g, gem = addedGems[i][1], addedGems[i][2]
		for k = #g.gemList, 1, -1 do if g.gemList[k] == gem then table.remove(g.gemList, k) break end end
	end
	for i = #savedGems, 1, -1 do
		local x = savedGems[i]
		x[1].level, x[1].quality, x[1].enabled = x[2], x[3], x[4]
		if x[5] ~= nil or x[6] ~= nil then x[1].enableGlobal1, x[1].enableGlobal2 = x[5], x[6] end
	end
	for i = #groupSaved, 1, -1 do
		local x = groupSaved[i]
		x[1].enabled = x[2]
		if x[3] ~= nil then x[1].slot = x[3] or nil end
		if x[4] ~= nil then x[1].groupCount = x[4] or nil end
	end
	for _, g in ipairs(addedGroups) do
		for k = #list, 1, -1 do if list[k] == g then table.remove(list, k) break end end
	end
	for g in pairs(touched) do pcall(build.skillsTab.ProcessSocketGroup, build.skillsTab, g) end
	for i = #placed, 1, -1 do
		local slot, old, id = placed[i][1], placed[i][2], placed[i][3]
		slot.selItemId = old
		if id then tab.items[id] = nil end
		if placed[i][4] and not placed[i][6] then placed[i][4][placed[i][5]] = nil end
	end
	if not ok then error(err, 0) end
	return res
end

-- Valeur des nœuds déjà pris (retrait)
function Bridge.nodeValues(a)
	local build = B()
	local spec = build.spec
	local calcFunc = calculator()
	local base = calcFunc({ }, true)
	local results = { }
	for _, id in ipairs(a.ids or { }) do
		local node = spec.allocNodes[id]
		if node then
			local rem = { [node] = true }
			if node.depends then for _, dn in ipairs(node.depends) do rem[dn] = true end end
			local out = calcFunc({ removeNodes = rem }, true)
			local r = { id = id, name = node.dn, stats = node.sd, recipe = node.recipe, head = headline(base, out) }
			-- nœuds qui tombent avec lui (chemin brisé), comme le surlignage rouge de PoB
			local lost, freed = { }, 0
			for dn in pairs(rem) do
				if not dn.ascendancyName or dn.type ~= "AscendClassStart" then freed = freed + ((dn.type == "Mastery" or dn.isProxy) and 0 or 1) end
				if dn ~= node and (dn.type == "Notable" or dn.type == "Keystone" or dn.type == "Mastery") then t_insert(lost, dn.dn) end
			end
			table.sort(lost)
			r.dependents = (function() local c = 0 for _ in pairs(rem) do c = c + 1 end return c - 1 end)()
			r.lostNames = lost
			r.points = freed
			if a.detail then
				r.diff = diffOutputs(build, base, out)
				if base.Minion and out.Minion then
					r.minionDiff = diffOutputs(build, base.Minion, out.Minion, build.minionDisplayStats, build.calcsTab.mainEnv.minion)
				end
			end
			t_insert(results, r)
		end
	end
	return results
end

-- Détecte automatiquement l'étape du guide la plus proche du personnage fourni (lecture seule, sans changer l'état PoB)
function Bridge.detectStage(a)
	local build = B()
	local p = a.player or { }
	local pLevel = p.level or 1
	local pUniques, pKeystones, pClusters = { }, { }, { }

	for _, s in ipairs(p.items or { }) do
		local it = s.item
		if it and (it.rarity == "UNIQUE" or it.rarity == "RELIC") then
			local uname = (it.title and it.title ~= "" and it.title or (it.name or ""):match("^([^,]+)") or ""):lower()
			if uname ~= "" then pUniques[uname] = true end
		end
	end
	for _, k in ipairs((p.tree and p.tree.keystones) or { }) do
		if k.name then pKeystones[k.name:lower()] = true end
	end
	for _, n in ipairs((p.tree and p.tree.notables) or { }) do
		if n.id and n.id >= 65536 and n.name then
			pClusters[n.name:lower()] = true
		end
	end

	local bestId, bestScore, bestReason = 1, -1e9, ""
	local ranking = { }

	for id, spec in ipairs(build.treeTab.specList) do
		local title = strip(spec.title or "Default")
		local isVariant = title:lower():match("option") or title:lower():match("variante") or title:lower():match("uber")

		-- Trouve l'itemSet correspondant par nom sans appeler SetActiveItemSet
		local targetSet = build.itemsTab.itemSets[build.itemsTab.activeItemSetId]
		for _, iid in ipairs(build.itemsTab.itemSetOrderList) do
			local cand = build.itemsTab.itemSets[iid]
			if cand and strip(cand.title or "") == title then
				targetSet = cand
				break
			end
		end

		local used = spec:CountAllocNodes()
		local gLevel = estimatedLevel(build, used)
		local score = -math.abs(pLevel - gLevel) * 2
		local reasons = { }

		-- 1. Keystones & Cluster Notables (lecture directe de spec.allocNodes)
		local ksMatch, clMatch = 0, 0
		for nid, node in pairs(spec.allocNodes or { }) do
			local kind = nodeKind(node)
			local dn = (node.dn or ""):lower()
			if kind == "keystone" and pKeystones[dn] then
				score = score + 30
				ksMatch = ksMatch + 1
			elseif kind == "notable" and nid >= 65536 and pClusters[dn] then
				score = score + 20
				clMatch = clMatch + 1
			end
		end
		if ksMatch > 0 then t_insert(reasons, ksMatch .. " keystone(s)") end
		if clMatch > 0 then t_insert(reasons, clMatch .. " cluster(s)") end

		-- 2. Objets Uniques (lecture directe de targetSet)
		local uMatch = 0
		if targetSet then
			for _, slot in ipairs(build.itemsTab.orderedSlots) do
				local slotEntry = targetSet[slot.slotName]
				local it = slotEntry and build.itemsTab.items[slotEntry.selItemId]
				if it and (it.rarity == "UNIQUE" or it.rarity == "RELIC") then
					local uname = (it.title and it.title ~= "" and it.title or (it.name or ""):match("^([^,]+)") or ""):lower()
					if pUniques[uname] then
						score = score + 35
						uMatch = uMatch + 1
					end
				end
			end
		end
		if uMatch > 0 then t_insert(reasons, uMatch .. " unique(s)") end
		if isVariant then score = score - 15 end

		t_insert(reasons, "niv. ~" .. gLevel)
		t_insert(ranking, { id = id, title = title, score = score, level = gLevel, reasons = table.concat(reasons, ", ") })

		if score > bestScore then
			bestScore = score
			bestId = id
			bestReason = table.concat(reasons, " · ")
		end
	end

	return { treeId = bestId, score = bestScore, reason = bestReason, ranking = ranking }
end

return "ok"
