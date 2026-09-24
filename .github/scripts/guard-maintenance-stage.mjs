const stages = new Set(['normal', 'draining', 'locked']);

export function checkMaintenanceTransition(current, desired, { confirmDrained = false, confirmResume = false } = {}) {
  if (!stages.has(desired)) throw new Error(`Unknown maintenance stage: ${desired}`);
  if (!current) {
    if (desired !== 'normal') throw new Error('Initialize the stack in normal maintenance stage first');
    return;
  }
  if (!stages.has(current)) throw new Error(`Unknown deployed maintenance stage: ${current}`);
  if (current === desired) return;
  if (current === 'normal' && desired === 'draining') return;
  if (current === 'draining' && desired === 'locked' && confirmDrained) return;
  if (current === 'locked' && desired === 'normal' && confirmResume) return;
  throw new Error(`Maintenance transition ${current} -> ${desired} is not allowed or lacks confirmation`);
}

if (process.argv[1]?.endsWith('guard-maintenance-stage.mjs')) {
  try {
    checkMaintenanceTransition(process.argv[2], process.argv[3], {
      confirmDrained: process.argv[4] === 'true',
      confirmResume: process.argv[5] === 'true',
    });
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
