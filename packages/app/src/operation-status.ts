import type { OperationProgress, OperationRecord, OperationType } from './database.js';
import { syncOperationIntent } from './blog-sync.js';

const OPERATION_LABELS: Record<OperationRecord['type'], string> = {
  sync: 'Sync content',
  generate_theme: 'Design theme',
  publish: 'Publish site',
};

const PENDING_MESSAGES: Record<OperationRecord['type'], Record<'queued' | 'running', string>> = {
  sync: { queued: 'Waiting to sync…', running: 'Reading HackMD and building the preview…' },
  generate_theme: { queued: 'Waiting for AI theme generation…', running: 'AI is designing a new theme…' },
  publish: { queued: 'Waiting to publish…', running: 'Building a new live release…' },
};

const OPERATION_MAX: Partial<Record<OperationType, number>> = { sync: 4, publish: 3 };

function storedProgress(operation: OperationRecord): OperationProgress | null {
  const progress = operation.result?.progress;
  if (!progress || typeof progress !== 'object') return null;
  const candidate = progress as Record<string, unknown>;
  if (candidate.kind === 'indeterminate') return { kind: 'indeterminate' };
  if (candidate.kind !== 'determinate' || typeof candidate.value !== 'number' || typeof candidate.max !== 'number') return null;
  if (!Number.isInteger(candidate.value) || !Number.isInteger(candidate.max) || candidate.max < 1 || candidate.value < 0 || candidate.value > candidate.max) return null;
  return { kind: 'determinate', value: candidate.value, max: candidate.max };
}

export function operationProgress(operation: OperationRecord): OperationProgress {
  if (operation.status === 'queued' || operation.type === 'generate_theme') return { kind: 'indeterminate' };
  const saved = storedProgress(operation);
  if (saved) return saved;
  const max = OPERATION_MAX[operation.type];
  return max ? { kind: 'determinate', value: operation.status === 'succeeded' ? max : 0, max } : { kind: 'indeterminate' };
}

export function operationLabel(operation: OperationRecord): string {
  if (operation.type === 'sync') {
    const intent = syncOperationIntent(operation.payload);
    if (intent === 'identity') return 'Update blog details';
    if (intent === 'selection') return 'Update article selection';
  }
  return OPERATION_LABELS[operation.type];
}

export function operationMessage(operation: OperationRecord): string {
  const progressMessage = typeof operation.result?.progressMessage === 'string' ? operation.result.progressMessage : null;
  if (operation.status === 'failed') {
    const error = operation.errorMessage ?? 'The operation failed. Please try again.';
    return progressMessage ? `${progressMessage} — ${error}` : error;
  }
  if (operation.status === 'succeeded') return typeof operation.result?.message === 'string' ? operation.result.message : 'Done';
  if (operation.status === 'running' && progressMessage) return progressMessage;
  if (operation.type === 'sync') {
    const intent = syncOperationIntent(operation.payload);
    if (intent === 'identity') return operation.status === 'queued' ? 'Waiting to update blog details…' : 'Reading HackMD and rebuilding the draft…';
    if (intent === 'selection') return operation.status === 'queued' ? 'Waiting to update article selection…' : 'Rebuilding the draft from your article selection…';
  }
  return PENDING_MESSAGES[operation.type][operation.status];
}
