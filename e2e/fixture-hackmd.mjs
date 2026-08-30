import { createServer } from 'node:http';

const responses = new Map([
  ['/api/@alice-hackmd/overview', {
    type: 'application/json',
    body: JSON.stringify({ notes: [{
      id: 'hello',
      title: 'Hello VibeLog',
      tags: ['Product'],
      lastchangeAt: '2026-08-30T01:00:00Z',
      publishType: 'view',
      publishedAt: '2026-08-29T01:00:00Z',
      permalink: 'hello-vibelog',
    }] }),
  }],
  ['/info/@alice-hackmd', {
    type: 'application/json',
    body: JSON.stringify({ user: { displayName: 'Alice Writer', biography: 'Notes about humane software.' }, team: null }),
  }],
  ['/hello/download', {
    type: 'text/markdown; charset=utf-8',
    body: '# Hello VibeLog\n\nThis article came through the complete local publishing path.\n',
  }],
]);

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200).end('ok');
    return;
  }
  const fixture = responses.get(request.url ?? '');
  if (!fixture) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': fixture.type });
  response.end(fixture.body);
});

server.listen(4400, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
