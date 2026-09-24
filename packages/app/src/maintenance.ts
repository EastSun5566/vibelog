export type MaintenanceStage = 'normal' | 'draining' | 'locked';

export function blocksRequest(stage: MaintenanceStage, service: 'web' | 'worker', path: string): boolean {
  return path !== '/health' && (service === 'web' ? stage !== 'normal' : stage === 'locked');
}

export function maintenanceResponse(method: string): Response {
  return new Response(method === 'HEAD' ? null : 'VibeLog is temporarily unavailable for maintenance. Please try again shortly.', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '300',
    },
  });
}
