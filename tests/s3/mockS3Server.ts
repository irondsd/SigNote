import http from 'http';
import type { AddressInfo } from 'net';

export interface MockS3Server {
  port: number;
  close: () => Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function xmlError(res: http.ServerResponse, status: number, code: string, message: string) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
  res.writeHead(status, {
    'Content-Type': 'application/xml',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function startMockS3Server(): Promise<MockS3Server> {
  const store = new Map<string, { body: Buffer; contentType: string }>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const key = url.pathname;

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const contentType = req.headers['content-type'] ?? 'application/octet-stream';
      store.set(key, { body, contentType });
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      const obj = store.get(key);
      if (!obj) return xmlError(res, 404, 'NoSuchKey', 'The specified key does not exist.');
      res.writeHead(200, {
        'Content-Type': obj.contentType,
        'Content-Length': obj.body.length,
      });
      res.end(obj.body);
      return;
    }

    if (req.method === 'DELETE') {
      store.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'HEAD') {
      const obj = store.get(key);
      if (!obj) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': obj.contentType,
        'Content-Length': obj.body.length,
      });
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise((r, e) => server.close((err) => (err ? e(err) : r()))),
      });
    });
    server.on('error', reject);
  });
}
