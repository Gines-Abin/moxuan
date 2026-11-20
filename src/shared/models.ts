export type ISODate = string;
export type AiScene = 'continue' | 'polish' | 'deai' | 'outline' | 'consistency';

export interface Work {
  workId: string;
  title: string;
  genre: string;
  description: string;
  /** 文风约束，例如“轻松幽默、快节奏、第一人称限知”。 */
  style?: string;
  /** 目标字数，0 或未填表示未设定。 */
  targetWords?: number;
  /** 发布平台或连载渠道。 */
  platform?: string;
  /** 补充要求或自定义信息。 */
  requirements?: string;
  /** 视觉改编画幅，例如 9:16、16:9。 */
  visualRatio?: string;
  /** 视觉改编画风，例如国风厚涂、日系赛璐璐。 */
  visualStyle?: string;
  /** 视觉改编的其他备注。 */
  visualNotes?: string;
  /** 作品分组（文件夹），空字符串表示未分组。 */
  group?: string;
  /** 本地占位封面主题，空字符串表示不使用封面。 */
  cover?: string;
  status: 'active' | 'archived';
  createdAt: ISODate;
  updatedAt: ISODate;
  deletedAt: ISODate | null;
}

export type ScriptEpisodeStatus = 'pending' | 'generating' | 'done' | 'failed';

/** 短剧创意卡片，Step1 生成后供用户选择。 */
export interface ScriptIdea {
  ideaId: string;
  title: string;
  logline: string;
  synopsis: string;
}

/** 短剧分集，正文由 Step3 逐批生成。 */
export interface ScriptEpisode {
  index: number;
  title: string;
  summary: string;
  content: string;
  status: ScriptEpisodeStatus;
  error?: string;
}

