import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

/**
 * The E2E object store.
 *
 * It began as a two-verb key/value server for the file-upload specs. Rotation
 * needs more from it, because the properties the rotation design leans on are
 * storage properties: an accepted object cannot be overwritten by a PUT grant
 * that is still valid, a body is bound to the checksum it was signed for, and a
 * verification read returns the exact bytes that were stored. A mock that
 * accepts every PUT would let all three regress silently.
 *
 * So this now models conditional create (`If-None-Match: *`), SHA-256 checksum
 * binding on write and on `HeadObject`, and browser CORS for the signed
 * cross-origin transfers. It deliberately does **not** verify signatures: the
 * production adapter's signing is exercised against real MinIO by
 * `tests/rotation/storage.ts`, and reproducing SigV4 here would test
 * this file rather than the app.
 *
 * Fault injection and inspection are reachable over HTTP under `/__control/`
 * because the server lives in the Playwright main process while specs run in
 * workers. That path can never collide with an object key, which is always
 * `/<bucket>/<key>`, and the whole server exists only inside the test run.
 */

export interface MockS3Server {
  port: number;
  close: () => Promise<void>;
  /** Drops the listener and rebinds on the same port, keeping stored objects. */
  restart: () => Promise<void>;
  objectCount: () => number;
}

type StoredObject = { body: Buffer; contentType: string; checksum: string };

type Fault = { method: string; keyPattern: string; status: number; remaining: number };

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function xmlError(res: http.ServerResponse, status: number, code: string, message: string) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
  res.writeHead(status, {
    'Content-Type': 'application/xml',
    'Content-Length': Buffer.byteLength(body),
    ...CORS,
  });
  res.end(body);
}

/**
 * Wide open because every origin in the run is a localhost port chosen at
 * startup. `ExposeHeaders` matters as much as the allow list: without it the
 * browser hides the checksum header from the page's own read-back.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,HEAD,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'ETag,Content-Length,x-amz-checksum-sha256',
  'Access-Control-Max-Age': '600',
};

const sha256 = (body: Buffer) => crypto.createHash('sha256').update(body).digest('base64');

export async function startMockS3Server(): Promise<MockS3Server> {
  const store = new Map<string, StoredObject>();
  const faults: Fault[] = [];

  const takeFault = (method: string, key: string): Fault | undefined => {
    const index = faults.findIndex(
      (fault) => fault.method === method && key.includes(fault.keyPattern) && fault.remaining > 0,
    );
    if (index === -1) return undefined;
    const fault = faults[index];
    fault.remaining -= 1;
    if (fault.remaining === 0) faults.splice(index, 1);
    return fault;
  };

  const control = async (req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<boolean> => {
    if (!pathname.startsWith('/__control/')) return false;
    const action = pathname.slice('/__control/'.length);
    const json = (status: number, value: unknown) => {
      const body = JSON.stringify(value);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...CORS });
      res.end(body);
    };

    if (action === 'objects') {
      return (
        json(200, {
          objects: [...store.entries()].map(([key, object]) => ({ key, bytes: object.body.length })),
        }),
        true
      );
    }
    if (action === 'reset') {
      faults.length = 0;
      return (json(200, { ok: true }), true);
    }
    if (action === 'fail') {
      const payload = JSON.parse((await readBody(req)).toString() || '{}') as Partial<Fault> & { times?: number };
      faults.push({
        method: (payload.method ?? 'PUT').toUpperCase(),
        keyPattern: payload.keyPattern ?? '',
        status: payload.status ?? 500,
        remaining: payload.times ?? 1,
      });
      return (json(200, { ok: true }), true);
    }
    if (action === 'delete') {
      const payload = JSON.parse((await readBody(req)).toString() || '{}') as { keyPattern?: string };
      let removed = 0;
      for (const key of [...store.keys()]) {
        if (payload.keyPattern && key.includes(payload.keyPattern)) {
          store.delete(key);
          removed++;
        }
      }
      return (json(200, { removed }), true);
    }
    if (action === 'corrupt') {
      const payload = JSON.parse((await readBody(req)).toString() || '{}') as { keyPattern?: string };
      let corrupted = 0;
      for (const [key, object] of store) {
        if (payload.keyPattern && key.includes(payload.keyPattern)) {
          // Same length, different bytes: a checksum or a decrypt has to be what
          // notices, not a size comparison.
          const body = Buffer.from(object.body);
          body[0] ^= 0xff;
          store.set(key, { ...object, body, checksum: sha256(body) });
          corrupted++;
        }
      }
      return (json(200, { corrupted }), true);
    }
    return (json(404, { error: 'unknown control action' }), true);
  };

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (await control(req, res, url.pathname)) return;

    const fault = takeFault(req.method ?? '', key);
    if (fault) return xmlError(res, fault.status, 'InjectedFault', 'Injected by the test harness');

    if (req.method === 'PUT') {
      const body = await readBody(req);
      // Conditional create. A still-valid grant from an earlier attempt must
      // not be able to replace an object the server already accepted.
      if (req.headers['if-none-match'] === '*' && store.has(key)) {
        return xmlError(res, 412, 'PreconditionFailed', 'At least one of the preconditions did not hold');
      }
      const claimed = req.headers['x-amz-checksum-sha256'];
      const actual = sha256(body);
      if (typeof claimed === 'string' && claimed !== actual) {
        return xmlError(res, 400, 'BadDigest', 'The checksum did not match the body');
      }
      const declared = req.headers['content-length'];
      if (typeof declared === 'string' && Number(declared) !== body.length) {
        return xmlError(res, 400, 'IncompleteBody', 'The body did not match the declared length');
      }
      store.set(key, {
        body,
        contentType: (req.headers['content-type'] as string) ?? 'application/octet-stream',
        checksum: actual,
      });
      res.writeHead(200, { ETag: `"${crypto.createHash('md5').update(body).digest('hex')}"`, ...CORS });
      res.end();
      return;
    }

    if (req.method === 'GET') {
      const object = store.get(key);
      if (!object) return xmlError(res, 404, 'NoSuchKey', 'The specified key does not exist.');
      res.writeHead(200, {
        'Content-Type': object.contentType,
        'Content-Length': object.body.length,
        'x-amz-checksum-sha256': object.checksum,
        ...CORS,
      });
      res.end(object.body);
      return;
    }

    if (req.method === 'HEAD') {
      const object = store.get(key);
      if (!object) {
        res.writeHead(404, CORS);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': object.contentType,
        'Content-Length': object.body.length,
        // Returned unconditionally. The SDK asks for it with ChecksumMode, and
        // an omitted header would make `verify()` fail for the wrong reason.
        'x-amz-checksum-sha256': object.checksum,
        ...CORS,
      });
      res.end();
      return;
    }

    if (req.method === 'DELETE') {
      store.delete(key);
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    res.writeHead(405, CORS);
    res.end();
  };

  let server = http.createServer(handler);
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    server.on('error', reject);
  });

  const close = (target: http.Server) =>
    new Promise<void>((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));

  return {
    port,
    objectCount: () => store.size,
    close: () => close(server),
    /**
     * Objects outlive the process that served them. Restarting on the same port
     * with the same store is what lets a spec assert that staged bytes survive
     * a storage outage rather than a mere in-memory pause.
     */
    async restart() {
      await close(server);
      server = http.createServer(handler);
      await new Promise<void>((resolve, reject) => {
        server.listen(port, '127.0.0.1', resolve);
        server.on('error', reject);
      });
    },
  };
}
