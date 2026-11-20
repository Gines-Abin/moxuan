// 全局查找替换的纯函数工具，供主进程存储层与测试复用。

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildSearchPattern(keyword: string, caseSensitive = true): RegExp {
  return new RegExp(escapeRegExp(keyword), caseSensitive ? 'g' : 'gi');
}

export function countMatches(content: string, keyword: string, caseSensitive = true): number {
  if (!keyword) return 0;
  return content.match(buildSearchPattern(keyword, caseSensitive))?.length ?? 0;
}

/** 提取命中的行作为预览，最多 limit 条，每条截断到 80 字。 */
export function previewMatches(content: string, keyword: string, caseSensitive = true, limit = 3): string[] {
  if (!keyword) return [];
  const pattern = buildSearchPattern(keyword, caseSensitive);
  const previews: string[] = [];
  for (const rawLine of content.split('\n')) {
    pattern.lastIndex = 0;
    if (!pattern.test(rawLine)) continue;
    const line = rawLine.trim();
    if (!line) continue;
    previews.push(line.length > 80 ? `${line.slice(0, 80)}…` : line);
    if (previews.length >= limit) break;
  }
  return previews;
}
