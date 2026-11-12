@echo off
setlocal enabledelayedexpansion

echo == MediaHunter Local Setup (Windows) ==

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%I in ("%SCRIPT_DIR%\..\..") do set "ROOT_DIR=%%~fI"

set "INSTALL_DIR=%LOCALAPPDATA%\MediaHunter"
set "EXE_NAME=mediahunter-companion.exe"
set "TARGET_EXE=%INSTALL_DIR%\%EXE_NAME%"
set "LAUNCHER_VBS=%INSTALL_DIR%\launch-companion.vbs"
set "REG_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "REG_NAME=MediaHunterCompanion"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

REM 1. Ensure yt-dlp is available (prefer winget or pip)
where yt-dlp >nul 2>&1
if errorlevel 1 (
    echo yt-dlp not found on PATH. Attempting installation...
    where winget >nul 2>&1
    if not errorlevel 1 (
        winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements
    ) else (
        where python >nul 2>&1
        if not errorlevel 1 (
            python -m pip install --user --upgrade yt-dlp
        ) else (
            echo Warning: Neither winget nor python was found. Please install yt-dlp and ffmpeg manually.
        )
    )
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo Note: ffmpeg not found on PATH. Installing ffmpeg is recommended for 1080p+ muxing and MP3 audio.
)

REM 2. Copy companion executable (or companion.py + pythonw fallback)
if exist "%SCRIPT_DIR%\%EXE_NAME%" (
    copy /Y "%SCRIPT_DIR%\%EXE_NAME%" "%TARGET_EXE%" >nul
    set "LAUNCH_CMD=\"%TARGET_EXE%\""
    echo Installed standalone executable to: %TARGET_EXE%
) else (
    set "SRC_PY="
    if exist "%SCRIPT_DIR%\..\companion.py" set "SRC_PY=%SCRIPT_DIR%\..\companion.py"
    if not defined SRC_PY if exist "%ROOT_DIR%\companion.py" set "SRC_PY=%ROOT_DIR%\companion.py"
    if not defined SRC_PY (
        echo Error: Neither %EXE_NAME% nor companion.py was found.
        exit /b 1
    )
    copy /Y "!SRC_PY!" "%INSTALL_DIR%\companion.py" >nul
    where pythonw >nul 2>&1
    if errorlevel 1 (
        echo Error: %EXE_NAME% is not built yet and pythonw.exe was not found.
        echo Install Python 3 or run build-exe.bat on Windows first.
        exit /b 1
    )
    for /f "delims=" %%P in ('where pythonw') do (
        set "PYTHONW_BIN=%%P"
        goto :found_pythonw
    )
    :found_pythonw
    set "LAUNCH_CMD=\"!PYTHONW_BIN!\" \"%INSTALL_DIR%\companion.py\""
    echo Installed companion.py to: %INSTALL_DIR%\companion.py
)

REM 3. Stop any existing instance cleanly
taskkill /F /IM "%EXE_NAME%" >nul 2>&1

REM 4. Register single silent startup application via Registry Run key
if exist "%TARGET_EXE%" (
    reg add "%REG_KEY%" /v "%REG_NAME%" /t REG_SZ /d "\"%TARGET_EXE%\"" /f >nul
    start "" /B "%TARGET_EXE%"
) else (
    > "%LAUNCHER_VBS%" (
        echo Set WshShell = CreateObject("WScript.Shell"^)
        echo WshShell.Run "%LAUNCH_CMD:"=""%", 0, False
    )
    reg add "%REG_KEY%" /v "%REG_NAME%" /t REG_SZ /d "wscript.exe \"%LAUNCHER_VBS%\"" /f >nul
    wscript.exe "%LAUNCHER_VBS%"
)

echo Registered MediaHunter Companion to start automatically at Windows login.

timeout /t 2 /nobreak >nul
echo MediaHunter Companion setup complete (http://127.0.0.1:9527/status).
endlocal
