-- Lucid — lecture des chiffres de PoB pour un débutant.
--   Bridge.manaBudget()      : la mana tient-elle ? (réserve libre, compétence la plus forte, sorts déclenchés)
--   Bridge.explainStats(a)   : « Pourquoi ce chiffre ? » — d'où vient chaque point d'une stat (arbre, objets, gemmes…)
-- Tout est lu dans les environnements de calcul de PoB : rien n'est recalculé à la main.

local t_insert = table.insert
local NULL = require("dkjson").null

local function B() return main.modes["BUILD"] end
local function num(v)
	if type(v) ~= "number" or v ~= v then return nil end
	if v == math.huge then return 1e300 end
	if v == -math.huge then return -1e300 end
	return v
end
local function skillName(s) return s.activeEffect and s.activeEffect.grantedEffect and s.activeEffect.grantedEffect.name or "?" end

------------------------------------------------------------------------ budget de mana
-- Chaque compétence est recalculée comme compétence principale (comme le Full DPS de PoB) pour lire
-- son coût, sa cadence (ou sa fréquence de déclenchement) et son vol de mana.
local function skillRows(build)
	local calcs = build.calcsTab.calcs
	local env = calcs.initEnv(build, "CALCULATOR")
	local rows = { }
	for _, s in ipairs(env.player.activeSkillList) do
		local reserves = s.skillTypes and s.skillTypes[SkillType.HasReservation] and not s.skillTypes[SkillType.ReservationBecomesCost]
		if not reserves and not (s.skillFlags and s.skillFlags.disable) then
			env.player.mainSkill = s
			local ok = pcall(calcs.perform, env, true)
			local o = env.player.output
			if ok and o then
				local minion = s.minion ~= nil
				local dps = minion and env.minion and env.minion.output and (env.minion.output.CombinedDPS or env.minion.output.TotalDPS) or (o.CombinedDPS or o.TotalDPS or 0)
				local triggered = (s.skillData and s.skillData.triggered) or (s.skillFlags and (s.skillFlags.triggered or s.skillFlags.globalTrigger)) or false
				-- ce qui déclenche le sort : gemme de support « Cast on… / Cast when… / Trigger… » ou objet
				local by
				for _, gem in ipairs(s.socketGroup and s.socketGroup.gemList or { }) do
					local n = gem.gemData and gem.gemData.name or gem.nameSpec or ""
					if gem.enabled ~= false and (n:match("^Cast ") or n:match("Trigger") or n:match("Spellslinger") or n:match("Arcanist")) and n ~= skillName(s) then by = n end
				end
				t_insert(rows, {
					name = skillName(s), by = by, ord = #rows + 1,
					group = s.socketGroup and (s.socketGroup.label ~= "" and s.socketGroup.label or s.socketGroup.slot) or nil,
					fromItem = s.socketGroup and s.socketGroup.source and s.socketGroup.source:match("^Item:%d+:(.+)") or nil,
					cost = num(o.ManaCost) or 0,
					perSec = num(o.ManaPerSecondCost) or 0,
					esPerSec = num(o.ESPerSecondCost) or 0,
					rate = num(o.SkillTriggerRate) or num(o.Speed) or 0,
					leech = num(o.ManaLeechGainRate) or 0,
					dps = num(dps) or 0,
					minion = minion or nil,
					triggered = triggered and true or nil,
					channel = s.skillTypes and s.skillTypes[SkillType.Channel] and true or nil,
					movement = s.skillTypes and (s.skillTypes[SkillType.Movement] or s.skillTypes[SkillType.Travel]) and true or nil,
					count = s.socketGroup and s.socketGroup.groupCount or nil,
				})
			end
		end
	end
	return rows
end

