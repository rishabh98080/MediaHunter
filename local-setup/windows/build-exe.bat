@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%I in ("%SCRIPT_DIR%\..\..") do set "ROOT_DIR=%%~fI"

set "SRC_PY="
if exist "%SCRIPT_DIR%\..\companion.py" set "SRC_PY=%SCRIPT_DIR%\..\companion.py"
if exist "%ROOT_DIR%\companion.py" set "SRC_PY=%ROOT_DIR%\companion.py"

if not defined SRC_PY (
    echo Error: companion.py not found.
    exit /b 1
)

python -m pip install --upgrade pyinstaller
if errorlevel 1 (
    echo Failed to install PyInstaller. Make sure Python 3 is installed and on PATH.
    exit /b 1
)

python -m PyInstaller ^
  --onefile ^
  --noconsole ^
  --clean ^
  --name mediahunter-companion ^
  --distpath "%SCRIPT_DIR%" ^
  --workpath "%TEMP%\mh-pyinstaller-work" ^
  --specpath "%TEMP%\mh-pyinstaller-spec" ^
  "%SRC_PY%"

if errorlevel 1 (
    echo Build failed.
    exit /b 1
)

echo Built: %SCRIPT_DIR%\mediahunter-companion.exe
endlocal

