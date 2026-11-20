import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLogWriter } from '../../src/main/eventLog';
import { registerIpc } from '../../src/main/ipc';
import { StorageRepository } from '../../src/main/storage';
import { ipcChannels, type ApiResult, type SaveChapterInput } from '../../src/shared/ipc';
import type { AiRequest, AppInfo, PublicProvider, ScriptProject, Work } from '../../src/shared/models';

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, ...args: any[]) => Promise<any>>(),
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  openPath: vi.fn(),
  appQuit: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: (channel: string) => { electronState.handlers.delete(channel); },
    handle: (channel: string, handler: (event: any, ...args: any[]) => Promise<any>) => {
      electronState.handlers.set(channel, handler);
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
  dialog: {
    showSaveDialog: electronState.saveDialog,
    showOpenDialog: electronState.openDialog,
  },
  shell: { openPath: electronState.openPath },
  app: { quit: electronState.appQuit },
}));

let directory: string;
let storage: StorageRepository;
let dispose: () => void;
let events: { write: ReturnType<typeof vi.fn> };
let sender: { id: number; isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> };

async function invoke<T>(channel: string, ...args: unknown[]): Promise<ApiResult<T>> {
  const handler = electronState.handlers.get(channel);
  if (!handler) throw new Error(`未注册 IPC：${channel}`);
  return handler({ sender }, ...args) as Promise<ApiResult<T>>;
}

async function createChapter(content = '') {
  const work = await storage.createWork({ title: '测试作品' });
  const outline = await storage.createOutline({ workId: work.workId, title: '第一章', level: 1, parentId: null });
  let chapter = outline.chapter;
  if (content) {
    const saved = await storage.saveChapter({ workId: work.workId, chapterId: chapter.chapterId, content, baseRevision: 0 });
    chapter = saved.chapter;
  }
  return { work, chapter, node: outline.node };
}

async function configureProvider(): Promise<PublicProvider> {
  const result = await invoke<PublicProvider>(ipcChannels.providerUpsert, {
    name: '测试服务', baseURL: 'https://api.example.test/v1', apiKey: 'secret-key', modelChat: 'test-model',
    isDefault: true, temperature: 0.7, maxTokens: 1024,
  });
  expect(result.code).toBe(0);
  return result.data;
}

function eventDetails(name: string, requestId?: string): Record<string, unknown> | undefined {
  const call = events.write.mock.calls.find(([eventName, details]) => eventName === name
    && (!requestId || (details as { requestId?: string }).requestId === requestId));
  return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'inkforge-ipc-test-'));
  storage = new StorageRepository(directory);
  await storage.initialize();
  events = { write: vi.fn() };
  sender = { id: 1, isDestroyed: () => false, send: vi.fn() };
  electronState.saveDialog.mockReset();
  electronState.openDialog.mockReset();
  electronState.openPath.mockReset();
  electronState.appQuit.mockReset();
  dispose = registerIpc({
    storage, events: events as unknown as EventLogWriter, version: '1.0.0', dataDirectory: directory,
    onFlushComplete: () => undefined,
  });
});

