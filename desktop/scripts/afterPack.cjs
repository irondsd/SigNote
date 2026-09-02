/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads hooks as CommonJS */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function hardenMacTransportSecurity(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  await flipFuses(appPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    // Ad-hoc macOS builds do not have a stable signing identity, so Chromium's
    // Keychain-backed cookie encryption can prompt again after every rebuild.
    // Enable it only for the future Developer ID release channel.
    [FuseV1Options.EnableCookieEncryption]: process.env.SIGNOTE_ENABLE_COOKIE_ENCRYPTION === 'true',
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });

  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');

  execFileSync('plutil', [
    '-replace',
    'NSAppTransportSecurity.NSAllowsArbitraryLoads',
    '-bool',
    'NO',
    infoPlist,
  ]);
  execFileSync('plutil', [
    '-replace',
    'NSAppTransportSecurity.NSAllowsLocalNetworking',
    '-bool',
    'NO',
    infoPlist,
  ]);
  execFileSync('plutil', ['-remove', 'NSAppTransportSecurity.NSExceptionDomains', infoPlist]);

  // Electron's packaging defaults add usage strings for capabilities SigNote
  // does not request. Omitting them keeps the signed bundle metadata aligned
  // with the main-process permission policy, which denies every request.
  for (const key of [
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
    'NSLocationUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    try {
      execFileSync('plutil', ['-remove', key, infoPlist]);
    } catch {
      // The key is optional and may disappear from future Electron templates.
    }
  }
};
