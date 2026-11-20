import { describe, expect, it } from 'vitest';
import type { Card } from '../../src/shared/models';
import { cardReferenceKey, resolveCardReferences } from '../../src/shared/utils/cardReferences';

const baseCard: Card = {
  cardId: 'card-1',
  workId: 'work-1',
  type: 'character',
  title: '沈砚',
  content: '身份：灯塔守夜人\n性格：克制、敏锐',
  tags: ['主角'],
  pinned: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

describe('设定卡引用', () => {
  it('生成引用 key 时使用中文类型名与标题', () => {
    expect(cardReferenceKey(baseCard)).toBe('@设定-角色-沈砚');
    expect(cardReferenceKey({ ...baseCard, type: 'world', title: '潮汐规则' })).toBe('@设定-世界观-潮汐规则');
  });

  it('命中时替换为设定正文并保留行尾标点', () => {
    const content = resolveCardReferences('请参考 @设定-角色-沈砚。再续写下一段。', [baseCard]);
    expect(content).toBe('请参考 【设定：沈砚｜角色】\n身份：灯塔守夜人\n性格：克制、敏锐。再续写下一段。');
    expect(content).not.toContain('@设定-');
  });

  it('未命中、类型不符或标题不一致时标记待补全', () => {
    const content = resolveCardReferences([
      '@设定-角色-林晚',
      '@设定-世界观-沈砚',
      '@设定-角色-沈砚 · 主角小传',
    ].join('\n'), [baseCard]);
    expect(content).toContain('（设定“林晚”待补全）');
    expect(content).toContain('（设定“沈砚”待补全）');
    expect(content).toContain('（设定“沈砚 · 主角小传”待补全）');
  });

  it('弃用与删除的设定卡不参与引用，其余文本保持原样', () => {
    const deprecated = { ...baseCard, deprecatedAt: '2026-02-01T00:00:00.000Z' };
    const deleted = { ...baseCard, deletedAt: '2026-02-01T00:00:00.000Z' };
    expect(resolveCardReferences('@设定-角色-沈砚', [deprecated])).toContain('待补全');
    expect(resolveCardReferences('@设定-角色-沈砚', [deleted])).toContain('待补全');
    expect(resolveCardReferences('普通正文 @笔记-角色-沈砚 保持原样', [baseCard])).toBe('普通正文 @笔记-角色-沈砚 保持原样');
  });

  it('多个引用可同时解析，同名卡按列表顺序取第一张', () => {
    const second: Card = { ...baseCard, cardId: 'card-2', title: '林晚', content: '灯塔临时看守。' };
    const duplicate: Card = { ...baseCard, cardId: 'card-3', updatedAt: '2026-03-01T00:00:00.000Z', content: '较新的同名卡。' };
    const content = resolveCardReferences('@设定-角色-沈砚\n@设定-角色-林晚', [baseCard, second, duplicate]);
    expect(content).toContain('身份：灯塔守夜人');
    expect(content).not.toContain('较新的同名卡');
    expect(content).toContain('灯塔临时看守。');
  });
});
