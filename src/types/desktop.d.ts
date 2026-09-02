export {};

declare global {
  type SigNoteDesktopPlatform = 'macos' | 'windows' | 'linux';

  type SigNoteDesktopBridge = Readonly<{
    isDesktop: true;
    platform: SigNoteDesktopPlatform;
    appVersion: string;
    startBrowserLogin(url: string): Promise<void>;
    onAuthCallback(callback: (payload: DesktopAuthCallbackPayload) => void): () => void;
  }>;

  type DesktopAuthCallbackPayload = {
    attemptId: string;
    code: string;
    state: string;
  };

  interface Window {
    signoteDesktop?: SigNoteDesktopBridge;
  }
}
