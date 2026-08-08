@echo off
REM ===================================================================
REM   Auto Marketing Software — ek j click ma chalu karo
REM
REM   AA FILE PAR DOUBLE-CLICK KARO. Baki badhu jate thai jashe:
REM     1. MongoDB chalu thashe
REM     2. App chalu thashe
REM     3. Browser jate khuli jashe
REM
REM   Band karva: aa window ma Ctrl+C dabavo.
REM ===================================================================

title Auto Marketing Software
cd /d "%~dp0"

echo.
echo   ====================================================
echo      Auto Marketing Software chalu thai rahyu che
echo   ====================================================
echo.

REM ---------------- 1. MongoDB ----------------
call :is_listening 27017
if "%LISTENING%"=="1" goto mongo_ready

echo   [1/3] MongoDB chalu karie chie...
start "MongoDB - aa window band na karo" cmd /c "npm run mongo"

REM Taiyar thay eni raah — 40 second sudhi.
set /a MONGO_TRIES=0
:mongo_wait
timeout /t 2 /nobreak >nul
call :is_listening 27017
if "%LISTENING%"=="1" goto mongo_ready
set /a MONGO_TRIES+=1
if %MONGO_TRIES% lss 20 goto mongo_wait

echo   ^^!  MongoDB shuru na thayu.
echo      Bija window ma "npm run mongo" jate chalavi jujo.
echo.
goto after_mongo

:mongo_ready
echo   [1/3] MongoDB taiyar che.

:after_mongo

REM ---------------- 2. Juno app band karo ----------------
echo   [2/3] Juno app band karie chie (chalu hoy to)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%p >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM ---------------- 3. Browser + App ----------------
echo   [3/3] App chalu karie chie...
echo.
echo   Browser ma khulse: http://localhost:8000
echo.
start "" http://localhost:8000

cd python
python run.py

echo.
echo   App band thai gayu. Koi pan key dabavo.
pause >nul
exit /b

REM ---------------- helper ----------------
REM Aapelo port par kai sambhale che ke nahi -> LISTENING=1/0
:is_listening
set "LISTENING=0"
netstat -ano | findstr ":%~1 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 set "LISTENING=1"
exit /b
