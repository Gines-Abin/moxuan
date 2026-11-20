import { describe, expect, it } from 'vitest';
import {
  buildOutlinePrompt, parseChapterDraft, parseMasterOutline, parseVolumeDrafts,
} from '../../src/main/promptTemplates';

describe('大纲提示词与解析', () => {
  it('总纲提示词包含作品信息与 Markdown 约束', () => {
    const prompt = buildOutlinePrompt({
      level: 'master', brief: '灯塔守夜人寻找失踪的姐姐', title: '潮汐尽头', genre: '悬疑', volumeCount: 2, chapterCount: 6,
    });
    expect(prompt).toContain('潮汐尽头');
    expect(prompt).toContain('2 卷');
    expect(prompt).toContain('Markdown');
    expect(prompt).not.toContain('JSON 数组');
  });

  it('卷纲提示词要求 JSON 数组并携带总纲', () => {
    const prompt = buildOutlinePrompt({
      level: 'volume', brief: '寻人', title: '潮汐尽头', genre: '悬疑', master: '## 内核\n主角追查灯塔',
    });
    expect(prompt).toContain('主角追查灯塔');
    expect(prompt).toContain('JSON 数组');
    expect(prompt).toContain('每卷约 8 章');
  });

  it('解析带代码围栏的卷章大纲并过滤脏数据', () => {
    const drafts = parseVolumeDrafts('```json\n[{"title":"第一卷 · 暗潮","summary":"卷摘要","chapters":[{"title":"第一章 · 灯塔","summary":"章摘要"},{"title":""}]},{"title":""}]\n```');
    expect(drafts).toEqual([
      { title: '第一卷 · 暗潮', summary: '卷摘要', chapters: [{ title: '第一章 · 灯塔', summary: '章摘要' }] },
    ]);
  });

  it('没有有效分卷时抛出 502', () => {
    expect(() => parseVolumeDrafts('[]')).toThrowError('模型未返回有效的分卷大纲');
  });

  it('解析单章对象并去掉 Markdown 围栏', () => {
    expect(parseChapterDraft('```json\n{"title":"第三章 · 回声","summary":"章摘要"}\n```'))
      .toEqual({ title: '第三章 · 回声', summary: '章摘要' });
  });

  it('解析总纲时移除围栏并拒绝空内容', () => {
    expect(parseMasterOutline('```markdown\n## 内核\n主线\n```')).toBe('## 内核\n主线');
    expect(() => parseMasterOutline('   ')).toThrowError('模型未返回有效的总纲内容');
  });
});
