import { createDiscreteApi } from 'naive-ui';
import type { ApiResult } from '../../shared/ipc';
import { countVisibleChars } from '../../shared/utils/countVisibleChars';

export const { message, dialog } = createDiscreteApi(['message', 'dialog'], {
  messageProviderProps: { placement: 'top', duration: 3200, max: 4 },
});

export function unwrap<T>(result: ApiResult<T>): T {
  if (result.code !== 0) {
    throw new Error(result.message || '操作未完成，请稍后重试');
  }
  return result.data;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作未完成，请稍后重试';
}

export function reportError(error: unknown): void {
  message.error(errorText(error));
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long', day: 'numeric',
  }).format(date);
}

export function countText(value: string): number {
  return countVisibleChars(value);
}

export function createRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `inkforge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 复制文本到系统剪贴板，剪贴板权限不可用时回退到临时文本框。 */
export async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}
