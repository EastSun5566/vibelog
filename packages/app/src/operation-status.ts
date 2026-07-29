import type { OperationRecord } from './database.js';
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

export function operationLabel(operation: OperationRecord): string {
  if (operation.type === 'sync') {
    const intent = syncOperationIntent(operation.payload);
    if (intent === 'identity') return 'Update blog details';
    if (intent === 'selection') return 'Update article selection';
  }
  return OPERATION_LABELS[operation.type];
}

export function operationMessage(operation: OperationRecord): string {
  if (operation.status === 'failed') return operation.errorMessage ?? 'The operation failed. Please try again.';
  if (operation.status === 'succeeded') return typeof operation.result?.message === 'string' ? operation.result.message : 'Done';
  if (operation.type === 'sync') {
    const intent = syncOperationIntent(operation.payload);
    if (intent === 'identity') return operation.status === 'queued' ? 'Waiting to update blog details…' : 'Reading HackMD and rebuilding the draft…';
    if (intent === 'selection') return operation.status === 'queued' ? 'Waiting to update article selection…' : 'Rebuilding the draft from your article selection…';
  }
  return PENDING_MESSAGES[operation.type][operation.status];
}
