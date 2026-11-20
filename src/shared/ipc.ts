import type {
  AiChunk, AiDone, AiFailure, AiRequest, AppInfo, BookConsistencyResult, Card, CardDraft, CardType, Chapter,
  ChapterContent, ChapterLockResult, ConsistencyIssue, FormatWorkResult, GeneratedChapterDraft, GenerationRecord, MasterOutline, OutlineDraft, OutlineNode,
  OutlineSeason, OutlineSeasonDraft, OutlineVolumeDraft, PromptTemplate, ProviderInput, PublicProvider,
  RecoveryItem, ReferenceExcerpt, ScriptProject, SearchReplaceResult, SnapshotInfo, Work, WorkspaceStats,
} from './models';

export interface ApiResult<T> {
  code: number;
  message: string;
  data: T;
}

export interface WorkInput {
  title: string;
  genre?: string;
  description?: string;
  style?: string;
  targetWords?: number;
  platform?: string;
  requirements?: string;
  visualRatio?: string;
  visualStyle?: string;
  visualNotes?: string;
  group?: string;
  cover?: string;
}
export interface CardInput extends Omit<Card, 'cardId' | 'createdAt' | 'updatedAt' | 'deletedAt'> { cardId?: string }
export interface OutlineInput {
  workId: string;
  title: string;
  summary?: string;
  level: 1 | 2;
  parentId: string | null;
  seasonId?: string | null;
}
export interface SeasonGenerateInput {
  workId: string;
  volumeId: string;
  brief: string;
  instruction?: string;
  chapterCount?: number;
}
export interface SeasonApplyInput {
  workId: string;
  volumeId: string;
  seasons: OutlineSeasonDraft[];
}
export interface SeasonApplyResult {
  seasons: OutlineSeason[];
  nodes: OutlineNode[];
}
export interface OutlineMoveInput {
  workId: string;
  nodeId: string;
  targetParentId: string;
}
export interface SearchReplaceInput {
  workId: string;
  keyword: string;
  /** 不传表示只查找；传入字符串（可为空）表示执行替换。 */
  replacement?: string;
  caseSensitive?: boolean;
}
export interface CardBatchInput {
  workId: string;
  type: CardType;
  items: Array<{ title: string; content: string }>;
}
export interface ChapterLockInput {
  workId: string;
  chapterId: string;
  locked: boolean;
}
export interface BookConsistencyInput {
  workId: string;
  cardIds?: string[];
  templateId?: string;
}
export type OutlineLevel = 'master' | 'volume' | 'chapter';
export interface OutlineGenerateInput {
  level: OutlineLevel;
  brief: string;
  title?: string;
  genre?: string;
  description?: string;
  volumeTitle?: string;
  chapterTitle?: string;
  master?: string;
  volumeCount?: number;
  chapterCount?: number;
  reference?: string;
}
export interface CardGenerateInput {
  workId: string;
  /** 指定章节时仅从该章正文提取资产，而不是按总纲补齐。 */
  chapterId?: string;
  categories?: CardType[];
  instruction?: string;
  count?: number;
}
export interface DraftGenerateInput {
  workId: string;
  mode: 'golden-three' | 'continue';
  chapterIds: string[];
  instruction?: string;
  targetChars?: number;
}
export interface DraftApplyInput {
  workId: string;
  drafts: { chapterId: string; text: string }[];
}
export interface OutlineApplyInput {
  workId: string;
  volumes: OutlineVolumeDraft[];
}
export interface ChapterDraftInput {
  workId: string;
  chapterId: string;
  content: string;
}
export interface SaveChapterInput extends ChapterDraftInput {
  baseRevision: number;
  reason?: 'manual' | 'autosave' | 'ai';
  createSnapshot?: boolean;
  aiScene?: 'continue' | 'polish' | 'deai';
  templateId?: string;
  diffType?: 'append' | 'document' | 'selection';
}
export interface ExportInput {
  workId: string;
  chapterId?: string;
  format: 'txt' | 'md' | 'html' | 'adaptation';
  /** 资料包格式下参与改编的章节；不传表示全部章节。 */
  chapterIds?: string[];
  /** 资料包格式下是否附带所选章节正文。 */
  includeChapterText?: boolean;
}
export interface ScriptProjectInput {
  title: string;
  genre?: string;
  elements: string[];
  episodeCount?: number;
  batchSize?: number;
}
export interface ScriptEpisodeGenerateInput {
  projectId: string;
  /** 要生成的分集序号，从 1 开始；单次最多 20 集。 */
  episodeIndexes: number[];
}
export interface ScriptEpisodeSaveInput {
  projectId: string;
  episodeIndex: number;
  content: string;
}
export interface ScriptExportInput {
  projectId: string;
  /** 不传表示导出全部已有正文的分集。 */
  episodeIndexes?: number[];
  format: 'md' | 'txt';
}

