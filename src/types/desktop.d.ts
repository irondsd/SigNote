export {};

declare global {
  type SigNoteDesktopPlatform = 'macos' | 'windows' | 'linux';

  type SigNoteDesktopBridge = Readonly<{
    isDesktop: true;
    platform: SigNoteDesktopPlatform;
    appVersion: string;
    startBrowserLogin(url: string): Promise<void>;
  }>;

  interface Window {
    signoteDesktop?: SigNoteDesktopBridge;
  }
}
