@echo off
setlocal
cd /d "%~dp0"
echo Checking Java and Gradle...
where java >nul 2>nul || (echo ERROR: Install Android Studio and a supported JDK first.& pause & exit /b 1)
where gradle >nul 2>nul || (
  echo ERROR: Gradle is not installed or not in PATH.
  echo Open this android folder in Android Studio, let Gradle sync, then use the Gradle tool window
  echo to run :app:assembleAdminDebug and :app:assembleWorkerDebug.
  pause
  exit /b 1
)
gradle :app:assembleAdminDebug :app:assembleWorkerDebug -PALSABIHA_BASE_URL=https://al-sabiha-manpower.up.railway.app
if errorlevel 1 (
  echo BUILD FAILED. Copy the complete error output and send it for troubleshooting.
  pause
  exit /b 1
)
echo.
echo Build completed. APKs should be in:
echo app\build\outputs\apk\admin\debug\
echo app\build\outputs\apk\worker\debug\
pause
