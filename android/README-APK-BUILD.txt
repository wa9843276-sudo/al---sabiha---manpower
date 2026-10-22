AL-SABIHA Android APK debug build

Configured website:
https://al-sabiha-manpower.up.railway.app

Flavors:
- adminDebug -> app/build/outputs/apk/admin/debug/
- workerDebug -> app/build/outputs/apk/worker/debug/

IMPORTANT:
- This package is the Android source project configured for the live URL; it is not itself the compiled APKs.
- The uploaded ZIP did not contain the Gradle wrapper (gradlew/gradlew.bat and gradle/wrapper files), and this environment has no Android SDK/Gradle installation, so APK compilation could not be performed here.
- Open this android folder in Android Studio, configure/sync Gradle, then run:
  :app:assembleAdminDebug
  :app:assembleWorkerDebug
- Or use Gradle from the command line:
  gradle :app:assembleAdminDebug :app:assembleWorkerDebug -PALSABIHA_BASE_URL=https://al-sabiha-manpower.up.railway.app
- These are debug/testing APKs, not Play Store release builds.