function Bridge.manaBudget()
	local build = B()
	local o = build.calcsTab.mainOutput or { }
	local env = build.calcsTab.mainEnv
	local rows = skillRows(build)
	-- compétence que tu spammes : celle qui fait le plus de dégâts parmi celles que tu lances toi-même
	local best, bestAny
	for _, r in ipairs(rows) do
		if not bestAny or r.dps > bestAny.dps then bestAny = r end
		if not r.minion and not r.triggered and not r.movement and r.dps > 0 and (not best or r.dps > best.dps) then best = r end
	end
	local spam = best
	-- build de sbires : ce sont eux qui font les dégâts, tu ne spammes rien
	if bestAny and bestAny.minion and (not best or bestAny.dps > best.dps * 3) then spam = nil end
	local triggers = { }
	for _, r in ipairs(rows) do
		if r.triggered and r.cost > 0 and r.perSec > 0 then t_insert(triggers, r) end
	end
	-- Cast on Ward Break : PoB ne limite la cadence que par le temps de recharge du support. Or la ward cassée
	-- doit d'abord se restaurer (Ward Recharge Delay, 2 s de base) avant de pouvoir recasser.
	local wardDelay = num(o.WardRechargeDelay)
	for _, t in ipairs(triggers) do
		if t.by == "Cast on Ward Break" and wardDelay and wardDelay > 0 and t.rate > 1 / wardDelay then
			t.pobRate = t.rate
			t.perSec = t.perSec * (1 / wardDelay) / t.rate
			t.rate = 1 / wardDelay
			t.wardDelay = wardDelay
		end
	end
	table.sort(triggers, function(a, b) return a.perSec > b.perSec end)
	-- auras et autres réservations (lues dans le calcul principal de PoB)
	local reserved = { }
	for _, s in ipairs(env and env.player and env.player.activeSkillList or { }) do
		local v = s.skillData and s.skillData.ManaReservedBase
		if v and v > 0 then t_insert(reserved, { name = skillName(s), value = v }) end
	end
	table.sort(reserved, function(a, b) return a.value > b.value end)

	local regen = num(o.ManaRegenRecovery) or 0
	local leech = spam and spam.leech or 0
	local use = (spam and spam.perSec or 0)
	-- la dépense continue ne concerne que le sort que tu lances toi-même : un sort déclenché part sur un
	-- événement (ward cassée, coup reçu…), on vérifie plutôt qu'une salve passe (bursts plus bas)
	local pool = num(o.ManaUnreserved) or 0
	-- regain de mana quand tu prends des coups (Recoup), moyenne calculée par PoB
	local recoup = num(o.ManaRecoupRecoveryAvg) or 0
	local net = regen + leech + recoup - use
	-- salves : un même déclencheur (Cast on Ward Break…) lance tous ses sorts au même moment.
	-- Chaque sort paie son coût ; s'il ne reste plus assez de mana, les suivants ne partent pas.
	local bursts, byKey = { }, { }
	for _, t in ipairs(triggers) do
		-- même support dans plusieurs groupes : un seul événement (la ward casse) les déclenche tous
		local key = t.by or ((t.fromItem or "?") .. "|" .. tostring(t.group))
		local g = byKey[key]
		if not g then
			g = { by = t.by or (t.fromItem and t.fromItem:gsub(",.*", "")) or "déclencheur", list = { }, cost = 0, rate = 0 }
			byKey[key] = g; t_insert(bursts, g)
		end
		t_insert(g.list, t); g.cost = g.cost + t.cost; g.rate = math.max(g.rate, t.rate)
		if t.wardDelay then g.wardDelay = t.wardDelay; g.pobRate = math.max(g.pobRate or 0, t.pobRate) end
	end
	local recov = regen + leech + recoup
	for _, g in ipairs(bursts) do
		table.sort(g.list, function(a, b) return a.ord < b.ord end)
		local left, fail, spells = pool, { }, { }
		for _, sp in ipairs(g.list) do
			if sp.cost <= left then left = left - sp.cost else t_insert(fail, sp.name) end
			t_insert(spells, { name = sp.name, cost = sp.cost, rate = sp.rate })
		end
		g.list = nil
		g.spells, g.fail = spells, fail
		g.inRow = g.cost > 0 and math.floor(pool / g.cost) or nil
		g.refill = recov > 0 and g.cost / recov or nil   -- secondes pour regagner le coût d'une salve
		-- Simulation sur 60 s : un déclenchement à chaque fois que c'est possible (période = 1 / cadence),
		-- chaque sort part s'il est prêt (sa propre recharge) et s'il reste assez de mana, dans l'ordre des gemmes.
		if g.rate > 0 then
			local period, mana, nextReady, stat = 1 / g.rate, pool, { }, { }
			local salvos, firstFail = 0, nil
			for i, sp in ipairs(spells) do nextReady[i] = 0; stat[i] = { name = sp.name, cast = 0, miss = 0 } end
			local t = 0
			while t <= 60 do
				salvos = salvos + 1
				for i, sp in ipairs(spells) do
					if t + 1e-6 >= nextReady[i] then
						if sp.cost <= mana then
							mana = mana - sp.cost; stat[i].cast = stat[i].cast + 1
							nextReady[i] = t + (sp.rate > 0 and 1 / sp.rate or period)
						else
							stat[i].miss = stat[i].miss + 1; firstFail = firstFail or t
						end
					end
				end
				mana = math.min(pool, mana + recov * period)
				t = t + period
			end
			local miss = { }
			for _, x in ipairs(stat) do if x.miss > 0 then t_insert(miss, x) end end
			g.sim = { period = period, salvos = salvos, miss = miss, firstFail = firstFail }
		end
	end
	table.sort(bursts, function(a, b) return a.cost > b.cost end)
	return {
		mana = num(o.Mana) or 0, pool = pool, reservedPct = num(o.ManaReservedPercent) or 0,
		regen = regen, leech = leech, recoup = recoup, use = use, net = net, bursts = bursts,
		-- vol de mana : seulement sur tes propres coups (ceux de tes sbires ne te rendent rien)
		leechNote = (not spam) and "none" or (leech <= 0 and "zero") or nil,
		-- secondes avant d'être à sec en utilisant tout en continu (nil = ça tient)
		secs = net < 0 and pool / -net or nil,
		spam = spam, triggers = triggers, reserved = reserved,
		eb = env and env.modDB and env.modDB:Flag(nil, "EnergyShieldProtectsMana") or false,
		minionBuild = spam == nil and bestAny and bestAny.minion or nil,
	}
