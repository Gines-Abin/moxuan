import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageRepository } from '../../src/main/storage';

let directory: string;
let storage: StorageRepository;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'inkforge-outline-'));
  storage = new StorageRepository(directory);
  await storage.initialize();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('三级大纲', () => {
  it('总纲默认空，保存后可重新读取', async () => {
    const work = await storage.createWork({ title: '潮汐尽头' });
    expect(await storage.getMasterOutline(work.workId)).toEqual({ content: '', updatedAt: '' });
    const saved = await storage.saveMasterOutline(work.workId, '## 故事内核\n\n主角寻找失踪的灯塔。');
    expect(saved.content).toContain('灯塔');
    expect(saved.updatedAt).not.toBe('');
    expect(await storage.getMasterOutline(work.workId)).toEqual(saved);
  });

  it('批量写入分卷与章纲，层级、摘要与空正文均正确', async () => {
    const work = await storage.createWork({ title: '潮汐尽头' });
    const nodes = await storage.applyOutlineDraft(work.workId, [
      {
        title: '第一卷 · 暗潮',
        summary: '卷摘要',
        chapters: [
          { title: '第一章 · 灯塔熄灭', summary: '章摘要一' },
          { title: '第二章 · 潮下信', summary: '章摘要二' },
        ],
      },
      { title: '第二卷 · 回响', summary: '卷摘要二', chapters: [{ title: '第三章 · 回声', summary: '' }] },
    ]);
    expect(nodes).toHaveLength(5);
    const outline = await storage.listOutline(work.workId);
    const volumes = outline.filter((node) => node.level === 1);
    expect(volumes.map((node) => node.title)).toEqual(['第一卷 · 暗潮', '第二卷 · 回响']);
    const chapters = outline.filter((node) => node.level === 2);
    expect(chapters.map((node) => node.summary)).toEqual(['章摘要一', '章摘要二', '']);
    expect(chapters[2].parentId).toBe(volumes[1].nodeId);
    expect((await storage.getChapter(work.workId, chapters[0].chapterId)).content).toBe('');
    expect(await readdir(path.join(directory, 'works', work.workId, 'chapters'))).toHaveLength(5);
  });

  it('空分卷大纲被拒绝，且不写入任何节点', async () => {
    const work = await storage.createWork({ title: '潮汐尽头' });
    await expect(storage.applyOutlineDraft(work.workId, [])).rejects.toMatchObject({ statusCode: 400 });
    expect(await storage.listOutline(work.workId)).toEqual([]);
  });

  it('总纲与卷章节点持久化到 outline.json', async () => {
    const work = await storage.createWork({ title: '潮汐尽头' });
    await storage.saveMasterOutline(work.workId, '## 总纲\n主线');
    await storage.applyOutlineDraft(work.workId, [{ title: '第一卷', summary: '', chapters: [] }]);
    const document = JSON.parse(await readFile(path.join(directory, 'works', work.workId, 'outline.json'), 'utf8'));
    expect(document.master.content).toBe('## 总纲\n主线');
    expect(document.nodes).toHaveLength(1);
  });
});
