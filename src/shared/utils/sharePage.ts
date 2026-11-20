// 生成可离线打开的作品阅读页，用于把本地作品分享给朋友。
import { countVisibleChars, stripMarkdown } from './countVisibleChars';

export interface SharePageChapter {
  title: string;
  content: string;
}

export interface SharePageInput {
  title: string;
  genre?: string;
  description?: string;
  chapters: SharePageChapter[];
  wordCount: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphs(content: string): string {
  return stripMarkdown(content)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** 生成无脚本、无外部资源、可直接发送或离线打开的静态阅读页。 */
export function formatSharePage(input: SharePageInput): string {
  const title = escapeHtml(input.title || '未命名作品');
  const meta = [
    input.genre?.trim(),
    `${input.chapters.length} 章`,
    `${Math.max(input.wordCount, 0).toLocaleString('zh-CN')} 字`,
  ].filter(Boolean).join(' · ');
  const description = input.description?.trim()
    ? `<p class="description">${escapeHtml(input.description.trim())}</p>`
    : '';
  const toc = input.chapters.length > 1
    ? `<nav class="toc" aria-label="目录"><h2>目录</h2><ol>${input.chapters
      .map((chapter, index) => `<li><a href="#chapter-${index + 1}">${escapeHtml(chapter.title)}</a></li>`)
      .join('')}</ol></nav>`
    : '';
  const body = input.chapters
    .map((chapter, index) => `<section class="chapter" id="chapter-${index + 1}">
<h2>${escapeHtml(chapter.title)}</h2>
${paragraphs(chapter.content)}
</section>`)
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; color: #2f3d36; background: #eef1ec; font-family: "Noto Serif SC", "Songti SC", "SimSun", serif; line-height: 1.9; }
.page { width: min(760px, calc(100% - 32px)); padding: 56px 64px; margin: 32px auto; background: #fffdf8; border: 1px solid #e3e2d8; border-radius: 6px; box-shadow: 0 16px 50px rgba(45, 60, 50, .08); }
.cover { padding-bottom: 28px; border-bottom: 1px solid #e8e5da; text-align: center; }
.eyebrow { margin: 0 0 18px; color: #8a988f; font-family: system-ui, sans-serif; font-size: 11px; letter-spacing: .18em; }
h1 { margin: 0; color: #26372f; font-size: clamp(26px, 5vw, 38px); font-weight: 600; letter-spacing: .04em; }
.meta { margin: 14px 0 0; color: #8b978f; font-family: system-ui, sans-serif; font-size: 12px; }
.description { max-width: 560px; margin: 20px auto 0; color: #6f7d74; font-size: 14px; line-height: 1.9; }
.toc { padding: 22px 0 4px; }
.toc h2 { margin: 0 0 10px; color: #718079; font-family: system-ui, sans-serif; font-size: 12px; font-weight: 600; letter-spacing: .12em; }
.toc ol { padding-left: 22px; margin: 0; }
.toc li { margin: 5px 0; }
.toc a { color: #416b58; text-decoration: none; }
.toc a:hover { text-decoration: underline; }
.chapter { padding-top: 38px; }
.chapter h2 { padding-bottom: 12px; margin: 0 0 22px; color: #31483d; font-size: 20px; font-weight: 600; border-bottom: 1px solid #eeebe1; }
.chapter p { margin: 0 0 1.05em; text-align: justify; text-indent: 2em; }
footer { padding-top: 30px; margin-top: 40px; color: #9aa49d; font-family: system-ui, sans-serif; font-size: 11px; text-align: center; border-top: 1px solid #e8e5da; }
@media (max-width: 640px) { .page { width: 100%; padding: 34px 22px; margin: 0; border: 0; border-radius: 0; } }
@media print { body { background: #fff; } .page { width: auto; margin: 0; padding: 0; border: 0; box-shadow: none; } .toc { break-after: page; } .chapter { break-inside: avoid-page; } }
</style>
</head>
<body>
<main class="page">
<header class="cover">
<p class="eyebrow">墨轩 MoXuan · 本地导出</p>
<h1>${title}</h1>
<p class="meta">${escapeHtml(meta)}</p>
${description}
</header>
${toc}
<article>
${body}
</article>
<footer>本页为本地静态导出，可直接离线打开或发送给朋友；不包含账号、邀请码、访问统计或邀请奖励。</footer>
</main>
</body>
</html>`;
}

export function sharePageWordCount(chapters: SharePageChapter[]): number {
  return chapters.reduce((sum, chapter) => sum + countVisibleChars(chapter.content), 0);
}
