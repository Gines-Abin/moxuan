// 工作台统计的纯函数工具。

export function localDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 连续写作天数：今天或昨天有记录才开始计数，向前逐日回溯。 */
export function calculateStreak(dayKeys: string[], today = new Date()): number {
  const days = new Set(dayKeys.filter(Boolean));
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function formatWordCount(value: number): string {
  const count = Math.max(0, Math.round(value || 0));
  if (count < 10000) return String(count);
  const wan = count / 10000;
  return `${wan >= 100 ? Math.round(wan) : Number(wan.toFixed(1))} 万`;
}
