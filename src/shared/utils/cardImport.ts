// 设定卡批量导入解析：卡片之间用 --- 或 === 分隔，首行为标题，其余为正文。

export interface ImportedCard {
  title: string;
  content: string;
}

const SEPARATOR = /^\s*(?:-{3,}|={3,})\s*$/;
const MAX_CARDS = 100;

export function parseCardImport(input: string): ImportedCard[] {
  const blocks = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .reduce<string[][]>((groups, line) => {
      if (SEPARATOR.test(line)) {
        groups.push([]);
        return groups;
      }
      groups[groups.length - 1].push(line);
      return groups;
    }, [[]]);

  const cards: ImportedCard[] = [];
  for (const block of blocks) {
    const lines = block.map((line) => line.trim()).filter((line) => line.length > 0);
    if (!lines.length) continue;
    const title = lines[0].replace(/^#{1,6}\s*/, '').replace(/[：:]\s*$/, '').slice(0, 100).trim();
    const content = lines.slice(1).join('\n').slice(0, 12000);
    if (!title || !content) continue;
    cards.push({ title, content });
    if (cards.length >= MAX_CARDS) break;
  }
  return cards;
}
