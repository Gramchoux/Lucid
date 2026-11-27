-- Lucid — couche graphique « SimpleGraphic » enregistrable.
-- PoB dessine avec DrawImage / DrawImageQuad / DrawString… ; ici ces appels sont enregistrés dans une liste
-- d'affichage que le navigateur rejoue sur un canvas. Le dessin (arbre, infobulles) reste celui de PoB.

local s_format = string.format
local m_floor = math.floor

local recording = false
local buckets, bucketKeys
local layer, subLayer = 0, 0
local vpX, vpY, vpW, vpH = 0, 0, 0, 0
local cr, cg, cb, ca = 1, 1, 1, 1
local imgIds, imgPaths = { }, { }

local DIGITS = {
	["0"] = { 0, 0, 0 }, ["1"] = { 1, 0, 0 }, ["2"] = { 0, 1, 0 }, ["3"] = { 0, 0, 1 }, ["4"] = { 1, 1, 0 },
	["5"] = { 1, 0, 1 }, ["6"] = { 0, 1, 1 }, ["7"] = { 1, 1, 1 }, ["8"] = { 0.7, 0.7, 0.7 }, ["9"] = { 0.4, 0.4, 0.4 },
}

local function bucket()
	local key = layer * 1000 + subLayer
	local b = buckets[key]
	if not b then
		b = { n = 0, color = nil, vp = nil }
		buckets[key] = b
		bucketKeys[#bucketKeys + 1] = key
	end
	return b
end

local function emit(cmd)
	local b = bucket()
	local col = s_format("%.3g,%.3g,%.3g,%.3g", cr, cg, cb, ca)
	if b.color ~= col then b.n = b.n + 1 b[b.n] = "C," .. col b.color = col end
	local vp = s_format("%d,%d,%d,%d", vpX, vpY, vpW, vpH)
	if b.vp ~= vp then b.n = b.n + 1 b[b.n] = "V," .. vp b.vp = vp end
	b.n = b.n + 1
	b[b.n] = cmd
end

local function r1(v) return m_floor((v or 0) * 10 + 0.5) / 10 end

function GFX_Begin(w, h)
	recording = true
	buckets, bucketKeys = { }, { }
	imgIds, imgPaths = { }, { }   -- chaque liste d'affichage déclare ses propres images
	layer, subLayer = 0, 0
	vpX, vpY, vpW, vpH = 0, 0, w or 0, h or 0
	cr, cg, cb, ca = 1, 1, 1, 1
end

function GFX_End()
	recording = false
	table.sort(bucketKeys)
	local out = { }
	for id, path in ipairs(imgPaths) do out[#out + 1] = "P," .. id .. "," .. path end
	for _, k in ipairs(bucketKeys) do
		local b = buckets[k]
		for i = 1, b.n do out[#out + 1] = b[i] end
	end
	buckets, bucketKeys = nil, nil
	return table.concat(out, "\n")
end

-- Images : chemin réel + taille réelle (PoB calcule ses coordonnées de texture avec ImageSize)
local imageHandleClass = { }
imageHandleClass.__index = imageHandleClass
function NewImageHandle() return setmetatable({ }, imageHandleClass) end
function imageHandleClass:Load(fileName, ...)
	self.path = fileName
	local wh = __ImageSize(fileName)
	if wh then
		local w, h = wh:match("^(%d+),(%d+)$")
		self.w, self.h = tonumber(w), tonumber(h)
	end
	self.valid = self.w ~= nil
end
function imageHandleClass:Unload() self.valid = false end
function imageHandleClass:IsValid() return self.valid end
function imageHandleClass:IsLoading() return false end
function imageHandleClass:SetLoadingPriority(pri) end
function imageHandleClass:ImageSize() return self.w or 1, self.h or 1 end

local function imgId(handle)
	if not handle then return 0 end
	if not handle.path or not handle.valid then return -1 end
	local id = imgIds[handle.path]
	if not id then
		id = #imgPaths + 1
		imgPaths[id] = handle.path
		imgIds[handle.path] = id
	end
	return id
end

-- Rendu
function SetDrawLayer(l, s)
	if l then layer = l end
	subLayer = s or 0
end
function GetDrawLayer() return layer, subLayer end
function SetViewport(x, y, w, h)
	if x then vpX, vpY, vpW, vpH = x, y, w, h else vpX, vpY, vpW, vpH = 0, 0, 0, 0 end
end
function SetDrawColor(r, g, b, a)
	if type(r) == "string" then
		local hex = r:match("^%^x(%x%x%x%x%x%x)")
		if hex then
			cr, cg, cb = tonumber(hex:sub(1, 2), 16) / 255, tonumber(hex:sub(3, 4), 16) / 255, tonumber(hex:sub(5, 6), 16) / 255
		else
			local d = DIGITS[r:match("^%^(%d)") or "7"]
			cr, cg, cb = d[1], d[2], d[3]
		end
		ca = g or 1
		return
	end
	cr, cg, cb, ca = r or 1, g or 1, b or 1, a or 1
end
function DrawImage(handle, x, y, w, h, s1, t1, s2, t2)
	if not recording then return end
	local id = imgId(handle)
	if id < 0 then return end
	emit(s_format("I,%d,%s,%s,%s,%s,%.5f,%.5f,%.5f,%.5f", id, r1(x + vpX), r1(y + vpY), r1(w), r1(h),
		s1 or 0, t1 or 0, s2 or 1, t2 or 1))
end
function DrawImageQuad(handle, x1, y1, x2, y2, x3, y3, x4, y4, s1, t1, s2, t2, s3, t3, s4, t4)
	if not recording then return end
	local id = imgId(handle)
	if id < 0 then return end
	emit(s_format("Q,%d,%s,%s,%s,%s,%s,%s,%s,%s,%.5f,%.5f,%.5f,%.5f,%.5f,%.5f,%.5f,%.5f", id,
		r1(x1 + vpX), r1(y1 + vpY), r1(x2 + vpX), r1(y2 + vpY), r1(x3 + vpX), r1(y3 + vpY), r1(x4 + vpX), r1(y4 + vpY),
		s1 or 0, t1 or 0, s2 or 1, t2 or 0, s3 or 1, t3 or 1, s4 or 0, t4 or 1))
end
function DrawString(x, y, align, height, font, text)
	if not recording or not text then return end
	text = tostring(text):gsub("\r", ""):gsub("\n", "\\n")
	emit(s_format("T,%s,%s,%s,%s,%s,%s", r1(x + vpX), r1(y + vpY), align or "LEFT", r1(height), font or "VAR", text))
end

-- Largeur de texte : métriques exactes des polices bitmap de PoB (calculées côté hôte)
function DrawStringWidth(height, font, text)
	if not text then return 0 end
	return __StringWidth(height, font or "VAR", tostring(text)) or 0
end
function DrawStringCursorIndex(height, font, text, cursorX, cursorY)
	local w = height * 0.5
	return math.max(1, math.floor(cursorX / w) + 1)
end
