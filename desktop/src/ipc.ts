export const START_BROWSER_LOGIN_CHANNEL = 'signote:start-browser-login';
export const AUTH_CALLBACK_CHANNEL = 'signote:auth-callback';
export const AUTH_CALLBACK_READY_CHANNEL = 'signote:auth-callback-ready';

export type DesktopAuthCallback = {
  attemptId: string;
  code: string;
  state: string;
};