afterEach(async () => {
  dispose();
  electronState.handlers.clear();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

describe('核心事件与章节保存', () => {
  it('自动保存、润色采纳和快照回滚写入规范字段', async () => {
    const { work, chapter } = await createChapter();
    const input: SaveChapterInput = {
      workId: work.workId, chapterId: chapter.chapterId, content: '原始正文', baseRevision: 0, reason: 'autosave',
    };
    const saved = await invoke<Awaited<ReturnType<StorageRepository['saveChapter']>>>(ipcChannels.chapterSave, input);
    expect(saved.code).toBe(0);
    expect(eventDetails('chapter_word_count')).toMatchObject({
      workId: work.workId, chapterId: chapter.chapterId, nodeId: chapter.nodeId, wordCount: 4,
    });
    const snapshot = await storage.createSnapshot(work.workId, chapter.chapterId, 'manual');

    const accepted = await invoke<Awaited<ReturnType<StorageRepository['saveChapter']>>>(ipcChannels.chapterSave, {
      workId: work.workId, chapterId: chapter.chapterId, content: '润色后的正文内容', baseRevision: 1,
      reason: 'ai', createSnapshot: true, aiScene: 'polish', templateId: 'builtin-polish', diffType: 'document',
    });
    expect(accepted.code).toBe(0);
    expect(eventDetails('polish_accept')).toMatchObject({
      chapterId: chapter.chapterId, scene: 'polish', templateId: 'builtin-polish', diffType: 'document',
    });

    const rolledBack = await invoke<Awaited<ReturnType<StorageRepository['rollbackSnapshot']>>>(
      ipcChannels.snapshotRollback, work.workId, chapter.chapterId, snapshot.snapshotId,
    );
    expect(rolledBack.code).toBe(0);
    expect(eventDetails('snapshot_rollback')).toMatchObject({
      workId: work.workId, chapterId: chapter.chapterId, deltaWordCount: -4,
    });
  });

  it('导出包含书名章节，并记录统一字数与粒度', async () => {
    const { work, chapter } = await createChapter('你好😀');
    const filePath = path.join(directory, '导出.md');
    electronState.saveDialog.mockResolvedValue({ canceled: false, filePath });
    const result = await invoke<{ filePath: string; wordCount: number }>(ipcChannels.exportDocument, {
      workId: work.workId, chapterId: chapter.chapterId, format: 'md',
    });
    expect(result.code).toBe(0);
    expect(await readFile(filePath, 'utf8')).toBe('测试作品\n\n第一章\n\n你好😀');
    expect(eventDetails('export_word_count')).toMatchObject({ workId: work.workId, wordCount: 3, granularity: 'chapter' });
  });

  it('改编资料包只包含选中章节并可附带正文与统一提示词', async () => {
    const { work } = await createChapter('第一章正文。');
    const second = await storage.createOutline({ workId: work.workId, title: '第二章', level: 1, parentId: null });
    await storage.saveChapter({ workId: work.workId, chapterId: second.chapter.chapterId, content: '第二章正文。', baseRevision: 0 });
    const filePath = path.join(directory, '短剧改编包.md');
    electronState.saveDialog.mockResolvedValue({ canceled: false, filePath });

    const result = await invoke(ipcChannels.exportDocument, {
      workId: work.workId, format: 'adaptation', chapterIds: [second.chapter.chapterId], includeChapterText: true,
    });
    expect(result.code).toBe(0);
    const content = await readFile(filePath, 'utf8');
    expect(content).toContain('## 二、短剧改编提示词');
    expect(content).toContain('第二章正文。');
    expect(content).not.toContain('第一章正文。');
    expect(content).toContain('## 六、所选章节正文');
  });
});

describe('本地个人面板 IPC', () => {
  it('返回本机信息、打开数据目录并支持退出', async () => {
    electronState.openPath.mockResolvedValue('');
    const info = await invoke<AppInfo>(ipcChannels.appInfo);
    expect(info.code).toBe(0);
    expect(info.data).toMatchObject({ version: '1.0.0', dataDirectory: directory, platform: process.platform });

    const opened = await invoke(ipcChannels.appOpenDataDir);
    expect(opened.code).toBe(0);
    expect(electronState.openPath).toHaveBeenCalledWith(directory);

    const quit = await invoke(ipcChannels.appQuit);
    expect(quit.code).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(electronState.appQuit).toHaveBeenCalledTimes(1);
  });

  it('数据目录无法打开时返回可读错误', async () => {
    electronState.openPath.mockResolvedValue('目录不存在');
    const opened = await invoke(ipcChannels.appOpenDataDir);
    expect(opened.code).toBe(500);
    expect(opened.message).toContain('无法打开数据目录');
  });
});

describe('AI 与一致性 IPC', () => {
  it('续写成功记录 ai_continue 和带 token 的 ai_call，失败不修改正文', async () => {
    const provider = await configureProvider();
    const { work, chapter } = await createChapter('原始正文');
    const fetchMock = vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"content":"续写"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ].join(''), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const request: AiRequest = {
      requestId: 'continue-success', workId: work.workId, chapterId: chapter.chapterId, scene: 'continue',
      cardIds: [], targetChars: 800, baseRevision: chapter.revision, templateId: 'builtin-continue',
    };
    const result = await invoke<{ text: string }>(ipcChannels.aiStart, request);
    expect(result.code).toBe(0);
    expect(result.data.text).toBe('续写');
    expect(eventDetails('ai_continue', request.requestId)).toMatchObject({
      workId: work.workId, chapterId: chapter.chapterId, wordCount: 4, templateId: 'builtin-continue',
    });
    expect(eventDetails('ai_call', request.requestId)).toMatchObject({
      scene: 'continue', model: provider.modelChat, success: true, promptTokens: 12, completionTokens: 2,
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const failed = await invoke(ipcChannels.aiStart, { ...request, requestId: 'continue-failed' });
    expect(failed.code).toBe(401);
    expect(eventDetails('ai_call', 'continue-failed')).toMatchObject({ success: false, errorCode: 'AI_UNAUTHORIZED' });
    expect((await storage.getChapter(work.workId, chapter.chapterId)).content).toBe('原始正文');
  });

  it('一致性检查返回问题、记录处置，空正文不调用 Provider', async () => {
    await configureProvider();
    const { work, chapter } = await createChapter('主角十八岁。');
    const card = await storage.upsertCard({
      workId: work.workId, type: 'character', title: '主角', content: '主角二十岁', tags: [], pinned: true,
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify([{ issueType: 'character', paragraph: '主角十八岁。', cardTitle: '主角', explanation: '年龄冲突', suggestion: '统一年龄' }]) } }],
      usage: { prompt_tokens: 9, completion_tokens: 4 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const request: AiRequest = {
      requestId: 'consistency-success', workId: work.workId, chapterId: chapter.chapterId, scene: 'continue',
      cardIds: [card.cardId], targetChars: 1200, baseRevision: chapter.revision, templateId: 'builtin-consistency',
    };
    const result = await invoke<Array<{ id: string; issueType: string }>>(ipcChannels.consistencyCheck, request);
    expect(result.code).toBe(0);
    expect(result.data[0]).toMatchObject({ issueType: 'character' });
    expect(eventDetails('ai_call', request.requestId)).toMatchObject({ scene: 'consistency', success: true, promptTokens: 9 });

    const fixed = await invoke(ipcChannels.consistencyFix, {
      workId: work.workId, chapterId: chapter.chapterId, issueId: result.data[0].id,
      issueType: 'character', scene: 'consistency', templateId: 'builtin-consistency', action: 'card',
    });
    expect(fixed.code).toBe(0);
    expect(eventDetails('knowledge_check_fix')).toMatchObject({ issueType: 'character', scene: 'consistency', templateId: 'builtin-consistency' });

    const empty = await createChapter();
    fetchMock.mockClear();
    const emptyResult = await invoke(ipcChannels.consistencyCheck, {
      ...request, requestId: 'consistency-empty', workId: empty.work.workId, chapterId: empty.chapter.chapterId,
      cardIds: [], baseRevision: 0,
    });
    expect(emptyResult.code).toBe(400);
    expect(emptyResult.message).toContain('无正文');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('连接测试成功与失败均记录 api_key_test，且不记录 Key 或 baseURL', async () => {
    const provider = await configureProvider();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const success = await invoke(ipcChannels.providerTest, provider.id);
    expect(success.code).toBe(0);
    expect(eventDetails('api_key_test')).toMatchObject({ provider: provider.name, success: true });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const failed = await invoke(ipcChannels.providerTest, provider.id);
    expect(failed.code).toBe(401);
    const serialized = JSON.stringify(events.write.mock.calls);
    expect(serialized).not.toContain('secret-key');
    expect(serialized).not.toContain(provider.baseURL);
    expect(events.write.mock.calls.filter(([name]) => name === 'api_key_test')).toHaveLength(2);
  });
});

describe('剧本工作台', () => {
  it('生成创意、分集大纲与正文，支持改稿与导出', async () => {
    await configureProvider();
    const created = await invoke<ScriptProject>(ipcChannels.scriptCreate, {
      title: '测试短剧', genre: '都市', elements: ['逆袭', '爽感'], episodeCount: 2, batchSize: 2,
    });
    expect(created.code).toBe(0);
    const projectId = created.data.projectId;
    const scenes = [
      '第1集\n场景一 内景 民政局 日\n苏晚把离婚证拍在桌上。',
      '第2集\n场景一 外景 天台 夜\n苏晚转身，反将一军。',
    ];
    let episodeCall = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content?: string }> };
      const prompt = body.messages?.[0]?.content ?? '';
      let content = '';
      if (prompt.includes('【短剧创意任务】')) {
        content = JSON.stringify([
          { title: '离婚当天，我成了债主', logline: '被扫地出门，转身收走整栋楼。', synopsis: '苏晚离婚当天发现前夫欠她一笔巨款。' },
          { title: '隐身总裁的替身妻', logline: '她替嫁的植物人，醒来是首富。', synopsis: '林晚替姐姐嫁入豪门。' },
        ]);
      } else if (prompt.includes('【分集大纲任务】')) {
        content = JSON.stringify({
          totalOutline: '苏晚离婚后步步反击，最终拿回属于自己的一切。',
          episodes: [
            { title: '第1集 · 离婚当天', summary: '苏晚被净身出户，却发现前夫的公司欠她巨款。' },
            { title: '第2集 · 债主上门', summary: '苏晚以债主身份重返公司，前夫当场失态。' },
          ],
        });
      } else {
        content = scenes[episodeCall] ?? scenes[0];
        episodeCall += 1;
      }
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const ideas = await invoke<ScriptProject>(ipcChannels.scriptGenerateIdeas, projectId, '女主第一集就要打脸');
    expect(ideas.code).toBe(0);
    expect(ideas.data.ideas).toHaveLength(2);
    expect(ideas.data.selectedIdeaId).toBeNull();
    const ideaId = ideas.data.ideas[0].ideaId;

    const selected = await invoke<ScriptProject>(ipcChannels.scriptSelectIdea, projectId, ideaId);
    expect(selected.code).toBe(0);
    expect(selected.data.selectedIdeaId).toBe(ideaId);

    const outline = await invoke<ScriptProject>(ipcChannels.scriptGenerateOutline, projectId);
    expect(outline.code).toBe(0);
    expect(outline.data.masterOutline).toContain('步步反击');
    expect(outline.data.episodes.map((episode) => episode.title)).toEqual(['第1集 · 离婚当天', '第2集 · 债主上门']);
    expect(outline.data.episodes.every((episode) => episode.status === 'pending')).toBe(true);

    const generated = await invoke<ScriptProject>(ipcChannels.scriptGenerateEpisodes, { projectId, episodeIndexes: [1, 2] });
    expect(generated.code).toBe(0);
    expect(generated.data.episodes.map((episode) => episode.status)).toEqual(['done', 'done']);
    expect(generated.data.episodes[0].content).toContain('离婚证拍在桌上');
    expect(eventDetails('script_episode')).toMatchObject({ projectId, episodeIndex: 1, success: true });

    const saved = await invoke<ScriptProject>(ipcChannels.scriptSaveEpisode, {
      projectId, episodeIndex: 2, content: '手动修改后的第二集正文。',
    });
    expect(saved.code).toBe(0);
    expect(saved.data.episodes[1].content).toBe('手动修改后的第二集正文。');

    const exportPath = path.join(directory, 'script-export.md');
    electronState.saveDialog.mockResolvedValue({ canceled: false, filePath: exportPath });
    const exported = await invoke<{ filePath: string; wordCount: number }>(ipcChannels.scriptExport, { projectId, format: 'md' });
    expect(exported.code).toBe(0);
    expect(exported.data?.filePath).toBe(exportPath);
    const document = await readFile(exportPath, 'utf8');
    expect(document).toContain('# 《测试短剧》分集剧本');
    expect(document).toContain('## 二、选定创意');
    expect(document).toContain('第1集 · 离婚当天');
    expect(document).toContain('手动修改后的第二集正文。');
    expect(document).toContain('不含分镜图、视频、音频或字幕文件');

    electronState.saveDialog.mockResolvedValue({ canceled: false, filePath: path.join(directory, 'script-part.md') });
    const partial = await invoke<{ filePath: string }>(ipcChannels.scriptExport, { projectId, episodeIndexes: [2], format: 'md' });
    expect(partial.code).toBe(0);
    const partialDocument = await readFile(path.join(directory, 'script-part.md'), 'utf8');
    expect(partialDocument).toContain('手动修改后的第二集正文。');
    expect(partialDocument).not.toContain('离婚证拍在桌上');
  });

  it('缺少创意或分集时拒绝生成并返回明确提示', async () => {
    await configureProvider();
    const created = await invoke<ScriptProject>(ipcChannels.scriptCreate, {
      title: '空白短剧', genre: '悬疑', elements: ['反转'], episodeCount: 6,
    });
    const projectId = created.data.projectId;
    const noIdea = await invoke<ScriptProject>(ipcChannels.scriptGenerateOutline, projectId);
    expect(noIdea.code).toBe(400);
    expect(noIdea.message).toContain('选择一个短剧创意');

    await storage.updateScriptProject(projectId, {
      ideas: [{ ideaId: 'idea-1', title: '测试创意', logline: '卖点', synopsis: '梗概' }],
      selectedIdeaId: 'idea-1',
    });
    const noEpisodes = await invoke<ScriptProject>(ipcChannels.scriptGenerateEpisodes, { projectId, episodeIndexes: [1] });
    expect(noEpisodes.code).toBe(400);
    expect(noEpisodes.message).toContain('分集大纲');

    const noElements = await invoke<ScriptProject>(ipcChannels.scriptCreate, { title: '无元素', elements: [] });
    expect(noElements.code).toBe(0);
    const rejected = await invoke<ScriptProject>(ipcChannels.scriptGenerateIdeas, noElements.data.projectId);
    expect(rejected.code).toBe(400);
    expect(rejected.message).toContain('题材或情绪元素');
  });
});

describe('作品分组与剧本导入', () => {
  it('创建分组、移动作品，删除分组后作品回到全部', async () => {
    const work = await storage.createWork({ title: '分组作品' });
    const created = await invoke<string[]>(ipcChannels.workGroupCreate, '短篇');
    expect(created.code).toBe(0);
    expect(created.data).toEqual(['短篇']);

    const moved = await invoke<Work>(ipcChannels.workUpdate, work.workId, { group: '短篇' });
    expect(moved.code).toBe(0);
    expect(moved.data.group).toBe('短篇');
    expect((await invoke<string[]>(ipcChannels.workGroupList)).data).toEqual(['短篇']);

    const duplicate = await invoke<string[]>(ipcChannels.workGroupCreate, '短篇');
    expect(duplicate.code).toBe(409);

    const cleared = await invoke<string[]>(ipcChannels.workGroupDelete, '短篇');
    expect(cleared.code).toBe(0);
    expect(cleared.data).toEqual([]);
    expect((await storage.getWork(work.workId)).group).toBe('');
    expect(eventDetails('work_group_delete')).toMatchObject({ name: '短篇' });
  });

  it('导入 TXT 为剧本项目并按章节拆分正文', async () => {
    const file = path.join(directory, '导入剧本.txt');
    await writeFile(file, '第一幕 开场\n苏晚走进民政局。\n\n第二幕 反转\n前夫追了进来。', 'utf8');
    electronState.openDialog.mockResolvedValue({ canceled: false, filePaths: [file] });

    const imported = await invoke<ScriptProject>(ipcChannels.scriptImport);
    expect(imported.code).toBe(0);
    expect(imported.data?.title).toBe('导入剧本');
    expect(imported.data?.episodes).toHaveLength(2);
    expect(imported.data?.episodes[0].title).toContain('第一幕');
    expect(imported.data?.episodes[0].content).toContain('苏晚走进民政局');
    expect(imported.data?.episodes.every((episode) => episode.status === 'done')).toBe(true);
    expect((await invoke<ScriptProject[]>(ipcChannels.scriptList)).data[0].projectId).toBe(imported.data?.projectId);
    expect(eventDetails('script_import')).toMatchObject({ projectId: imported.data?.projectId, episodeCount: 2 });
  });

  it('取消导入时不创建剧本项目', async () => {
    electronState.openDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const imported = await invoke<ScriptProject | null>(ipcChannels.scriptImport);
    expect(imported.code).toBe(0);
    expect(imported.data).toBeNull();
    expect((await invoke<ScriptProject[]>(ipcChannels.scriptList)).data).toEqual([]);
  });
});
