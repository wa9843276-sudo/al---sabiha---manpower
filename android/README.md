# Android apps — Admin & Worker  (SOURCE ONLY — NOT YET BUILT OR TESTED)

One Gradle project, two flavors:
| | Admin | Worker |
|---|---|---|
| applicationId | `com.alsabiha.manpower.admin` | `com.alsabiha.manpower.worker` |
| App name | AL SABIHA Admin | AL SABIHA Worker |
| Opens | `/mobile.html` (existing PIN-gated admin mobile page) | `/worker-app.html` (existing worker page) |
| Signing | its own keystore | its own keystore |

**Design:** a hardened WebView shell around your existing mobile pages — HTTPS only (cleartext blocked; debug allows only the emulator loopback), navigation restricted to your server (other links open the browser), **no JavaScript bridge**, file/content access off, backups off, camera and location granted to the page **only for your server's origin**, offline/error screen with *Try again*, no credentials stored in the app. Admin-only operations remain protected **on the server** (PIN header / session), never by hiding screens in the app. Min SDK 24 (Android 7+), target 34.

## Why WebView
It reuses the audited server-side rules and avoids duplicating logic. It is acceptable only because the above hardening is applied and the server enforces all authorization. A native rewrite is a larger, separate project.

## Build (on a PC with Android Studio / JDK 17 + Android SDK 34)
1. Open the `android/` folder in Android Studio (it will create the Gradle wrapper), or run `gradle wrapper` once.
2. Debug builds for testing (emulator → your PC at `http://10.0.2.2:3000`):
   `./gradlew assembleAdminDebug assembleWorkerDebug -PALSABIHA_BASE_URL=http://10.0.2.2:3000`
3. Release (requires HTTPS URL and keystores):
   - Create two keystores, e.g. `keytool -genkeypair -v -keystore alsabiha-admin.jks -alias admin -keyalg RSA -keysize 2048 -validity 10000` (repeat for worker). **Back them up safely; losing them means you can never update the installed app.**
   - Copy `keystore.properties.example` → `keystore.properties` and fill it (never commit it).
   - `./gradlew assembleAdminRelease assembleWorkerRelease -PALSABIHA_BASE_URL=https://YOUR-DOMAIN`
   - APKs: `app/build/outputs/apk/<flavor>/release/`. Without keystore values the release APK is **unsigned** and will not install.
4. The release task refuses to run with a placeholder or non-HTTPS URL.

## Test checklist before distributing
Install on a real Android 8, 11 and 13+ device; log in; scan a QR (camera prompt appears once, only for your domain); check-in/out; airplane-mode shows the error screen; Worker app cannot reach admin pages; rotate the screen mid-scan.

## Troubleshooting "App not installed"
- Same applicationId already installed but signed with a **different key** → uninstall the old app first (never mix debug/release keys).
- Installing the *unsigned* release APK → sign it (see above).
- Device Android < 7 (minSdk 24) or incompatible ABI (this APK is architecture-independent).
- Storage full, or blocked "install unknown apps" setting for your file manager/browser.
- Check with `adb install -r app-admin-release.apk` — it prints the exact error code (e.g. `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, `INSTALL_FAILED_OLDER_SDK`).

## Not verified here
Compilation, the per-flavor signing hook (`androidComponents.onVariants` — AGP 8.5 API, unverified), the launcher icon appearance, and all device behaviour. Expect to fix small build errors on first compile.
