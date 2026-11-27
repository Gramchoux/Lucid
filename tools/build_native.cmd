@echo off
rem Recompile lucid\native\lucidnative.dll (ooz + bcdec) avec zig (python -m pip install --target tools\zig ziglang).
rem Note : la vectorisation automatique de clang casse ooz (code ecrit pour MSVC), d'ou -fno-vectorize.
cd /d "%~dp0src"
..\zig\ziglang\zig.exe c++ -shared -O2 -fno-vectorize -fno-slp-vectorize -fno-strict-aliasing -target x86_64-windows-gnu -fno-sanitize=undefined -w -include sys/stat.h -Dmain=ooz_cli_main -o ..\..\lucid\native\lucidnative.dll lucidnative.cpp kraken.cpp bitknit.cpp lzna.cpp
del /q ..\..\lucid\native\lucidnative.lib ..\..\lucid\native\lucidnative.pdb 2>nul
