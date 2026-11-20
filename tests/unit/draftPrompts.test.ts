import { describe, expect, it } from 'vitest';
import type { Card, Work } from '../../src/shared/models';
import {
  buildCardPrompt, buildDraftPrompt, buildOutlinePrompt, parseCardDrafts, parseDraftText,
} from '../../src/main/promptTemplates';

const work: Work = {
  workId: 'work-1',
  title: '潮汐尽头',
  genre: '悬疑',
  description: '灯塔守夜人追查姐姐失踪的真相。',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const card: Card = {
  cardId: 'card-1',
  workId: 'work-1',
  type: 'character',
  title: '沈砚',
  content: '灯塔守夜人，右手有旧伤。',
  tags: ['主角'],
  pinned: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

describe('参考作品与设定补齐提示词', () => {
  it('总纲提示词携带参考片段并截断，明确禁止复制原文', () => {
    const prompt = buildOutlinePrompt({ level: 'master', brief: '寻人', reference: '甲'.repeat(7000) });
    expect(prompt).toContain('参考作品片段');
    expect(prompt).toContain('禁止复制原文');
    expect(prompt).toContain('……');
    expect(prompt).not.toContain('甲'.repeat(6001));
  });

  it('未上传参考书时不插入参考段落', () => {
    const prompt = buildOutlinePrompt({ level: 'volume', brief: '寻人', master: '## 内核' });
    expect(prompt).not.toContain('参考作品片段');
  });

  it('设定补齐提示词包含已有设定、类型约束与补充要求', () => {
    const prompt = buildCardPrompt(work, '## 内核\n主线', ['沈砚'], ['character', 'item'], '重点补齐反派', 4);
    expect(prompt).toContain('潮汐尽头');
    expect(prompt).toContain('沈砚');
    expect(prompt).toContain('重点补齐反派');
    expect(prompt).toContain('4 条');
    expect(prompt).toContain('character');
  });

  it('作品基础信息会进入设定与正文提示词', () => {
    const rich: Work = {
      ...work, style: '冷峻克制', targetWords: 150000, platform: '番茄小说', requirements: '每章结尾留钩子',
    };
    const cardPrompt = buildCardPrompt(rich, '## 内核', [], ['world'], '', 3);
    expect(cardPrompt).toContain('文风：冷峻克制');
    expect(cardPrompt).toContain('目标字数：约 150000 字');
    expect(cardPrompt).toContain('发布平台：番茄小说');
    expect(cardPrompt).toContain('补充要求：每章结尾留钩子');
    const draftPrompt = buildDraftPrompt({
      mode: 'continue', work: rich, chapterTitle: '第二章', outlineSummary: '继续追查', volumeTitle: '第一卷',
      master: '', cards: [], previousText: '', targetChars: 1200,
    });
    expect(draftPrompt).toContain('文风：冷峻克制');
    expect(draftPrompt).toContain('发布平台：番茄小说');
  });

  it('解析设定 JSON，非法类型回落为世界观并过滤空项', () => {
    const drafts = parseCardDrafts('```json\n[{"type":"character","title":"沈砚","content":"守夜人","tags":["主角"]},{"type":"unknown","title":"海上城","content":"潮汐规则","tags":[]},{"title":""}]\n```');
    expect(drafts).toEqual([
      { type: 'character', title: '沈砚', content: '守夜人', tags: ['主角'] },
      { type: 'world', title: '海上城', content: '潮汐规则', tags: [] },
    ]);
  });

  it('没有有效设定时抛出 502', () => {
    expect(() => parseCardDrafts('[]')).toThrowError('模型未返回有效的设定资料');
  });

  it('黄金三章提示词包含章纲、前文、字数与开篇要求', () => {
    const prompt = buildDraftPrompt({
      mode: 'golden-three',
      work,
      chapterTitle: '第一章 · 灯塔熄灭',
      outlineSummary: '灯塔在暴雨夜熄灭。',
      volumeTitle: '第一卷 · 暗潮',
      master: '## 故事内核\n守夜人追查灯塔',
      cards: [card],
      previousText: '沈砚在码头捡到一枚铜钥匙。',
      instruction: '使用第一人称',
      targetChars: 1800,
    });
    expect(prompt).toContain('第一章 · 灯塔熄灭');
    expect(prompt).toContain('第一卷 · 暗潮');
    expect(prompt).toContain('灯塔在暴雨夜熄灭。');
    expect(prompt).toContain('沈砚在码头捡到一枚铜钥匙。');
    expect(prompt).toContain('约 1800 字');
    expect(prompt).toContain('使用第一人称');
    expect(prompt).toContain('黄金三章');
  });

  it('续写提示词携带上一章结尾锚点并给出衔接硬规则', () => {
    const prompt = buildDraftPrompt({
      mode: 'continue',
      work,
      chapterTitle: '第二章 · 潮声',
      outlineSummary: '沈砚追查铜钥匙的来处。',
      volumeTitle: '第一卷 · 暗潮',
      master: '',
      cards: [],
      previousText: '第一段早已结束的旧事。\n\n第二段仍在铺垫。\n\n沈砚握紧铜钥匙，听见门后传来脚步声。',
      targetChars: 1500,
    });
    expect(prompt).toContain('【上一章结尾原文（衔接锚点）】');
    expect(prompt).toContain('沈砚握紧铜钥匙，听见门后传来脚步声。');
    expect(prompt).toContain('同一时间、同一地点、同一在场人物');
    expect(prompt).toContain('禁止用“与此同时”“另一边”“三天后”');
    expect(prompt).toContain('落笔点：第一句要用锚点最后一句里出现的人物、物品或动作起笔');
    expect(prompt).toContain('第一句禁止以“那”“这”“他”“她”“它”开头');
    expect(prompt).toContain('必须先用 1-2 句写清人物如何离开上一场景');
  });

  it('开篇章节不附带衔接锚点', () => {
    const prompt = buildDraftPrompt({
      mode: 'continue', work, chapterTitle: '第一章', outlineSummary: '开场',
      volumeTitle: '第一卷', master: '', cards: [], previousText: '', targetChars: 1200,
    });
    expect(prompt).toContain('（本章为开篇，无前文）');
  });

  it('解析正文时去掉代码围栏与章节标题，空内容报错', () => {
    expect(parseDraftText('```markdown\n第一章 · 灯塔熄灭\n\n潮声从礁石后传来。\n```')).toBe('潮声从礁石后传来。');
    expect(() => parseDraftText('   ')).toThrowError('模型未返回有效的正文内容');
  });
});
