export type VaultBackupChunkSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array> | ReadableStream<Uint8Array>;

export async function* readableStreamValues<T>(stream: ReadableStream<T>): AsyncGenerator<T> {
  const reader = stream.getReader();
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        return;
      }
      yield value;
    }
  } finally {
    if (!completed) {
      // Releasing a lock does not stop its producer. Explicit cancellation is
      // required when a downstream consumer abandons the async iterator.
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

export async function* readableStreamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  for await (const value of readableStreamValues(stream)) if (value.length > 0) yield value;
}

export function chunkSource(source: VaultBackupChunkSource): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in source) return source;
  if (Symbol.iterator in source) {
    return (async function* () {
      yield* source;
    })();
  }
  return readableStreamChunks(source);
}

export function readableStreamFromChunks(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

export async function collectChunks(
  source: VaultBackupChunkSource,
  maxBytes: number = Number.MAX_SAFE_INTEGER,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of chunkSource(source)) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Stream exceeds the configured byte limit');
    chunks.push(chunk);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export class ByteQueue {
  private readonly chunks: Uint8Array[] = [];
  private firstOffset = 0;
  private byteLength = 0;

  get length(): number {
    return this.byteLength;
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.byteLength += chunk.length;
  }

  take(length: number): Uint8Array<ArrayBuffer> {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.byteLength) {
      throw new RangeError('Cannot take more bytes than the queue contains');
    }

    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const first = this.chunks[0];
      const available = first.length - this.firstOffset;
      const count = Math.min(available, length - written);
      result.set(first.subarray(this.firstOffset, this.firstOffset + count), written);
      written += count;
      this.firstOffset += count;
      this.byteLength -= count;
      if (this.firstOffset === first.length) {
        this.chunks.shift();
        this.firstOffset = 0;
      }
    }
    return result;
  }
}
