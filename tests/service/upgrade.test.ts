import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageRepository } from '../../src/main/storage';

let directory: string;
let storage: StorageRepository;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'inkforge-upgrade-'));
  storage = new StorageRepository(directory);
  await storage.initialize();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('章节锁定', () => {
  it('锁定后拒绝保存草稿与正文，解锁后恢复', async () => {
    const work = await storage.createWork({ title: '锁定测试' });
    const created = await storage.createOutline({ workId: work.workId, title: '第一章', level: 1, parentId: null });
    await storage.saveChapter({ workId: work.workId, chapterId: created.chapter.chapterId, content: '原始正文', baseRevision: 0 });

    const locked = await storage.setChapterLock(work.workId, created.chapter.chapterId, true);
    expect(locked.locked).toBe(true);
    expect(locked.lockedAt).toBeTruthy();
    await expect(storage.saveChapter({
      workId: work.workId, chapterId: created.chapter.chapterId, content: '覆盖', baseRevision: 1,
    })).rejects.toMatchObject({ statusCode: 409, message: '章节已锁定，请先解锁' });
    await expect(storage.saveChapterDraft({
      workId: work.workId, chapterId: created.chapter.chapterId, content: '草稿覆盖',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect((await storage.getChapter(work.workId, created.chapter.chapterId)).content).toBe('原始正文');

    const unlocked = await storage.setChapterLock(work.workId, created.chapter.chapterId, false);
    expect(unlocked.locked).toBe(false);
    const saved = await storage.saveChapter({
      workId: work.workId, chapterId: created.chapter.chapterId, content: '解锁后修改', baseRevision: 1,
    });
    expect(saved.content).toBe('解锁后修改');
  });
});

describe('季规划写入', () => {
  it('复用现有章节、补建不足章节，并保留未分季章节', async () => {
    const work = await storage.createWork({ title: '季测试' });
    const volume = await storage.createOutline({ workId: work.workId, title: '第一卷 · 暗潮', level: 1, parentId: null });
    const first = await storage.createOutline({ workId: work.workId, title: '第一章', level: 2, parentId: volume.node.nodeId });
    const second = await storage.createOutline({ workId: work.workId, title: '第二章', level: 2, parentId: volume.node.nodeId });
    await storage.saveChapter({ workId: work.workId, chapterId: first.chapter.chapterId, content: '第一章原文', baseRevision: 0 });

    const applied = await storage.applySeasons(work.workId, volume.node.nodeId, [
      { title: '第一季 · 潮起', summary: '铺垫', chapters: [{ title: '第一章 · 灯塔', summary: '改标题' }, { title: '第二章 · 回声', summary: '' }] },
      { title: '第二季 · 暗流', summary: '推进', chapters: [{ title: '第三章 · 礁石', summary: '' }, { title: '第四章 · 失踪', summary: '' }] },
    ]);
    expect(applied.seasons).toHaveLength(2);
    expect(applied.nodes).toHaveLength(4);

    let outline = await storage.listOutline(work.workId);
    let chapters = outline.filter((node) => node.level === 2);
    expect(chapters).toHaveLength(4);
    expect(chapters[0].nodeId).toBe(first.node.nodeId);
    expect(chapters[0].title).toBe('第一章 · 灯塔');
    expect(chapters[0].seasonId).toBe(applied.seasons[0].seasonId);
    expect(chapters[2].seasonId).toBe(applied.seasons[1].seasonId);
    expect((await storage.getChapter(work.workId, first.chapter.chapterId)).content).toBe('第一章原文');
    expect((await storage.listChapters(work.workId)).find((chapter) => chapter.chapterId === second.chapter.chapterId)?.title)
      .toBe('第二章 · 回声');

    await storage.applySeasons(work.workId, volume.node.nodeId, [
      { title: '唯一季', summary: '', chapters: [{ title: '第一章 · 重写' }] },
    ]);
    outline = await storage.listOutline(work.workId);
    chapters = outline.filter((node) => node.level === 2);
    expect(chapters).toHaveLength(4);
    expect(chapters.filter((node) => node.seasonId).length).toBe(1);
    expect(chapters.find((node) => node.nodeId === first.node.nodeId)?.title).toBe('第一章 · 重写');
    expect((await storage.listSeasons(work.workId)).map((season) => season.title)).toEqual(['唯一季']);
  });

  it('补建章节保持在所属分卷内，不打乱后续分卷顺序', async () => {
    const work = await storage.createWork({ title: '跨卷顺序' });
    const first = await storage.createOutline({ workId: work.workId, title: '第一卷', level: 1, parentId: null });
    await storage.createOutline({ workId: work.workId, title: '第一卷第一章', level: 2, parentId: first.node.nodeId });
    const second = await storage.createOutline({ workId: work.workId, title: '第二卷', level: 1, parentId: null });
    const secondChapter = await storage.createOutline({ workId: work.workId, title: '第二卷第一章', level: 2, parentId: second.node.nodeId });

    await storage.applySeasons(work.workId, first.node.nodeId, [
      { title: '第一季', summary: '', chapters: [{ title: '第一卷第一章' }, { title: '补建章节' }, { title: '补建章节二' }] },
    ]);
    const ordered = (await storage.listOutline(work.workId)).filter((node) => node.level === 2);
    expect(ordered.map((node) => node.title)).toEqual(['第一卷第一章', '补建章节', '补建章节二', '第二卷第一章']);
    expect(ordered.findIndex((node) => node.nodeId === secondChapter.node.nodeId)).toBe(3);
  });

  it('删除季只解绑章节，不删除章节', async () => {
    const work = await storage.createWork({ title: '删除季' });
    const volume = await storage.createOutline({ workId: work.workId, title: '第一卷', level: 1, parentId: null });
    await storage.applySeasons(work.workId, volume.node.nodeId, [
      { title: '第一季', summary: '', chapters: [{ title: '第一章', summary: '' }] },
    ]);
    const season = (await storage.listSeasons(work.workId))[0];
    await storage.deleteSeason(work.workId, season.seasonId);
    expect(await storage.listSeasons(work.workId)).toEqual([]);
    const chapters = (await storage.listOutline(work.workId)).filter((node) => node.level === 2);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].seasonId).toBeNull();
  });
});

describe('视觉改编设定', () => {
  it('创建与更新时保存画幅、画风与视觉备注', async () => {
    const work = await storage.createWork({
      title: '视觉测试', visualRatio: '16:9', visualStyle: '日系赛璐璐', visualNotes: '冷色调、低饱和',
    });
    expect(work.visualRatio).toBe('16:9');
    expect(work.visualStyle).toBe('日系赛璐璐');
    expect(work.visualNotes).toBe('冷色调、低饱和');

    const updated = await storage.updateWork(work.workId, { visualRatio: '9:16', visualStyle: '国风厚涂' });
    expect(updated.visualRatio).toBe('9:16');
    expect(updated.visualStyle).toBe('国风厚涂');
    expect(updated.visualNotes).toBe('冷色调、低饱和');
  });
});

describe('全局查找替换', () => {
  it('统计全部命中，替换时跳过锁定章节并创建快照', async () => {
    const work = await storage.createWork({ title: '替换测试' });
    const volume = await storage.createOutline({ workId: work.workId, title: '第一卷', level: 1, parentId: null });
    const first = await storage.createOutline({ workId: work.workId, title: '第一章', level: 2, parentId: volume.node.nodeId });
    const second = await storage.createOutline({ workId: work.workId, title: '第二章', level: 2, parentId: volume.node.nodeId });
    await storage.saveChapter({ workId: work.workId, chapterId: first.chapter.chapterId, content: '沈砚走进雨夜，雨夜很静。', baseRevision: 0 });
    await storage.saveChapter({ workId: work.workId, chapterId: second.chapter.chapterId, content: '林晚也在雨夜。', baseRevision: 0 });
    await storage.setChapterLock(work.workId, second.chapter.chapterId, true);

    const found = await storage.searchReplace({ workId: work.workId, keyword: '雨夜' });
    expect(found.totalCount).toBe(3);
    expect(found.hits).toHaveLength(2);
    expect(found.hits.find((hit) => hit.chapterId === second.chapter.chapterId)?.locked).toBe(true);
    expect(found.replacedChapters).toBe(0);
    expect(found.hits.find((hit) => hit.chapterId === first.chapter.chapterId)?.previews[0]).toContain('雨夜');

    const replaced = await storage.searchReplace({ workId: work.workId, keyword: '雨夜', replacement: '深夜' });
    expect(replaced.replacedChapters).toBe(1);
    expect(replaced.skippedLocked).toBe(1);
    expect((await storage.getChapter(work.workId, first.chapter.chapterId)).content).toBe('沈砚走进深夜，深夜很静。');
    expect((await storage.getChapter(work.workId, second.chapter.chapterId)).content).toBe('林晚也在雨夜。');
    expect(await storage.listSnapshots(work.workId, first.chapter.chapterId)).toHaveLength(1);
    expect((await storage.listSnapshots(work.workId, second.chapter.chapterId))).toHaveLength(0);
  });

  it('区分大小写开关生效，空关键字被拒绝', async () => {
    const work = await storage.createWork({ title: '大小写测试' });
    const volume = await storage.createOutline({ workId: work.workId, title: '第一卷', level: 1, parentId: null });
    const chapter = await storage.createOutline({ workId: work.workId, title: '第一章', level: 2, parentId: volume.node.nodeId });
    await storage.saveChapter({ workId: work.workId, chapterId: chapter.chapter.chapterId, content: 'Rain rain RAIN', baseRevision: 0 });
    expect((await storage.searchReplace({ workId: work.workId, keyword: 'rain', caseSensitive: true })).totalCount).toBe(1);
    expect((await storage.searchReplace({ workId: work.workId, keyword: 'rain', caseSensitive: false })).totalCount).toBe(3);
    await expect(storage.searchReplace({ workId: work.workId, keyword: '  ' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('跨卷移动章节', () => {
  it('移动后归属目标分卷、排在末尾并清除季归属', async () => {
    const work = await storage.createWork({ title: '移动测试' });
    const firstVolume = await storage.createOutline({ workId: work.workId, title: '第一卷', level: 1, parentId: null });
    const moving = await storage.createOutline({ workId: work.workId, title: '待移动章节', level: 2, parentId: firstVolume.node.nodeId });
    await storage.applySeasons(work.workId, firstVolume.node.nodeId, [
      { title: '第一季', summary: '', chapters: [{ title: '待移动章节' }] },
    ]);
    const secondVolume = await storage.createOutline({ workId: work.workId, title: '第二卷', level: 1, parentId: null });
    await storage.createOutline({ workId: work.workId, title: '目标卷原有章节', level: 2, parentId: secondVolume.node.nodeId });

    const moved = await storage.moveOutlineNode(work.workId, moving.node.nodeId, secondVolume.node.nodeId);
    expect(moved.parentId).toBe(secondVolume.node.nodeId);
    expect(moved.seasonId).toBeNull();

    const chapters = (await storage.listOutline(work.workId)).filter((node) => node.level === 2);
    expect(chapters.map((node) => node.title)).toEqual(['目标卷原有章节', '待移动章节']);
    expect(chapters[1].parentId).toBe(secondVolume.node.nodeId);
    expect(await storage.listSeasons(work.workId)).toHaveLength(1);

    await expect(storage.moveOutlineNode(work.workId, moving.node.nodeId, 'missing-volume'))
      .rejects.toMatchObject({ statusCode: 400 });
    const noop = await storage.moveOutlineNode(work.workId, moving.node.nodeId, secondVolume.node.nodeId);
    expect(noop.parentId).toBe(secondVolume.node.nodeId);
  });
});

describe('整书智能排版', () => {
  it('清理格式、跳过锁定章节并生成快照', async () => {
    const work = await storage.createWork({ title: '排版测试' });
    const volume = await storage.createOutline({ workId: work.workId, title: '第一卷', level: 1, parentId: null });
    const first = await storage.createOutline({ workId: work.workId, title: '第一章', level: 2, parentId: volume.node.nodeId });
    const second = await storage.createOutline({ workId: work.workId, title: '第二章', level: 2, parentId: volume.node.nodeId });
    await storage.saveChapter({ workId: work.workId, chapterId: first.chapter.chapterId, content: '第一段  \n\n\n\n第二段\u3000\u3000', baseRevision: 0 });
    await storage.saveChapter({ workId: work.workId, chapterId: second.chapter.chapterId, content: '锁定章  ', baseRevision: 0 });
    await storage.setChapterLock(work.workId, second.chapter.chapterId, true);

    const result = await storage.formatWork(work.workId);
    expect(result).toEqual({ totalChapters: 2, changedChapters: 1, skippedLocked: 1 });
    expect((await storage.getChapter(work.workId, first.chapter.chapterId)).content).toBe('第一段\n\n第二段');
    expect((await storage.getChapter(work.workId, second.chapter.chapterId)).content).toBe('锁定章  ');
    expect(await storage.listSnapshots(work.workId, first.chapter.chapterId)).toHaveLength(1);
    expect(await storage.listSnapshots(work.workId, second.chapter.chapterId)).toHaveLength(0);
  });
});

describe('设定卡批量导入', () => {
  it('一次创建多张并跳过空内容，限制批量上限', async () => {
    const work = await storage.createWork({ title: '设定导入测试' });
    const cards = await storage.createCards({
      workId: work.workId, type: 'world', items: [
        { title: '潮汐规则', content: '海水每日上涨两次' },
        { title: '空卡', content: '   ' },
        { title: '灯塔', content: '只在雨夜点燃' },
      ],
    });
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.type)).toEqual(['world', 'world']);
    expect((await storage.listCards(work.workId)).map((card) => card.title)).toEqual(['潮汐规则', '灯塔']);
    await expect(storage.createCards({ workId: work.workId, type: 'world', items: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(storage.createCards({
      workId: work.workId, type: 'world',
      items: Array.from({ length: 101 }, (_, index) => ({ title: `卡${index}`, content: '内容' })),
    })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('导入作品', () => {
  it('创建工作、分卷与章节并写入正文', async () => {
    const work = await storage.createImportedWork({
      title: '导入之书', description: '一段简介',
      chapters: [{ title: '第一章', content: '正文一' }, { title: '第二章', content: '正文二' }],
    });
    const outline = await storage.listOutline(work.workId);
    const chapters = outline.filter((node) => node.level === 2);
    expect(chapters.map((node) => node.title)).toEqual(['第一章', '第二章']);
    expect(chapters[0].parentId).toBe(outline.find((node) => node.level === 1)?.nodeId);
    const stored = await storage.listChapters(work.workId);
    expect(stored.map((chapter) => chapter.wordCount)).toEqual([0, 3, 3]);
    expect((await storage.getChapter(work.workId, chapters[0].chapterId)).content).toBe('正文一');
    expect((await storage.getWork(work.workId)).title).toBe('导入之书');
  });
});

describe('工作台创作统计', () => {
  it('汇总累计字数、写作天数与最近章节', async () => {
    const work = await storage.createWork({ title: '统计测试' });
    const volume = await storage.createOutline({ workId: work.workId, title: '第一卷', level: 1, parentId: null });
    const first = await storage.createOutline({ workId: work.workId, title: '第一章', level: 2, parentId: volume.node.nodeId });
    const second = await storage.createOutline({ workId: work.workId, title: '第二章', level: 2, parentId: volume.node.nodeId });
    await storage.saveChapter({ workId: work.workId, chapterId: first.chapter.chapterId, content: '第一段正文', baseRevision: 0 });
    await storage.saveChapter({ workId: work.workId, chapterId: second.chapter.chapterId, content: '第二段正文', baseRevision: 0 });

    const stats = await storage.workspaceStats();
    expect(stats.totalWords).toBe(10);
    expect(stats.writingDays).toBe(1);
    expect(stats.streakDays).toBe(1);
    expect(stats.works.find((item) => item.workId === work.workId)).toMatchObject({
      wordCount: 10,
      chapterCount: 3,
      writtenChapterCount: 2,
      lastChapterId: second.chapter.chapterId,
      lastChapterTitle: '第二章',
    });
  });

  it('空作品统计为零且没有可继续写作的章节', async () => {
    const work = await storage.createWork({ title: '空作品' });
    const stats = await storage.workspaceStats();
    expect(stats.works.find((item) => item.workId === work.workId)).toMatchObject({
      wordCount: 0, chapterCount: 0, writtenChapterCount: 0, lastChapterId: null, lastChapterTitle: null,
    });
  });
});

describe('作品基础信息与设定卡弃用', () => {
  it('创建与更新作品基础信息', async () => {
    const work = await storage.createWork({
      title: '资料测试', style: '轻松幽默', targetWords: 200000, platform: '起点中文网', requirements: '不新增设定',
    });
    expect(work).toMatchObject({
      style: '轻松幽默', targetWords: 200000, platform: '起点中文网', requirements: '不新增设定',
    });
    const updated = await storage.updateWork(work.workId, {
      style: '快节奏', targetWords: 120000, platform: '番茄小说', requirements: '',
    });
    expect(updated).toMatchObject({
      title: '资料测试', style: '快节奏', targetWords: 120000, platform: '番茄小说', requirements: '',
    });
  });

  it('弃用设定卡保留在列表中但不再注入 AI，恢复后重新生效', async () => {
    const work = await storage.createWork({ title: '弃用测试' });
    const card = await storage.upsertCard({
      workId: work.workId, type: 'character', title: '沈砚', content: '守夜人', tags: [], pinned: true,
    });
    expect(card.deprecatedAt).toBeNull();
    const deprecated = await storage.upsertCard({ ...card, deprecatedAt: '2026-11-20T00:00:00.000Z' });
    expect(deprecated.deprecatedAt).toBe('2026-11-20T00:00:00.000Z');
    expect((await storage.listCards(work.workId)).map((item) => item.cardId)).toContain(card.cardId);
    expect(await storage.listActiveCards(work.workId)).toHaveLength(0);

    const restored = await storage.upsertCard({ ...deprecated, deprecatedAt: null });
    expect(restored.deprecatedAt).toBeNull();
    expect(await storage.listActiveCards(work.workId)).toHaveLength(1);
  });
});

describe('提示词使用统计', () => {
  it('记录使用次数与最近使用时间，不改变模板内容', async () => {
    const templates = await storage.listTemplates();
    const builtin = templates.find((template) => template.isBuiltin && template.scene === 'continue');
    expect(builtin).toBeTruthy();
    const before = builtin!.usageCount ?? 0;

    const first = await storage.markTemplateUsed(builtin!.templateId);
    expect(first.usageCount).toBe(before + 1);
    expect(first.lastUsedAt).toBeTruthy();
    expect(first.content).toBe(builtin!.content);

    const second = await storage.markTemplateUsed(builtin!.templateId);
    expect(second.usageCount).toBe(before + 2);
  });

  it('保存模板描述与标签，更新时保留未修改的标签', async () => {
    const created = await storage.upsertTemplate({
      name: '带标签模板', scene: 'continue', content: '按 {{文风偏好}} 续写',
      description: '适用山谷场景续写', tags: ['山野', ' 冷峻 ', ''],
    });
    expect(created.description).toBe('适用山谷场景续写');
    expect(created.tags).toEqual(['山野', '冷峻']);

    const updated = await storage.upsertTemplate({ ...created, description: '更新后的说明' });
    expect(updated.description).toBe('更新后的说明');
    expect(updated.tags).toEqual(['山野', '冷峻']);
  });
});

describe('生成历史', () => {
  const input = (content: string, kind: 'continue' | 'polish' | 'deai' = 'continue') => ({
    kind, workId: 'work-1', workTitle: '潮汐之城', chapterId: 'chapter-1', chapterTitle: '第一章 · 灯塔',
    promptName: '续写正文', model: 'mock-chat', content, promptTokens: 20, completionTokens: 8,
  });

  it('新记录前插并可读取完整字段', async () => {
    expect(await storage.listGenerations()).toEqual([]);
    const first = await storage.addGeneration(input('第一段生成内容'));
    const second = await storage.addGeneration({ ...input('第二段生成内容', 'polish'), promptTokens: undefined });

    expect(first.generationId).not.toBe(second.generationId);
    expect(first.createdAt).toBeTruthy();
    const records = await storage.listGenerations();
    expect(records.map((record) => record.content)).toEqual(['第二段生成内容', '第一段生成内容']);
    expect(records[1]).toMatchObject({
      kind: 'continue', workTitle: '潮汐之城', chapterTitle: '第一章 · 灯塔',
      promptName: '续写正文', model: 'mock-chat', promptTokens: 20, completionTokens: 8,
    });
    expect(records[0].promptTokens).toBeUndefined();
  });

  it('删除单条记录与清空全部记录', async () => {
    const first = await storage.addGeneration(input('保留的记录'));
    await storage.addGeneration(input('删除的记录', 'deai'));

    await storage.deleteGeneration((await storage.listGenerations())[0].generationId);
    expect((await storage.listGenerations()).map((record) => record.content)).toEqual(['保留的记录']);
    await expect(storage.deleteGeneration('missing-id')).rejects.toMatchObject({ statusCode: 404 });

    await storage.clearGenerations();
    expect(await storage.listGenerations()).toEqual([]);
    expect((await storage.addGeneration(input('清空后的新记录'))).content).toBe('清空后的新记录');
    expect(first.generationId).toBeTruthy();
  });

  it('最多保留最近 300 条记录', async () => {
    for (let index = 0; index < 302; index += 1) {
      await storage.addGeneration(input(`生成内容 ${index}`));
    }
    const records = await storage.listGenerations();
    expect(records).toHaveLength(300);
    expect(records[0].content).toBe('生成内容 301');
    expect(records[299].content).toBe('生成内容 2');
  });
});
