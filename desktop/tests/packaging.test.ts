import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { toDesktopPlatform } from '../src/bridge';

const desktopDir = path.join(import.meta.dir, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8')) as {
  desktopName: string;
  build: {
    appId: string;
    protocols: Array<{ schemes: string[] }>;
    nsis: Record<string, unknown>;
    win: { icon: string; target: Array<{ target: string; arch: string[] }> };
    linux: { icon: string; executableName: string; syncDesktopName: boolean; target: Array<{ target: string }> };
  };
};

describe('desktop platform mapping', () => {
  test('maps every Electron desktop platform to a renderer platform', () => {
    expect(toDesktopPlatform('darwin')).toBe('macos');
    expect(toDesktopPlatform('win32')).toBe('windows');
    expect(toDesktopPlatform('linux')).toBe('linux');
    expect(toDesktopPlatform('freebsd')).toBe('linux');
  });
});

describe('windows packaging', () => {
  const { build } = packageJson;

  test('builds an NSIS installer for both Windows architectures', () => {
    expect(build.win.target).toEqual([{ target: 'nsis', arch: ['x64', 'arm64'] }]);
  });

  test('installs per user without elevation so the protocol lands in HKCU', () => {
    expect(build.nsis.oneClick).toBe(false);
    expect(build.nsis.perMachine).toBe(false);
    expect(build.nsis.allowElevation).toBe(false);
    expect(build.nsis.deleteAppDataOnUninstall).toBe(false);
  });

  test('registers and removes the signote protocol from the installer', () => {
    const includePath = build.nsis.include as string;
    const installer = fs.readFileSync(path.join(desktopDir, includePath), 'utf8');

    expect(installer).toContain('!macro customInstall');
    expect(installer).toContain('!macro customUnInstall');
    expect(installer).toContain('WriteRegStr SHCTX "Software\\Classes\\signote" "URL Protocol" ""');
    expect(installer).toContain(
      'WriteRegStr SHCTX "Software\\Classes\\signote\\shell\\open\\command" "" \'"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "%1"\'',
    );
    expect(installer).toContain('DeleteRegKey SHCTX "Software\\Classes\\signote"');
  });

  test('ships an icon containing the 256px slot Windows installers require', () => {
    const ico = fs.readFileSync(path.join(desktopDir, build.win.icon));

    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const entryCount = ico.readUInt16LE(4);
    expect(entryCount).toBeGreaterThan(0);

    // A 256px entry stores its dimensions as 0 because the fields are one byte.
    const dimensions = Array.from({ length: entryCount }, (_unused, index) => ico.readUInt8(6 + index * 16));
    expect(dimensions).toContain(0);
    expect(dimensions).toContain(32);
  });
});

describe('linux packaging', () => {
  const { build, desktopName } = packageJson;

  test('declares the protocol electron-builder turns into a desktop-entry MimeType', () => {
    expect(build.protocols.some((protocol) => protocol.schemes.includes('signote'))).toBe(true);
  });

  test('keeps the desktop entry name aligned with the Electron app_id', () => {
    expect(desktopName).toBe('signote.desktop');
    expect(build.linux.syncDesktopName).toBe(true);
    expect(build.linux.executableName).toBe('signote');
  });

  test('builds portable and system-installed packages', () => {
    expect(build.linux.target.map((target) => target.target).sort()).toEqual(['AppImage', 'deb']);
  });

  test('ships a Linux icon source', () => {
    expect(fs.existsSync(path.join(desktopDir, build.linux.icon))).toBe(true);
  });
});