export interface ConsistencyDispositionInput {
  workId: string;
  chapterId: string;
  issueId: string;
  issueType: string;
  scene: 'consistency';
  templateId: string;
  action: 'text' | 'card';
}
export interface InkForgeApi {
  app: {
    getInfo(): Promise<ApiResult<AppInfo>>;
    openDataDir(): Promise<ApiResult<null>>;
    quit(): Promise<ApiResult<null>>;
    flushComplete(saved: boolean): Promise<ApiResult<null>>;
  };
  work: {
    list(): Promise<ApiResult<Work[]>>;
    create(input: WorkInput): Promise<ApiResult<Work>>;
    update(workId: string, input: Partial<WorkInput>): Promise<ApiResult<Work>>;
    delete(workId: string): Promise<ApiResult<null>>;
    import(): Promise<ApiResult<Work | null>>;
    stats(): Promise<ApiResult<WorkspaceStats>>;
    groups(): Promise<ApiResult<string[]>>;
    createGroup(name: string): Promise<ApiResult<string[]>>;
    deleteGroup(name: string): Promise<ApiResult<string[]>>;
  };
  card: {
    list(workId: string): Promise<ApiResult<Card[]>>;
    upsert(input: CardInput): Promise<ApiResult<Card>>;
    delete(workId: string, cardId: string): Promise<ApiResult<null>>;
    generate(input: CardGenerateInput): Promise<ApiResult<CardDraft[]>>;
    batchCreate(input: CardBatchInput): Promise<ApiResult<Card[]>>;
  };
  outline: {
    list(workId: string): Promise<ApiResult<OutlineNode[]>>;
    create(input: OutlineInput): Promise<ApiResult<{ node: OutlineNode; chapter: ChapterContent['chapter'] }>>;
    update(workId: string, nodeId: string, input: Partial<Pick<OutlineNode, 'title' | 'summary'>>): Promise<ApiResult<OutlineNode>>;
    reorder(workId: string, nodeIds: string[]): Promise<ApiResult<OutlineNode[]>>;
    move(input: OutlineMoveInput): Promise<ApiResult<OutlineNode>>;
    delete(workId: string, nodeId: string): Promise<ApiResult<null>>;
    getMaster(workId: string): Promise<ApiResult<MasterOutline>>;
    saveMaster(workId: string, content: string): Promise<ApiResult<MasterOutline>>;
    generate(input: OutlineGenerateInput): Promise<ApiResult<OutlineDraft>>;
    applyDraft(input: OutlineApplyInput): Promise<ApiResult<OutlineNode[]>>;
    listSeasons(workId: string): Promise<ApiResult<OutlineSeason[]>>;
    generateSeasons(input: SeasonGenerateInput): Promise<ApiResult<OutlineSeasonDraft[]>>;
    applySeasons(input: SeasonApplyInput): Promise<ApiResult<SeasonApplyResult>>;
    deleteSeason(workId: string, seasonId: string): Promise<ApiResult<null>>;
  };
  draft: {
    generate(input: DraftGenerateInput): Promise<ApiResult<GeneratedChapterDraft[]>>;
    apply(input: DraftApplyInput): Promise<ApiResult<GeneratedChapterDraft[]>>;
  };
  content: {
    searchReplace(input: SearchReplaceInput): Promise<ApiResult<SearchReplaceResult>>;
    formatWork(workId: string): Promise<ApiResult<FormatWorkResult>>;
  };
  reference: {
    pickTxt(): Promise<ApiResult<ReferenceExcerpt | null>>;
  };
  chapter: {
    list(workId: string): Promise<ApiResult<Chapter[]>>;
    get(workId: string, chapterId: string): Promise<ApiResult<ChapterContent>>;
    saveDraft(input: ChapterDraftInput): Promise<ApiResult<null>>;
    save(input: SaveChapterInput): Promise<ApiResult<ChapterContent>>;
    lock(input: ChapterLockInput): Promise<ApiResult<ChapterLockResult>>;
  };
  prompt: {
    list(): Promise<ApiResult<PromptTemplate[]>>;
    upsert(input: Partial<PromptTemplate> & Pick<PromptTemplate, 'name' | 'scene' | 'content'>): Promise<ApiResult<PromptTemplate>>;
    delete(templateId: string): Promise<ApiResult<null>>;
    markUsed(templateId: string): Promise<ApiResult<PromptTemplate>>;
    import(): Promise<ApiResult<PromptTemplate[] | null>>;
    export(): Promise<ApiResult<string | null>>;
  };
  history: {
    list(): Promise<ApiResult<GenerationRecord[]>>;
    delete(generationId: string): Promise<ApiResult<null>>;
    clear(): Promise<ApiResult<null>>;
  };
  provider: {
    list(): Promise<ApiResult<PublicProvider[]>>;
    upsert(input: ProviderInput): Promise<ApiResult<PublicProvider>>;
    delete(id: string): Promise<ApiResult<null>>;
    test(id: string): Promise<ApiResult<{ latencyMs: number }>>;
    activate(id: string): Promise<ApiResult<PublicProvider[]>>;
    setCompliance(show: boolean): Promise<ApiResult<boolean>>;
    getCompliance(): Promise<ApiResult<boolean>>;
  };
  ai: {
    start(input: AiRequest): Promise<ApiResult<AiDone>>;
    abort(requestId: string): Promise<ApiResult<null>>;
    onChunk(callback: (event: AiChunk) => void): () => void;
    onDone(callback: (event: AiDone) => void): () => void;
    onError(callback: (event: AiFailure) => void): () => void;
  };
  consistency: {
    check(input: AiRequest): Promise<ApiResult<ConsistencyIssue[]>>;
    checkBook(input: BookConsistencyInput): Promise<ApiResult<BookConsistencyResult>>;
    recordFix(input: ConsistencyDispositionInput): Promise<ApiResult<null>>;
  };
  snapshot: {
    list(workId: string, chapterId: string): Promise<ApiResult<SnapshotInfo[]>>;
    create(workId: string, chapterId: string): Promise<ApiResult<SnapshotInfo>>;
    rollback(workId: string, chapterId: string, snapshotId: string): Promise<ApiResult<ChapterContent>>;
  };
  recovery: {
    list(): Promise<ApiResult<RecoveryItem[]>>;
    restore(id: string): Promise<ApiResult<null>>;
    discard(id: string): Promise<ApiResult<null>>;
  };
  export: {
    document(input: ExportInput): Promise<ApiResult<{ filePath: string; wordCount: number } | null>>;
  };
  script: {
    list(): Promise<ApiResult<ScriptProject[]>>;
    importFile(): Promise<ApiResult<ScriptProject | null>>;
    create(input: ScriptProjectInput): Promise<ApiResult<ScriptProject>>;
    update(projectId: string, input: Partial<ScriptProjectInput>): Promise<ApiResult<ScriptProject>>;
    delete(projectId: string): Promise<ApiResult<null>>;
    generateIdeas(projectId: string, instruction?: string): Promise<ApiResult<ScriptProject>>;
    selectIdea(projectId: string, ideaId: string): Promise<ApiResult<ScriptProject>>;
    generateOutline(projectId: string): Promise<ApiResult<ScriptProject>>;
    generateEpisodes(input: ScriptEpisodeGenerateInput): Promise<ApiResult<ScriptProject>>;
    saveEpisode(input: ScriptEpisodeSaveInput): Promise<ApiResult<ScriptProject>>;
    export(input: ScriptExportInput): Promise<ApiResult<{ filePath: string; wordCount: number } | null>>;
  };
}

