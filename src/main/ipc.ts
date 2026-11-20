import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type {
  AiDone, AiFailure, AiRequest, AppInfo, BookConsistencyIssue, BookConsistencyResult, GeneratedChapterDraft,
  OutlineDraft, ProviderConfig, ProviderInput, PublicProvider, ReferenceExcerpt,
} from '../shared/models';
import {
  ipcChannels, type ApiResult, type BookConsistencyInput, type CardBatchInput, type CardGenerateInput, type ChapterDraftInput,
  type ChapterLockInput, type ConsistencyDispositionInput, type DraftApplyInput, type DraftGenerateInput,
  type ExportInput, type OutlineApplyInput, type OutlineGenerateInput, type OutlineMoveInput, type SaveChapterInput,
  type ScriptEpisodeGenerateInput, type ScriptEpisodeSaveInput, type ScriptExportInput, type ScriptProjectInput,
  type SearchReplaceInput, type SeasonApplyInput, type SeasonGenerateInput,
} from '../shared/ipc';
import { formatAdaptationPack } from '../shared/utils/adaptationPack';
import { countVisibleChars, stripMarkdown } from '../shared/utils/countVisibleChars';
import { formatSharePage, sharePageWordCount } from '../shared/utils/sharePage';
import { scoreContinuity } from '../shared/utils/continuity';
import { splitChapters } from '../shared/utils/importText';
import { OpenAICompatibleAdapter, assertSecureBaseURL, parseConsistencyIssues } from './ai';
import { extractDocxText } from './docxImport';
import { ServiceError } from './errors';
import { EventLogWriter } from './eventLog';
import { buildScriptEpisodePrompt, buildScriptIdeaPrompt, buildScriptOutlinePrompt, formatScriptDocument, parseScriptIdeas, parseScriptOutline } from './scriptStudio';
import {
  buildCardPrompt, buildCharacterExtractPrompt, buildDraftPrompt, buildOutlinePrompt, buildPrompt, buildSeasonPrompt,
  normalizeImportedTemplates, parseCardDrafts, parseChapterDraft, parseCharacterNames, parseDraftText,
  parseMasterOutline, parseSeasonDrafts, parseVolumeDrafts,
} from './promptTemplates';
import type { StorageRepository } from './storage';

function ok<T>(data: T): ApiResult<T> {
  return { code: 0, message: 'ok', data };
}

function failure<T>(error: unknown, data: T = null as T): ApiResult<T> {
  if (error instanceof ServiceError) return { code: error.statusCode, message: error.message, data };
  return { code: 500, message: '操作失败，请稍后重试', data };
}

