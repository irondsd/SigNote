/** Refuse to start behind an old worker that can return cached key material. */
export async function rotationWorkerReady(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return true;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return true;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(ready && navigator.serviceWorker.controller === controller);
    };
    const timer = setTimeout(() => finish(false), 3000);
    channel.port1.onmessage = (event) => finish(event.data?.rotationProtocol === 1);
    controller.postMessage({ type: 'SIGNOTE_ROTATION_PROTOCOL' }, [channel.port2]);
  });
}
