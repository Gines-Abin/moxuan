// 正文排版清理：只做可逆、保守的空白整理，不改变 Markdown 语义。

export function formatManuscript(content: string): string {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n').map((line) => line
    // 中文输入法常见的全角前导空格不属于正文
    .replace(/^(\u3000)+/, '')
    // 行尾空白（含全角空格）不参与排版
    .replace(/[ \t\u3000]+$/, ''));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

export function hasManuscriptChanges(content: string): boolean {
  return formatManuscript(content) !== content;
}
