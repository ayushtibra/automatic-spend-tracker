// Builds the web app, syncs it into the Android project and assembles a debug APK.
// Uses Android Studio's bundled Java (Gradle doesn't support very new system JDKs yet).
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const studioJbr = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/opt/android-studio/jbr',
].find((p) => p && existsSync(p));
const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', 'Library'), 'Android', 'Sdk');

// Java's socket pipe breaks when %TEMP% is an 8.3 short path (e.g. C:\Users\NAME~1.ABC); give it a plain one.
const sockDir = join(process.platform === 'win32' ? 'C:\\' : tmpdir(), '.gradle-tmp');
mkdirSync(sockDir, { recursive: true });

const env = {
  ...process.env,
  ...(studioJbr ? { JAVA_HOME: studioJbr } : {}),
  ANDROID_HOME: sdk,
  JAVA_TOOL_OPTIONS: `-Djdk.net.unixdomain.tmpdir=${sockDir}`,
};
const run = (cmd, cwd = '.') => execSync(cmd, { stdio: 'inherit', env, cwd });

run('npm run build');
run('npx cap sync android');
run(process.platform === 'win32' ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug', 'android');

// Copy the build to an easy-to-find name next to the project: spend-tracker/SpendTracker.apk
const built = resolve('android/app/build/outputs/apk/debug/app-debug.apk');
const out = resolve('..', 'SpendTracker.apk');
copyFileSync(built, out);
console.log(`\nAPK ready: ${out}`);