end

------------------------------------------------------------------------ compétence principale
-- Un Dash ou une aura choisie par erreur comme compétence principale fausse tous les gains (objets, arbre) :
-- PoB mesure alors le DPS d'une compétence qui n'en fait pas.
function Bridge.mainSkillCheck()
	local build = B()
	local list = build.skillsTab.socketGroupList
	local mainG = list[build.mainSocketGroup]
	local main, best
	local rows = skillRows(build)
	for _, r in ipairs(rows) do
		if not r.triggered and r.dps > 0 and (not best or r.dps > best.dps) then best = r end
	end
	-- la ligne de la compétence principale : même nom que l'actif du groupe principal
	local mainName
	if mainG then
		local ms = mainG.displaySkillList and mainG.displaySkillList[mainG.mainActiveSkill or 1]
		mainName = ms and ms.activeEffect and ms.activeEffect.grantedEffect and ms.activeEffect.grantedEffect.name
	end
	for _, r in ipairs(rows) do if r.name == mainName then main = r break end end
	local bestIndex
	if best then
		for i, g in ipairs(list) do
			for _, s in ipairs(g.displaySkillList or { }) do
				if s.activeEffect and s.activeEffect.grantedEffect and s.activeEffect.grantedEffect.name == best.name then bestIndex = bestIndex or i end
			end
		end
	end
	return {
		name = mainName, dps = main and main.dps or 0, movement = main and main.movement or nil,
		best = best and { name = best.name, dps = best.dps, index = bestIndex, minion = best.minion } or nil,
	}
end

