import { describe, expect, it } from 'vitest';
import type { GenerationRecord } from '../../src/shared/models';
import { summarizeUsage } from '../../src/shared/utils/usageStats';

const today = new Date(2026, 10, 20, 12, 0, 0);

function record(createdAt: Date | string, promptTokens?: number, completionTokens?: number, model = 'mock-chat'): GenerationRecord {
  return {
    generationId: String(Math.random()),
    kind: 'continue',
    workId: 'work-1',
    workTitle: '测试作品',
    chapterId: 'chapter-1',
    chapterTitle: '第一章',
    promptName: '续写正文',
    model,
    content: '正文',
    promptTokens,
    completionTokens,
    createdAt: (createdAt instanceof Date ? createdAt.toISOString() : createdAt) as GenerationRecord['createdAt'],
  };
}

describe('summarizeUsage', () => {
  it('按最近 7 个自然日聚合，并补零缺失日期', () => {
    const summary = summarizeUsage([
      record(new Date(2026, 10, 20, 9), 20, 8),
      record(new Date(2026, 10, 19, 10), 10, 5),
      record(new Date(2026, 10, 12, 10), 100, 100),
      record('not-a-date', 10, 10),
    ], { days: 7, today });

    expect(summary.days).toHaveLength(7);
    expect(summary.days[0].day).toBe('2026-11-14');
    expect(summary.days[6].day).toBe('2026-11-20');
    expect(summary.days[6]).toMatchObject({ calls: 1, promptTokens: 20, completionTokens: 8, totalTokens: 28 });
    expect(summary.days[5]).toMatchObject({ calls: 1, totalTokens: 15 });
    expect(summary.days[0]).toMatchObject({ calls: 0, totalTokens: 0 });
    expect(summary).toMatchObject({ calls: 2, promptTokens: 30, completionTokens: 13, totalTokens: 43 });
    expect(summary.models).toHaveLength(1);
    expect(summary.models[0]).toMatchObject({ model: 'mock-chat', calls: 2, totalTokens: 43 });
  });

  it('支持 30 天范围并按 token 用量排序模型', () => {
    const summary = summarizeUsage([
      record(new Date(2026, 10, 20, 9), 1, 1, 'model-small'),
      record(new Date(2026, 10, 18, 9), 30, 10, 'model-big'),
      record(new Date(2026, 9, 25, 9), 5, 5, 'model-old'),
    ], { days: 30, today });

    expect(summary.days).toHaveLength(30);
    expect(summary.calls).toBe(3);
    expect(summary.models.map((model) => model.model)).toEqual(['model-big', 'model-old', 'model-small']);
  });

  it('缺失 token 字段按 0 处理，空模型归为未知模型', () => {
    const summary = summarizeUsage([
      record(new Date(2026, 10, 20, 9), undefined, undefined, ''),
    ], { days: 7, today });

    expect(summary.totalTokens).toBe(0);
    expect(summary.models[0].model).toBe('未知模型');
  });
});
