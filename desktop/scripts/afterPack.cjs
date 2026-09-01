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
    [FuseV1Options.EnableCookieEncryption]: true,
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
};
