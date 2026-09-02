const WALLET_DISCONNECT_EVENT = 'signote:wallet-disconnect';

export function requestWalletDisconnect(): void {
  window.dispatchEvent(new Event(WALLET_DISCONNECT_EVENT));
}

export function onWalletDisconnectRequested(callback: () => void): () => void {
  window.addEventListener(WALLET_DISCONNECT_EVENT, callback);
  return () => window.removeEventListener(WALLET_DISCONNECT_EVENT, callback);
}
