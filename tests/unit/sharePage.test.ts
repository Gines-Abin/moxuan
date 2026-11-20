import { describe, expect, it } from 'vitest';
import { formatSharePage } from '../../src/shared/utils/sharePage';

describe('formatSharePage', () => {
  it('生成可离线打开的单文件阅读页并转义危险内容', () => {
    const page = formatSharePage({
      title: '<危险标题>',
      genre: '悬疑',
      description: '简介 & 说明',
      chapters: [
        { title: '第一章 <开始>', content: '**粗体**第一段。\n\n第二段 <script>alert(1)</script>' },
        { title: '第二章', content: '另一段正文。' },
      ],
      wordCount: 20,
    });

    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<title>&lt;危险标题&gt;</title>');
    expect(page).toContain('悬疑 · 2 章 · 20 字');
    expect(page).toContain('简介 &amp; 说明');
    expect(page).toContain('第一章 &lt;开始&gt;');
    expect(page).toContain('粗体第一段。');
    expect(page).toContain('第二段 alert(1)');
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('href="#chapter-2"');
    expect(page).toContain('不包含账号、邀请码、访问统计或邀请奖励');
  });

  it('单章不生成目录，并保留段落换行', () => {
    const page = formatSharePage({
      title: '单章作品',
      chapters: [{ title: '唯一章节', content: '第一行\n第二行\n\n新段落' }],
      wordCount: 10,
    });

    expect(page).not.toContain('aria-label="目录"');
    expect(page).toContain('第一行<br>第二行');
    expect(page).toContain('<p>新段落</p>');
  });
});
