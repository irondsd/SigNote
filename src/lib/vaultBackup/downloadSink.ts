import { VAULT_EXPORT_MIME } from './exportTypes';

export const VAULT_EXPORT_BLOB_LIMIT = 64 * 1024 * 1024;

export type PreparedVaultDownload = {
  save(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<{ bytesWritten: number }>;
  abort(): Promise<void>;
};

type PickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
};

function fileSystemSink(handle: FileSystemFileHandle): PreparedVaultDownload {
  let writable: FileSystemWritableFileStream | null = null;
  return {
    async save(stream, signal) {
      writable = await handle.createWritable();
      let bytesWritten = 0;
      await stream
        .pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytesWritten += chunk.byteLength;
              controller.enqueue(chunk);
            },
          }),
        )
        .pipeTo(writable, { signal });
      writable = null;
      return { bytesWritten };
    },
    async abort() {
      await writable?.abort().catch(() => undefined);
      writable = null;
    },
  };
}

function serviceWorkerSink(filename: string): PreparedVaultDownload {
  let token: string | null = null;
  let port: MessagePort | null = null;
  return {
    async save(stream, signal) {
      const controller = navigator.serviceWorker?.controller;
      if (!controller) throw new Error('STREAMING_DOWNLOAD_UNAVAILABLE');
      if (signal.aborted) {
        await stream.cancel('cancelled').catch(() => undefined);
        throw new DOMException('Cancelled', 'AbortError');
      }
      token = crypto.randomUUID();
      const channel = new MessageChannel();
      port = channel.port1;
      let confirmRegistration!: () => void;
      const registered = new Promise<void>((resolve) => {
        confirmRegistration = resolve;
      });
      let fail!: (error: Error) => void;
      const result = new Promise<{ bytesWritten: number }>((resolve, reject) => {
        fail = reject;
        channel.port1.onmessage = (event: MessageEvent<{ type: string; bytesWritten?: number }>) => {
          if (event.data.type === 'registered') {
            clearTimeout(registrationTimeout);
            confirmRegistration();
          } else if (event.data.type === 'complete') resolve({ bytesWritten: event.data.bytesWritten ?? 0 });
          else if (event.data.type === 'error' || event.data.type === 'expired') {
            confirmRegistration();
            reject(new Error('DOWNLOAD_STREAM_FAILED'));
          }
        };
      });
      void result.catch(() => undefined);
      const registrationTimeout = setTimeout(() => {
        confirmRegistration();
        fail(new Error('STREAMING_DOWNLOAD_UNAVAILABLE'));
      }, 5_000);
      signal.addEventListener(
        'abort',
        () => {
          channel.port1.postMessage({ type: 'cancel' });
        },
        { once: true },
      );
      let iframe: HTMLIFrameElement | null = null;
      try {
        controller.postMessage({ type: 'SIGNOTE_VAULT_DOWNLOAD_REGISTER', token, filename, stream }, [
          channel.port2,
          stream as unknown as Transferable,
        ]);
        await registered;
        iframe = document.createElement('iframe');
        iframe.hidden = true;
        iframe.src = `/__signote/vault-download/${token}`;
        document.body.appendChild(iframe);
        return await result;
      } finally {
        clearTimeout(registrationTimeout);
        iframe?.remove();
        channel.port1.close();
        port = null;
        token = null;
      }
    },
    async abort() {
      port?.postMessage({ type: 'cancel' });
      port?.close();
      port = null;
      token = null;
    },
  };
}

function blobSink(filename: string): PreparedVaultDownload {
  return {
    async save(stream, signal) {
      const reader = stream.getReader();
      const chunks: ArrayBuffer[] = [];
      let total = 0;
      let completed = false;
      try {
        while (true) {
          if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          const { done, value } = await reader.read();
          if (done) {
            completed = true;
            break;
          }
          total += value.byteLength;
          if (total > VAULT_EXPORT_BLOB_LIMIT) throw new Error('EXPORT_TOO_LARGE_FOR_BROWSER');
          chunks.push(value.slice().buffer as ArrayBuffer);
        }
      } finally {
        if (!completed) await reader.cancel('cancelled').catch(() => undefined);
        reader.releaseLock();
      }
      const blob = new Blob(chunks, { type: VAULT_EXPORT_MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return { bytesWritten: total };
    },
    async abort() {},
  };
}

async function supportsVaultDownloadWorker(): Promise<boolean> {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return false;
  const channel = new MessageChannel();
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 750);
    channel.port1.onmessage = (event: MessageEvent<{ vaultDownloadProtocol?: number }>) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data.vaultDownloadProtocol === 1);
    };
    try {
      controller.postMessage({ type: 'SIGNOTE_VAULT_DOWNLOAD_PROTOCOL' }, [channel.port2]);
    } catch {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(false);
    }
  });
}

/** Must be called directly from the export button so browsers preserve the
 * user activation required by the native save picker. */
export async function prepareVaultDownload(filename: string, estimatedBytes: number): Promise<PreparedVaultDownload> {
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'SigNote encrypted vault', accept: { [VAULT_EXPORT_MIME]: ['.snvault'] } }],
      });
      return fileSystemSink(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }
  }
  if (await supportsVaultDownloadWorker()) return serviceWorkerSink(filename);
  if (estimatedBytes <= VAULT_EXPORT_BLOB_LIMIT) return blobSink(filename);
  throw new Error('STREAMING_DOWNLOAD_UNAVAILABLE');
}
