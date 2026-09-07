export const START_BROWSER_LOGIN_CHANNEL = 'signote:start-browser-login';
export const AUTH_CALLBACK_CHANNEL = 'signote:auth-callback';
export const AUTH_CALLBACK_READY_CHANNEL = 'signote:auth-callback-ready';
export const SELECT_ALL_AT_CHANNEL = 'signote:select-all-at';

export type DesktopAuthCallback = {
  attemptId: string;
  code: string;
  state: string;
};

export type DesktopPoint = {
  x: number;
  y: number;
};
