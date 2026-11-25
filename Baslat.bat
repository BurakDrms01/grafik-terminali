@echo off
title Grafik Terminali
cd /d "%~dp0"

rem Uygulama zaten calisiyorsa sadece tarayicida ac.
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:5173
  exit /b
)

if not exist node_modules (
  echo Ilk calistirma: paketler kuruluyor...
  call npm install
)
echo Grafik Terminali baslatiliyor... Kapatmak icin bu pencereyi kapatin.
call npm start
pause
