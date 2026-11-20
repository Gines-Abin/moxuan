export interface ImportedChapter {
  title: string;
  content: string;
}

const CHAPTER_HEADING = /^\s*第[一二三四五六七八九十百千万零两0-9]+[章节回幕场话][^\n]*$/u;
const MARKDOWN_HEADING = /^\s{0,3}#{1,3}\s+[^\n]+$/u;

function headingText(line: string): string {
  return line.trim().replace(/^#{1,3}\s+/, '').replace(/^[*_~`\s]+|[*_~`\s]+$/g, '').trim();
}

/**
 * 将整本书文本拆分为章节。支持“第X章/节/回/幕/场/话”标题与 Markdown 一至三级标题。
 * 若不存在可识别标题，则整篇作为单章「全文」。
 */
export function splitChapters(raw: string): ImportedChapter[] {
  const content = raw.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const lines = content.split('\n');
  const chapters: ImportedChapter[] = [];
  let currentTitle = '';
  let buffer: string[] = [];
  let preamble: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    if (currentTitle || text) {
      chapters.push({ title: currentTitle || `第${chapters.length + 1}章`, content: text });
    }
    buffer = [];
  };

  for (const line of lines) {
    const isHeading = CHAPTER_HEADING.test(line) || MARKDOWN_HEADING.test(line);
    if (isHeading) {
      const title = headingText(line);
      if (title) {
        if (currentTitle) flush();
        else if (preamble.join('\n').trim()) buffer.push(...preamble);
        currentTitle = title;
        preamble = [];
        continue;
      }
    }
    if (currentTitle) buffer.push(line);
    else preamble.push(line);
  }
  if (currentTitle) flush();

  if (chapters.length) {
    if (!chapters[0].content && preamble.join('\n').trim()) {
      chapters[0].content = preamble.join('\n').trim();
    }
    return chapters;
  }
  const whole = content.trim();
  return whole ? [{ title: '全文', content: whole }] : [];
}
