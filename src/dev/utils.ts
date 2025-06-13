import type { IncomingMessage, ServerResponse } from 'node:http';

declare module 'http' {
  interface IncomingMessage {
    body?: unknown;
  }
}

type NextFunction = (error?: Error) => void

export class HttpError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export function parseBody(limit = 1024 * 1024) {
  return (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method ?? '')) {
      next();
      return;
    }
    if (req.body) {
      next();
      return;
    }
    const contentType = req.headers['content-type']?.split(';')[0] ?? '';
    if (contentType !== 'application/json') {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req
      .on('error', next)
      .on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) {
          next(new HttpError('Too large', 413));
          return;
        }

        chunks.push(chunk);
      })
      .on('end', () => {
        try {
          const rawBody = Buffer.concat(chunks).toString();
          req.body = rawBody.trim() ? JSON.parse(rawBody) : {};
          next();
        } catch {
          next(new HttpError('Invalid JSON', 400));
        }
      });
  };
}

export function handleError() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (error: Error, req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    const status = error instanceof HttpError ? error.status : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: error.message || 'Internal Server Error',
    }));
  };
}
