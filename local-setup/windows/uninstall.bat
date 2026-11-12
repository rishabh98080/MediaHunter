@echo off
setlocal

set "INSTALL_DIR=%LOCALAPPDATA%\MediaHunter"
set "EXE_NAME=mediahunter-companion.exe"
set "REG_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "REG_NAME=MediaHunterCompanion"

echo == MediaHunter Local Uninstall (Windows) ==

taskkill /F /IM "%EXE_NAME%" >nul 2>&1
reg delete "%REG_KEY%" /v "%REG_NAME%" /f >nul 2>&1
if exist "%INSTALL_DIR%" rmdir /S /Q "%INSTALL_DIR%"

echo Removed MediaHunter Companion startup entry and files.
endlocal
