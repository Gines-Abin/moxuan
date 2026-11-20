import { randomUUID } from 'node:crypto';
import type {
  AiRequest, AiScene, Card, CardDraft, CardType, Chapter, OutlineChapterDraft, OutlineSeasonDraft,
  OutlineVolumeDraft, PromptTemplate, Work,
} from '../shared/models';
import type { OutlineGenerateInput } from '../shared/ipc';
import { PROMPT_VARIABLE_PATTERN } from '../shared/utils/promptVars';
import { resolveCardReferences } from '../shared/utils/cardReferences';
import { extractJsonArray, extractJsonObject } from './ai';
import { ServiceError } from './errors';

export const builtinTemplates: PromptTemplate[] = [
  {
    templateId: 'builtin-continue',
    scene: 'continue',
    name: '续写正文',
    content: '请根据作品《{{workTitle}}》的设定与已有正文，自然续写第 {{chapterTitle}} 章。目标约 {{targetChars}} 字。\n\n【作品简介】\n{{workDescription}}\n\n【相关设定】\n{{cards}}\n\n【已有正文】\n{{content}}\n\n请仅输出续写内容，保持既有叙事视角、人物语气与时间线，不重复已有正文。',
    isBuiltin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    templateId: 'builtin-polish',
    scene: 'polish',
    name: '润色文字',
    content: '请润色《{{workTitle}}》第 {{chapterTitle}} 章中的下列文字。\n\n【相关设定】\n{{cards}}\n\n【待润色文字】\n{{selectedText}}\n\n请保留原意、事实、人称和叙事视角，改善节奏与表达，不增加新的剧情，不解释修改过程，仅输出润色后的文字。',
    isBuiltin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    templateId: 'builtin-deai',
    scene: 'deai',
    name: '降低 AI 痕迹',
    content: '请重写下列文字，使其更像自然的人类创作。采用 {{strategy}} 策略，减少模板化总结、机械排比、空泛形容和过度工整的句式。\n\n【相关设定】\n{{cards}}\n\n【原文】\n{{selectedText}}\n\n请保持事实、人物性格和剧情不变，仅输出重写后的文字。',
    isBuiltin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    templateId: 'builtin-consistency',
    scene: 'consistency',
    name: '设定一致性检查',
    content: '请检查《{{workTitle}}》正文与设定是否矛盾。\n\n【设定卡】\n{{cards}}\n\n【正文】\n{{content}}\n\n只报告有明确依据的矛盾，不评价文风。严格返回 JSON 数组，不要使用 Markdown 代码围栏，不要附加解释。每项必须包含 issueType、paragraph、cardTitle、explanation、suggestion 五个字符串字段；issueType 使用 character、world、plot、item、term 或 setting_conflict。',
    isBuiltin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
];

export function renderTemplate(content: string, variables: Record<string, string | number | undefined>): string {
  return content.replace(PROMPT_VARIABLE_PATTERN, (_match, key: string) => String(variables[key] ?? ''));
}

function workProfile(work: Work): string {
  const lines: string[] = [];
  if (work.style?.trim()) lines.push(`文风：${work.style.trim()}`);
  if (work.targetWords && work.targetWords > 0) lines.push(`目标字数：约 ${work.targetWords} 字`);
  if (work.platform?.trim()) lines.push(`发布平台：${work.platform.trim()}`);
  if (work.requirements?.trim()) lines.push(`补充要求：${work.requirements.trim()}`);
  return lines.length ? `【作品基础信息】\n${lines.join('\n')}` : '';
}

export function buildPrompt(
  request: AiRequest,
  template: PromptTemplate,
  work: Work,
  chapter: Chapter,
  content: string,
  cards: Card[],
  libraryCards: Card[] = cards,
): string {
  const selectedText = request.selectedText?.trim() || content;
  const strategyNames = { natural: '自然表达', short: '长短句交错', colloquial: '口语化', voice: '保留人物声线' } as const;
  const instruction = request.instruction?.trim();
  const prompt = resolveCardReferences(renderTemplate(template.content, {
    ...request.variables,
    workTitle: work.title,
    workDescription: work.description,
    workStyle: work.style ?? '',
    workTargetWords: work.targetWords ? String(work.targetWords) : '',
    workPlatform: work.platform ?? '',
    workRequirements: work.requirements ?? '',
    chapterTitle: chapter.title,
    content,
    selectedText,
    cards: cards.map((card) => `【${card.title}｜${card.type}】\n${card.content}`).join('\n\n'),
    targetChars: request.targetChars,
    strategy: strategyNames[request.strategy ?? 'natural'],
  }), libraryCards);
  const profile = workProfile(work);
  if (!instruction && !profile) return prompt;
  const sections = [prompt];
  if (profile) sections.push(profile);
  if (instruction) sections.push(`【补充要求】\n${instruction}\n请在不违背已有设定与既定事实的前提下执行以上要求。`);
  return sections.join('\n\n');
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function buildOutlinePrompt(input: OutlineGenerateInput): string {
  const title = input.title?.trim() || '未命名作品';
  const genre = input.genre?.trim() || '未指定类型';
  const brief = input.brief.trim();
  if (input.level === 'master') {
    const volumeCount = input.volumeCount ?? 3;
    const chapterCount = input.chapterCount ?? 8;
    return `请为下面的长篇小说项目生成一份可执行的故事总纲（全书最高层大纲）。\n\n【作品名】${title}\n【类型】${genre}\n【核心想法】${brief}\n【篇幅规划】预计 ${volumeCount} 卷，每卷约 ${chapterCount} 章\n${referenceBlock(input.reference)}\n输出要求：\n1. 先用一句话写清故事内核，再用 100 字左右说明主角的目标、最大阻碍和将付出的代价。\n2. 按开端、发展、高潮、结局拆出主线阶段，每阶段写清核心冲突与关键转折。\n3. 列出 3-6 个主要人物，写清各自目标、与主角的关系和可能的立场变化。\n4. 写清世界规则中最关键的约束，以及违反约束的后果。\n5. 最后给出 2-3 条贯穿全书的伏笔。\n6. 直接输出 Markdown，使用“## ”二级标题分节，不要输出 JSON，不要解释生成过程。`;
  }
  if (input.level === 'volume') {
    const volumeCount = input.volumeCount ?? 3;
    const chapterCount = input.chapterCount ?? 8;
    return `请把下面的故事总纲拆解为分卷与章节大纲。\n\n【作品名】${title}\n【类型】${genre}\n【核心想法】${brief}\n【故事总纲】\n${input.master?.trim() || '（暂无总纲，请依据核心想法自行规划主线）'}\n${referenceBlock(input.reference)}\n【本次生成】${volumeCount} 卷，每卷约 ${chapterCount} 章\n\n输出要求：\n1. 每卷包含 title、summary 和 chapters 数组；summary 写清本卷核心冲突、推进与卷末钩子，80-160 字。\n2. 每个章节包含 title（采用“第X章 · 标题”格式）与 summary（本章事件、冲突和结尾钩子，40-100 字）。\n3. 章节之间必须因果推进，不重复总纲原句，不使用“发生了一系列事件”这类空泛描述。\n4. 严格返回 JSON 数组，不要 Markdown 代码围栏，不要附加任何解释。结构示例：\n[{"title":"第一卷 · 卷名","summary":"...","chapters":[{"title":"第一章 · 章名","summary":"..."}]}]`;
  }
  return `请为《${title}》生成单章章纲。\n\n【类型】${genre}\n【核心想法】${brief}\n【所属分卷】${input.volumeTitle?.trim() || '未分卷'}\n【章节】${input.chapterTitle?.trim() || '待定'}\n【故事总纲】\n${input.master?.trim() || '（暂无总纲）'}\n\n输出要求：\n1. 只生成这一章的章纲，不扩写正文。\n2. summary 控制在 80-140 字，写清开场情境、冲突升级和结尾钩子。\n3. 严格返回 JSON 对象，不要 Markdown 代码围栏，不要附加解释。结构：{"title":"第X章 · 章名","summary":"..."}`;
}

export function parseMasterOutline(input: string): string {
  const content = input.replace(/```(?:markdown|md)?/gi, '').trim();
  if (!content) throw new ServiceError(502, '模型未返回有效的总纲内容', 'AI_INVALID_RESPONSE');
  return content;
}

export function parseVolumeDrafts(input: string): OutlineVolumeDraft[] {
  const volumes = extractJsonArray(input).flatMap((value) => {
    if (typeof value !== 'object' || value === null) return [];
    const record = value as Record<string, unknown>;
    const title = text(record.title);
    if (!title) return [];
    const chapters = (Array.isArray(record.chapters) ? record.chapters : []).flatMap((chapterValue) => {
      if (typeof chapterValue !== 'object' || chapterValue === null) return [];
      const chapter = chapterValue as Record<string, unknown>;
      const chapterTitle = text(chapter.title);
      return chapterTitle ? [{ title: chapterTitle, summary: text(chapter.summary) }] : [];
    });
    return [{ title, summary: text(record.summary), chapters }];
  });
  if (!volumes.length) throw new ServiceError(502, '模型未返回有效的分卷大纲', 'AI_INVALID_RESPONSE');
  return volumes;
}

export function parseChapterDraft(input: string): OutlineChapterDraft {
  const record = extractJsonObject(input);
  const title = text(record.title);
  if (!title) throw new ServiceError(502, '模型未返回有效的章纲', 'AI_INVALID_RESPONSE');
  return { title, summary: text(record.summary) };
}

export interface SeasonPromptInput {
  title: string;
  genre: string;
  brief: string;
  master: string;
  volumeTitle: string;
  instruction?: string;
  chapterCount?: number;
}

export function buildSeasonPrompt(input: SeasonPromptInput): string {
  const chapterCount = Math.min(12, Math.max(3, input.chapterCount ?? 6));
  return `请为《${input.title}》的分卷「${input.volumeTitle}」设计“季”级结构，把这一卷拆成若干季，并为每季安排章节。\n\n【类型】${input.genre || '未指定'}\n【核心想法】${input.brief}\n【故事总纲】\n${trimTo(input.master, 3000) || '（暂无总纲）'}\n${input.instruction ? `【补充要求】${input.instruction}\n` : ''}\n输出要求：\n1. 每季包含 title、summary 和 chapters 数组。summary 写清本季的阶段目标、主要冲突和季末转折，60-120 字。\n2. 每季章节数量约 ${chapterCount} 章，最多 12 章；章节包含 title（采用“第X章 · 标题”格式）与 summary（40-100 字）。\n3. 各季之间必须递进，不重复已有情节，不写“发生了一系列事件”这类空泛内容。\n4. 严格返回 JSON 数组，不要 Markdown 代码围栏，不要附加解释。结构示例：\n[{"title":"第一季 · 暗潮初起","summary":"...","chapters":[{"title":"第一章 · 灯塔熄灭","summary":"..."}]}]`;
}

export function parseSeasonDrafts(input: string): OutlineSeasonDraft[] {
  const seasons = extractJsonArray(input).flatMap((value) => {
    if (typeof value !== 'object' || value === null) return [];
    const record = value as Record<string, unknown>;
    const title = text(record.title);
    if (!title) return [];
    const chapters = (Array.isArray(record.chapters) ? record.chapters : []).flatMap((chapterValue) => {
      if (typeof chapterValue !== 'object' || chapterValue === null) return [];
      const chapter = chapterValue as Record<string, unknown>;
      const chapterTitle = text(chapter.title);
      return chapterTitle ? [{ title: chapterTitle, summary: text(chapter.summary) }] : [];
    }).slice(0, 12);
    return [{ title, summary: text(record.summary), chapters }];
  });
  if (!seasons.length) throw new ServiceError(502, '模型未返回有效的季规划', 'AI_INVALID_RESPONSE');
  return seasons.slice(0, 8);
}

export function buildCharacterExtractPrompt(work: Work, chapterTitle: string, content: string): string {
  return `请从下面的小说正文中提取出现的有名角色（不包括泛指、称呼和未命名人物）。\n\n【作品】《${work.title}》\n【章节】${chapterTitle}\n【正文】\n${trimTo(content, 4000)}\n\n输出要求：\n1. 只输出角色姓名，最多 20 个，去重，保留正文中的写法。\n2. 严格返回 JSON 字符串数组，不要 Markdown 代码围栏，不要附加解释。结构示例：["沈砚","林晚"]`;
}

export function parseCharacterNames(input: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of extractJsonArray(input)) {
    const name = typeof value === 'string'
      ? value.trim()
      : typeof value === 'object' && value !== null
        ? text((value as Record<string, unknown>).name) || text((value as Record<string, unknown>).title)
        : '';
    if (!name || name.length > 20 || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= 20) break;
  }
  if (!names.length) throw new ServiceError(502, '模型未返回有效的角色名', 'AI_INVALID_RESPONSE');
  return names;
}

const CARD_TYPES: CardType[] = ['character', 'world', 'plot', 'item', 'term'];
const trimTo = (value: string, limit: number): string => value.length > limit ? `${value.slice(0, limit)}……` : value;

function referenceBlock(reference?: string): string {
  const excerpt = reference?.trim();
  if (!excerpt) return '';
  return `\n【参考作品片段（仅用于分析题材定位、节奏与结构；禁止复制原文句子、专有名词、人物名）】\n${trimTo(excerpt, 6000)}\n`;
}

export function buildCardPrompt(
  work: Work, master: string, existingTitles: string[], categories: CardType[], instruction: string, count: number,
  chapterText?: string,
): string {
  const types = categories.filter((type) => CARD_TYPES.includes(type));
  const visual = [
    work.visualRatio && `画幅 ${work.visualRatio}`,
    work.visualStyle && `画风 ${work.visualStyle}`,
    work.visualNotes && `视觉备注 ${work.visualNotes}`,
  ].filter(Boolean).join('；');
  const chapter = chapterText?.trim();
  const task = chapter
    ? '请从下面这部作品的本章正文中提取可直接使用的角色、场景、道具等设定资料。'
    : '请为下面这部作品补齐可直接使用的设定资料。';
  const chapterBlock = chapter
    ? `\n【本章正文（只从此处提取，不得新增未出现的人物、场景或道具）】\n${trimTo(chapter, 6000)}\n`
    : '';
  return `你是资深网文策划编辑，${task}\n\n【作品】《${work.title}》\n【类型】${work.genre || '未指定'}\n【作品简介】${work.description || '（暂无）'}${workProfile(work) ? `\n${workProfile(work)}` : ''}${visual ? `\n【视觉改编设定】${visual}` : ''}\n【故事总纲】\n${trimTo(master, 3000) || '（暂无总纲，请依据作品简介合理补全）'}\n${chapterBlock}\n【已有设定】${existingTitles.length ? existingTitles.join('、') : '（暂无）'}\n【本次生成】${count} 条，类型限定：${(types.length ? types : CARD_TYPES).join('、')}\n${instruction ? `【补充要求】${instruction}\n` : ''}\n输出要求：\n1. 每条包含 type、title、content、tags：type 只能取 character / world / plot / item / term；content 用 120-260 字写清可执行细节；tags 为 2-4 个短标签。\n2. character 卡的 content 必须使用“标签：正文”分行格式，标签固定为 身份、性格、背景、能力、外貌、目标、关系，每行写具体事实；world 卡写清模块名与规则代价，若写修炼体系则注明总览、层级（从低到高）、晋升条件、硬规则。\n3. 不重复已有设定；人物写清目标、阻碍、秘密与说话方式；世界写清规则与代价；plot 写清伏笔或事件链。\n4. 与总纲保持一致，不要另起主线${chapter ? '；场景与道具的外观描述要贴合视觉改编设定' : ''}。\n5. 严格返回 JSON 数组，不要 Markdown 代码围栏，不要解释。结构示例：\n[{"type":"character","title":"沈砚","content":"身份：守夜人\\n性格：沉默、执拗\\n背景：幼年随姐姐迁入潮汐城\\n能力：能在退潮时听见礁石下的回声\\n外貌：右手旧伤，常穿深色雨衣\\n目标：查明姐姐失踪的真相\\n关系：与林晚亦敌亦友","tags":["主角","守夜人"]}]`;
}

export function parseCardDrafts(input: string): CardDraft[] {
  const drafts = extractJsonArray(input).flatMap((value) => {
    if (typeof value !== 'object' || value === null) return [];
    const record = value as Record<string, unknown>;
    const title = text(record.title);
    const content = text(record.content);
    if (!title || !content) return [];
    const type = CARD_TYPES.includes(record.type as CardType) ? record.type as CardType : 'world';
    const tags = Array.isArray(record.tags)
      ? record.tags.map((tag) => text(tag)).filter(Boolean).slice(0, 6)
      : [];
    return [{ type, title, content, tags }];
  });
  if (!drafts.length) throw new ServiceError(502, '模型未返回有效的设定资料', 'AI_INVALID_RESPONSE');
  return drafts.slice(0, 30);
}

export interface DraftPromptInput {
  mode: 'golden-three' | 'continue';
  work: Work;
  chapterTitle: string;
  outlineSummary: string;
  volumeTitle: string;
  master: string;
  cards: Card[];
  previousText: string;
  instruction?: string;
  targetChars: number;
}

/** 取上一章结尾的最后几段，作为续写的衔接锚点。 */
function draftAnchor(previousText: string): string {
  const trimmed = previousText.trim();
  if (!trimmed) return '';
  const paragraphs = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return trimTo(paragraphs.slice(-3).join('\n'), 800);
}

export function buildDraftPrompt(input: DraftPromptInput): string {
  const cards = input.cards
    .slice(0, 8)
    .map((card) => `【${card.title}｜${card.type}】${trimTo(card.content, 300)}`)
    .join('\n');
  const anchor = draftAnchor(input.previousText);
  return `你是网络小说作者，请直接写出下面章节的正文。\n\n【作品】《${input.work.title}》｜${input.work.genre || '未指定类型'}\n【作品简介】${input.work.description || '（暂无）'}${workProfile(input.work) ? `\n${workProfile(input.work)}` : ''}\n【故事总纲】\n${trimTo(input.master, 3000) || '（暂无总纲）'}\n【设定卡】\n${cards || '（暂无）'}\n\n【所属分卷】${input.volumeTitle || '未分卷'}\n【本章】${input.chapterTitle}\n【本章章纲】${input.outlineSummary || '（暂无章纲，请依据总纲与前文自行推进）'}\n【上一章结尾原文（衔接锚点）】\n${anchor || '（本章为开篇，无前文）'}\n${input.instruction ? `【补充要求】${input.instruction}\n` : ''}\n输出要求：\n1. 只输出正文，不要重复章节标题，不要写“好的”“以下是”，不要解释创作思路。\n2. 约 ${input.targetChars} 字，中文书面语，保持人物声线与世界规则一致。\n3. 有场景、动作、对话和情绪推进，结尾留下让读者继续读的钩子。\n4. 不要照抄设定卡或参考作品原文。\n5. 【衔接硬规则】正文第一段必须紧接「衔接锚点」的最后一句续写：保持同一时间、同一地点、同一在场人物，先接住上一章的动作、对话或情绪，再推进本章新事件。\n   - 落笔点：第一句要用锚点最后一句里出现的人物、物品或动作起笔，人名、道具名与动作词保持一致；第一句禁止以“那”“这”“他”“她”“它”开头，必须直接写出具体人名、地名或物品名。\n   - 禁止用“与此同时”“另一边”“三天后”“数日后”“话说”等跳场景或跳时间的开场。\n   - 禁止在开头总结、复述或点评上一章内容。\n   - 若本章章纲要求切换场景，必须先用 1-2 句写清人物如何离开上一场景、如何到达新场景，再展开冲突。${input.mode === 'golden-three' ? '\n6. 这是开篇黄金三章之一：首章尽快建立主角目标与核心悬念，三章内完成第一次有效冲突。' : ''}`;
}

export function parseDraftText(input: string): string {
  const cleaned = input
    .replace(/```(?:markdown|md|text)?/gi, '')
    .replace(/^\s*#*\s*第[一二三四五六七八九十百千0-9]+章[^\n]*\n+/u, '')
    .trim();
  if (!cleaned) throw new ServiceError(502, '模型未返回有效的正文内容', 'AI_INVALID_RESPONSE');
  return cleaned;
}

export function normalizeImportedTemplates(value: unknown): PromptTemplate[] {  const candidate = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as { templates?: unknown }).templates)
      ? (value as { templates: PromptTemplate[] }).templates
      : null;
  if (!candidate) throw new Error('提示词文件格式不正确');

  return candidate.map((item) => {
    if (typeof item !== 'object' || item === null) throw new Error('提示词文件包含无效条目');
    const raw = item as Partial<PromptTemplate>;
    const scenes: AiScene[] = ['continue', 'polish', 'deai', 'outline', 'consistency'];
    if (typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.content !== 'string' || !raw.content.trim() || !scenes.includes(raw.scene as AiScene)) {
      throw new Error('提示词文件缺少必要字段');
    }
    const now = new Date().toISOString();
    return {
      templateId: randomUUID(),
      scene: raw.scene as AiScene,
      name: raw.name.trim(),
      content: raw.content,
      description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
      tags: Array.isArray(raw.tags)
        ? raw.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())).map((tag) => tag.trim())
        : [],
      temperature: typeof raw.temperature === 'number' ? raw.temperature : undefined,
      maxTokens: typeof raw.maxTokens === 'number' ? raw.maxTokens : undefined,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now,
    };
  });
}
