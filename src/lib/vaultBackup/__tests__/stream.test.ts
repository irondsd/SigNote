import { readableStreamValues } from '../stream';

describe('vault backup stream adapters', () => {
  it('cancels a ReadableStream when iteration ends early', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(Uint8Array.of(1));
      },
      cancel() {
        cancelled = true;
      },
    });

    const values = readableStreamValues(stream);
    await values.next();
    await values.return(undefined);

    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it('does not cancel a ReadableStream after normal completion', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    const values = [];
    for await (const chunk of readableStreamValues(stream)) values.push(chunk);

    expect(values).toEqual([Uint8Array.of(1)]);
    expect(cancelled).toBe(false);
    expect(stream.locked).toBe(false);
  });
});
