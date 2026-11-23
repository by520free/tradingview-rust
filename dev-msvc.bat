@echo off
REM One-click launcher for CandleLab Tauri dev window (MSVC toolchain).
REM Double-click this file, or run it from a terminal. Keep the window open while testing.
setlocal

set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc
set "V=D:\VSBuildTools\VC\Tools\MSVC\14.44.35207"
set "K=C:\Program Files (x86)\Windows Kits\10"

set "INCLUDE=%V%\include;%K%\Include\10.0.26100.0\ucrt;%K%\Include\10.0.26100.0\um;%K%\Include\10.0.26100.0\shared;%K%\Include\10.0.26100.0\winrt;%K%\Include\10.0.26100.0\cppwinrt"
set "LIB=%V%\lib\x64;%K%\Lib\10.0.26100.0\ucrt\x64;%K%\Lib\10.0.26100.0\um\x64"
REM rustup's MSVC cargo MUST come first, otherwise Tauri picks scoop's GNU cargo and fails to link.
set "PATH=C:\Users\Administrator\.cargo\bin;%V%\bin\Hostx64\x64;%PATH%"

cd /d E:\code\AI-Code\tradingview-rust
echo ============================================================
echo  CandleLab Tauri dev - building with MSVC, please wait...
echo  A desktop window will open when ready. Do NOT close this terminal.
echo ============================================================
call npm run tauri dev
echo.
echo Tauri dev exited with code %ERRORLEVEL%.
pause
