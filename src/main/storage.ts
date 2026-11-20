import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AppConfig, Card, Chapter, ChapterContent, FormatWorkResult, GenerationRecord, MasterOutline, OutlineNode, OutlineSeason,
  OutlineSeasonDraft, OutlineVolumeDraft, PromptTemplate, RecoveryItem, SearchReplaceResult, ScriptProject, SnapshotInfo, Work, WorkspaceStats,
} from '../shared/models';
import type { CardBatchInput, CardInput, ChapterDraftInput, OutlineInput, SaveChapterInput, ScriptProjectInput, SearchReplaceInput, WorkInput } from '../shared/ipc';
import { countVisibleChars } from '../shared/utils/countVisibleChars';
import { formatManuscript } from '../shared/utils/manuscript';
import { calculateStreak, localDayKey } from '../shared/utils/stats';
import type { ImportedChapter } from '../shared/utils/importText';
import { buildSearchPattern, countMatches, previewMatches } from '../shared/utils/searchReplace';
import { ServiceError, requireCondition } from './errors';
import { builtinTemplates } from './promptTemplates';

interface WorkDocument { schemaVersion: 1; work: Work; chapters: Chapter[] }
interface CardsDocument { schemaVersion: 1; cards: Card[] }
interface OutlineDocument { schemaVersion: 1; nodes: OutlineNode[]; master?: MasterOutline; seasons?: OutlineSeason[] }
interface TemplatesDocument { schemaVersion: 1; templates: PromptTemplate[] }
interface GenerationsDocument { schemaVersion: 1; records: GenerationRecord[] }
interface ScriptsDocument { schemaVersion: 1; projects: ScriptProject[] }
interface WorkGroupsDocument { schemaVersion: 1; groups: string[] }
interface SnapshotDocument { schemaVersion: 1; snapshot: SnapshotInfo; content: string }

/** 生成历史只保留最近若干条，避免本地文件无限增长。 */
const GENERATION_HISTORY_LIMIT = 300;

const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const byOrder = (a: OutlineNode, b: OutlineNode) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt);

function assertSegment(value: string, label: string): void {
  requireCondition(/^[a-zA-Z0-9_-]+$/.test(value), 400, `${label}不合法`);
}

export class JsonFileRepository {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(public readonly rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
  }

  resolve(relativePath: string): string {
    requireCondition(!path.isAbsolute(relativePath), 400, '文件路径不合法');
    const resolved = path.resolve(this.rootDirectory, relativePath);
    const relative = path.relative(this.rootDirectory, resolved);
    requireCondition(relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative), 400, '文件路径超出数据目录');
    return resolved;
  }

  async read<T>(relativePath: string): Promise<T> {
    try {
      return JSON.parse(await readFile(this.resolve(relativePath), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ServiceError(404, '数据文件不存在');
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(500, '数据文件损坏或无法读取');
    }
  }

  async write<T extends object>(relativePath: string, value: T): Promise<void> {
    const document = { ...value, schemaVersion: 'schemaVersion' in value ? value.schemaVersion : 1 };
    await this.writeTextAtomic(relativePath, `${JSON.stringify(document, null, 2)}\n`);
  }

  async writeTextAtomic(relativePath: string, content: string, tempSuffix = '.tmp'): Promise<void> {
    const target = this.resolve(relativePath);
    const temporary = `${target}${tempSuffix}`;
    const previous = this.queues.get(target) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temporary, content, 'utf8');
      await rename(temporary, target);
    });
    const tail = operation.then(() => undefined, () => undefined);
    this.queues.set(target, tail);
    try {
      await operation;
    } finally {
      if (this.queues.get(target) === tail) this.queues.delete(target);
    }
  }
}

