import { createServer } from 'node:http';

const responses = new Map([
  ['/overview', {
    type: 'application/json',
    body: JSON.stringify({ notes: [{
      id: 'hello',
      title: 'Hello VibeLog',
      tags: ['Product'],
      lastchangeAt: '2026-08-30T01:00:00Z',
      publishType: 'view',
      publishedAt: '2026-08-29T01:00:00Z',
      permalink: 'hello-vibelog',
    }, {
      id: 'second',
      title: 'A Second Note',
      tags: ['Writing'],
      lastchangeAt: '2026-08-31T01:00:00Z',
      publishType: 'view',
      publishedAt: '2026-08-31T01:00:00Z',
      permalink: 'second-note',
    }] }),
  }],
  ['/info', {
    type: 'application/json',
    body: JSON.stringify({ user: { displayName: 'Alice Writer', biography: 'Notes about humane software.' }, team: null }),
  }],
  ['/hello/download', {
    type: 'text/markdown; charset=utf-8',
    body: '# Hello VibeLog\n\nThis article came through the complete local publishing path.\n\n這是一篇中文搜尋測試。\n\nPlain prefix:value and inline `a < b` remain intact.\n\n```ts\nconst greeting = "hello";\n```\n\n~~~text\n<div>literal code</div>\n~~~\n',
  }],
  ['/second/download', {
    type: 'text/markdown; charset=utf-8',
    body: '# A Second Note\n\nThis article can be excluded in the editor.\n',
  }],
]);

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200).end('ok');
    return;
  }
  if (request.url === '/v1/me') {
    // The HackMD API token "token-for-<name>" belongs to the profile <name>.
    const owner = /^Bearer token-for-(.+)$/u.exec(request.headers.authorization ?? '')?.[1];
    response.writeHead(owner ? 200 : 401, { 'content-type': 'application/json' });
    response.end(owner ? JSON.stringify({ id: owner, userPath: owner, email: null }) : '{}');
    return;
  }
  // Every public profile shares the same notes, so each scenario can claim its own account.
  // A name starting with "missing" has no public profile.
  const profile = /^\/(api\/@[^/]+\/overview|info\/@[^/]+)$/u.exec(request.url ?? '');
  const name = /@([^/]+)/u.exec(request.url ?? '')?.[1] ?? '';
  const fixture = profile
    ? name.startsWith('missing')
      ? undefined
      : responses.get(request.url?.startsWith('/api/') ? '/overview' : '/info')
    : responses.get(request.url ?? '');
  if (!fixture) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': fixture.type });
  response.end(fixture.body);
});

server.listen(4400, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
