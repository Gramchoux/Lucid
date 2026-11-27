-- Lucid — hôte "headless" pour Path of Building.
-- Remplace l'API SimpleGraphic (fenêtre, rendu, entrées) par des stubs,
-- puis démarre PoB normalement via Launch.lua.

package.path = "./?.lua;./lua/?.lua;./lua/?/init.lua;" .. package.path
package.cpath = __RUNTIME_PATH .. "/?.dll;" .. package.cpath

local callbackTable = { }
local mainObject
function runCallback(name, ...)
	if callbackTable[name] then
		return callbackTable[name](...)
	elseif mainObject and mainObject[name] then
		return mainObject[name](mainObject, ...)
	end
end
function SetCallback(name, func) callbackTable[name] = func end
function GetCallback(name) return callbackTable[name] end
function SetMainObject(obj) mainObject = obj end

-- Images
local imageHandleClass = { }
imageHandleClass.__index = imageHandleClass
function NewImageHandle() return setmetatable({ }, imageHandleClass) end
function imageHandleClass:Load(fileName, ...) self.valid = true end
function imageHandleClass:Unload() self.valid = false end
function imageHandleClass:IsValid() return self.valid end
function imageHandleClass:SetLoadingPriority(pri) end
function imageHandleClass:ImageSize() return 1, 1 end

-- Rendu
function RenderInit(...) end
function GetScreenSize() return 1920, 1080 end
function GetVirtualScreenSize() return 1920, 1080 end
function GetScreenScale() return 1 end
function GetDPIScaleOverridePercent() return 1 end
function SetDPIScaleOverridePercent(s) end
function SetClearColor(...) end
function SetDrawLayer(...) end
function GetDrawLayer() return 0, 0 end
function SetViewport(...) end
function SetDrawColor(...) end
function DrawImage(...) end
function DrawImageQuad(...) end
function DrawString(...) end
function DrawStringWidth(height, font, text) return #(text or "") * height / 2 end
function DrawStringCursorIndex(...) return 0 end
function StripEscapes(text)
	return (text:gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""))
end
function GetAsyncCount() return 0 end

-- Données volumineuses (joyaux Timeless) : décompressées dans un cache Lucid plutôt que dans le dossier de PoB.
-- Lectures : cache Lucid, puis source, puis dossiers de données connus. Écritures : cache Lucid.
local timelessDirs = { }
for d in (__TIMELESS_DIRS or ""):gmatch("[^;]+") do timelessDirs[#timelessDirs + 1] = d end
local function timelessName(path)
	return type(path) == "string" and path:gsub("\\", "/"):match("Data/TimelessJewelData/(.+)$")
end
local l_open = io.open
io.open = function(path, mode)
	local name = timelessName(path)
	if not name then return l_open(path, mode) end
	if mode and (mode:match("w") or mode:match("a")) then
		return l_open(timelessDirs[1] .. "/" .. name, mode)
	end
	for _, d in ipairs(timelessDirs) do
		local f = l_open(d .. "/" .. name, mode)
		if f then return f end
	end
	return l_open(path, mode)
end

-- Recherche de fichiers (implémentée côté Python)
local fileSearchClass = { }
fileSearchClass.__index = fileSearchClass
function NewFileSearch(pattern, dirOnly)
	local list = Bridge_json_decode(__ListDir(pattern, dirOnly and true or false))
	local name = timelessName(pattern)
	if name and (not list or #list == 0) then
		for _, d in ipairs(timelessDirs) do
			list = Bridge_json_decode(__ListDir(d .. "/" .. name, dirOnly and true or false))
			if list and #list > 0 then break end
		end
	end
	if not list or #list == 0 then return nil end
	return setmetatable({ list = list, i = 1 }, fileSearchClass)
end
function fileSearchClass:NextFile() self.i = self.i + 1 return self.list[self.i] ~= nil end
function fileSearchClass:GetFileName() return self.list[self.i].name end
function fileSearchClass:GetFileSize() return self.list[self.i].size end
function fileSearchClass:GetFileModifiedTime() return self.list[self.i].mtime end

-- Divers
function SetWindowTitle(title) end
function GetCursorPos() return __cursorX or -1, __cursorY or -1 end
function SetCursorPos(x, y) end
function ShowCursor(doShow) end
function IsKeyDown(keyName) return __keys ~= nil and __keys[keyName] == true end
function Copy(text) end
function Paste() return "" end
function GetScriptPath() return __SCRIPT_PATH end
function GetRuntimePath() return __RUNTIME_PATH end
function GetUserPath() return __USER_PATH end
function RemoveDir(path) end
function SetWorkDir(path) end
function GetWorkDir() return "" end
function LaunchSubScript(scriptText, funcList, subList, ...) return nil end
function AbortSubScript(ssID) end
function IsSubScriptRunning(ssID) return false end
function LoadModule(fileName, ...)
	if not fileName:match("%.lua$") then fileName = fileName .. ".lua" end
	local func, err = loadfile(fileName)
	if func then return func(...) end
	error("LoadModule() error loading '" .. fileName .. "': " .. tostring(err))
end
function PLoadModule(fileName, ...)
	if not fileName:match("%.lua$") then fileName = fileName .. ".lua" end
	local func, err = loadfile(fileName)
	if func then return PCall(func, ...) end
	error("PLoadModule() error loading '" .. fileName .. "': " .. tostring(err))
end
function PCall(func, ...)
	local ret = { xpcall(func, debug.traceback, ...) }
	if ret[1] then
		table.remove(ret, 1)
		return nil, unpack(ret)
	end
	return ret[2]
end
function ConPrintf(fmt, ...)
	local ok, s = pcall(string.format, fmt, ...)
	__Print(ok and s or tostring(fmt))
end
function ConPrintTable(tbl, noRecurse) end
function ConExecute(cmd) end
function ConClear() end
function SpawnProcess(cmdName, args) end
function OpenURL(url) end
function SetProfiling(isEnabled) end
function Restart() end
function Exit() end
function TakeScreenshot() end
function GetCloudProvider(path) return nil, nil, nil end

local l_require = require
function require(name)
	if name == "lcurl.safe" then return nil end
	return l_require(name)
end

-- JSON minimal pour NewFileSearch (dkjson est chargé plus tard par le bridge)
function Bridge_json_decode(s)
	local dk = l_require("dkjson")
	return dk.decode(s)
end

-- rendu enregistrable (remplace les stubs ci-dessus)
dofile(__LUCID_LUA .. "/graphics.lua")

arg = { }
dofile("Launch.lua")
-- Mode CI : PoB évite certaines actions interactives (popups, mises à jour)
mainObject.continuousIntegrationMode = true
runCallback("OnInit")
runCallback("OnFrame")
if mainObject.promptMsg then
	error("PoB: " .. tostring(mainObject.promptMsg))
end
return "ok"