------------------------------------------------------------------------ plafond d'ES (Divine Shield…)
-- « Cannot Recover Energy Shield to above Armour / Evasion Rating » : l'ES utile s'arrête à l'armure (ou l'évasion).
-- Le build garde volontairement l'ES juste au-dessus : on n'est jamais « full ES », le vol et la régénération
-- d'ES ne s'arrêtent jamais. Si l'armure passe au-dessus, on redevient full ES et ce mécanisme s'arrête.
function Bridge._esCap(build)
	build = build or B()
	local env, o = build.calcsTab.mainEnv, build.calcsTab.mainOutput
	if not env or not o then return nil end
	local modDB = env.player.modDB
	local by = modDB:Flag(nil, "ArmourESRecoveryCap") and "Armour" or modDB:Flag(nil, "EvasionESRecoveryCap") and "Evasion" or nil
	if not by then return nil end
	local source
	for _, e in ipairs(modDB:Tabulate("FLAG", nil, by .. "ESRecoveryCap")) do
		local id = tonumber((e.mod.source or ""):match("^Tree:(%d+)"))
		local node = id and build.spec.nodes[id]
		source = node and node.dn or (e.mod.source or ""):match("^Item:[^:]*:([^,\n]+)") or source
	end
	return { by = by, label = by == "Armour" and "armure" or "évasion", source = source or "Divine Shield",
		def = num(o[by]) or 0, es = num(o.EnergyShield) or 0, cap = num(o.EnergyShieldRecoveryCap) or 0 }
end

------------------------------------------------------------------------ « Pourquoi ce chiffre ? »
-- Mods additionnés par PoB pour chaque stat (mêmes noms que ses sections de calcul, Modules/CalcSections.lua).
local EXPLAIN = {
	Life = { label = "Vie", names = { "Life" } },
	Mana = { label = "Mana", names = { "Mana" } },
	EnergyShield = { label = "Bouclier d'énergie", names = { "EnergyShield" }, inc = { "EnergyShield", "Defences" }, gear = "EnergyShield" },
	Armour = { label = "Armure", names = { "Armour", "ArmourAndEvasion" }, inc = { "Armour", "ArmourAndEvasion", "Defences" }, gear = "Armour" },
	Evasion = { label = "Évasion", names = { "Evasion", "ArmourAndEvasion" }, inc = { "Evasion", "ArmourAndEvasion", "Defences" }, gear = "Evasion" },
	FireResist = { label = "Résistance au feu", names = { "FireResist", "ElementalResist" }, resist = "Fire" },
	ColdResist = { label = "Résistance au froid", names = { "ColdResist", "ElementalResist" }, resist = "Cold" },
	LightningResist = { label = "Résistance à la foudre", names = { "LightningResist", "ElementalResist" }, resist = "Lightning" },
	ChaosResist = { label = "Résistance au chaos", names = { "ChaosResist" }, resist = "Chaos" },
	Str = { label = "Force", names = { "Str" } },
	Dex = { label = "Dextérité", names = { "Dex" } },
	Int = { label = "Intelligence", names = { "Int" } },
	SpellSuppressionChance = { label = "Suppression des sorts", names = { "SpellSuppressionChance" }, chance = true },
	BlockChance = { label = "Blocage des attaques", names = { "BlockChance" }, chance = true },
	SpellBlockChance = { label = "Blocage des sorts", names = { "SpellBlockChance" }, chance = true },
	EffectiveMovementSpeedMod = { label = "Vitesse de déplacement", names = { "MovementSpeed" }, incOnly = true },
	ManaRegenRecovery = { label = "Régénération de mana", names = { "ManaRegen" }, inc = { "ManaRegen" } },
}
Bridge._EXPLAIN = EXPLAIN

local CAT = {
	Tree = "Arbre passif", Item = "Objets", Skill = "Gemmes et auras", Base = "Base du personnage",
	Config = "Conditions de calcul", Pantheon = "Panthéon", Bandit = "Bandit", Ascendancy = "Ascendance",
}

local function sourceOf(build, mod, stat)
	local src = mod.source or "?"
	local kind = src:match("^[^:]+") or src
	local name
	if kind == "Tree" then
		local raw = src:match("^Tree:(.+)")
		local id = tonumber(raw or "")
		local node = (id and build.spec.nodes[id]) or (raw and (build.spec.nodes[raw] or (build.spec.tree.nodes or { })[raw]))
		name = node and node.dn or raw or "Passif"
		if node and node.ascendancyName then kind = "Ascendance" end
	elseif kind == "Item" then
		name = src:match("^Item:[^:]*:(.+)") or "Objet"
		name = name:gsub("\n.*", "")
	elseif kind == "Skill" then
		local id = src:match("^Skill:(.+)")
		name = id and data.skills[id] and data.skills[id].name or id or "Compétence"
	elseif kind == "Base" then
		name = (stat:match("Resist$") and (mod.value or 0) < 0) and "Pénalité de résistance (actes 5 et 10)" or "Valeur de départ (classe et niveau)"
	else
		name = src:match("^[^:]+:(.+)") or src
	end
	return CAT[kind] or kind, name