/** 本地短剧项目，保存元素、创意、分集大纲与正文。 */
export interface ScriptProject {
  projectId: string;
  title: string;
  genre: string;
  elements: string[];
  episodeCount: number;
  batchSize: number;
  ideas: ScriptIdea[];
  selectedIdeaId: string | null;
  masterOutline: string;
  episodes: ScriptEpisode[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type CardType = 'character' | 'world' | 'plot' | 'item' | 'term';
export interface Card {
  cardId: string;
  workId: string;
  type: CardType;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  /** 弃用时间；弃用后默认隐藏，且不再注入 AI 上下文。 */
  deprecatedAt?: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  deletedAt: ISODate | null;
}

export interface OutlineNode {
  nodeId: string;
  workId: string;
  chapterId: string;
  title: string;
  summary: string;
  orderIndex: number;
  level: 1 | 2;
  parentId: string | null;
  seasonId?: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  deletedAt: ISODate | null;
}

export interface OutlineSeason {
  seasonId: string;
  volumeId: string;
  title: string;
  summary: string;
  orderIndex: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface OutlineSeasonChapterDraft {
  title: string;
  summary: string;
}

export interface OutlineSeasonDraft {
  title: string;
  summary: string;
  chapters: OutlineSeasonChapterDraft[];
}

export interface MasterOutline {
  content: string;
  updatedAt: ISODate;
}

export interface CardDraft {
  type: CardType;
  title: string;
  content: string;
  tags: string[];
}

export interface ContinuityScore {
  score: number;
  message: string;
}

export interface GeneratedChapterDraft {
  chapterId: string;
  title: string;
  text: string;
  continuity?: ContinuityScore;
}

export interface ReferenceExcerpt {
  fileName: string;
  charCount: number;
  excerpt: string;
}

export interface OutlineChapterDraft {
  title: string;
  summary: string;
}

export interface OutlineVolumeDraft {
  title: string;
  summary: string;
  chapters: OutlineChapterDraft[];
}

export interface OutlineDraft {
  master: string;
  volumes: OutlineVolumeDraft[];
  chapter: OutlineChapterDraft | null;
}

export interface Chapter {
  chapterId: string;
  workId: string;
  nodeId: string;
  title: string;
  wordCount: number;
  status: 'draft' | 'writing' | 'done';
  revision: number;
  locked?: boolean;
  lockedAt?: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  deletedAt: ISODate | null;
}

export interface ChapterLockResult {
  chapter: Chapter;
  created: string[];
}

export interface ChapterContent {
  chapter: Chapter;
  content: string;
}

export interface PromptTemplate {
  templateId: string;
  scene: AiScene;
  name: string;
  content: string;
  /** 适用与不适用场景说明，便于选择和检索。 */
  description?: string;
  /** 题材、风格、平台等检索标签。 */
  tags?: string[];
  temperature?: number;
  maxTokens?: number;
  isBuiltin: boolean;
  /** 被选择使用的次数，用于“热门”排序。 */
  usageCount?: number;
  /** 最近一次使用时间。 */
  lastUsedAt?: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseURL: string;
  apiKeyEnc: string;
  modelChat: string;
  isDefault: boolean;
  temperature: number;
  maxTokens: number;
}

export type PublicProvider = Omit<ProviderConfig, 'apiKeyEnc'> & { hasApiKey: boolean };
export interface ProviderInput extends Omit<ProviderConfig, 'id' | 'apiKeyEnc'> {
  id?: string;
  apiKey?: string;
}

export interface AppConfig {
  schemaVersion: 1;
  providers: ProviderConfig[];
  activeProviderId: string | null;
  settings: {
    showExportCompliance: boolean;
  };
}

export interface EventLog {
  ts: ISODate;
  event: string;
  [key: string]: unknown;
}

export interface SnapshotInfo {
  snapshotId: string;
  workId: string;
  chapterId: string;
  reason: 'pre_ai' | 'accepted' | 'manual' | 'rollback';
  createdAt: ISODate;
  wordCount: number;
}

export interface AiRequest {
  requestId: string;
  workId: string;
  chapterId: string;
  scene: Exclude<AiScene, 'outline' | 'consistency'>;
  cardIds: string[];
  templateId?: string;
  targetChars: number;
  selectedText?: string;
  baseRevision: number;
  strategy?: 'natural' | 'short' | 'colloquial' | 'voice';
  instruction?: string;
  /** 使用时手动填写的模板动态字段，系统变量优先。 */
  variables?: Record<string, string>;
}

/** 本地生成历史的场景，与 AiRequest 支持的场景保持一致。 */
export type GenerationKind = 'continue' | 'polish' | 'deai';

export interface GenerationRecord {
  generationId: string;
  kind: GenerationKind;
  /** 生成时所属的作品与章节，便于回溯。 */
  workId: string;
  workTitle: string;
  chapterId: string;
  chapterTitle: string;
  promptName: string;
  model: string;
  /** 模型返回的完整内容，仅保存在本机。 */
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  createdAt: ISODate;
}

export interface AiChunk { requestId: string; delta: string }
export interface AiDone {
  requestId: string;
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  continuity?: ContinuityScore;
}
export interface AiFailure { requestId: string; code: string; message: string }

export interface ConsistencyIssue {
  id: string;
  issueType: string;
  paragraph: string;
  cardTitle: string;
  explanation: string;
  suggestion: string;
}

export interface BookConsistencyIssue extends ConsistencyIssue {
  chapterId: string;
  chapterTitle: string;
}

export interface BookConsistencyResult {
  issues: BookConsistencyIssue[];
  checkedChapters: number;
}

export interface SearchReplaceHit {
  chapterId: string;
  chapterTitle: string;
  count: number;
  locked: boolean;
  previews: string[];
}

export interface SearchReplaceResult {
  keyword: string;
  totalCount: number;
  hits: SearchReplaceHit[];
  replacedChapters: number;
  skippedLocked: number;
}

export interface WorkStat {
  workId: string;
  wordCount: number;
  chapterCount: number;
  writtenChapterCount: number;
  lastChapterId: string | null;
  lastChapterTitle: string | null;
  lastActiveAt: ISODate | null;
}

export interface WorkspaceStats {
  totalWords: number;
  writingDays: number;
  streakDays: number;
  works: WorkStat[];
}

export interface FormatWorkResult {
  totalChapters: number;
  changedChapters: number;
  skippedLocked: number;
}

export interface RecoveryItem {
  id: string;
  workId: string;
  chapterId: string;
  filePath: string;
  content: string;
  modifiedAt: ISODate;
}

export interface AppInfo {
  version: string;
  dataDirectory: string;
  platform: string;
}
