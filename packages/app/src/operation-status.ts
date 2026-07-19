import type { OperationRecord } from './database.js';

export const OPERATION_LABELS: Record<OperationRecord['type'], string> = {
  sync: '同步內容',
  generate_theme: '設計樣式',
  publish: '發布網站',
};

const PENDING_MESSAGES: Record<OperationRecord['type'], Record<'queued' | 'running', string>> = {
  sync: { queued: '正在等待同步…', running: '正在讀取 HackMD 並建立預覽…' },
  generate_theme: { queued: '正在等待 AI 樣式設計…', running: 'AI 正在設計新樣式…' },
  publish: { queued: '正在等待發布…', running: '正在建立新的線上版本…' },
};

export function operationMessage(operation: OperationRecord): string {
  if (operation.status === 'failed') return operation.errorMessage ?? '操作失敗，請再試一次。';
  if (operation.status === 'succeeded') return typeof operation.result?.message === 'string' ? operation.result.message : '完成';
  return PENDING_MESSAGES[operation.type][operation.status];
}
