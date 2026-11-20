import { describe, expect, it } from 'vitest';
import type { AiRequest, Card, Chapter, PromptTemplate, Work } from '../../src/shared/models';
import { buildPrompt, builtinTemplates, normalizeImportedTemplates, renderTemplate } from '../../src/main/promptTemplates';

describe('提示词模板', () => {
  it('替换变量、数字与空值，不保留未知占位符', () => {
    expect(renderTemplate('《{{workTitle}}》 {{ targetChars }} 字 {{missing}} {{workTitle}}', {
      workTitle: '测试作品', targetChars: 800,
    })).toBe('《测试作品》 800 字  测试作品');
  });

  it('支持中文变量名并清空未知变量', () => {
    expect(renderTemplate('按{{文风偏好}}续写，{{未知变量}}', { 文风偏好: '冷峻' })).toBe('按冷峻续写，');
  });

  it('内置 continue/polish/deai/consistency 中文模板', () => {
    expect(builtinTemplates.map((template) => template.scene)).toEqual(['continue', 'polish', 'deai', 'consistency']);
    for (const template of builtinTemplates) {
      expect(template.isBuiltin).toBe(true);
      expect(template.content).toMatch(/[一-龥]/);
      expect(template.content).toContain('{{cards}}');
    }
    expect(builtinTemplates.find((template) => template.scene === 'consistency')?.content).toContain('JSON 数组');
  });

  it('导入模板始终转为非内置并生成新 ID', () => {
    const [template] = normalizeImportedTemplates({
      schemaVersion: 1,
      templates: [{ templateId: 'builtin-continue', name: '自定义', scene: 'continue', content: '正文', isBuiltin: true }],
    });
    expect(template.name).toBe('自定义');
    expect(template.templateId).not.toBe('builtin-continue');
    expect(template.isBuiltin).toBe(false);
    expect(() => normalizeImportedTemplates({ templates: [{ name: '' }] })).toThrow();
  });

  it('提示词中的设定卡引用会替换为当前作品的设定正文', () => {
    const work: Work = {
      workId: 'work-1', title: '潮汐尽头', genre: '悬疑', description: '灯塔守夜人追查真相。',
      status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    };
    const chapter: Chapter = {
      chapterId: 'chapter-1', workId: 'work-1', nodeId: 'node-1', title: '第一章 · 灯塔', wordCount: 5,
      status: 'writing', revision: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    };
    const template: PromptTemplate = {
      templateId: 'custom-ref', name: '引用设定续写', scene: 'continue',
      content: '请续写《{{workTitle}}》。\n@设定-角色-沈砚\n【正文】\n{{content}}',
      isBuiltin: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const request: AiRequest = {
      requestId: 'req-1', workId: 'work-1', chapterId: 'chapter-1', scene: 'continue', cardIds: [], targetChars: 800, baseRevision: 0,
    };
    const card: Card = {
      cardId: 'card-1', workId: 'work-1', type: 'character', title: '沈砚', content: '身份：灯塔守夜人',
      tags: [], pinned: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    };

    const prompt = buildPrompt(request, template, work, chapter, '沈砚抬头。', [], [card]);
    expect(prompt).toContain('【设定：沈砚｜角色】\n身份：灯塔守夜人');
    expect(prompt).toContain('【正文】\n沈砚抬头。');
    expect(prompt).not.toContain('@设定-角色-沈砚');
  });
});