end

local function tabulate(build, modDB, modType, names, stat)
	local groups, order, total = { }, { }, 0
	for _, e in ipairs(modDB:Tabulate(modType, nil, unpack(names))) do
		local v = e.value
		if type(v) == "number" and v ~= 0 then
			local cat, name = sourceOf(build, e.mod, stat)
			local g = groups[cat]
			if not g then g = { label = cat, value = 0, items = { }, byName = { } }; groups[cat] = g; t_insert(order, g) end
			local it = g.byName[name]
			if not it then it = { name = name, value = 0 }; g.byName[name] = it; t_insert(g.items, it) end
			if modType == "MORE" then
				it.value = ((1 + it.value / 100) * (1 + v / 100) - 1) * 100
				g.value = ((1 + g.value / 100) * (1 + v / 100) - 1) * 100
				total = ((1 + total / 100) * (1 + v / 100) - 1) * 100
			else
				it.value = it.value + v
				g.value = g.value + v
				total = total + v
			end
		end
	end
	for _, g in ipairs(order) do
		g.byName = nil
		table.sort(g.items, function(a, b) return math.abs(a.value) > math.abs(b.value) end)
	end
	table.sort(order, function(a, b) return math.abs(a.value) > math.abs(b.value) end)
	return { total = num(total), groups = order }
end

local function explainOne(build, key)
	local def = EXPLAIN[key]
	local env = build.calcsTab.mainEnv
	local o = build.calcsTab.mainOutput
	if not def or not env or not o then return nil end
	local modDB = env.player.modDB
	local r = { key = key, label = def.label, value = num(o[key]) }
	if not def.incOnly then r.base = tabulate(build, modDB, "BASE", def.names, key) end
	-- défenses des pièces d'armure (valeur locale de chaque pièce, déjà comptée par PoB)
	if def.gear then
		local items, sum = { }, 0
		for _, slot in ipairs({ "Helmet", "Body Armour", "Gloves", "Boots", "Weapon 2", "Weapon 1" }) do
			local v = o[def.gear .. "On" .. slot]
			if type(v) == "number" and v > 0 then
				local it = env.player.itemList and env.player.itemList[slot]
				t_insert(items, { name = (it and it.name or slot):gsub("\n.*", ""), value = v })
				sum = sum + v
			end
		end
		if sum > 0 then
			r.base = r.base or { total = 0, groups = { } }
			t_insert(r.base.groups, 1, { label = "Pièces d'armure (valeur de base)", value = sum, items = items })
			r.base.total = (r.base.total or 0) + sum
		end
	end
	if not def.chance and not def.resist then
		r.inc = tabulate(build, modDB, "INC", def.inc or def.names, key)
		r.more = tabulate(build, modDB, "MORE", def.inc or def.names, key)
	end
	if key == "EnergyShield" then r.cap = Bridge._esCap(build) end
	if def.resist then
		local maxNames = def.resist == "Chaos" and { "ChaosResistMax" } or { def.resist .. "ResistMax", "ElementalResistMax" }
		r.max = num(o[key .. "Max"]) or num(modDB:Sum("BASE", nil, unpack(maxNames)))
		r.total = num(o[key .. "Total"]) or (r.base and r.base.total)
		r.overCap = num(o[key .. "OverCap"])
	end
	return r
end

function Bridge.explainStats(a)
	local build = B()
	local keys = a and a.keys ~= NULL and a.keys or nil
	local out = { }
	if keys then
		for _, k in ipairs(keys) do out[k] = explainOne(build, k) end
	else
		for k in pairs(EXPLAIN) do out[k] = explainOne(build, k) end
	end
	return out
end
