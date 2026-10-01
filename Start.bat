@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Дорожная карта КСО - сервер

set "RUNTIME=%~dp0site\runtime"
set "NODE=%RUNTIME%\node.exe"

if exist "%NODE%" goto run

rem --- Node.js, уже установленный на компьютере ---
set "SYSNODE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined SYSNODE set "SYSNODE=%%i"
if defined SYSNODE (
  "%SYSNODE%" -e "process.exit(+process.versions.node.split('.')[0]>=18?0:1)" >nul 2>nul
  if not errorlevel 1 (
    set "NODE=%SYSNODE%"
    goto run
  )
)

rem --- Первый запуск: скачиваем переносной Node.js в папку site\runtime ---
echo.
echo  Первый запуск: скачиваю Node.js (около 30 МБ). Нужен интернет, 1-3 минуты...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0site\tools\get-node.ps1" -Dest "%RUNTIME%"
if not exist "%NODE%" (
  echo.
  echo  Не удалось скачать Node.js.
  echo  Вариант без интернета: скачайте на другом компьютере архив
  echo  "Windows Binary .zip" с сайта https://nodejs.org/en/download
  echo  и положите файл node.exe из него в папку:
  echo     "%RUNTIME%"
  echo  Затем снова запустите Start.bat.
  echo.
  pause
  exit /b 1
)

:run
echo.
"%NODE%" "%~dp0site\server.js"
echo.
echo  Сервер остановлен.
pause
