import { serve } from '@hono/node-server';
import app from './index.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

console.log(`🚀 VibeLog SaaS API Server running on http://localhost:${String(port)}`);
console.log('📝 API Endpoints:');
console.log('   GET  /health                      - Health check');
console.log('   POST /api/projects                - Create a new blog project');
console.log('   POST /api/projects/:id/build      - Build static site');
console.log('   POST /api/projects/:id/style      - AI-powered style transformation');

serve({
  fetch: app.fetch,
  port,
});