export class StorageRepository {
  readonly json: JsonFileRepository;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(public readonly rootDirectory: string) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.json = new JsonFileRepository(this.rootDirectory);
  }

  async initialize(): Promise<void> {
    await mkdir(path.join(this.rootDirectory, 'works'), { recursive: true });
    await this.ensureTemplates();
    await this.ensureGenerations();
    const configPath = this.json.resolve('config.json');
    try {
      await stat(configPath);
    } catch {
      await this.json.write('config.json', this.defaultConfig());
    }
  }

  private defaultConfig(): AppConfig {
    return { schemaVersion: 1, providers: [], activeProviderId: null, settings: { showExportCompliance: true } };
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.locks.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private workDirectory(workId: string): string {
    assertSegment(workId, '作品 ID');
    return `works/${workId}`;
  }

  private workDocumentPath(workId: string): string { return `${this.workDirectory(workId)}/work.json`; }
  private cardsPath(workId: string): string { return `${this.workDirectory(workId)}/cards.json`; }
  private outlinePath(workId: string): string { return `${this.workDirectory(workId)}/outline.json`; }
  private chapterPath(workId: string, chapterId: string): string {
    assertSegment(chapterId, '章节 ID');
    return `${this.workDirectory(workId)}/chapters/${chapterId}.md`;
  }
  private snapshotPath(workId: string, chapterId: string, snapshotId: string): string {
    assertSegment(snapshotId, '快照 ID');
    return `${this.workDirectory(workId)}/versions/${chapterId}/${snapshotId}.json`;
  }

  private async readWorkDocument(workId: string, includeDeleted = false): Promise<WorkDocument> {
    const document = await this.json.read<WorkDocument>(this.workDocumentPath(workId));
    if (!includeDeleted && document.work.deletedAt) throw new ServiceError(404, '作品不存在');
    return document;
  }

  private async writeWorkDocument(workId: string, document: WorkDocument): Promise<void> {
    await this.json.write(this.workDocumentPath(workId), document);
  }

  async getWork(workId: string): Promise<Work> {
    return clone((await this.readWorkDocument(workId)).work);
  }

  async listWorks(): Promise<Work[]> {
    const entries = await readdir(path.join(this.rootDirectory, 'works'), { withFileTypes: true }).catch(() => []);
    const works: Work[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const document = await this.readWorkDocument(entry.name);
        works.push(document.work);
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
      }
    }
    return works.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** 汇总全部作品的累计字数、写作天数与继续写作位置。 */
  async workspaceStats(): Promise<WorkspaceStats> {
    const works = await this.listWorks();
    const dayKeys = new Set<string>();
    const stats: WorkspaceStats['works'] = [];
    let totalWords = 0;
    for (const work of works) {
      const document = await this.readWorkDocument(work.workId).catch(() => null);
      const chapters = document ? document.chapters.filter((chapter) => !chapter.deletedAt) : [];
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(work.workId)).catch(() => null);
      const order = new Map(
        (outline?.nodes ?? []).filter((node) => !node.deletedAt).map((node) => [node.chapterId, node.orderIndex]),
      );
      const wordCount = chapters.reduce((sum, chapter) => sum + Math.max(0, chapter.wordCount || 0), 0);
      const written = chapters.filter((chapter) => chapter.wordCount > 0);
      for (const chapter of written) {
        const key = localDayKey(chapter.updatedAt);
        if (key) dayKeys.add(key);
      }
      const latest = [...chapters].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)
        || (order.get(left.chapterId) ?? 0) - (order.get(right.chapterId) ?? 0)).at(-1) ?? null;
      totalWords += wordCount;
      stats.push({
        workId: work.workId,
        wordCount,
        chapterCount: chapters.length,
        writtenChapterCount: written.length,
        lastChapterId: latest?.chapterId ?? null,
        lastChapterTitle: latest?.title ?? null,
        lastActiveAt: latest?.updatedAt ?? work.updatedAt,
      });
    }
    return {
      totalWords,
      writingDays: dayKeys.size,
      streakDays: calculateStreak([...dayKeys]),
      works: stats,
    };
  }

  async createWork(input: WorkInput): Promise<Work> {
    requireCondition(input.title.trim(), 400, '作品标题不能为空');
    const timestamp = now();
    const work: Work = {
      workId: randomUUID(), title: input.title.trim(), genre: input.genre?.trim() ?? '',
      description: input.description ?? '', style: input.style?.trim() ?? '',
      targetWords: Math.max(0, Math.round(input.targetWords ?? 0)),
      platform: input.platform?.trim() ?? '', requirements: input.requirements?.trim() ?? '',
      visualRatio: input.visualRatio?.trim() ?? '', visualStyle: input.visualStyle?.trim() ?? '',
      visualNotes: input.visualNotes?.trim() ?? '',
      group: input.group?.trim().slice(0, 20) ?? '', cover: input.cover?.trim().slice(0, 20) ?? '',
      status: 'active', createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
    };
    const directory = this.workDirectory(work.workId);
    await this.json.write(`${directory}/work.json`, { schemaVersion: 1 as const, work, chapters: [] });
    await this.json.write(`${directory}/cards.json`, { schemaVersion: 1 as const, cards: [] });
    await this.json.write(`${directory}/outline.json`, { schemaVersion: 1 as const, nodes: [] });
    return clone(work);
  }

  async createImportedWork(input: { title: string; description?: string; chapters: ImportedChapter[] }): Promise<Work> {
    const work = await this.createWork({ title: input.title, description: input.description });
    return this.withLock(work.workId, async () => {
      const document = await this.readWorkDocument(work.workId);
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(work.workId));
      const timestamp = now();
      const volumeChapterId = randomUUID();
      const volumeNode: OutlineNode = {
        nodeId: randomUUID(), workId: work.workId, chapterId: volumeChapterId, title: '正文', summary: '',
        orderIndex: 0, level: 1, parentId: null, seasonId: null,
        createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      };
      const volumeChapter: Chapter = {
        chapterId: volumeChapterId, workId: work.workId, nodeId: volumeNode.nodeId, title: '正文',
        wordCount: 0, status: 'draft', revision: 0, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      };
      outline.nodes.push(volumeNode);
      document.chapters.push(volumeChapter);
      await this.json.writeTextAtomic(this.chapterPath(work.workId, volumeChapterId), '');
      let orderIndex = 1;
      for (const item of input.chapters) {
        const chapterId = randomUUID();
        const node: OutlineNode = {
          nodeId: randomUUID(), workId: work.workId, chapterId, title: item.title, summary: '',
          orderIndex: orderIndex++, level: 2, parentId: volumeNode.nodeId, seasonId: null,
          createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
        };
        const chapter: Chapter = {
          chapterId, workId: work.workId, nodeId: node.nodeId, title: item.title,
          wordCount: countVisibleChars(item.content), status: item.content.trim() ? 'writing' : 'draft',
          revision: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
        };
        outline.nodes.push(node);
        document.chapters.push(chapter);
        await this.json.writeTextAtomic(this.chapterPath(work.workId, chapterId), item.content);
      }
      await this.json.write(this.outlinePath(work.workId), outline);
      await this.writeWorkDocument(work.workId, document);
      return clone(document.work);
    });
  }

  async updateWork(workId: string, input: Partial<WorkInput>): Promise<Work> {
    return this.withLock(workId, async () => {
      const document = await this.readWorkDocument(workId);
      if (input.title !== undefined) {
        requireCondition(input.title.trim(), 400, '作品标题不能为空');
        document.work.title = input.title.trim();
      }
      if (input.genre !== undefined) document.work.genre = input.genre.trim();
      if (input.description !== undefined) document.work.description = input.description;
      if (input.style !== undefined) document.work.style = input.style.trim();
      if (input.targetWords !== undefined) document.work.targetWords = Math.max(0, Math.round(input.targetWords));
      if (input.platform !== undefined) document.work.platform = input.platform.trim();
      if (input.requirements !== undefined) document.work.requirements = input.requirements.trim();
      if (input.visualRatio !== undefined) document.work.visualRatio = input.visualRatio.trim();
      if (input.visualStyle !== undefined) document.work.visualStyle = input.visualStyle.trim();
      if (input.visualNotes !== undefined) document.work.visualNotes = input.visualNotes.trim();
      if (input.group !== undefined) document.work.group = input.group.trim().slice(0, 20);
      if (input.cover !== undefined) document.work.cover = input.cover.trim().slice(0, 20);
      document.work.updatedAt = now();
      await this.writeWorkDocument(workId, document);
      return clone(document.work);
    });
  }

  async deleteWork(workId: string): Promise<void> {
    await this.withLock(workId, async () => {
      const document = await this.readWorkDocument(workId);
      document.work.deletedAt = now();
      document.work.updatedAt = document.work.deletedAt;
      await this.writeWorkDocument(workId, document);
    });
  }

  async listCards(workId: string): Promise<Card[]> {
    await this.readWorkDocument(workId);
    const document = await this.json.read<CardsDocument>(this.cardsPath(workId));
    return clone(document.cards.filter((card) => !card.deletedAt).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt.localeCompare(b.createdAt)));
  }

  /** 供 AI 使用的设定卡，弃用卡不参与上下文注入。 */
  async listActiveCards(workId: string): Promise<Card[]> {
    return (await this.listCards(workId)).filter((card) => !card.deprecatedAt);
  }

  async upsertCard(input: CardInput): Promise<Card> {
    return this.withLock(input.workId, async () => {
      await this.readWorkDocument(input.workId);
      requireCondition(input.title.trim(), 400, '设定卡标题不能为空');
      const document = await this.json.read<CardsDocument>(this.cardsPath(input.workId));
      const timestamp = now();
      let card: Card;
      if (input.cardId) {
        assertSegment(input.cardId, '设定卡 ID');
        const existing = document.cards.find((item) => item.cardId === input.cardId && !item.deletedAt);
        if (!existing) throw new ServiceError(404, '设定卡不存在');
        Object.assign(existing, {
          type: input.type, title: input.title.trim(), content: input.content,
          tags: [...input.tags], pinned: input.pinned,
          deprecatedAt: input.deprecatedAt !== undefined ? input.deprecatedAt : existing.deprecatedAt ?? null,
          updatedAt: timestamp,
        });
        card = existing;
      } else {
        card = {
          cardId: randomUUID(), workId: input.workId, type: input.type, title: input.title.trim(),
          content: input.content, tags: [...input.tags], pinned: input.pinned,
          deprecatedAt: input.deprecatedAt ?? null,
          createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
        };
        document.cards.push(card);
      }
      await this.json.write(this.cardsPath(input.workId), document);
      return clone(card);
    });
  }

  /** 批量创建设定卡，一次写盘；空标题或超出上限的条目会被跳过。 */
  async createCards(input: CardBatchInput): Promise<Card[]> {
    return this.withLock(input.workId, async () => {
      await this.readWorkDocument(input.workId);
      requireCondition(input.items.length > 0, 400, '没有可导入的设定卡');
      requireCondition(input.items.length <= 100, 400, '单次最多导入 100 张设定卡');
      const document = await this.json.read<CardsDocument>(this.cardsPath(input.workId));
      const timestamp = now();
      const created: Card[] = [];
      for (const item of input.items) {
        const title = item.title.trim().slice(0, 100);
        const content = item.content.trim();
        if (!title || !content) continue;
        const card: Card = {
          cardId: randomUUID(), workId: input.workId, type: input.type, title, content,
          tags: [], pinned: false, deprecatedAt: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
        };
        document.cards.push(card);
        created.push(card);
      }
      requireCondition(created.length > 0, 400, '没有可导入的有效设定卡（标题和内容不能为空）');
      await this.json.write(this.cardsPath(input.workId), document);
      return clone(created);
    });
  }

  async deleteCard(workId: string, cardId: string): Promise<void> {
    await this.withLock(workId, async () => {
      const document = await this.json.read<CardsDocument>(this.cardsPath(workId));
      const card = document.cards.find((item) => item.cardId === cardId && !item.deletedAt);
      if (!card) throw new ServiceError(404, '设定卡不存在');
      card.deletedAt = now();
      card.updatedAt = card.deletedAt;
      await this.json.write(this.cardsPath(workId), document);
    });
  }

  async listOutline(workId: string): Promise<OutlineNode[]> {
    await this.readWorkDocument(workId);
    const document = await this.json.read<OutlineDocument>(this.outlinePath(workId));
    return clone(document.nodes.filter((node) => !node.deletedAt).sort(byOrder));
  }

  async listChapters(workId: string): Promise<Chapter[]> {
    const document = await this.readWorkDocument(workId);
    return clone(document.chapters.filter((chapter) => !chapter.deletedAt));
  }

  async listSeasons(workId: string): Promise<OutlineSeason[]> {
    await this.readWorkDocument(workId);
    const document = await this.json.read<OutlineDocument>(this.outlinePath(workId));
    return clone((document.seasons ?? []).slice().sort((a, b) => a.orderIndex - b.orderIndex));
  }

  async createOutline(input: OutlineInput): Promise<{ node: OutlineNode; chapter: Chapter }> {
    return this.withLock(input.workId, async () => {
      const workDocument = await this.readWorkDocument(input.workId);
      requireCondition(input.title.trim(), 400, '章节标题不能为空');
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(input.workId));
      const active = outline.nodes.filter((node) => !node.deletedAt);
      if (input.level === 1) requireCondition(input.parentId === null, 400, '卷不能设置父节点');
      if (input.level === 2) {
        const parent = active.find((node) => node.nodeId === input.parentId && node.level === 1);
        requireCondition(parent, 400, '章必须归属于有效的卷');
      }
      const timestamp = now();
      const chapterId = randomUUID();
      let seasonId: string | null = null;
      if (input.level === 2 && input.seasonId) {
        const season = (outline.seasons ?? []).find((item) => item.seasonId === input.seasonId && item.volumeId === input.parentId);
        seasonId = season ? season.seasonId : null;
      }
      const node: OutlineNode = {
        nodeId: randomUUID(), workId: input.workId, chapterId, title: input.title.trim(),
        summary: input.summary ?? '', orderIndex: active.length ? Math.max(...active.map((item) => item.orderIndex)) + 1 : 0,
        level: input.level, parentId: input.parentId, seasonId: input.level === 2 ? seasonId : null,
        createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      };
      const chapter: Chapter = {
        chapterId, workId: input.workId, nodeId: node.nodeId, title: node.title,
        wordCount: 0, status: 'draft', revision: 0, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      };
      outline.nodes.push(node);
      workDocument.chapters.push(chapter);
      await this.json.writeTextAtomic(this.chapterPath(input.workId, chapterId), '');
      await this.json.write(this.outlinePath(input.workId), outline);
      await this.writeWorkDocument(input.workId, workDocument);
      return { node: clone(node), chapter: clone(chapter) };
    });
  }

  async updateOutline(workId: string, nodeId: string, input: Partial<Pick<OutlineNode, 'title' | 'summary'>>): Promise<OutlineNode> {
    return this.withLock(workId, async () => {
      const workDocument = await this.readWorkDocument(workId);
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const node = outline.nodes.find((item) => item.nodeId === nodeId && !item.deletedAt);
      if (!node) throw new ServiceError(404, '大纲节点不存在');
      if (input.title !== undefined) {
        requireCondition(input.title.trim(), 400, '章节标题不能为空');
        node.title = input.title.trim();
        const chapter = workDocument.chapters.find((item) => item.chapterId === node.chapterId);
        if (chapter) chapter.title = node.title;
      }
      if (input.summary !== undefined) node.summary = input.summary;
      node.updatedAt = now();
      await this.json.write(this.outlinePath(workId), outline);
      await this.writeWorkDocument(workId, workDocument);
      return clone(node);
    });
  }

  async reorderOutline(workId: string, nodeIds: string[]): Promise<OutlineNode[]> {
    return this.withLock(workId, async () => {
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const active = outline.nodes.filter((node) => !node.deletedAt).sort(byOrder);
      requireCondition(new Set(nodeIds).size === nodeIds.length, 400, '排序 ID 不能重复');
      for (const id of nodeIds) requireCondition(active.some((node) => node.nodeId === id), 404, '大纲节点不存在');
      const requested = nodeIds.map((id) => active.find((node) => node.nodeId === id)!);
      const requestedSet = new Set(nodeIds);
      const sorted = [...requested, ...active.filter((node) => !requestedSet.has(node.nodeId))];
      const timestamp = now();
      sorted.forEach((node, index) => {
        if (node.orderIndex !== index) {
          node.orderIndex = index;
          node.updatedAt = timestamp;
        }
      });
      await this.json.write(this.outlinePath(workId), outline);
      return clone(sorted);
    });
  }

  /** 把章节移动到另一个分卷，清空原季归属，并重排全书顺序。 */
  async moveOutlineNode(workId: string, nodeId: string, targetParentId: string): Promise<OutlineNode> {
    return this.withLock(workId, async () => {
      await this.readWorkDocument(workId);
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const active = outline.nodes.filter((node) => !node.deletedAt);
      const node = active.find((item) => item.nodeId === nodeId && item.level === 2);
      if (!node) throw new ServiceError(404, '章节不存在');
      const target = active.find((item) => item.nodeId === targetParentId && item.level === 1);
      requireCondition(target, 400, '目标分卷不存在');
      if (node.parentId === targetParentId) return clone(node);
      const timestamp = now();
      const targetChapters = active.filter((item) => item.level === 2 && item.parentId === targetParentId);
      node.parentId = targetParentId;
      node.seasonId = null;
      node.orderIndex = targetChapters.length ? Math.max(...targetChapters.map((item) => item.orderIndex)) + 1 : 0;
      node.updatedAt = timestamp;
      const volumes = active.filter((item) => item.level === 1).sort(byOrder);
      const sequence: OutlineNode[] = [];
      for (const volume of volumes) {
        sequence.push(volume);
        sequence.push(...active.filter((item) => item.level === 2 && item.parentId === volume.nodeId).sort(byOrder));
      }
      sequence.push(...active.filter((item) => item.level === 2 && !volumes.some((volume) => volume.nodeId === item.parentId)).sort(byOrder));
      sequence.forEach((item, index) => { item.orderIndex = index; });
      await this.json.write(this.outlinePath(workId), outline);
      return clone(node);
    });
  }

  async getMasterOutline(workId: string): Promise<MasterOutline> {
    await this.readWorkDocument(workId);
    const document = await this.json.read<OutlineDocument>(this.outlinePath(workId));
    return clone(document.master ?? { content: '', updatedAt: '' });
  }

  async saveMasterOutline(workId: string, content: string): Promise<MasterOutline> {
    return this.withLock(workId, async () => {
      await this.readWorkDocument(workId);
      const document = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const master: MasterOutline = { content, updatedAt: now() };
      document.master = master;
      await this.json.write(this.outlinePath(workId), document);
      return clone(master);
    });
  }

  async applyOutlineDraft(workId: string, volumes: OutlineVolumeDraft[]): Promise<OutlineNode[]> {
    return this.withLock(workId, async () => {
      const workDocument = await this.readWorkDocument(workId);
      requireCondition(volumes.length > 0, 400, '分卷大纲不能为空');
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const active = outline.nodes.filter((node) => !node.deletedAt);
      let orderIndex = active.length ? Math.max(...active.map((item) => item.orderIndex)) + 1 : 0;
      const timestamp = now();
      const created: OutlineNode[] = [];
      const appendNode = async (title: string, summary: string, level: 1 | 2, parentId: string | null): Promise<OutlineNode> => {
        requireCondition(title.trim(), 400, level === 1 ? '分卷标题不能为空' : '章节标题不能为空');
        const chapterId = randomUUID();
        const nodeId = randomUUID();
        const node: OutlineNode = {
          nodeId, workId, chapterId, title: title.trim(), summary: summary ?? '',
          orderIndex: orderIndex++, level, parentId, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
        };
        const chapter: Chapter = {
          chapterId, workId, nodeId, title: node.title,
          wordCount: 0, status: 'draft', revision: 0, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
        };
        outline.nodes.push(node);
        workDocument.chapters.push(chapter);
        await this.json.writeTextAtomic(this.chapterPath(workId, chapterId), '');
        created.push(node);
        return node;
      };
      for (const volumeDraft of volumes) {
        const volumeNode = await appendNode(volumeDraft.title, volumeDraft.summary, 1, null);
        for (const chapterDraft of volumeDraft.chapters) {
          await appendNode(chapterDraft.title, chapterDraft.summary, 2, volumeNode.nodeId);
        }
      }
      await this.json.write(this.outlinePath(workId), outline);
      await this.writeWorkDocument(workId, workDocument);
      return clone(created);
    });
  }

  async applySeasons(workId: string, volumeId: string, drafts: OutlineSeasonDraft[]): Promise<{ seasons: OutlineSeason[]; nodes: OutlineNode[] }> {
    return this.withLock(workId, async () => {
      const workDocument = await this.readWorkDocument(workId);
      requireCondition(Array.isArray(drafts) && drafts.length > 0, 400, '季规划不能为空');
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const active = outline.nodes.filter((node) => !node.deletedAt);
      const volume = active.find((node) => node.nodeId === volumeId && node.level === 1);
      requireCondition(volume, 400, '分卷不存在');
      const existingChapters = active
        .filter((node) => node.level === 2 && node.parentId === volumeId)
        .sort(byOrder);
      const timestamp = now();
      const seasons: OutlineSeason[] = [];
      const touched: OutlineNode[] = [];
      const used = new Set<string>();
      let cursor = 0;
      let orderIndex = active.length ? Math.max(...active.map((node) => node.orderIndex)) + 1 : 0;
      for (const [index, draft] of drafts.entries()) {
        const title = draft.title?.trim();
        requireCondition(title, 400, `第 ${index + 1} 季缺少标题`);
        const season: OutlineSeason = {
          seasonId: randomUUID(), volumeId, title, summary: draft.summary ?? '',
          orderIndex: index, createdAt: timestamp, updatedAt: timestamp,
        };
        seasons.push(season);
        for (const chapterDraft of draft.chapters ?? []) {
          const chapterTitle = chapterDraft.title?.trim();
          if (!chapterTitle) continue;
          const summary = chapterDraft.summary ?? '';
          const existing = existingChapters[cursor];
          cursor += 1;
          if (existing) {
            existing.title = chapterTitle;
            existing.summary = summary;
            existing.seasonId = season.seasonId;
            existing.updatedAt = timestamp;
            used.add(existing.nodeId);
            touched.push(existing);
            const chapter = workDocument.chapters.find((item) => item.chapterId === existing.chapterId && !item.deletedAt);
            if (chapter) {
              chapter.title = chapterTitle;
              chapter.updatedAt = timestamp;
            }
            continue;
          }
          const chapterId = randomUUID();
          const node: OutlineNode = {
            nodeId: randomUUID(), workId, chapterId, title: chapterTitle, summary,
            orderIndex: orderIndex++, level: 2, parentId: volumeId, seasonId: season.seasonId,
            createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
          };
          const chapter: Chapter = {
            chapterId, workId, nodeId: node.nodeId, title: chapterTitle,
            wordCount: 0, status: 'draft', revision: 0, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
          };
          outline.nodes.push(node);
          workDocument.chapters.push(chapter);
          await this.json.writeTextAtomic(this.chapterPath(workId, chapterId), '');
          used.add(node.nodeId);
          touched.push(node);
        }
      }
      for (const chapterNode of existingChapters) {
        if (!used.has(chapterNode.nodeId)) {
          chapterNode.seasonId = null;
          chapterNode.updatedAt = timestamp;
          touched.push(chapterNode);
        }
      }
      outline.seasons = [...(outline.seasons ?? []).filter((season) => season.volumeId !== volumeId), ...seasons];

      // 按“卷 → 卷内章节”的顺序重排 orderIndex，保持全书导出顺序稳定。
      const allActive = outline.nodes.filter((node) => !node.deletedAt);
      const volumes = allActive.filter((node) => node.level === 1).sort(byOrder);
      const sequence: OutlineNode[] = [];
      for (const item of volumes) {
        sequence.push(item);
        sequence.push(...allActive.filter((node) => node.level === 2 && node.parentId === item.nodeId).sort(byOrder));
      }
      sequence.push(...allActive.filter((node) => node.level === 2 && !volumes.some((item) => item.nodeId === node.parentId)).sort(byOrder));
      sequence.forEach((node, index) => { node.orderIndex = index; });

      await this.json.write(this.outlinePath(workId), outline);
      await this.writeWorkDocument(workId, workDocument);
      return { seasons: clone(seasons), nodes: clone(touched) };
    });
  }

  async deleteSeason(workId: string, seasonId: string): Promise<void> {
    return this.withLock(workId, async () => {
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const season = (outline.seasons ?? []).find((item) => item.seasonId === seasonId);
      if (!season) throw new ServiceError(404, '季不存在');
      const timestamp = now();
      for (const node of outline.nodes) {
        if (!node.deletedAt && node.seasonId === seasonId) {
          node.seasonId = null;
          node.updatedAt = timestamp;
        }
      }
      outline.seasons = (outline.seasons ?? []).filter((item) => item.seasonId !== seasonId);
      await this.json.write(this.outlinePath(workId), outline);
    });
  }

  async deleteOutline(workId: string, nodeId: string): Promise<void> {
    await this.withLock(workId, async () => {
      const workDocument = await this.readWorkDocument(workId);
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const node = outline.nodes.find((item) => item.nodeId === nodeId && !item.deletedAt);
      if (!node) throw new ServiceError(404, '大纲节点不存在');
      const children = node.level === 1 ? outline.nodes.filter((item) => !item.deletedAt && item.parentId === node.nodeId) : [];
      const protectedNodes = node.level === 1 ? [node, ...children] : [];
      for (const item of protectedNodes) {
        const content = await readFile(this.json.resolve(this.chapterPath(workId, item.chapterId)), 'utf8').catch(() => '');
        if (content.trim()) throw new ServiceError(409, item === node ? '卷正文非空，不能删除' : '卷内存在非空章节，不能删除');
      }
      const timestamp = now();
      for (const item of [node, ...children]) {
        item.deletedAt = timestamp;
        item.updatedAt = timestamp;
        const chapter = workDocument.chapters.find((candidate) => candidate.chapterId === item.chapterId && !candidate.deletedAt);
        if (chapter) {
          chapter.deletedAt = timestamp;
          chapter.updatedAt = timestamp;
        }
      }
      await this.json.write(this.outlinePath(workId), outline);
      await this.writeWorkDocument(workId, workDocument);
    });
  }

  async getChapter(workId: string, chapterId: string): Promise<ChapterContent> {
    const document = await this.readWorkDocument(workId);
    const chapter = document.chapters.find((item) => item.chapterId === chapterId && !item.deletedAt);
    if (!chapter) throw new ServiceError(404, '章节不存在');
    const content = await readFile(this.json.resolve(this.chapterPath(workId, chapterId)), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new ServiceError(404, '章节正文不存在');
      throw error;
    });
    return { chapter: clone(chapter), content };
  }

  async saveChapterDraft(input: ChapterDraftInput): Promise<void> {
    return this.withLock(input.workId, async () => {
      const document = await this.readWorkDocument(input.workId);
      const chapter = document.chapters.find((item) => item.chapterId === input.chapterId && !item.deletedAt);
      if (!chapter) throw new ServiceError(404, '章节不存在');
      if (chapter.locked) throw new ServiceError(409, '章节已锁定，请先解锁');
      await writeFile(this.json.resolve(`${this.chapterPath(input.workId, input.chapterId)}.tmp`), input.content, 'utf8');
    });
  }

  async setChapterLock(workId: string, chapterId: string, locked: boolean): Promise<Chapter> {
    return this.withLock(workId, async () => {
      const document = await this.readWorkDocument(workId);
      const chapter = document.chapters.find((item) => item.chapterId === chapterId && !item.deletedAt);
      if (!chapter) throw new ServiceError(404, '章节不存在');
      chapter.locked = locked;
      chapter.lockedAt = locked ? now() : null;
      chapter.updatedAt = chapter.lockedAt ?? now();
      await this.writeWorkDocument(workId, document);
      return clone(chapter);
    });
  }

  /** 在全作品章节中查找关键字；传入 replacement 时执行替换，锁定章节只统计不替换。 */
  async searchReplace(input: SearchReplaceInput): Promise<SearchReplaceResult> {
    return this.withLock(input.workId, async () => {
      const keyword = input.keyword ?? '';
      requireCondition(keyword.trim(), 400, '请输入要查找的内容');
      const caseSensitive = input.caseSensitive !== false;
      const replacing = input.replacement !== undefined;
      const workDocument = await this.readWorkDocument(input.workId);
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(input.workId));
      const activeNodes = outline.nodes.filter((node) => !node.deletedAt).sort(byOrder);
      const chapterById = new Map(
        workDocument.chapters.filter((chapter) => !chapter.deletedAt).map((chapter) => [chapter.chapterId, chapter]),
      );
      const timestamp = now();
      const hits: SearchReplaceResult['hits'] = [];
      let totalCount = 0;
      let replacedChapters = 0;
      let skippedLocked = 0;
      for (const node of activeNodes) {
        if (node.level !== 2) continue;
        const chapter = chapterById.get(node.chapterId);
        if (!chapter) continue;
        const content = await readFile(this.json.resolve(this.chapterPath(input.workId, node.chapterId)), 'utf8').catch(() => '');
        const count = countMatches(content, keyword, caseSensitive);
        if (!count) continue;
        const locked = chapter.locked === true;
        totalCount += count;
        hits.push({
          chapterId: node.chapterId, chapterTitle: node.title, count, locked,
          previews: previewMatches(content, keyword, caseSensitive),
        });
        if (!replacing || locked) {
          if (replacing && locked) skippedLocked += 1;
          continue;
        }
        await this.createSnapshotLocked(input.workId, node.chapterId, 'manual', content, chapter);
        const next = content.replace(buildSearchPattern(keyword, caseSensitive), () => input.replacement ?? '');
        chapter.revision += 1;
        chapter.wordCount = countVisibleChars(next);
        chapter.updatedAt = timestamp;
        await this.json.writeTextAtomic(this.chapterPath(input.workId, node.chapterId), next);
        replacedChapters += 1;
      }
      if (replacedChapters) await this.writeWorkDocument(input.workId, workDocument);
      return { keyword, totalCount, hits, replacedChapters, skippedLocked };
    });
  }

  /** 整书排版：清理行尾空格、全角缩进与多余空行，锁定章节跳过。 */
  async formatWork(workId: string): Promise<FormatWorkResult> {
    return this.withLock(workId, async () => {
      const workDocument = await this.readWorkDocument(workId);
      const outline = await this.json.read<OutlineDocument>(this.outlinePath(workId));
      const activeNodes = outline.nodes.filter((node) => !node.deletedAt && node.level === 2).sort(byOrder);
      const chapterById = new Map(
        workDocument.chapters.filter((chapter) => !chapter.deletedAt).map((chapter) => [chapter.chapterId, chapter]),
      );
      const timestamp = now();
      let changedChapters = 0;
      let skippedLocked = 0;
      for (const node of activeNodes) {
        const chapter = chapterById.get(node.chapterId);
        if (!chapter) continue;
        const content = await readFile(this.json.resolve(this.chapterPath(workId, node.chapterId)), 'utf8').catch(() => '');
        const formatted = formatManuscript(content);
        if (formatted === content) continue;
        if (chapter.locked) {
          skippedLocked += 1;
          continue;
        }
        await this.createSnapshotLocked(workId, node.chapterId, 'manual', content, chapter);
        chapter.revision += 1;
        chapter.wordCount = countVisibleChars(formatted);
        chapter.updatedAt = timestamp;
        await this.json.writeTextAtomic(this.chapterPath(workId, node.chapterId), formatted);
        changedChapters += 1;
      }
      if (changedChapters) await this.writeWorkDocument(workId, workDocument);
      return { totalChapters: activeNodes.length, changedChapters, skippedLocked };
    });
  }

  async saveChapter(input: SaveChapterInput): Promise<ChapterContent> {
    return this.withLock(input.workId, async () => {
      const document = await this.readWorkDocument(input.workId);
      const chapter = document.chapters.find((item) => item.chapterId === input.chapterId && !item.deletedAt);
      if (!chapter) throw new ServiceError(404, '章节不存在');
      if (chapter.locked) throw new ServiceError(409, '章节已锁定，请先解锁');
      if (chapter.revision !== input.baseRevision) throw new ServiceError(409, '章节已被修改，请刷新后重试');
      const timestamp = now();
      chapter.revision += 1;
      chapter.wordCount = countVisibleChars(input.content);
      chapter.updatedAt = timestamp;
      if (input.content && chapter.status === 'draft') chapter.status = 'writing';
      await this.json.writeTextAtomic(this.chapterPath(input.workId, input.chapterId), input.content);
      await this.writeWorkDocument(input.workId, document);
      if (input.createSnapshot) {
        await this.createSnapshotLocked(input.workId, input.chapterId, input.reason === 'ai' ? 'accepted' : 'manual', input.content, chapter);
      }
      return { chapter: clone(chapter), content: input.content };
    });
  }

  private async createSnapshotLocked(
    workId: string, chapterId: string, reason: SnapshotInfo['reason'], content: string, chapter: Chapter,
  ): Promise<SnapshotInfo> {
    const snapshot: SnapshotInfo = {
      snapshotId: randomUUID(), workId, chapterId, reason, createdAt: now(),
      wordCount: countVisibleChars(content),
    };
    await this.json.write(this.snapshotPath(workId, chapterId, snapshot.snapshotId), { schemaVersion: 1 as const, snapshot, content });
    chapter.updatedAt = chapter.updatedAt || snapshot.createdAt;
    return clone(snapshot);
  }

  async createSnapshot(workId: string, chapterId: string, reason: SnapshotInfo['reason'] = 'manual'): Promise<SnapshotInfo> {
    return this.withLock(workId, async () => {
      const document = await this.readWorkDocument(workId);
      const chapter = document.chapters.find((item) => item.chapterId === chapterId && !item.deletedAt);
      if (!chapter) throw new ServiceError(404, '章节不存在');
      const content = await readFile(this.json.resolve(this.chapterPath(workId, chapterId)), 'utf8');
      return this.createSnapshotLocked(workId, chapterId, reason, content, chapter);
    });
  }

  async listSnapshots(workId: string, chapterId: string): Promise<SnapshotInfo[]> {
    await this.getChapter(workId, chapterId);
    const directory = this.json.resolve(`${this.workDirectory(workId)}/versions/${chapterId}`);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const snapshots: SnapshotInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const document = await this.json.read<SnapshotDocument>(`${this.workDirectory(workId)}/versions/${chapterId}/${entry.name}`);
      snapshots.push(document.snapshot);
    }
    return clone(snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async rollbackSnapshot(workId: string, chapterId: string, snapshotId: string): Promise<ChapterContent> {
    return this.withLock(workId, async () => {
      const workDocument = await this.readWorkDocument(workId);
      const chapter = workDocument.chapters.find((item) => item.chapterId === chapterId && !item.deletedAt);
      if (!chapter) throw new ServiceError(404, '章节不存在');
      const snapshotDocument = await this.json.read<SnapshotDocument>(this.snapshotPath(workId, chapterId, snapshotId));
      requireCondition(snapshotDocument.snapshot.workId === workId && snapshotDocument.snapshot.chapterId === chapterId, 400, '快照与章节不匹配');
      const currentContent = await readFile(this.json.resolve(this.chapterPath(workId, chapterId)), 'utf8');
      await this.createSnapshotLocked(workId, chapterId, 'rollback', currentContent, chapter);
      chapter.revision += 1;
      chapter.wordCount = countVisibleChars(snapshotDocument.content);
      chapter.updatedAt = now();
      await this.json.writeTextAtomic(this.chapterPath(workId, chapterId), snapshotDocument.content);
      await this.writeWorkDocument(workId, workDocument);
      return { chapter: clone(chapter), content: snapshotDocument.content };
    });
  }

  private async ensureTemplates(): Promise<void> {
    let document: TemplatesDocument;
    try {
      document = await this.json.read<TemplatesDocument>('templates.json');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.statusCode !== 404) throw error;
      document = { schemaVersion: 1, templates: [] };
    }
    const ids = new Set(document.templates.map((template) => template.templateId));
    const missing = builtinTemplates.filter((template) => !ids.has(template.templateId));
    if (missing.length || document.templates.length === 0) {
      document.templates.push(...clone(missing));
      await this.json.write('templates.json', document);
    }
  }

  async listTemplates(): Promise<PromptTemplate[]> {
    await this.ensureTemplates();
    const document = await this.json.read<TemplatesDocument>('templates.json');
    return clone(document.templates.sort((a, b) => Number(b.isBuiltin) - Number(a.isBuiltin) || a.createdAt.localeCompare(b.createdAt)));
  }

  async getTemplate(templateId: string): Promise<PromptTemplate> {
    const templates = await this.listTemplates();
    const template = templates.find((item) => item.templateId === templateId);
    if (!template) throw new ServiceError(404, '提示词模板不存在');
    return template;
  }

  async getTemplateForScene(scene: PromptTemplate['scene'], templateId?: string): Promise<PromptTemplate> {
    if (templateId) {
      const template = await this.getTemplate(templateId);
      requireCondition(template.scene === scene, 400, '提示词模板场景不匹配');
      return template;
    }
    const templates = await this.listTemplates();
    const template = templates.find((item) => item.scene === scene && item.isBuiltin) ?? templates.find((item) => item.scene === scene);
    if (!template) throw new ServiceError(400, '没有可用的提示词模板');
    return template;
  }

  async upsertTemplate(input: Partial<PromptTemplate> & Pick<PromptTemplate, 'name' | 'scene' | 'content'>): Promise<PromptTemplate> {
    return this.withLock('templates', async () => {
      requireCondition(input.name.trim() && input.content.trim(), 400, '模板名称和内容不能为空');
      const document = await this.json.read<TemplatesDocument>('templates.json');
      const timestamp = now();
      const description = input.description?.trim();
      const tags = input.tags?.map((tag) => tag.trim()).filter(Boolean);
      let template: PromptTemplate;
      if (input.templateId) {
        const existing = document.templates.find((item) => item.templateId === input.templateId);
        if (!existing) throw new ServiceError(404, '提示词模板不存在');
        Object.assign(existing, {
          scene: input.scene, name: input.name.trim(), content: input.content,
          temperature: input.temperature, maxTokens: input.maxTokens, updatedAt: timestamp,
        });
        if (input.description !== undefined) existing.description = description || undefined;
        if (tags !== undefined) existing.tags = tags;
        template = existing;
      } else {
        template = {
          templateId: randomUUID(), scene: input.scene, name: input.name.trim(), content: input.content,
          description: description || undefined, tags: tags ?? [],
          temperature: input.temperature, maxTokens: input.maxTokens, isBuiltin: false,
          usageCount: 0, lastUsedAt: null,
          createdAt: timestamp, updatedAt: timestamp,
        };
        document.templates.push(template);
      }
      await this.json.write('templates.json', document);
      return clone(template);
    });
  }

  async markTemplateUsed(templateId: string): Promise<PromptTemplate> {
    return this.withLock('templates', async () => {
      const document = await this.json.read<TemplatesDocument>('templates.json');
      const template = document.templates.find((item) => item.templateId === templateId);
      if (!template) throw new ServiceError(404, '提示词模板不存在');
      template.usageCount = (template.usageCount ?? 0) + 1;
      template.lastUsedAt = now();
      await this.json.write('templates.json', document);
      return clone(template);
    });
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.withLock('templates', async () => {
      const document = await this.json.read<TemplatesDocument>('templates.json');
      const template = document.templates.find((item) => item.templateId === templateId);
      if (!template) throw new ServiceError(404, '提示词模板不存在');
      requireCondition(!template.isBuiltin, 400, '内置模板不能删除');
      document.templates = document.templates.filter((item) => item.templateId !== templateId);
      await this.json.write('templates.json', document);
    });
  }

  async importTemplates(templates: PromptTemplate[]): Promise<PromptTemplate[]> {
    return this.withLock('templates', async () => {
      const document = await this.json.read<TemplatesDocument>('templates.json');
      document.templates.push(...clone(templates));
      await this.json.write('templates.json', document);
      return clone(document.templates);
    });
  }

  private async ensureGenerations(): Promise<void> {
    try {
      await this.json.read<GenerationsDocument>('generations.json');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.statusCode !== 404) throw error;
      await this.json.write('generations.json', { schemaVersion: 1, records: [] });
    }
  }

  async addGeneration(input: Omit<GenerationRecord, 'generationId' | 'createdAt'>): Promise<GenerationRecord> {
    return this.withLock('generations', async () => {
      await this.ensureGenerations();
      const document = await this.json.read<GenerationsDocument>('generations.json');
      const record: GenerationRecord = { ...clone(input), generationId: randomUUID(), createdAt: now() };
      document.records.unshift(record);
      if (document.records.length > GENERATION_HISTORY_LIMIT) document.records.length = GENERATION_HISTORY_LIMIT;
      await this.json.write('generations.json', document);
      return clone(record);
    });
  }

  async listGenerations(): Promise<GenerationRecord[]> {
    await this.ensureGenerations();
    const document = await this.json.read<GenerationsDocument>('generations.json');
    return clone(document.records);
  }

  async deleteGeneration(generationId: string): Promise<void> {
    await this.withLock('generations', async () => {
      await this.ensureGenerations();
      const document = await this.json.read<GenerationsDocument>('generations.json');
      const exists = document.records.some((record) => record.generationId === generationId);
      requireCondition(exists, 404, '生成记录不存在');
      document.records = document.records.filter((record) => record.generationId !== generationId);
      await this.json.write('generations.json', document);
    });
  }

  async clearGenerations(): Promise<void> {
    await this.withLock('generations', async () => {
      await this.json.write('generations.json', { schemaVersion: 1, records: [] });
    });
  }

  private async readWorkGroups(): Promise<WorkGroupsDocument> {
    try {
      return await this.json.read<WorkGroupsDocument>('work-groups.json');
    } catch (error) {
      if (error instanceof ServiceError && error.statusCode === 404) return { schemaVersion: 1, groups: [] };
      throw error;
    }
  }

  async listWorkGroups(): Promise<string[]> {
    return clone((await this.readWorkGroups()).groups);
  }

  async createWorkGroup(name: string): Promise<string[]> {
    const value = String(name ?? '').trim().slice(0, 20);
    requireCondition(!!value, 400, '分组名称不能为空');
    return this.withLock('work-groups', async () => {
      const document = await this.readWorkGroups();
      requireCondition(!document.groups.includes(value), 409, '分组已存在');
      requireCondition(document.groups.length < 50, 400, '分组数量已达上限');
      document.groups.push(value);
      await this.json.write('work-groups.json', document);
      return clone(document.groups);
    });
  }

  /** 删除分组只清空作品的 group 字段，作品本体保留。 */
  async deleteWorkGroup(name: string): Promise<string[]> {
    const value = String(name ?? '').trim();
    const groups = await this.withLock('work-groups', async () => {
      const document = await this.readWorkGroups();
      requireCondition(document.groups.includes(value), 404, '分组不存在');
      document.groups = document.groups.filter((group) => group !== value);
      await this.json.write('work-groups.json', document);
      return clone(document.groups);
    });
    const works = await this.listWorks();
    await Promise.all(works
      .filter((work) => work.group === value)
      .map((work) => this.updateWork(work.workId, { group: '' })));
    return groups;
  }

  private normalizeScriptElements(elements: string[]): string[] {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const element of Array.isArray(elements) ? elements : []) {
      const value = String(element ?? '').trim().slice(0, 20);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      values.push(value);
      if (values.length >= 20) break;
    }
    return values;
  }

  private async readScripts(): Promise<ScriptsDocument> {
    try {
      return await this.json.read<ScriptsDocument>('scripts.json');
    } catch (error) {
      if (error instanceof ServiceError && error.statusCode === 404) return { schemaVersion: 1, projects: [] };
      throw error;
    }
  }

  async listScriptProjects(): Promise<ScriptProject[]> {
    const document = await this.readScripts();
    return clone([...document.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  async getScriptProject(projectId: string): Promise<ScriptProject> {
    const document = await this.readScripts();
    const project = document.projects.find((item) => item.projectId === projectId);
    requireCondition(project, 404, '剧本项目不存在');
    return clone(project);
  }

  async createScriptProject(input: ScriptProjectInput): Promise<ScriptProject> {
    const title = String(input?.title ?? '').trim().slice(0, 60);
    requireCondition(!!title, 400, '请先为剧本起一个名字');
    const timestamp = now();
    const episodeCount = Math.min(100, Math.max(1, Math.round(Number(input.episodeCount) || 12)));
    const batchSize = Math.min(20, Math.max(1, Math.round(Number(input.batchSize) || 5)));
    const project: ScriptProject = {
      projectId: randomUUID(),
      title,
      genre: String(input.genre ?? '').trim().slice(0, 30),
      elements: this.normalizeScriptElements(input.elements),
      episodeCount,
      batchSize,
      ideas: [],
      selectedIdeaId: null,
      masterOutline: '',
      episodes: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.withLock('scripts', async () => {
      const document = await this.readScripts();
      document.projects.unshift(project);
      await this.json.write('scripts.json', document);
    });
    return clone(project);
  }

  async updateScriptProject(
    projectId: string,
    patch: Partial<Pick<ScriptProject, 'title' | 'genre' | 'elements' | 'episodeCount' | 'batchSize'
      | 'ideas' | 'selectedIdeaId' | 'masterOutline' | 'episodes'>>,
  ): Promise<ScriptProject> {
    return this.withLock('scripts', async () => {
      const document = await this.readScripts();
      const project = document.projects.find((item) => item.projectId === projectId);
      requireCondition(project, 404, '剧本项目不存在');
      if (patch.title !== undefined) {
        const title = String(patch.title).trim().slice(0, 60);
        requireCondition(!!title, 400, '剧本名称不能为空');
        project.title = title;
      }
      if (patch.genre !== undefined) project.genre = String(patch.genre).trim().slice(0, 30);
      if (patch.elements !== undefined) project.elements = this.normalizeScriptElements(patch.elements);
      if (patch.episodeCount !== undefined) project.episodeCount = Math.min(100, Math.max(1, Math.round(Number(patch.episodeCount) || 12)));
      if (patch.batchSize !== undefined) project.batchSize = Math.min(20, Math.max(1, Math.round(Number(patch.batchSize) || 5)));
      if (patch.ideas !== undefined) project.ideas = clone(patch.ideas);
      if (patch.selectedIdeaId !== undefined) project.selectedIdeaId = patch.selectedIdeaId;
      if (patch.masterOutline !== undefined) project.masterOutline = patch.masterOutline;
      if (patch.episodes !== undefined) project.episodes = clone(patch.episodes);
      project.updatedAt = now();
      await this.json.write('scripts.json', document);
      return clone(project);
    });
  }

  async deleteScriptProject(projectId: string): Promise<void> {
    await this.withLock('scripts', async () => {
      const document = await this.readScripts();
      const exists = document.projects.some((item) => item.projectId === projectId);
      requireCondition(exists, 404, '剧本项目不存在');
      document.projects = document.projects.filter((item) => item.projectId !== projectId);
      await this.json.write('scripts.json', document);
    });
  }

  async saveScriptEpisode(projectId: string, episodeIndex: number, content: string): Promise<ScriptProject> {    return this.withLock('scripts', async () => {
      const document = await this.readScripts();
      const project = document.projects.find((item) => item.projectId === projectId);
      requireCondition(project, 404, '剧本项目不存在');
      const episode = project.episodes.find((item) => item.index === episodeIndex);
      requireCondition(episode, 404, '分集不存在');
      episode.content = String(content ?? '');
      episode.status = episode.content.trim() ? 'done' : 'pending';
      episode.error = undefined;
      project.updatedAt = now();
      await this.json.write('scripts.json', document);
      return clone(project);
    });
  }

  async readConfig(): Promise<AppConfig> {
    try {
      return clone(await this.json.read<AppConfig>('config.json'));
    } catch (error) {
      if (error instanceof ServiceError && error.statusCode === 404) return this.defaultConfig();
      throw error;
    }
  }

  async updateConfig(update: (config: AppConfig) => void | Promise<void>): Promise<AppConfig> {
    return this.withLock('config', async () => {
      const config = await this.readConfig();
      await update(config);
      config.schemaVersion = 1;
      await this.json.write('config.json', config);
      return clone(config);
    });
  }

  private recoveryId(relativePath: string): string {
    return Buffer.from(relativePath.replace(/\\/g, '/'), 'utf8').toString('base64url');
  }

  private recoveryPath(id: string): { relativePath: string; workId: string; chapterId: string } {
    let relativePath: string;
    try {
      relativePath = Buffer.from(id, 'base64url').toString('utf8').replace(/\\/g, '/');
    } catch {
      throw new ServiceError(400, '恢复项 ID 不合法');
    }
    const match = /^works\/([a-zA-Z0-9_-]+)\/chapters\/([a-zA-Z0-9_-]+)\.md\.tmp$/.exec(relativePath);
    requireCondition(match, 400, '恢复项路径不合法');
    this.json.resolve(relativePath);
    return { relativePath, workId: match[1], chapterId: match[2] };
  }

  async listRecovery(): Promise<RecoveryItem[]> {
    const worksDirectory = path.join(this.rootDirectory, 'works');
    const works = await readdir(worksDirectory, { withFileTypes: true }).catch(() => []);
    const items: RecoveryItem[] = [];
    for (const work of works) {
      if (!work.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(work.name)) continue;
      const chaptersDirectory = path.join(worksDirectory, work.name, 'chapters');
      const chapters = await readdir(chaptersDirectory, { withFileTypes: true }).catch(() => []);
      for (const chapter of chapters) {
        const match = /^([a-zA-Z0-9_-]+)\.md\.tmp$/.exec(chapter.name);
        if (!chapter.isFile() || !match) continue;
        const relativePath = `works/${work.name}/chapters/${chapter.name}`;
        const absolutePath = this.json.resolve(relativePath);
        const [content, metadata] = await Promise.all([readFile(absolutePath, 'utf8'), stat(absolutePath)]);
        items.push({
          id: this.recoveryId(relativePath), workId: work.name, chapterId: match[1],
          filePath: absolutePath, content, modifiedAt: metadata.mtime.toISOString(),
        });
      }
    }
    return items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  async restoreRecovery(id: string): Promise<void> {
    const recovery = this.recoveryPath(id);
    await this.withLock(recovery.workId, async () => {
      const source = this.json.resolve(recovery.relativePath);
      const content = await readFile(source, 'utf8').catch(() => { throw new ServiceError(404, '恢复项不存在'); });
      await this.json.writeTextAtomic(this.chapterPath(recovery.workId, recovery.chapterId), content, '.restore.tmp');
      await unlink(source).catch(() => undefined);
      try {
        const document = await this.readWorkDocument(recovery.workId, true);
        const chapter = document.chapters.find((item) => item.chapterId === recovery.chapterId && !item.deletedAt);
        if (chapter) {
          chapter.revision += 1;
          chapter.wordCount = countVisibleChars(content);
          chapter.updatedAt = now();
          await this.writeWorkDocument(recovery.workId, document);
        }
      } catch (error) {
        if (!(error instanceof ServiceError && error.statusCode === 404)) throw error;
      }
    });
  }

  async discardRecovery(id: string): Promise<void> {
    const recovery = this.recoveryPath(id);
    await unlink(this.json.resolve(recovery.relativePath)).catch(() => { throw new ServiceError(404, '恢复项不存在'); });
  }

  async getDocument(workId: string, chapterId?: string): Promise<{ title: string; content: string; wordCount: number }> {
    const work = await this.getWork(workId);
    if (chapterId) {
      const chapter = await this.getChapter(workId, chapterId);
      return {
        title: chapter.chapter.title,
        content: `${work.title}\n\n${chapter.chapter.title}\n\n${chapter.content}`,
        wordCount: countVisibleChars(chapter.content),
      };
    }
    const outline = await this.listOutline(workId);
    const document = await this.readWorkDocument(workId);
    const activeChapters = document.chapters.filter((chapter) => !chapter.deletedAt);
    const orderedIds = outline.map((node) => node.chapterId);
    const remaining = activeChapters.filter((chapter) => !orderedIds.includes(chapter.chapterId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const ordered = [
      ...orderedIds.map((id) => activeChapters.find((chapter) => chapter.chapterId === id)).filter((chapter): chapter is Chapter => Boolean(chapter)),
      ...remaining,
    ];
    const parts: string[] = [];
    let wordCount = 0;
    for (const chapter of ordered) {
      const content = await readFile(this.json.resolve(this.chapterPath(workId, chapter.chapterId)), 'utf8');
      parts.push(`${chapter.title}\n\n${content}`);
      wordCount += countVisibleChars(content);
    }
    if (wordCount === 0) throw new ServiceError(400, '全书正文为空，请先写入内容再导出');
    return { title: work.title, content: `${work.title}\n\n${parts.join('\n\n')}`, wordCount };
  }
}
