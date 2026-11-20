import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServiceError } from '../../src/main/errors';
import { JsonFileRepository, StorageRepository } from '../../src/main/storage';

let directory: string;
let storage: StorageRepository;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'inkforge-test-'));
  storage = new StorageRepository(directory);
  await storage.initialize();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function createChapter() {
  const work = await storage.createWork({ title: '测试作品', description: '简介' });
  const outline = await storage.createOutline({ workId: work.workId, title: '第一章', level: 1, parentId: null });
  return { work, ...outline };
}

describe('JSON 原子写与章节 revision', () => {
  it('所有 JSON 带 schemaVersion，成功写入后不残留 tmp', async () => {
    const json = new JsonFileRepository(directory);
    await json.write('atomic/value.json', { value: '第一版' });
    await json.write('atomic/value.json', { value: '第二版' });
    const document = JSON.parse(await readFile(path.join(directory, 'atomic/value.json'), 'utf8'));
    expect(document).toEqual({ value: '第二版', schemaVersion: 1 });
    expect(await readdir(path.join(directory, 'atomic'))).toEqual(['value.json']);
  });

  it('保存递增 revision，过期 revision 返回 409 且不覆盖正文', async () => {
    const { work, chapter } = await createChapter();
    const first = await storage.saveChapter({ workId: work.workId, chapterId: chapter.chapterId, content: '# 你好😀', baseRevision: 0 });
    expect(first.chapter.revision).toBe(1);
    expect(first.chapter.wordCount).toBe(3);

    await expect(storage.saveChapter({ workId: work.workId, chapterId: chapter.chapterId, content: '错误覆盖', baseRevision: 0 }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect((await storage.getChapter(work.workId, chapter.chapterId)).content).toBe('# 你好😀');
    const files = await readdir(path.join(directory, 'works', work.workId, 'chapters'));
    expect(files).toEqual([`${chapter.chapterId}.md`]);
  });

  it('同一 baseRevision 的并发保存只有一个成功', async () => {
    const { work, chapter } = await createChapter();
    const results = await Promise.allSettled([
      storage.saveChapter({ workId: work.workId, chapterId: chapter.chapterId, content: 'A', baseRevision: 0 }),
      storage.saveChapter({ workId: work.workId, chapterId: chapter.chapterId, content: 'B', baseRevision: 0 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as ServiceError).statusCode).toBe(409);
    expect((await storage.getChapter(work.workId, chapter.chapterId)).chapter.revision).toBe(1);
  });
});

describe('快照与回滚', () => {
  it('保留 pre_ai/accepted/rollback 快照，回滚正文且递增 revision', async () => {
    const { work, chapter } = await createChapter();
    await storage.saveChapter({ workId: work.workId, chapterId: chapter.chapterId, content: '原始正文', baseRevision: 0 });
    const preAi = await storage.createSnapshot(work.workId, chapter.chapterId, 'pre_ai');
    await storage.saveChapter({
      workId: work.workId, chapterId: chapter.chapterId, content: 'AI **采纳**正文', baseRevision: 1,
      reason: 'ai', createSnapshot: true,
    });
    const rolledBack = await storage.rollbackSnapshot(work.workId, chapter.chapterId, preAi.snapshotId);
    expect(rolledBack.content).toBe('原始正文');
    expect(rolledBack.chapter.revision).toBe(3);
    expect(rolledBack.chapter.wordCount).toBe(4);

    const snapshots = await storage.listSnapshots(work.workId, chapter.chapterId);
    expect(snapshots.map((snapshot) => snapshot.reason).sort()).toEqual(['accepted', 'pre_ai', 'rollback']);
    expect(snapshots.find((snapshot) => snapshot.snapshotId === preAi.snapshotId)?.wordCount).toBe(4);
    expect((await storage.getChapter(work.workId, chapter.chapterId)).content).toBe('原始正文');
  });
});

describe('作品导出', () => {
  it('全书正文为空时返回 400', async () => {
    const { work } = await createChapter();
    await expect(storage.getDocument(work.workId)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('导出书名、按顺序排列的章节标题与正文，并只统计正文字数', async () => {
    const work = await storage.createWork({ title: '测试作品' });
    const first = await storage.createOutline({ workId: work.workId, title: '第一章', level: 1, parentId: null });
    const second = await storage.createOutline({ workId: work.workId, title: '第二章', level: 1, parentId: null });
    await storage.saveChapter({ workId: work.workId, chapterId: first.chapter.chapterId, content: '# 你好😀', baseRevision: 0 });
    await storage.saveChapter({ workId: work.workId, chapterId: second.chapter.chapterId, content: '**世界。**', baseRevision: 0 });

    const document = await storage.getDocument(work.workId);
    expect(document.content).toBe('测试作品\n\n第一章\n\n# 你好😀\n\n第二章\n\n**世界。**');
    expect(document.wordCount).toBe(6);

    const single = await storage.getDocument(work.workId, first.chapter.chapterId);
    expect(single.content).toBe('测试作品\n\n第一章\n\n# 你好😀');
    expect(single.wordCount).toBe(3);
  });
});

describe('崩溃恢复', () => {
  it('编辑草稿立即写入 tmp，正常保存后清除，未保存修改仍可恢复', async () => {
    const { work, chapter } = await createChapter();
    await storage.saveChapterDraft({ workId: work.workId, chapterId: chapter.chapterId, content: '尚未自动保存的正文' });
    expect((await storage.getChapter(work.workId, chapter.chapterId)).content).toBe('');
    const [draft] = await storage.listRecovery();
    expect(draft.content).toBe('尚未自动保存的正文');

    await storage.saveChapter({ workId: work.workId, chapterId: chapter.chapterId, content: '尚未自动保存的正文', baseRevision: 0 });
    expect(await storage.listRecovery()).toEqual([]);

    await storage.saveChapterDraft({ workId: work.workId, chapterId: chapter.chapterId, content: '强杀前的最新修改' });
    const [latest] = await storage.listRecovery();
    await storage.restoreRecovery(latest.id);
    expect((await storage.getChapter(work.workId, chapter.chapterId)).content).toBe('强杀前的最新修改');
  });

  it('仅恢复 chapters/*.tmp，并在恢复后清理临时文件', async () => {
    const { work, chapter } = await createChapter();
    const temporary = path.join(directory, 'works', work.workId, 'chapters', `${chapter.chapterId}.md.tmp`);
    await writeFile(temporary, '断电前的正文', 'utf8');
    const [item] = await storage.listRecovery();
    expect(item.workId).toBe(work.workId);
    expect(item.chapterId).toBe(chapter.chapterId);
    expect(item.content).toBe('断电前的正文');

    await storage.restoreRecovery(item.id);
    expect((await storage.getChapter(work.workId, chapter.chapterId)).content).toBe('断电前的正文');
    expect((await storage.getChapter(work.workId, chapter.chapterId)).chapter.revision).toBe(1);
    expect(await storage.listRecovery()).toEqual([]);
    await expect(storage.discardRecovery('../outside')).rejects.toMatchObject({ statusCode: 400 });
  });
});