export const ipcChannels = {
  appInfo: 'app.info', appOpenDataDir: 'app.open-data-dir', appQuit: 'app.quit', appFlushComplete: 'app.flush-complete',
  workList: 'work.list', workCreate: 'work.create', workUpdate: 'work.update', workDelete: 'work.delete', workImport: 'work.import', workStats: 'work.stats',
  cardList: 'card.list', cardUpsert: 'card.upsert', cardDelete: 'card.delete',
  outlineList: 'outline.list', outlineCreate: 'outline.create', outlineUpdate: 'outline.update', outlineReorder: 'outline.reorder', outlineDelete: 'outline.delete', outlineMove: 'outline.move',
  outlineGetMaster: 'outline.master', outlineSaveMaster: 'outline.master.save', outlineGenerate: 'outline.generate', outlineApply: 'outline.apply',
  outlineSeasons: 'outline.seasons', outlineGenerateSeasons: 'outline.seasons.generate', outlineApplySeasons: 'outline.seasons.apply', outlineDeleteSeason: 'outline.seasons.delete',
  cardGenerate: 'card.generate', cardBatchCreate: 'card.batch-create', draftGenerate: 'draft.generate', draftApply: 'draft.apply', referencePickTxt: 'reference.pickTxt',
  contentSearchReplace: 'content.search-replace', contentFormatWork: 'content.format-work',
  chapterList: 'chapter.list', chapterGet: 'chapter.get', chapterDraft: 'chapter.draft', chapterSave: 'chapter.save', chapterLock: 'chapter.lock',
  promptList: 'prompt.list', promptUpsert: 'prompt.upsert', promptDelete: 'prompt.delete', promptMarkUsed: 'prompt.mark-used', promptImport: 'prompt.import', promptExport: 'prompt.export',
  historyList: 'history.list', historyDelete: 'history.delete', historyClear: 'history.clear',
  providerList: 'provider.list', providerUpsert: 'provider.upsert', providerDelete: 'provider.delete', providerTest: 'provider.test', providerActivate: 'provider.activate', providerCompliance: 'provider.compliance', providerGetCompliance: 'provider.compliance.get',
  aiStart: 'ai.stream', aiAbort: 'ai.abort', aiChunk: 'ai:chunk', aiDone: 'ai:done', aiError: 'ai:error',
  consistencyCheck: 'consistency.check', consistencyBook: 'consistency.checkBook', consistencyFix: 'consistency.fix',
  snapshotList: 'snapshot.list', snapshotCreate: 'snapshot.create', snapshotRollback: 'snapshot.rollback',
  recoveryList: 'recovery.list', recoveryRestore: 'recovery.restore', recoveryDiscard: 'recovery.discard',
  exportDocument: 'export.document',
  workGroupList: 'work.groups', workGroupCreate: 'work.group.create', workGroupDelete: 'work.group.delete',
  scriptList: 'script.list', scriptImport: 'script.import', scriptCreate: 'script.create', scriptUpdate: 'script.update', scriptDelete: 'script.delete',
  scriptGenerateIdeas: 'script.ideas.generate', scriptSelectIdea: 'script.idea.select', scriptGenerateOutline: 'script.outline.generate',
  scriptGenerateEpisodes: 'script.episodes.generate', scriptSaveEpisode: 'script.episode.save', scriptExport: 'script.export',
} as const;