function publicProvider(provider: ProviderConfig): PublicProvider {
  return {
    id: provider.id, name: provider.name, baseURL: provider.baseURL,
    modelChat: provider.modelChat, isDefault: provider.isDefault,
    temperature: provider.temperature, maxTokens: provider.maxTokens,
    hasApiKey: Boolean(provider.apiKeyEnc),
  };
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof ServiceError) {
    return { code: error.errorCode === 'SERVICE_ERROR' ? `HTTP_${error.statusCode}` : error.errorCode, message: error.message };
  }
  return { code: 'INTERNAL_ERROR', message: '操作失败，请稍后重试' };
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp`;
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function safeFileName(value: string): string {
  const sanitized = Array.from(value, (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character).join('');
  return sanitized.trim() || '墨轩 MoXuan';
}

function decodeTextBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    return utf8;
  }
}

export interface IpcServices {
  storage: StorageRepository;
  events: EventLogWriter;
  version: string;
  dataDirectory: string;
  onFlushComplete(webContentsId: number, saved: boolean): void;
}

export function registerIpc({ storage, events, version, dataDirectory, onFlushComplete }: IpcServices): () => void {
  const activeRequests = new Map<string, AbortController>();
  const registered: string[] = [];

  const handle = (channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<unknown>): void => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return ok(await handler(event, ...args));
      } catch (error) {
        return failure(error);
      }
    });
    registered.push(channel);
  };

  const resolveProvider = async (id?: string): Promise<{ adapter: OpenAICompatibleAdapter; provider: ProviderConfig }> => {
    const config = await storage.readConfig();
    const providerId = id ?? config.activeProviderId;
    const provider = config.providers.find((item) => item.id === providerId) ?? (!id ? config.providers.find((item) => item.isDefault) : undefined);
    if (!provider) throw new ServiceError(400, '请先配置并激活模型服务', 'PROVIDER_NOT_CONFIGURED');
    assertSecureBaseURL(provider.baseURL);
    let apiKey = '';
    if (provider.apiKeyEnc) {
      try {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('unavailable');
        apiKey = safeStorage.decryptString(Buffer.from(provider.apiKeyEnc, 'base64'));
      } catch {
        throw new ServiceError(400, '无法解密 API Key，请重新配置模型服务', 'PROVIDER_KEY_ERROR');
      }
    }
    return {
      adapter: new OpenAICompatibleAdapter({
        baseURL: provider.baseURL, apiKey, modelChat: provider.modelChat,
        temperature: provider.temperature, maxTokens: provider.maxTokens,
      }),
      provider,
    };
  };

  handle(ipcChannels.appInfo, async (): Promise<AppInfo> => ({ version, dataDirectory, platform: process.platform }));
  handle(ipcChannels.appOpenDataDir, async () => {
    const error = await shell.openPath(dataDirectory);
    if (error) throw new ServiceError(500, '无法打开数据目录，请检查目录是否存在');
    return null;
  });
  handle(ipcChannels.appQuit, async () => {
    setTimeout(() => app.quit(), 0);
    return null;
  });
  handle(ipcChannels.appFlushComplete, async (event, saved: boolean) => {
    onFlushComplete(event.sender.id, saved === true);
    return null;
  });

  handle(ipcChannels.workList, () => storage.listWorks());
  handle(ipcChannels.workStats, () => storage.workspaceStats());
  handle(ipcChannels.workCreate, async (_event, input) => {
    const work = await storage.createWork(input);
    events.write('work_create', { workId: work.workId });
    return work;
  });
  handle(ipcChannels.workUpdate, async (_event, workId, input) => {
    const work = await storage.updateWork(workId, input);
    events.write('work_update', { workId });
    return work;
  });
  handle(ipcChannels.workDelete, async (_event, workId) => {
    await storage.deleteWork(workId);
    events.write('work_delete', { workId });
    return null;
  });
  handle(ipcChannels.workGroupList, () => storage.listWorkGroups());
  handle(ipcChannels.workGroupCreate, async (_event, name: string) => {
    const groups = await storage.createWorkGroup(name);
    events.write('work_group_create', { name });
    return groups;
  });
  handle(ipcChannels.workGroupDelete, async (_event, name: string) => {
    const groups = await storage.deleteWorkGroup(name);
    events.write('work_group_delete', { name });
    return groups;
  });
  handle(ipcChannels.workImport, async () => {
    const result = await dialog.showOpenDialog({
      title: '导入作品', properties: ['openFile'],
      filters: [{ name: 'TXT / Markdown / Word', extensions: ['txt', 'md', 'docx'] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const extension = path.extname(filePath).toLowerCase();
    const buffer = await readFile(filePath);
    if (buffer.length > 30_000_000) throw new ServiceError(400, '文件过大，请控制在 30MB 以内');
    const rawText = extension === '.docx' ? extractDocxText(buffer) : decodeTextBuffer(buffer);
    const chapters = splitChapters(rawText);
    if (!chapters.length) throw new ServiceError(400, '未读取到可导入的正文');
    if (chapters.length > 500) throw new ServiceError(400, '章节数量超过 500，请先拆分文件');
    const title = path.basename(filePath, path.extname(filePath)).trim() || '导入作品';
    const description = rawText.replace(/\s+/g, ' ').trim().slice(0, 300);
    const work = await storage.createImportedWork({ title, description, chapters });
    events.write('work_import', {
      workId: work.workId, format: extension.replace('.', ''), chapterCount: chapters.length, charCount: rawText.length,
    });
    return work;
  });

  handle(ipcChannels.cardList, (_event, workId) => storage.listCards(workId));
  handle(ipcChannels.cardUpsert, async (_event, input) => {
    const card = await storage.upsertCard(input);
    events.write('card_upsert', { workId: card.workId, cardId: card.cardId });
    return card;
  });
  handle(ipcChannels.cardDelete, async (_event, workId, cardId) => {
    await storage.deleteCard(workId, cardId);
    events.write('card_delete', { workId, cardId });
    return null;
  });

  handle(ipcChannels.outlineList, (_event, workId) => storage.listOutline(workId));
  handle(ipcChannels.outlineCreate, async (_event, input) => {
    const result = await storage.createOutline(input);
    events.write('outline_create', { workId: input.workId, nodeCount: 1, nodeId: result.node.nodeId, chapterId: result.chapter.chapterId });
    return result;
  });
  handle(ipcChannels.outlineUpdate, async (_event, workId, nodeId, input) => {
    const node = await storage.updateOutline(workId, nodeId, input);
    events.write('outline_update', { workId, nodeId });
    return node;
  });
  handle(ipcChannels.outlineReorder, async (_event, workId, nodeIds) => {
    const nodes = await storage.reorderOutline(workId, nodeIds);
    events.write('outline_reorder', { workId, nodeCount: nodeIds.length });
    return nodes;
  });
  handle(ipcChannels.outlineMove, async (_event, input: OutlineMoveInput) => {
    if (!input?.workId || !input.nodeId || !input.targetParentId) throw new ServiceError(400, '移动参数不完整');
    const node = await storage.moveOutlineNode(input.workId, input.nodeId, input.targetParentId);
    events.write('outline_move', { workId: input.workId, nodeId: input.nodeId, targetParentId: input.targetParentId });
    return node;
  });
  handle(ipcChannels.outlineDelete, async (_event, workId, nodeId) => {
    await storage.deleteOutline(workId, nodeId);
    events.write('outline_delete', { workId, nodeId });
    return null;
  });
  handle(ipcChannels.outlineGetMaster, (_event, workId) => storage.getMasterOutline(workId));
  handle(ipcChannels.outlineSaveMaster, async (_event, workId, content) => {
    const master = await storage.saveMasterOutline(workId, String(content ?? ''));
    events.write('outline_master_save', { workId, charCount: master.content.length });
    return master;
  });
  handle(ipcChannels.outlineGenerate, async (_event, input: OutlineGenerateInput) => {
    if (!['master', 'volume', 'chapter'].includes(input?.level)) throw new ServiceError(400, '不支持的大纲层级');
    if (!input.brief?.trim()) throw new ServiceError(400, '请先填写故事想法或创作要求');
    const startedAt = Date.now();
    let model = 'unknown';
    try {
      const { adapter, provider } = await resolveProvider();
      model = provider.modelChat;
      const result = await adapter.complete(buildOutlinePrompt(input), {
        temperature: input.level === 'master' ? 0.8 : 0.7,
        maxTokens: input.level === 'master' ? 2400 : 3200,
        timeoutMs: 120_000,
      });
      const draft: OutlineDraft = {
        master: input.level === 'master' ? parseMasterOutline(result.text) : '',
        volumes: input.level === 'volume' ? parseVolumeDrafts(result.text) : [],
        chapter: input.level === 'chapter' ? parseChapterDraft(result.text) : null,
      };
      events.write('outline_generate', {
        level: input.level, model, success: true, latencyMs: Date.now() - startedAt,
        volumeCount: draft.volumes.length, chapterCount: draft.volumes.reduce((sum, volume) => sum + volume.chapters.length, 0),
      });
      return draft;
    } catch (error) {
      events.write('outline_generate', {
        level: input?.level, model, success: false, latencyMs: Date.now() - startedAt, errorCode: errorDetails(error).code,
      });
      throw error;
    }
  });
  handle(ipcChannels.outlineApply, async (_event, input: OutlineApplyInput) => {
    if (!input?.workId || !Array.isArray(input.volumes)) throw new ServiceError(400, '分卷大纲信息不完整');
    const nodes = await storage.applyOutlineDraft(input.workId, input.volumes);
    events.write('outline_apply', { workId: input.workId, volumeCount: input.volumes.length, nodeCount: nodes.length });
    return nodes;
  });
  handle(ipcChannels.outlineSeasons, (_event, workId) => storage.listSeasons(workId));
  handle(ipcChannels.outlineGenerateSeasons, async (_event, input: SeasonGenerateInput) => {
    if (!input?.workId || !input.volumeId) throw new ServiceError(400, '请选择要规划的分卷');
    if (!input.brief?.trim()) throw new ServiceError(400, '请先填写故事想法或创作要求');
    const startedAt = Date.now();
    let model = 'unknown';
    try {
      const [work, master, outline] = await Promise.all([
        storage.getWork(input.workId), storage.getMasterOutline(input.workId), storage.listOutline(input.workId),
      ]);
      const volume = outline.find((node) => node.nodeId === input.volumeId && node.level === 1);
      if (!volume) throw new ServiceError(404, '分卷不存在');
      const prompt = buildSeasonPrompt({
        title: work.title, genre: work.genre, brief: input.brief.trim(), master: master.content,
        volumeTitle: volume.title, instruction: input.instruction?.trim(), chapterCount: input.chapterCount,
      });
      const { adapter, provider } = await resolveProvider();
      model = provider.modelChat;
      const result = await adapter.complete(prompt, { temperature: 0.7, maxTokens: 3200, timeoutMs: 180_000 });
      const seasons = parseSeasonDrafts(result.text);
      events.write('outline_seasons_generate', {
        workId: input.workId, volumeId: input.volumeId, model, seasonCount: seasons.length, latencyMs: Date.now() - startedAt,
      });
      return seasons;
    } catch (error) {
      events.write('outline_seasons_generate', {
        workId: input?.workId, volumeId: input?.volumeId, model, success: false,
        errorCode: errorDetails(error).code, latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  });
  handle(ipcChannels.outlineApplySeasons, async (_event, input: SeasonApplyInput) => {
    if (!input?.workId || !input.volumeId || !Array.isArray(input.seasons)) throw new ServiceError(400, '季规划信息不完整');
    const result = await storage.applySeasons(input.workId, input.volumeId, input.seasons);
    events.write('outline_seasons_apply', {
      workId: input.workId, volumeId: input.volumeId, seasonCount: result.seasons.length,
      chapterCount: result.nodes.length,
    });
    return result;
  });
  handle(ipcChannels.outlineDeleteSeason, async (_event, workId, seasonId) => {
    await storage.deleteSeason(workId, seasonId);
    events.write('outline_seasons_delete', { workId, seasonId });
    return null;
  });
  handle(ipcChannels.cardBatchCreate, async (_event, input: CardBatchInput) => {
    if (!input?.workId || !input.type || !Array.isArray(input.items)) throw new ServiceError(400, '批量导入参数不完整');
    const cards = await storage.createCards(input);
    events.write('card_batch_create', { workId: input.workId, type: input.type, count: cards.length });
    return cards;
  });

  handle(ipcChannels.cardGenerate, async (_event, input: CardGenerateInput) => {
    const startedAt = Date.now();
    let model = 'unknown';
    try {
      const { adapter, provider } = await resolveProvider();
      model = provider.modelChat;
      const [work, cards, master] = await Promise.all([
        storage.getWork(input.workId), storage.listActiveCards(input.workId), storage.getMasterOutline(input.workId),
      ]);
      const chapterText = input.chapterId
        ? stripMarkdown((await storage.getChapter(input.workId, input.chapterId)).content)
        : undefined;
      const prompt = buildCardPrompt(
        work, master.content, cards.map((card) => card.title),
        input.categories ?? [], input.instruction?.trim() ?? '', Math.min(20, Math.max(1, input.count ?? 6)),
        chapterText,
      );
      const result = await adapter.complete(prompt, { temperature: 0.8, maxTokens: 3000, timeoutMs: 120_000 });
      const drafts = parseCardDrafts(result.text);
      events.write('card_generate', { workId: input.workId, count: drafts.length, model, latencyMs: Date.now() - startedAt });
      return drafts;
    } catch (error) {
      events.write('card_generate', {
        workId: input?.workId, model, success: false, errorCode: errorDetails(error).code, latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  });
  handle(ipcChannels.draftGenerate, async (_event, input: DraftGenerateInput) => {
    if (!input?.workId || !Array.isArray(input.chapterIds) || !input.chapterIds.length) throw new ServiceError(400, '请选择要生成的章节');
    if (input.chapterIds.length > 5) throw new ServiceError(400, '单次最多批量生成 5 章');
    if (!['golden-three', 'continue'].includes(input.mode)) throw new ServiceError(400, '不支持的生成模式');
    const startedAt = Date.now();
    let model = 'unknown';
    try {
      const { adapter, provider } = await resolveProvider();
      model = provider.modelChat;
      const [work, master, cards, outline] = await Promise.all([
        storage.getWork(input.workId), storage.getMasterOutline(input.workId),
        storage.listActiveCards(input.workId), storage.listOutline(input.workId),
      ]);
      const nodeByChapter = new Map(outline.map((node) => [node.chapterId, node]));
      const volumeByNode = new Map(outline.filter((node) => node.level === 1).map((node) => [node.nodeId, node]));
      const targetChars = Math.min(6000, Math.max(600, input.targetChars ?? 2000));
      const orderedChapterIds = outline
        .filter((node) => node.level === 2)
        .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt))
        .map((node) => node.chapterId);
      const drafts: GeneratedChapterDraft[] = [];
      let previousText = '';
      for (const chapterId of input.chapterIds) {
        const content = await storage.getChapter(input.workId, chapterId);
        if (!previousText) {
          const previousIndex = orderedChapterIds.indexOf(chapterId) - 1;
          if (previousIndex >= 0) {
            previousText = (await storage.getChapter(input.workId, orderedChapterIds[previousIndex])).content.trim();
          }
        }
        const node = nodeByChapter.get(chapterId);
        const prompt = buildDraftPrompt({
          mode: input.mode,
          work,
          chapterTitle: node?.title ?? content.chapter.title,
          outlineSummary: node?.summary ?? '',
          volumeTitle: node?.parentId ? volumeByNode.get(node.parentId)?.title ?? '' : '',
          master: master.content,
          cards,
          previousText,
          instruction: input.instruction?.trim(),
          targetChars,
        });
        const result = await adapter.complete(prompt, { temperature: 0.85, maxTokens: 3600, timeoutMs: 300_000 });
        const text = parseDraftText(result.text);
        drafts.push({
          chapterId, title: node?.title ?? content.chapter.title, text,
          continuity: scoreContinuity(previousText, text),
        });
        previousText = text;
      }
      events.write('draft_generate', {
        workId: input.workId, mode: input.mode, count: drafts.length, model, latencyMs: Date.now() - startedAt,
      });
      return drafts;
    } catch (error) {
      events.write('draft_generate', {
        workId: input?.workId, mode: input?.mode, model, success: false,
        errorCode: errorDetails(error).code, latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  });
  handle(ipcChannels.draftApply, async (_event, input: DraftApplyInput) => {
    if (!input?.workId || !Array.isArray(input.drafts) || !input.drafts.length) throw new ServiceError(400, '没有可保存的正文');
    const saved: GeneratedChapterDraft[] = [];
    for (const draft of input.drafts) {
      if (!draft.text.trim()) throw new ServiceError(400, '章节正文不能为空');
      const current = await storage.getChapter(input.workId, draft.chapterId);
      const result = await storage.saveChapter({
        workId: input.workId, chapterId: draft.chapterId, content: draft.text,
        baseRevision: current.chapter.revision, reason: 'manual', createSnapshot: true,
      });
      saved.push({ chapterId: draft.chapterId, title: result.chapter.title, text: draft.text });
    }
    events.write('draft_apply', { workId: input.workId, count: saved.length });
    return saved;
  });
  handle(ipcChannels.referencePickTxt, async (): Promise<ReferenceExcerpt | null> => {
    const result = await dialog.showOpenDialog({
      title: '选择同类参考作品',
      properties: ['openFile'],
      filters: [{ name: 'TXT 文本', extensions: ['txt'] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) throw new ServiceError(400, '参考文件内容为空');
    if (raw.length > 20_000_000) throw new ServiceError(400, '参考文件过大，请控制在 20MB 以内');
    const excerpt = raw.replace(/\r\n/g, '\n').trim().slice(0, 12_000);
    events.write('reference_import', { fileName: path.basename(filePath), charCount: raw.length });
    return { fileName: path.basename(filePath), charCount: raw.length, excerpt };
  });

  handle(ipcChannels.contentFormatWork, async (_event, workId) => {
    const result = await storage.formatWork(workId);
    events.write('content_format_work', {
      workId, totalChapters: result.totalChapters, changedChapters: result.changedChapters, skippedLocked: result.skippedLocked,
    });
    return result;
  });

  handle(ipcChannels.contentSearchReplace, async (_event, input: SearchReplaceInput) => {
    if (!input?.workId) throw new ServiceError(400, '作品信息不完整');
    if (!input.keyword?.trim()) throw new ServiceError(400, '请输入要查找的内容');
    const result = await storage.searchReplace(input);
    events.write('content_search_replace', {
      workId: input.workId, keywordLength: input.keyword.length, caseSensitive: input.caseSensitive !== false,
      totalCount: result.totalCount, replacedChapters: result.replacedChapters, skippedLocked: result.skippedLocked,
    });
    return result;
  });

  handle(ipcChannels.chapterList, (_event, workId) => storage.listChapters(workId));
  handle(ipcChannels.chapterGet, (_event, workId, chapterId) => storage.getChapter(workId, chapterId));
  handle(ipcChannels.chapterLock, async (_event, input: ChapterLockInput) => {
    if (!input?.workId || !input.chapterId || typeof input.locked !== 'boolean') throw new ServiceError(400, '锁定参数不完整');
    const chapter = await storage.setChapterLock(input.workId, input.chapterId, input.locked);
    const created: string[] = [];
    if (input.locked) {
      try {
        const content = (await storage.getChapter(input.workId, input.chapterId)).content.trim();
        if (content) {
          const [work, cards, resolved] = await Promise.all([
            storage.getWork(input.workId), storage.listActiveCards(input.workId), resolveProvider(),
          ]);
          const prompt = buildCharacterExtractPrompt(work, chapter.title, content);
          const result = await resolved.adapter.complete(prompt, { temperature: 0.2, maxTokens: 600, timeoutMs: 90_000 });
          const existing = new Set(cards.map((card) => card.title.trim()));
          for (const name of parseCharacterNames(result.text)) {
            if (existing.has(name)) continue;
            await storage.upsertCard({
              workId: input.workId, type: 'character', title: name,
              content: `身份：${name}（章节锁定时自动收录，待补全）`, tags: ['自动收录'], pinned: false,
            });
            existing.add(name);
            created.push(name);
          }
        }
      } catch {
        // 人物提取失败不影响锁定结果。
      }
    }
    events.write('chapter_lock', {
      workId: input.workId, chapterId: input.chapterId, locked: input.locked, createdCount: created.length,
    });
    return { chapter, created };
  });
  handle(ipcChannels.chapterDraft, async (_event, input: ChapterDraftInput) => {
    await storage.saveChapterDraft(input);
    return null;
  });
  handle(ipcChannels.chapterSave, async (_event, input: SaveChapterInput) => {
    const result = await storage.saveChapter(input);
    events.write('chapter_save', {
      workId: input.workId, chapterId: input.chapterId, revision: result.chapter.revision,
      reason: input.reason ?? 'manual', wordCount: result.chapter.wordCount,
    });
    if (input.reason === 'autosave') {
      events.write('chapter_word_count', {
        workId: input.workId, chapterId: input.chapterId, nodeId: result.chapter.nodeId, wordCount: result.chapter.wordCount,
      });
    }
    if (input.reason === 'ai' && (input.aiScene === 'polish' || input.aiScene === 'deai')) {
      events.write('polish_accept', {
        workId: input.workId, chapterId: input.chapterId, diffType: input.diffType ?? 'document',
        scene: input.aiScene, templateId: input.templateId ?? `builtin-${input.aiScene}`,
      });
    }
    return result;
  });

  handle(ipcChannels.promptList, () => storage.listTemplates());
  handle(ipcChannels.promptUpsert, async (_event, input) => {
    const template = await storage.upsertTemplate(input);
    events.write('prompt_upsert', { templateId: template.templateId, scene: template.scene });
    return template;
  });
  handle(ipcChannels.promptDelete, async (_event, templateId) => {
    await storage.deleteTemplate(templateId);
    events.write('prompt_delete', { templateId });
    return null;
  });
  handle(ipcChannels.promptMarkUsed, (_event, templateId) => storage.markTemplateUsed(templateId));
  handle(ipcChannels.promptImport, async () => {
    const result = await dialog.showOpenDialog({
      title: '导入提示词模板', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    let templates;
    try {
      templates = normalizeImportedTemplates(JSON.parse(await readFile(result.filePaths[0], 'utf8')));
    } catch {
      throw new ServiceError(400, '提示词文件格式不正确');
    }
    const imported = await storage.importTemplates(templates);
    events.write('prompt_import', { count: templates.length });
    return imported;
  });
  handle(ipcChannels.promptExport, async () => {
    const result = await dialog.showSaveDialog({
      title: '导出提示词模板', defaultPath: 'inkforge-prompts.json', filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const filePath = path.extname(result.filePath) ? result.filePath : `${result.filePath}.json`;
    const templates = await storage.listTemplates();
    await writeFileAtomic(filePath, `${JSON.stringify({ schemaVersion: 1, templates }, null, 2)}\n`);
    events.write('prompt_export', { count: templates.length });
    return filePath;
  });

  handle(ipcChannels.historyList, () => storage.listGenerations());
  handle(ipcChannels.historyDelete, async (_event, generationId: string) => {
    await storage.deleteGeneration(generationId);
    events.write('generation_history_delete', { generationId });
    return null;
  });
  handle(ipcChannels.historyClear, async () => {
    await storage.clearGenerations();
    events.write('generation_history_clear');
    return null;
  });

  handle(ipcChannels.providerList, async () => (await storage.readConfig()).providers.map(publicProvider));
  handle(ipcChannels.providerUpsert, async (_event, input: ProviderInput) => {
    if (!input.name?.trim() || !input.modelChat?.trim()) throw new ServiceError(400, '服务名称和模型不能为空');
    assertSecureBaseURL(input.baseURL);
    let encryptedKey = input.apiKey;
    if (encryptedKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new ServiceError(503, '系统安全存储不可用', 'SAFE_STORAGE_UNAVAILABLE');
      encryptedKey = safeStorage.encryptString(encryptedKey).toString('base64');
    }
    let saved: ProviderConfig | undefined;
    const config = await storage.updateConfig((current) => {
      const id = input.id ?? crypto.randomUUID();
      const existing = current.providers.find((provider) => provider.id === id);
      if (input.id && !existing) throw new ServiceError(404, '模型服务不存在');
      const apiKeyEnc = input.apiKey === undefined ? existing?.apiKeyEnc ?? '' : encryptedKey ?? '';
      const provider: ProviderConfig = {
        id, name: input.name.trim(), baseURL: input.baseURL.trim(), apiKeyEnc,
        modelChat: input.modelChat.trim(), isDefault: input.isDefault,
        temperature: input.temperature, maxTokens: input.maxTokens,
      };
      if (existing) Object.assign(existing, provider);
      else current.providers.push(provider);
      if (provider.isDefault || !current.activeProviderId) current.activeProviderId = id;
      if (current.activeProviderId === id) provider.isDefault = true;
      current.providers.forEach((item) => { item.isDefault = item.id === current.activeProviderId; });
      saved = current.providers.find((item) => item.id === id);
    });
    if (!saved) throw new ServiceError(500, '模型服务保存失败');
    events.write('provider_upsert', { providerId: saved.id, activeProviderId: config.activeProviderId });
    return publicProvider(saved);
  });
  handle(ipcChannels.providerDelete, async (_event, id) => {
    await storage.updateConfig((config) => {
      const index = config.providers.findIndex((provider) => provider.id === id);
      if (index < 0) throw new ServiceError(404, '模型服务不存在');
      config.providers.splice(index, 1);
      if (config.activeProviderId === id) config.activeProviderId = null;
      config.providers.forEach((provider) => { provider.isDefault = provider.id === config.activeProviderId; });
    });
    events.write('provider_delete', { providerId: id });
    return null;
  });
  handle(ipcChannels.providerTest, async (_event, id) => {
    const startedAt = Date.now();
    let providerName = String(id);
    try {
      const { adapter, provider } = await resolveProvider(id);
      providerName = provider.name;
      const latencyMs = await adapter.test();
      events.write('api_key_test', { provider: providerName, success: true, latencyMs });
      return { latencyMs };
    } catch (error) {
      events.write('api_key_test', {
        provider: providerName, success: false, latencyMs: Date.now() - startedAt, errorCode: errorDetails(error).code,
      });
      throw error;
    }
  });
  handle(ipcChannels.providerActivate, async (_event, id) => {
    const config = await storage.updateConfig((current) => {
      if (!current.providers.some((provider) => provider.id === id)) throw new ServiceError(404, '模型服务不存在');
      current.activeProviderId = id;
      current.providers.forEach((provider) => { provider.isDefault = provider.id === id; });
    });
    events.write('provider_activate', { providerId: id });
    return config.providers.map(publicProvider);
  });
  handle(ipcChannels.providerCompliance, async (_event, show) => {
    const config = await storage.updateConfig((current) => { current.settings.showExportCompliance = Boolean(show); });
    return config.settings.showExportCompliance;
  });
  handle(ipcChannels.providerGetCompliance, async () => (await storage.readConfig()).settings.showExportCompliance);

  ipcMain.removeHandler(ipcChannels.aiStart);
  ipcMain.handle(ipcChannels.aiStart, async (event, input: AiRequest): Promise<ApiResult<AiDone>> => {
    const controller = new AbortController();
    if (activeRequests.has(input.requestId)) return failure(new ServiceError(409, '相同请求正在执行'), { requestId: input.requestId, text: '' });
    activeRequests.set(input.requestId, controller);
    const sender: WebContents = event.sender;
    const startedAt = Date.now();
    let model = 'unknown';
    let callSucceeded = false;
    let callErrorCode: string | undefined;
    let usage: AiDone['usage'];
    try {
      if (!['continue', 'polish', 'deai'].includes(input.scene)) throw new ServiceError(400, '不支持的 AI 场景');
      const [work, chapter, cards, resolved] = await Promise.all([
        storage.getWork(input.workId), storage.getChapter(input.workId, input.chapterId),
        storage.listActiveCards(input.workId), resolveProvider(),
      ]);
      const { adapter, provider } = resolved;
      model = provider.modelChat;
      if (chapter.chapter.revision !== input.baseRevision) throw new ServiceError(409, '章节已被修改，请刷新后重试');
      const selectedCards = cards.filter((card) => input.cardIds.includes(card.cardId));
      const template = await storage.getTemplateForScene(input.scene, input.templateId);
      const prompt = buildPrompt(input, template, work, chapter.chapter, chapter.content, selectedCards, cards);
      await storage.createSnapshot(input.workId, input.chapterId, 'pre_ai');
      if (input.scene === 'continue') {
        events.write('ai_continue', {
          requestId: input.requestId, workId: input.workId, chapterId: input.chapterId,
          wordCount: chapter.chapter.wordCount, templateId: template.templateId,
        });
      }
      const result = await adapter.stream(prompt, {
        temperature: template.temperature, maxTokens: template.maxTokens,
      }, (delta) => {
        if (!sender.isDestroyed()) sender.send(ipcChannels.aiChunk, { requestId: input.requestId, delta });
      }, controller.signal);
      usage = result.usage;
      callSucceeded = true;
      const done: AiDone = {
        requestId: input.requestId, text: result.text, ...(result.usage ? { usage: result.usage } : {}),
        ...(input.scene === 'continue' ? { continuity: scoreContinuity(chapter.content, result.text) } : {}),
      };
      if (!sender.isDestroyed()) sender.send(ipcChannels.aiDone, done);
      try {
        await storage.addGeneration({
          kind: input.scene,
          workId: work.workId, workTitle: work.title,
          chapterId: chapter.chapter.chapterId, chapterTitle: chapter.chapter.title,
          promptName: template.name, model, content: result.text,
          ...(result.usage?.promptTokens !== undefined ? { promptTokens: result.usage.promptTokens } : {}),
          ...(result.usage?.completionTokens !== undefined ? { completionTokens: result.usage.completionTokens } : {}),
        });
      } catch (error) {
        // 历史记录写入失败不应影响本次生成结果的交付。
        events.write('generation_history_failed', { requestId: input.requestId, errorCode: errorDetails(error).code });
      }
      return ok(done);
    } catch (error) {
      const details = errorDetails(error);
      callErrorCode = details.code;
      const failureEvent: AiFailure = { requestId: input.requestId, ...details };
      if (!sender.isDestroyed()) sender.send(ipcChannels.aiError, failureEvent);
      return failure(error, { requestId: input.requestId, text: '' });
    } finally {
      events.write('ai_call', {
        requestId: input.requestId, scene: input.scene, model, success: callSucceeded,
        latencyMs: Date.now() - startedAt, ...(callErrorCode ? { errorCode: callErrorCode } : {}),
        ...(usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } : {}),
      });
      activeRequests.delete(input.requestId);
    }
  });
  registered.push(ipcChannels.aiStart);

  handle(ipcChannels.aiAbort, async (_event, requestId) => {
    activeRequests.get(requestId)?.abort();
    return null;
  });

  handle(ipcChannels.consistencyCheck, async (_event, input: AiRequest) => {
    const startedAt = Date.now();
    let model = 'unknown';
    let callSucceeded = false;
    let callErrorCode: string | undefined;
    let usage: AiDone['usage'];
    try {
      const [work, chapter, cards] = await Promise.all([
        storage.getWork(input.workId), storage.getChapter(input.workId, input.chapterId), storage.listActiveCards(input.workId),
      ]);
      if (chapter.chapter.revision !== input.baseRevision) throw new ServiceError(409, '章节已被修改，请刷新后重试');
      if (!chapter.content.trim()) throw new ServiceError(400, '当前章节无正文，请先写入内容再检查');
      const selectedCards = input.cardIds.length ? cards.filter((card) => input.cardIds.includes(card.cardId)) : cards;
      if (!selectedCards.length) throw new ServiceError(400, '请先创建或选择设定卡');
      const { adapter, provider } = await resolveProvider();
      model = provider.modelChat;
      const template = await storage.getTemplateForScene('consistency', input.templateId);
      const prompt = buildPrompt(input, template, work, chapter.chapter, chapter.content, selectedCards, cards);
      const result = await adapter.complete(prompt, { temperature: 0, maxTokens: template.maxTokens });
      usage = result.usage;
      const issues = parseConsistencyIssues(result.text);
      callSucceeded = true;
      events.write('consistency_check', {
        requestId: input.requestId, workId: input.workId, chapterId: input.chapterId,
        issueCount: issues.length, templateId: template.templateId,
      });
      return issues;
    } catch (error) {
      callErrorCode = errorDetails(error).code;
      throw error;
    } finally {
      events.write('ai_call', {
        requestId: input.requestId, scene: 'consistency', model, success: callSucceeded,
        latencyMs: Date.now() - startedAt, ...(callErrorCode ? { errorCode: callErrorCode } : {}),
        ...(usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } : {}),
      });
    }
  });

  handle(ipcChannels.consistencyBook, async (_event, input: BookConsistencyInput): Promise<BookConsistencyResult> => {
    if (!input?.workId) throw new ServiceError(400, '作品信息不完整');
    const startedAt = Date.now();
    let model = 'unknown';
    let checkedChapters = 0;
    try {
      const [work, cards, outline, chapters] = await Promise.all([
        storage.getWork(input.workId), storage.listActiveCards(input.workId),
        storage.listOutline(input.workId), storage.listChapters(input.workId),
      ]);
      const selectedCards = input.cardIds?.length ? cards.filter((card) => input.cardIds?.includes(card.cardId)) : cards;
      if (!selectedCards.length) throw new ServiceError(400, '请先创建或选择设定卡');
      const { adapter, provider } = await resolveProvider();
      model = provider.modelChat;
      const template = await storage.getTemplateForScene('consistency', input.templateId);
      const chapterById = new Map(chapters.map((chapter) => [chapter.chapterId, chapter]));
      const ordered = outline
        .filter((node) => node.level === 2)
        .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt))
        .flatMap((node) => {
          const chapter = chapterById.get(node.chapterId);
          return chapter ? [{ node, chapter }] : [];
        })
        .slice(0, 40);
      const issues: BookConsistencyIssue[] = [];
      for (const { node, chapter } of ordered) {
        const content = (await storage.getChapter(input.workId, chapter.chapterId)).content.trim().slice(0, 1500);
        if (!content) continue;
        const request: AiRequest = {
          requestId: `book-${chapter.chapterId}`, workId: input.workId, chapterId: chapter.chapterId,
          scene: 'continue', cardIds: input.cardIds ?? [], targetChars: 0, baseRevision: chapter.revision,
        };
        try {
          const prompt = buildPrompt(request, template, work, chapter, content, selectedCards, cards);
          const result = await adapter.complete(prompt, { temperature: 0, maxTokens: template.maxTokens, timeoutMs: 120_000 });
          for (const issue of parseConsistencyIssues(result.text)) {
            issues.push({ ...issue, chapterId: chapter.chapterId, chapterTitle: node.title });
          }
        } catch {
          // 单章失败不阻塞全书检查。
        }
        checkedChapters += 1;
      }
      events.write('consistency_book_check', {
        workId: input.workId, checkedChapters, issueCount: issues.length, model, latencyMs: Date.now() - startedAt,
      });
      return { issues, checkedChapters };
    } catch (error) {
      events.write('consistency_book_check', {
        workId: input?.workId, model, success: false, errorCode: errorDetails(error).code, latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  });

  handle(ipcChannels.consistencyFix, async (_event, input: ConsistencyDispositionInput) => {
    if (!input.issueType?.trim() || !input.templateId?.trim() || !['text', 'card'].includes(input.action)) {
      throw new ServiceError(400, '一致性处置信息不完整');
    }
    events.write('knowledge_check_fix', {
      workId: input.workId, chapterId: input.chapterId, issueId: input.issueId,
      issueType: input.issueType, scene: 'consistency', templateId: input.templateId, action: input.action,
    });
    return null;
  });

  handle(ipcChannels.snapshotList, (_event, workId, chapterId) => storage.listSnapshots(workId, chapterId));
  handle(ipcChannels.snapshotCreate, async (_event, workId, chapterId) => {
    const snapshot = await storage.createSnapshot(workId, chapterId);
    events.write('snapshot_create', { workId, chapterId, snapshotId: snapshot.snapshotId, reason: snapshot.reason });
    return snapshot;
  });
  handle(ipcChannels.snapshotRollback, async (_event, workId, chapterId, snapshotId) => {
    const before = await storage.getChapter(workId, chapterId);
    const result = await storage.rollbackSnapshot(workId, chapterId, snapshotId);
    events.write('snapshot_rollback', {
      workId, chapterId, snapshotId, revision: result.chapter.revision,
      deltaWordCount: result.chapter.wordCount - before.chapter.wordCount,
    });
    return result;
  });

  handle(ipcChannels.recoveryList, () => storage.listRecovery());
  handle(ipcChannels.recoveryRestore, async (_event, id) => {
    await storage.restoreRecovery(id);
    events.write('recovery_restore', {});
    return null;
  });
  handle(ipcChannels.recoveryDiscard, async (_event, id) => {
    await storage.discardRecovery(id);
    events.write('recovery_discard', {});
    return null;
  });

  handle(ipcChannels.exportDocument, async (_event, input: ExportInput) => {
    if (input.format === 'html') {
      const [work, outline] = await Promise.all([
        storage.getWork(input.workId), storage.listOutline(input.workId),
      ]);
      const nodes = input.chapterId ? outline.filter((node) => node.chapterId === input.chapterId) : outline;
      const chapters: { title: string; content: string }[] = [];
      for (const node of nodes) {
        const chapter = await storage.getChapter(input.workId, node.chapterId);
        chapters.push({ title: node.title, content: chapter.content });
      }
      if (!chapters.length && input.chapterId) {
        const chapter = await storage.getChapter(input.workId, input.chapterId);
        chapters.push({ title: chapter.chapter.title, content: chapter.content });
      }
      if (!chapters.length) throw new ServiceError(400, '作品还没有可导出的章节');
      const wordCount = sharePageWordCount(chapters);
      if (!wordCount) throw new ServiceError(400, '所选章节还没有正文');
      const content = formatSharePage({
        title: work.title, genre: work.genre, description: work.description, chapters, wordCount,
      });
      const result = await dialog.showSaveDialog({
        title: input.chapterId ? '导出章节阅读页' : '导出作品阅读页',
        defaultPath: `${safeFileName(work.title)}${input.chapterId ? `-${safeFileName(chapters[0].title)}` : ''}-阅读页.html`,
        filters: [{ name: '网页', extensions: ['html'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const filePath = path.extname(result.filePath) ? result.filePath : `${result.filePath}.html`;
      await writeFileAtomic(filePath, content);
      events.write('export_word_count', {
        workId: input.workId, wordCount, granularity: input.chapterId ? 'chapter' : 'work',
        chapterId: input.chapterId, format: 'html',
      });
      return { filePath, wordCount };
    }
    if (input.format === 'adaptation') {
      const [work, cards, outline, master] = await Promise.all([
        storage.getWork(input.workId), storage.listActiveCards(input.workId),
        storage.listOutline(input.workId), storage.getMasterOutline(input.workId),
      ]);
      const selectedIds = input.chapterIds?.length ? new Set(input.chapterIds) : null;
      const selectedOutline = selectedIds
        ? outline.filter((node) => node.chapterId && selectedIds.has(node.chapterId))
        : outline;
      const adaptationChapters = input.includeChapterText
        ? await Promise.all(selectedOutline.filter((node) => node.chapterId).map(async (node) => {
          const chapter = await storage.getChapter(input.workId, node.chapterId);
          return { title: node.title, content: chapter.content };
        }))
        : undefined;
      const content = formatAdaptationPack({
        work, cards, outline: selectedOutline, master: master.content, chapters: adaptationChapters,
      });
      const result = await dialog.showSaveDialog({
        title: '导出改编资料包',
        defaultPath: `${safeFileName(work.title)}-改编资料包.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const filePath = path.extname(result.filePath) ? result.filePath : `${result.filePath}.md`;
      await writeFileAtomic(filePath, content);
      events.write('export_word_count', {
        workId: input.workId, wordCount: content.length, granularity: 'work', format: 'adaptation',
      });
      return { filePath, wordCount: content.length };
    }
    const document = await storage.getDocument(input.workId, input.chapterId);
    const extension = input.format;
    const result = await dialog.showSaveDialog({
      title: input.chapterId ? '导出章节' : '导出全书',
      defaultPath: `${safeFileName(document.title)}.${extension}`,
      filters: [{ name: extension === 'txt' ? '纯文本' : 'Markdown', extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return null;
    const filePath = path.extname(result.filePath) ? result.filePath : `${result.filePath}.${extension}`;
    const content = input.format === 'txt' ? stripMarkdown(document.content) : document.content;
    await writeFileAtomic(filePath, content);
    events.write('export_word_count', {
      workId: input.workId, wordCount: document.wordCount, granularity: input.chapterId ? 'chapter' : 'work',
      chapterId: input.chapterId, format: input.format,
    });
    return { filePath, wordCount: document.wordCount };
  });

  handle(ipcChannels.scriptList, () => storage.listScriptProjects());
  handle(ipcChannels.scriptImport, async () => {
    const result = await dialog.showOpenDialog({
      title: '导入剧本', properties: ['openFile'],
      filters: [{ name: 'TXT / Markdown / Word', extensions: ['txt', 'md', 'docx'] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    const extension = path.extname(filePath).toLowerCase();
    const buffer = await readFile(filePath);
    if (buffer.length > 30_000_000) throw new ServiceError(400, '文件过大，请控制在 30MB 以内');
    const rawText = extension === '.docx' ? extractDocxText(buffer) : decodeTextBuffer(buffer);
    const chapters = splitChapters(rawText);
    if (!chapters.length) throw new ServiceError(400, '未识别到可导入的章节');
    if (chapters.length > 100) throw new ServiceError(400, '分集数量超过 100，请拆分后再导入');
    const title = path.basename(filePath, path.extname(filePath)).trim().slice(0, 60) || '导入剧本';
    const created = await storage.createScriptProject({
      title, elements: [], episodeCount: chapters.length, batchSize: 5,
    });
    const project = await storage.updateScriptProject(created.projectId, {
      episodes: chapters.map((chapter, index) => ({
        index: index + 1, title: chapter.title, summary: '', content: chapter.content,
        status: chapter.content.trim() ? 'done' as const : 'pending' as const,
      })),
    });
    events.write('script_import', { projectId: project.projectId, episodeCount: chapters.length });
    return project;
  });
  handle(ipcChannels.scriptCreate, async (_event, input: ScriptProjectInput) => {
    const project = await storage.createScriptProject(input);
    events.write('script_create', { projectId: project.projectId, episodeCount: project.episodeCount });
    return project;
  });
  handle(ipcChannels.scriptUpdate, async (_event, projectId: string, input: Partial<ScriptProjectInput>) => {
    if (!projectId) throw new ServiceError(400, '缺少剧本项目');
    return storage.updateScriptProject(projectId, input ?? {});
  });
  handle(ipcChannels.scriptDelete, async (_event, projectId: string) => {
    await storage.deleteScriptProject(projectId);
    events.write('script_delete', { projectId });
    return null;
  });
  handle(ipcChannels.scriptGenerateIdeas, async (_event, projectId: string, instruction?: string) => {
    const startedAt = Date.now();
    let model = 'unknown';
    try {
      const project = await storage.getScriptProject(projectId);
      if (!project.elements.length) throw new ServiceError(400, '请先选择至少一个题材或情绪元素');
      const { adapter, provider } = await resolveProvider();
      model = provider.modelChat;
      const result = await adapter.complete(buildScriptIdeaPrompt({
        title: project.title, genre: project.genre, elements: project.elements,
        instruction: typeof instruction === 'string' ? instruction : undefined,
      }), { temperature: 0.9, maxTokens: 1800, timeoutMs: 120_000 });
      const ideas = parseScriptIdeas(result.text).map((idea) => ({ ...idea, ideaId: randomUUID() }));
      const updated = await storage.updateScriptProject(projectId, {
        ideas,
        selectedIdeaId: ideas.some((idea) => idea.ideaId === project.selectedIdeaId) ? project.selectedIdeaId : null,
      });
      events.write('script_ideas', {
        projectId, count: ideas.length, model, latencyMs: Date.now() - startedAt,
      });
      return updated;
    } catch (error) {
      events.write('script_ideas', {
        projectId, model, success: false, errorCode: errorDetails(error).code, latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  });
  handle(ipcChannels.scriptSelectIdea, async (_event, projectId: string, ideaId: string) => {
    const project = await storage.getScriptProject(projectId);
    if (!project.ideas.some((idea) => idea.ideaId === ideaId)) throw new ServiceError(404, '创意不存在');
    return storage.updateScriptProject(projectId, { selectedIdeaId: ideaId });
  });
  handle(ipcChannels.scriptGenerateOutline, async (_event, projectId: string) => {
    const startedAt = Date.now();
    let model = 'unknown';
    try {
      const project = await storage.getScriptProject(projectId);
      const idea = project.ideas.find((item) => item.ideaId === project.selectedIdeaId);
      if (!idea) throw new ServiceError(400, '请先选择一个短剧创意');
      const { adapter, provider } = await resolveProvider();
      model = provider.modelChat;
      const result = await adapter.complete(buildScriptOutlinePrompt({
        title: project.title, genre: project.genre, elements: project.elements,
        idea, episodeCount: project.episodeCount,
      }), { temperature: 0.8, maxTokens: 5000, timeoutMs: 180_000 });
      const outline = parseScriptOutline(result.text, project.episodeCount);
      const updated = await storage.updateScriptProject(projectId, {
        masterOutline: outline.masterOutline,
        episodes: outline.episodes.map((episode, index) => ({
          index: index + 1, title: episode.title, summary: episode.summary, content: '', status: 'pending' as const,
        })),
      });
      events.write('script_outline', {
        projectId, episodeCount: updated.episodes.length, model, latencyMs: Date.now() - startedAt,
      });
      return updated;
    } catch (error) {
      events.write('script_outline', {
        projectId, model, success: false, errorCode: errorDetails(error).code, latencyMs: Date.now() - startedAt,
      });
      throw error;
    }
  });
  handle(ipcChannels.scriptGenerateEpisodes, async (_event, input: ScriptEpisodeGenerateInput) => {
    if (!input?.projectId || !Array.isArray(input.episodeIndexes) || !input.episodeIndexes.length) {
      throw new ServiceError(400, '请选择要生成的分集');
    }
    if (input.episodeIndexes.length > 20) throw new ServiceError(400, '单次最多生成 20 集');
    const project = await storage.getScriptProject(input.projectId);
    const idea = project.ideas.find((item) => item.ideaId === project.selectedIdeaId);
    if (!idea) throw new ServiceError(400, '请先选择一个短剧创意');
    if (!project.episodes.length) throw new ServiceError(400, '请先生成分集大纲');
    const indexes = [...new Set(input.episodeIndexes.map(Number).filter((value) => Number.isInteger(value)))];
    const targets = project.episodes.filter((episode) => indexes.includes(episode.index));
    if (!targets.length) throw new ServiceError(404, '所选分集不存在');
    const { adapter, provider } = await resolveProvider();
    const model = provider.modelChat;
    const episodes = project.episodes.map((episode) => ({ ...episode }));
    for (const target of targets) {
      const current = episodes.find((episode) => episode.index === target.index);
      if (!current) continue;
      current.status = 'generating';
      current.error = undefined;
      const previousTail = current.index > 1 ? episodes.find((episode) => episode.index === current.index - 1)?.content ?? '' : '';
      const startedAt = Date.now();
      try {
        const result = await adapter.complete(buildScriptEpisodePrompt({
          project: { ...project, episodes }, idea, episode: current, previousTail,
        }), { temperature: 0.8, maxTokens: 2200, timeoutMs: 180_000 });
        current.content = result.text.trim();
        current.status = current.content ? 'done' : 'failed';
        if (!current.content) current.error = '模型返回空内容';
        events.write('script_episode', {
          projectId: input.projectId, episodeIndex: current.index, model,
          wordCount: countVisibleChars(current.content), success: !!current.content, latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        current.status = 'failed';
        current.error = error instanceof Error ? error.message : '生成失败，请重试';
        events.write('script_episode', {
          projectId: input.projectId, episodeIndex: current.index, model,
          success: false, errorCode: errorDetails(error).code, latencyMs: Date.now() - startedAt,
        });
      }
    }
    return storage.updateScriptProject(input.projectId, { episodes });
  });
  handle(ipcChannels.scriptSaveEpisode, async (_event, input: ScriptEpisodeSaveInput) => {
    if (!input?.projectId || !Number.isInteger(Number(input.episodeIndex))) throw new ServiceError(400, '分集信息不完整');
    const project = await storage.saveScriptEpisode(input.projectId, Number(input.episodeIndex), String(input.content ?? ''));
    events.write('script_episode_save', {
      projectId: input.projectId, episodeIndex: Number(input.episodeIndex), wordCount: countVisibleChars(String(input.content ?? '')),
    });
    return project;
  });
  handle(ipcChannels.scriptExport, async (_event, input: ScriptExportInput) => {
    if (!input?.projectId) throw new ServiceError(400, '缺少剧本项目');
    const project = await storage.getScriptProject(input.projectId);
    const extension = input.format === 'txt' ? 'txt' : 'md';
    const content = formatScriptDocument(project, {
      episodeIndexes: input.episodeIndexes,
      format: extension,
    });
    const result = await dialog.showSaveDialog({
      title: '导出分集剧本',
      defaultPath: `${safeFileName(project.title)}-分集剧本.${extension}`,
      filters: [{ name: extension === 'txt' ? '纯文本' : 'Markdown', extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return null;
    const filePath = path.extname(result.filePath) ? result.filePath : `${result.filePath}.${extension}`;
    await writeFileAtomic(filePath, content);
    const wordCount = countVisibleChars(content);
    events.write('export_word_count', {
      workId: project.projectId, wordCount, granularity: 'work', format: 'script',
    });
    return { filePath, wordCount };
  });

  return () => {
    for (const controller of activeRequests.values()) controller.abort();
    activeRequests.clear();
    for (const channel of registered) ipcMain.removeHandler(channel);
  };
}
