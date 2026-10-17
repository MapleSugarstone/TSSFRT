@echo off
rem Runs the game on this computer and opens it in the browser. Saved edits to code, wording and
rem assets show up in the open page by themselves.
rem   play            the game
rem   play online     the game plus a local room server, to test online play in two browser tabs
rem   play editor     the mod maker
setlocal
cd /d "%~dp0"

where npm >nul 2>nul || (
  echo npm was not found. Install it, then run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing the game's dependencies...
  call npm install || goto failed
)

if /i "%~1"=="editor" (
  call npm run characters || goto failed
  goto end
)

if /i "%~1"=="online" (
  if not exist server\node_modules (
    echo Installing the room server's dependencies...
    call npm --prefix server install || goto failed
  )
  start "Room server" cmd /k npm run worker:dev
)

if not "%~1"=="" if /i not "%~1"=="online" (
  echo Unknown option "%~1". Use: play, play online, or play editor.
  pause
  exit /b 1
)

call npm run characters:build || goto failed
call npm run dev -- --open || goto failed
goto end

:failed
echo.
echo Something went wrong. The messages above say what.
pause
exit /b 1

:end
endlocal
