-- Lucid — Linter de build (analyseur de cohérence).
-- Croise trois sources : la configuration supposée par le guide, le build réel du joueur
-- et les statistiques calculées par le moteur PoB. Les règles sont des fichiers indépendants
-- (lucid/rules/*.lua) relus à chaque analyse : on en ajoute à chaque ligue sans toucher au cœur.
--
-- Une règle :
--   { id, category = "SURVIE"|"DPS"|"MECANIQUE"|"CONFIG", severity = "CRITIQUE"|"ATTENTION"|"CONSEIL", title,
--     triggerCondition(guide, player)        -> bool   : la règle s'applique-t-elle ? (prérequis du guide)
--     isFailing(stats, player, guide)        -> bool, data : test chiffré sur les stats PoB du joueur
--     calculateImpact(player, engine, data)  -> impact (facultatif) : simulation corrective dans PoB
--     formatMessage(stats, impact, player, guide, data) -> texte pédagogique
--     fix (facultatif) : ce qu'il faut faire, en une phrase }

local t_insert = table.insert
local NULL = require("dkjson").null
local configVarList = require("Modules.ConfigOptions")

local function B() return main.modes["BUILD"] end

local function num(v)
	if type(v) ~= "number" or v ~= v then return nil end
	if v == math.huge then return 1e300 end
	if v == -math.huge then return -1e300 end
	return v
end

local function lower(s) return type(s) == "string" and StripEscapes(s):lower() or "" end

local function configInput(build)
	local ct = build.configTab
	local set = ct.configSets and ct.configSets[ct.activeConfigSetId]
	return set and set.input or ct.input or { }, set
end

------------------------------------------------------------------------ outils communs aux règles
local L = { }
Lint = L

local labels
function L.label(var)
	if not labels then
		labels = { }
		for _, vd in ipairs(configVarList) do
			if vd.var and vd.label and not labels[vd.var] then labels[vd.var] = StripEscapes(vd.label) end
		end
	end
	return labels[var] or var
end

-- Format d'un nombre à la française : 1 234,5
function L.n(v, dec)
	v = tonumber(v) or 0
	dec = dec or (math.abs(v) < 10 and v ~= math.floor(v) and 1 or 0)
	local s = string.format("%." .. dec .. "f", v)
	local int, frac = s:match("^(-?%d+)%.?(%d*)$")
	if not int then return s end
	int = int:reverse():gsub("(%d%d%d)", "%1 "):reverse():gsub("^(-?) ", "%1")
	return int .. (frac ~= "" and ("," .. frac) or "")
end

function L.pct(v) return L.n(v) .. " %" end

-- Texte court d'un impact { dps = %, ehp = %, life = abs, … }
function L.impactText(i)
	if type(i) ~= "table" then return i end
	local parts = { }
	local function add(v, what)
		if v and math.abs(v) >= 0.5 then
			t_insert(parts, (v > 0 and "+" or "−") .. L.n(math.abs(v), math.abs(v) < 10 and 1 or 0) .. " % " .. what)
		end
	end
	add(i.dps, "de DPS")
	add(i.ehp, "de survie (Max Hit)")
	if #parts == 0 then return nil end
	return table.concat(parts, ", ")
end

------------------------------------------------------------------------ profil d'un build (joueur ou guide)
local PROFILE_KEYS = {
	"TotalDPS", "CombinedDPS", "FullDPS", "TotalDotDPS", "HitChance", "AccuracyHitChance", "CritChance", "Speed",
	"Life", "LifeUnreserved", "LifeUnreservedPercent", "EnergyShield", "Mana", "ManaUnreserved", "ManaUnreservedPercent", "TotalEHP",
	"FireResist", "ColdResist", "LightningResist", "ChaosResist",
	"FireResistOverCap", "ColdResistOverCap", "LightningResistOverCap", "ChaosResistOverCap", "MissingFireResist", "MissingColdResist", "MissingLightningResist",
	"MissingChaosResist", "SpellSuppressionChance", "BlockChance", "SpellBlockChance", "Armour", "Evasion",
	"PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken", "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
	"LifeRegenRecovery", "NetLifeRegen", "TotalBuildDegen", "LifeLeechGainRate", "ManaRegenRecovery", "NetManaRegen",
	"Str", "Dex", "Int", "ReqStr", "ReqDex", "ReqInt", "ManaCost", "ManaPerSecondCost", "LifeCost",
	"PowerChargesMax", "FrenzyChargesMax", "EnduranceChargesMax", "PowerChargesMin", "FrenzyChargesMin", "EnduranceChargesMin",
	"ShockChanceOnHit", "ChillChanceOnHit", "FreezeChanceOnHit", "IgniteChanceOnHit", "ShockChanceOnCrit", "IgniteChanceOnCrit",
	"FreezeChanceOnCrit", "BleedChanceOnHit", "PoisonChanceOnHit",
	"FireMax", "ColdMax", "LightningMax", "PhysicalMax", "ChaosMax",
}

local function pickKeys(o)
	local r = { }
	if not o then return r end
	for _, k in ipairs(PROFILE_KEYS) do if type(o[k]) == "number" then r[k] = num(o[k]) end end
	local hp, mh, mt = Bridge._survival(o)
	r.HitPool, r.MinMaxHit, r.MinMaxHitType = num(hp), num(mh), mt
	return r
end

local function gemTags(gd)
	local tags = { }
	for k, v in pairs(gd and gd.tags or { }) do if v then t_insert(tags, k) end end
	return tags
end

local function buildProfile(build)
	local output = build.calcsTab.mainOutput or { }
	local env = build.calcsTab.mainEnv
	local corpus = { }
	local function add(prefix, s) if s and s ~= "" then t_insert(corpus, prefix .. lower(s)) end end

	-- objets équipés
	local items, flasks, uniques = { }, { }, { }
	local tab = build.itemsTab
	for _, slot in ipairs(tab.orderedSlots) do
		local id = slot.selItemId or 0
		local item = id ~= 0 and tab.items[id]
		local active = item and not slot.slotName:match("Swap")
		if active and slot.nodeId then active = build.spec.allocNodes[slot.nodeId] ~= nil end
		if active then
			local name = StripEscapes(item.name or "")
			add("item:", name)
			add("item:", item.baseName)
			for _, list in ipairs({ item.enchantModLines, item.scourgeModLines, item.implicitModLines, item.explicitModLines, item.crucibleModLines }) do
				for _, ml in ipairs(list or { }) do
					if item:CheckModLineVariant(ml) then add("item:", ml.line) end
				end
			end
			local row = { slot = slot.slotName, name = name, base = item.baseName, rarity = item.rarity }
			if slot.slotName:match("^Flask") then
				-- lignes de mods de la flasque (enchantements compris), en minuscules : pour les règles de flasques
				row.mods = { }
				for _, list in ipairs({ item.enchantModLines, item.implicitModLines, item.explicitModLines, item.crucibleModLines }) do
					for _, ml in ipairs(list or { }) do
						if item:CheckModLineVariant(ml) then t_insert(row.mods, lower(ml.line)) end
					end
				end
			end
			t_insert(items, row)
			if item.rarity == "UNIQUE" or item.rarity == "RELIC" then t_insert(uniques, name) end
			if slot.slotName:match("^Flask") then t_insert(flasks, row) end
		end
	end

	-- équipement des sbires (Animated Guardian) : ses objets appliquent eux aussi des effets
	local guardian = { }
	local tabSets = build.itemsTab.itemSets
	for _, g in ipairs(Bridge._minionGear(build)) do
		if g.enabled then
			for _, sl in ipairs(g.slots) do
				local it = sl.item
				if it then
					local item = build.itemsTab.items[it.id]
					t_insert(guardian, { slot = sl.slot, name = it.name, base = it.base, rarity = it.rarity, skill = g.skill })
					add("guardian:", it.name)
					add("guardian:", it.base)
					if item then
						for _, list in ipairs({ item.enchantModLines, item.scourgeModLines, item.implicitModLines, item.explicitModLines, item.crucibleModLines }) do
							for _, ml in ipairs(list or { }) do
								if item:CheckModLineVariant(ml) then add("guardian:", ml.line) end
							end
						end
					end
				end
			end
		end
	end

	-- arbre (y compris maîtrises choisies et ascendance)
	local keystones, ascNotables = { }, { }
	for _, node in pairs(build.spec.allocNodes) do
		add("tree:", node.dn)
		for _, l in ipairs(node.sd or { }) do add("tree:", l) end
		if node.type == "Keystone" or node.isKeystone then t_insert(keystones, node.dn) end
		if node.ascendancyName and (node.type == "Notable" or node.isNotable) then t_insert(ascNotables, node.dn) end
	end
	table.sort(keystones) table.sort(ascNotables)

	-- gemmes (groupes et gemmes actifs)
	local gems, mainGems = { }, { }
	for gi, g in ipairs(build.skillsTab.socketGroupList) do
		if g.enabled ~= false then
			for _, gem in ipairs(g.gemList) do
				local gd = gem.gemData
				local ge = gd and gd.grantedEffect or gem.grantedEffect
				if gem.enabled ~= false and (gd or ge) then
					local name = gd and gd.name or ge.name
					local e = { name = name, level = gem.level, quality = gem.quality, support = ge and ge.support and true or false,
						tags = gemTags(gd), group = gi, main = gi == build.mainSocketGroup or nil,
						maxLevel = gd and gd.naturalMaxLevel or nil }
					t_insert(gems, e)
					if e.main then t_insert(mainGems, e) end
					add("gem:", name)
					for _, t in ipairs(e.tags) do add("tag:", t) end
					if ge and ge.description then add("gemdesc:", ge.description) end
				end
			end
		end
	end

	local mainSkill = env and env.player and env.player.mainSkill
	local flags = { }
	for k, v in pairs(mainSkill and mainSkill.skillFlags or { }) do if v == true then flags[k] = true end end
	local cfg = { }
	for k, v in pairs(configInput(build)) do if type(v) ~= "table" then cfg[k] = v end end
	local modDB = env and env.player and env.player.modDB
	-- ce qui demande le plus de chaque attribut (objet ou gemme), d'après « Req<Attr>Item » de PoB
	local reqSrc = { }
	for _, at in ipairs({ "Str", "Dex", "Int" }) do
		local r = output["Req" .. at .. "Item"]
		if type(r) == "table" then
			reqSrc[at] = r.sourceItem and StripEscapes(r.sourceItem.name or "") or (r.sourceGem and r.sourceGem.nameSpec) or nil
		end
	end
	return {
		reqSrc = reqSrc,
		level = build.characterLevel,
		class = build.spec.curClassName,
		ascendancy = build.spec.curAscendClassName,
		mainSkill = mainSkill and mainSkill.activeEffect and mainSkill.activeEffect.grantedEffect.name or nil,
		flags = flags,
		cfg = cfg,
		key = pickKeys(output),
		minion = output.Minion and pickKeys(output.Minion) or nil,
		ci = modDB and modDB:Flag(nil, "ChaosInoculation") or false,
		-- Supreme Ostentation, Doryani's Lesson… : les exigences d'attributs ne s'appliquent plus
		ignoreAttrReq = modDB and modDB:Flag(nil, "IgnoreAttributeRequirements") or false,
		esCap = Bridge._esCap and Bridge._esCap(build) or nil,
		-- budget de mana (insight.lua) : compétence la plus forte, sorts déclenchés, réserve libre
		mana = Bridge.manaBudget and (function() local ok, r = pcall(Bridge.manaBudget) return ok and r or nil end)() or nil,
		-- compétence principale : fait-elle des dégâts ? (un Dash choisi par erreur fausse tous les gains)
		mainCheck = Bridge.mainSkillCheck and (function() local ok, r = pcall(Bridge.mainSkillCheck) return ok and r or nil end)() or nil,
		corpus = corpus,
		items = items, flasks = flasks, uniques = uniques, guardian = guardian,
		keystones = keystones, ascNotables = ascNotables,
		gems = gems, mainGems = mainGems,
	}
end

-- Méthodes communes au profil du joueur et à celui du guide
local Profile = { }
Profile.__index = Profile

-- Première ligne du build (objets, arbre, gemmes) qui correspond à l'un des motifs Lua (en minuscules).
-- `exclude` : motifs qui disqualifient la ligne (ex. « avoid », « immune » pour une altération subie).
function Profile:find(patterns, exclude)
	if type(patterns) == "string" then patterns = { patterns } end
	for _, line in ipairs(self.corpus or { }) do
		for _, p in ipairs(patterns) do
			if line:find(p) then
				local bad = false
				for _, x in ipairs(exclude or { }) do if line:find(x) then bad = true break end end
				if not bad then
					local src, txt = line:match("^(%w+):(.*)$")
					if src == "guardian" then return txt .. " (Guardian)" end
					return txt or line
				end
			end
		end
	end
	return nil
end
function Profile:has(patterns, exclude) return self:find(patterns, exclude) ~= nil end

function Profile:hasGem(name)
	name = name:lower()
	for _, g in ipairs(self.gems or { }) do if g.name:lower() == name then return g end end
	return nil
end

function Profile:gemsTagged(tag)
	local out = { }
	for _, g in ipairs(self.gems or { }) do
		for _, t in ipairs(g.tags or { }) do if t == tag then t_insert(out, g) break end end
	end
	return out
end

function Profile:hasUnique(name)
	-- nom complet (« Mageblood, Heavy Belt ») ou nom de l'unique seul (« Mageblood »)
	for _, u in ipairs(self.uniques or { }) do if u == name or u:match("^([^,]+)") == name then return true end end
	return false
end

function Profile:hasKeystone(name)
	for _, k in ipairs(self.keystones or { }) do if k == name then return true end end
	return false
end

-- Valeur d'une option de config (nil si décochée / 0)
function Profile:opt(var)
	local v = self.cfg and self.cfg[var]
	if v == false or v == 0 or v == "" or v == NULL then return nil end
	return v
end

-- Stat de la compétence principale du joueur, ou des sbires si c'est une compétence de sbire
function Profile:stat(k)
	local v = self.key and self.key[k]
	if (v == nil or v == 0) and self.minion and self.minion[k] then return self.minion[k] end
	return v or 0
end

function Profile:isMinionBuild() return self.flags and self.flags.minion or false end

------------------------------------------------------------------------ simulations correctives (moteur PoB)
local Engine = { }
Engine.__index = Engine

local function headline(base, new)
	local _, src = Bridge._globalDps(base)
	local function pick(o)
		local dps = Bridge._dpsLike(o, src)
		return dps, (o.Life or 0), (o.EnergyShield or 0), (Bridge._survival(o))
	end
	local d0, l0, e0, h0 = pick(base)
	local d1, l1, e1, h1 = pick(new)
	local function pct(a, b) if a == 0 then return b ~= 0 and 100 or 0 end return (b - a) / math.abs(a) * 100 end
	return { dps = num(pct(d0, d1)), ehp = num(pct(h0, h1)), life = num(l1 - l0), es = num(e1 - e0),
		dpsAbs = num(d1 - d0), ehpAbs = num(h1 - h0) }
end

local function calcNow(build)
	return build.calcsTab:GetMiscCalculator()({ }, true)
end

function Engine.new(build)
	return setmetatable({ build = build, count = 0 }, Engine)
end

function Engine:base()
	if not self._base then self._base = calcNow(self.build) end
	return self._base
end

-- Change des options de config le temps d'un calcul, puis restaure tout : { var = valeur | false }
function Engine:simulate(changes, mods)
	local build = self.build
	local input, set = configInput(build)
	local base = self:base()
	local saved, block = { }, nil
	-- tout ce qui modifie le build est protégé : la restauration a lieu même si BuildModList échoue
	local ok, out = pcall(function()
		for k, v in pairs(changes or { }) do
			saved[k] = { input[k] }
			if v == false then input[k] = nil else input[k] = v end
		end
		if mods and #mods > 0 and set then
			set.customModsList = set.customModsList or { }
			block = { title = "Lucid", enabled = true, text = table.concat(mods, "\n") }
			t_insert(set.customModsList, block)
		end
		build.configTab:BuildModList()
		return calcNow(build)
	end)
	for k, v in pairs(saved) do input[k] = v[1] end
	if block then
		for i, b in ipairs(set.customModsList) do if b == block then table.remove(set.customModsList, i) break end end
	end
	pcall(build.configTab.BuildModList, build.configTab)
	self.count = self.count + 1
	if not ok then return nil end
	self.lastOut = out
	return headline(base, out)
end

-- Ajoute des lignes de mods (comme dans « Custom Modifiers » de PoB) le temps d'un calcul
function Engine:simulateMods(lines)
	if type(lines) == "string" then lines = { lines } end
	return self:simulate(nil, lines)
end

------------------------------------------------------------------------ exécution
local SEVERITY = { CRITIQUE = 1, ATTENTION = 2, CONSEIL = 3 }
local CATEGORY = { SURVIE = true, DPS = true, MECANIQUE = true, CONFIG = true }

function Bridge.lintProfile()
	return buildProfile(B())
end

-- a = { rules = { { name, code } }, guide = profil du guide (ou nil : le build se juge lui-même), compare = { items, toTake } }
function Bridge.lint(a)
	local build = B()
	local t0 = GetTime and GetTime() or 0
	local player = setmetatable(buildProfile(build), Profile)
	local guide = a.guide and a.guide ~= NULL and setmetatable(a.guide, Profile) or player
	guide.isGuide = a.guide ~= nil and a.guide ~= NULL
	player.compare = a.compare ~= NULL and a.compare or { }
	local output = build.calcsTab.mainOutput
	local engine = Engine.new(build)
	local findings, errors, total = { }, { }, 0
	-- règles ignorées par le créateur du guide (guideMeta) : partout, ou seulement sur l'étape active
	local off, ignored = { }, { }
	local meta = a.guideMeta ~= NULL and a.guideMeta or nil
	if type(meta) == "table" then
		for _, id in ipairs(type(meta.globalDisabledRules) == "table" and meta.globalDisabledRules or { }) do off[id] = "global" end
		local st = type(meta.steps) == "table" and a.activeStep and a.activeStep ~= NULL and meta.steps[a.activeStep] or nil
		for _, id in ipairs(type(st) == "table" and type(st.disabledRules) == "table" and st.disabledRules or { }) do off[id] = off[id] or "step" end
	end

	for _, file in ipairs(a.rules or { }) do
		local chunk, err = loadstring(file.code, "@rules/" .. file.name)
		local ok, rules = false, err
		if chunk then ok, rules = pcall(chunk, L) end
		if not ok or type(rules) ~= "table" then
			t_insert(errors, file.name .. " : " .. tostring(rules))
		else
			for _, r in ipairs(rules) do
				total = total + 1
				local function fail(stage, e) t_insert(errors, (r.id or "?") .. " (" .. stage .. ") : " .. tostring(e)) end
				local ok1, trig = pcall(r.triggerCondition or function() return true end, guide, player)
				if not ok1 then fail("triggerCondition", trig)
				elseif trig then
					local ok2, failing, data = pcall(r.isFailing, output, player, guide)
					if not ok2 then fail("isFailing", failing)
					elseif failing then
						local impact
						if r.calculateImpact then
							local ok3, res = pcall(r.calculateImpact, player, engine, data)
							if ok3 then impact = res else fail("calculateImpact", res) end
						end
						local ok4, msg = pcall(r.formatMessage, output, impact, player, guide, data)
						if not ok4 then fail("formatMessage", msg) msg = r.title end
						local fix = r.fix
						if type(fix) == "function" then
							local ok5, f = pcall(fix, player, guide, data)
							fix = ok5 and f or nil
						end
						-- sévérité et titre peuvent dépendre de l'écart mesuré : function(data, player, guide)
						local sev, title = r.severity, r.title
						if type(sev) == "function" then
							local ok6, v = pcall(sev, data, player, guide)
							sev = ok6 and v or "ATTENTION"
						end
						if type(title) == "function" then
							local ok7, v = pcall(title, data, player, guide)
							title = ok7 and v or r.id
						end
						local dest = findings
						if off[r.id] then dest = ignored end
						-- dropIfNoImpact : la correction mesurée par PoB ne change rien (ex. précision d'un build
						-- de sbires : ce sont eux qui touchent) → pas d'alerte
						if r.dropIfNoImpact and (type(impact) ~= "table"
							or (math.abs(impact.dps or 0) < 0.5 and math.abs(impact.ehp or 0) < 0.5)) then dest = { } end
						t_insert(dest, {
							id = r.id, title = title,
							category = CATEGORY[r.category] and r.category or "MECANIQUE",
							severity = SEVERITY[sev] and sev or "CONSEIL",
							message = msg, fix = fix,
							impact = type(impact) == "table" and impact or nil,
							impactText = L.impactText(impact),
							file = file.name,
						})
					end
				end
			end
		end
	end

	table.sort(findings, function(x, y)
		if x.severity ~= y.severity then return SEVERITY[x.severity] < SEVERITY[y.severity] end
		local ix = x.impact and math.max(math.abs(x.impact.dps or 0), math.abs(x.impact.ehp or 0)) or 0
		local iy = y.impact and math.max(math.abs(y.impact.dps or 0), math.abs(y.impact.ehp or 0)) or 0
		if ix ~= iy then return ix > iy end
		return (x.id or "") < (y.id or "")
	end)
	for _, f in ipairs(ignored) do f.ignoredBy = off[f.id] end
	return { findings = findings, ignored = ignored, errors = errors, rules = total, simulations = engine.count, mana = player.mana,
		ignoreAttrReq = player.ignoreAttrReq or nil,
		-- attributs lus par les règles (la colonne Santé affiche les mêmes)
		attrs = { Str = player.key.Str, Dex = player.key.Dex, Int = player.key.Int, ReqStr = player.key.ReqStr, ReqDex = player.key.ReqDex, ReqInt = player.key.ReqInt },
		withGuide = guide.isGuide, ms = GetTime and (GetTime() - t0) or nil }
end

------------------------------------------------------------------------ conditions réalistes
-- Le perso est simulé dans la situation de combat du guide (boss, état de l'ennemi…), MAIS sans les conditions
-- qu'il ne peut pas activer lui-même : charges sans source, altérations qu'il n'inflige pas… (règles needsSource
-- de rules/a_config.lua). Une condition n'est retirée que si le guide, lui, en montre la source : sinon c'est une
-- hypothèse invérifiable des deux côtés et on la garde, pour comparer à conditions égales.
local function gateList(files)
	L.gates = { }
	for _, file in ipairs(files or { }) do
		local chunk = loadstring(file.code, "@rules/" .. file.name)
		if chunk then pcall(chunk, L) end
	end
	local g = L.gates
	L.gates = nil
	return g
end
local function hasSrc(d, p)
	if d.has then
		local ok, r = pcall(d.has, p)
		if ok and r then return true, "stat" end
	end
	-- objets du Guardian : ses effets (charges…) sont les siens, pas ceux du joueur
	local own = { }
	for _, line in ipairs(p.corpus or { }) do if not line:match("^guardian:") then t_insert(own, line) end end
	local f = setmetatable({ corpus = own }, Profile):find(d.sources, d.exclude)
	return f ~= nil, f
end
-- nombre de lignes du build qui sont une source (pour savoir si un objet est la SEULE source)
local function countSrc(d, p)
	local n = 0
	for _, line in ipairs(p.corpus or { }) do
		if line:match("^guardian:") then goto continue end
		for _, pat in ipairs(d.sources) do
			if line:find(pat) then
				local bad = false
				for _, x in ipairs(d.exclude or { }) do if line:find(x) then bad = true break end end
				if not bad then n = n + 1 end
				break
			end
		end
		::continue::
	end
	return n
end

function Bridge.gateConfig(a)
	local build = B()
	local player = setmetatable(buildProfile(build), Profile)
	local guide = a.guide and a.guide ~= NULL and setmetatable(a.guide, Profile) or nil
	local gcfg = a.guideCfg ~= NULL and a.guideCfg or { }
	local drop, keep = { }, { }
	for _, d in ipairs(gateList(a.rules)) do
		local gv = gcfg[d.var]
		if gv ~= nil and gv ~= false and gv ~= 0 and gv ~= NULL then
			local pHas, how = hasSrc(d, player)
			if not pHas then
				local gHas, gHow = false, nil
				if guide then gHas, gHow = hasSrc(d, guide) end
				if gHas then
					t_insert(drop, { var = d.var, label = L.label(d.var), what = d.what, value = gv, sources = d.sources, exclude = d.exclude,
						guideSrc = type(gHow) == "string" and gHow ~= "stat" and gHow or nil })
				end
			elseif how ~= "stat" then
				-- source seulement dans des lignes d'objets/arbre : retirer l'objet peut la faire perdre
				t_insert(keep, { var = d.var, label = L.label(d.var), sources = d.sources, exclude = d.exclude, count = countSrc(d, player) })
			end
		end
	end
	return { drop = drop, keep = keep }
end

-- Conditions retenues pour ce perso (rappelées par calcSwap lors des tests d'objets) + gain s'il avait la source
function Bridge.setGates(a)
	local drop = a.drop ~= NULL and a.drop or { }
	local keep = a.keep ~= NULL and a.keep or { }
	Bridge._gates = { drop = drop, keep = keep }
	local engine = Engine.new(B())
	for _, d in ipairs(drop) do
		d.impact = engine:simulate({ [d.var] = d.value })
		d.impactText = L.impactText(d.impact)
	end
	return { dropped = drop }
end

------------------------------------------------------------------------ écarts de stats avec le guide
-- Pour chaque stat où tu es en dessous du guide : gain de DPS / EHP si tu avais la valeur du guide.
-- On ajoute le mod équivalent (comme « Custom Modifiers » de PoB) ; pour les valeurs multipliées par tes
-- « increased » (vie, armure…), une 2e simulation ajuste la quantité pour atteindre exactement l'écart.
local GAP_MODS = {
	Life = { "+%d to maximum Life" }, EnergyShield = { "+%d to maximum Energy Shield" }, Mana = { "+%d to maximum Mana" },
	Armour = { "+%d to Armour" }, Evasion = { "+%d to Evasion Rating" },
	FireResist = { "+%d%% to Fire Resistance", exact = true }, ColdResist = { "+%d%% to Cold Resistance", exact = true },
	LightningResist = { "+%d%% to Lightning Resistance", exact = true }, ChaosResist = { "+%d%% to Chaos Resistance", exact = true },
	BlockChance = { "+%d%% Chance to Block Attack Damage", exact = true }, SpellBlockChance = { "+%d%% Chance to Block Spell Damage", exact = true },
	SpellSuppressionChance = { "+%d%% chance to Suppress Spell Damage", exact = true },
	Str = { "+%d to Strength" }, Dex = { "+%d to Dexterity" }, Int = { "+%d to Intelligence" },
	CritChance = { "+%.2f%% to Critical Strike Chance", float = true },
	Speed = { "%d%% increased Attack and Cast Speed", relative = true },
	PowerChargesMax = { "+%d to Maximum Power Charges", exact = true }, FrenzyChargesMax = { "+%d to Maximum Frenzy Charges", exact = true },
	EnduranceChargesMax = { "+%d to Maximum Endurance Charges", exact = true },
}
Bridge._GAP_MODS = GAP_MODS

function Bridge.statGaps(a)
	local build = B()
	local engine = Engine.new(build)
	local base = engine:base()
	local out = { }
	-- ES plafonnée par l'armure (Divine Shield) : armure et ES ne se jugent qu'ensemble
	local cap = Bridge._esCap and Bridge._esCap(build)
	local pair
	if cap then
		local want = { }
		for _, row in ipairs(a.rows or { }) do want[row.key] = tonumber(row.guide) end
		pair = { by = cap.by, label = cap.label, source = cap.source,
			mine = { def = cap.def, es = cap.es }, guide = { def = want[cap.by], es = want.EnergyShield } }
		local gd, ge = want[cap.by], want.EnergyShield
		if gd and ge and (gd > cap.def or ge > cap.es) then
			-- les deux mods ensemble, chacun ajusté pour atteindre la valeur du guide
			local nd, ne = math.max(0, gd - cap.def), math.max(0, ge - cap.es)
			local function lines()
				local l = { }
				if nd >= 1 then t_insert(l, string.format(GAP_MODS[cap.by][1], math.floor(nd + 0.5))) end
				if ne >= 1 then t_insert(l, string.format(GAP_MODS.EnergyShield[1], math.floor(ne + 0.5))) end
				return l
			end
			local h = engine:simulateMods(lines())
			if h then
				local o = engine.lastOut
				local gotD, gotE = (o[cap.by] or cap.def) - cap.def, (o.EnergyShield or cap.es) - cap.es
				if (nd >= 1 and gotD > 0) or (ne >= 1 and gotE > 0) then
					if nd >= 1 and gotD > 0 then nd = nd * (gd - cap.def) / gotD end
					if ne >= 1 and gotE > 0 then ne = ne * (ge - cap.es) / gotE end
					h = engine:simulateMods(lines()) or h
				end
				pair.gain = { dps = h.dps, ehp = h.ehp, mod = table.concat(lines(), " / ") }
			end
		end
	end
	for _, row in ipairs(a.rows or { }) do
		local def = GAP_MODS[row.key]
		if pair and (row.key == pair.by or row.key == "EnergyShield") then def = nil end
		local cur, want = base[row.key], tonumber(row.guide)
		if def and type(cur) == "number" and want and want > cur then
			local gap = want - cur
			local function line(n)
				if def.float then return string.format(def[1], n) end
				n = math.floor(n + 0.5)
				if n < 1 then return nil end
				return string.format(def[1], n)
			end
			local n = gap
			if def.relative then n = cur > 0 and gap / cur * 100 or 0 end
			local l = line(n)
			if l and not (def.float and gap < 0.05) then
				-- résistance au-delà de 75 % : le guide a aussi plus de maximum (ex. 90 %) — sans lui, la résistance en plus est perdue
				local lines = { l }
				local elem = row.key:match("^(%a+)Resist$")
				if elem and want > 75 then
					t_insert(lines, 1, string.format("+%d%% to maximum %s Resistance", math.floor(want - math.max(cur, 75) + 0.5), elem))
					l = table.concat(lines, " / ")
				end
				local h = engine:simulateMods(lines)
				-- ajustement : les « increased » multiplient le mod ajouté
				if h and not def.exact then
					local got = (engine.lastOut[row.key] or cur) - cur
					if got > 0 and math.abs(got - gap) / gap > 0.05 then
						local l2 = line(n * gap / got)
						if l2 then h = engine:simulateMods(l2) or h; l = l2 end
					end
				end
				if h then out[row.key] = { dps = h.dps, ehp = h.ehp, mod = l } end
			end
		end
	end
	if pair and pair.gain then out[pair.by] = { pair = true, dps = pair.gain.dps, ehp = pair.gain.ehp }; out.EnergyShield = out[pair.by] end
	return { gaps = out, esCap = pair, simulations = engine.count }
end
