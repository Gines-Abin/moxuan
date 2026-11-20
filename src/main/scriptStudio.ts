import type { ScriptEpisode, ScriptIdea, ScriptProject } from '../shared/models';
import { stripMarkdown } from '../shared/utils/countVisibleChars';
import { extractJsonArray, extractJsonObject } from './ai';
import { ServiceError } from './errors';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const trimTo = (value: string, limit: number): string => value.length > limit ? `${value.slice(0, limit)}……` : value;

/** Step1：根据元素生成多条短剧创意。 */
export function buildScriptIdeaPrompt(input: {
  title: string;
  genre: string;
  elements: string[];
  instruction?: string;
  count?: number;
}): string {
  const count = Math.min(6, Math.max(2, input.count ?? 4));
  const elements = input.elements.length ? input.elements.join('、') : '未指定';
  const instruction = input.instruction?.trim() ? `【补充想法】${input.instruction.trim()}\n` : '';
  return `【短剧创意任务】
请为短剧《${input.title}》生成 ${count} 条可选创意。

【类型】${input.genre || '未指定'}
【元素】${elements}
${instruction}
输出要求：
1. 每条创意包含 title（不超过 12 字）、logline（一句话卖点）与 synopsis（80-120 字剧情梗概）。
2. 创意之间方向必须不同，至少覆盖不同的主角身份或核心冲突，不要同义改写。
3. 符合 1-3 分钟一集、强冲突、快节奏、结尾留钩子的短剧形态。
4. 严格返回 JSON 数组，不要 Markdown 代码围栏，不要附加解释。结构示例：
[{"title":"离婚当天，我继承了整座城","logline":"被扫地出门的她，转身成了债主。","synopsis":"..."}]`;
}

export function parseScriptIdeas(input: string): Array<Pick<ScriptIdea, 'title' | 'logline' | 'synopsis'>> {
  let values: unknown[];
  try {
    values = extractJsonArray(input);
  } catch {
    throw new ServiceError(502, '模型未返回有效的短剧创意', 'AI_INVALID_RESPONSE');
  }
  const ideas = values.flatMap((value) => {
    if (typeof value !== 'object' || value === null) return [];
    const record = value as Record<string, unknown>;
    const title = text(record.title);
    if (!title) return [];
    return [{ title, logline: text(record.logline), synopsis: text(record.synopsis) }];
  });
  if (!ideas.length) throw new ServiceError(502, '模型未返回有效的短剧创意', 'AI_INVALID_RESPONSE');
  return ideas.slice(0, 6);
}

/** Step2：把选定创意扩展为总纲与分集规划。 */
export function buildScriptOutlinePrompt(input: {
  title: string;
  genre: string;
  elements: string[];
  idea: ScriptIdea;
  episodeCount: number;
}): string {
  const count = Math.min(100, Math.max(1, input.episodeCount));
  return `【分集大纲任务】
请把下面选定的短剧创意扩展为 ${count} 集的分集大纲。

【剧名】${input.title}
【类型】${input.genre || '未指定'}
【元素】${input.elements.length ? input.elements.join('、') : '未指定'}
【已选创意】
标题：${input.idea.title}
一句话卖点：${input.idea.logline || '无'}
剧情梗概：${input.idea.synopsis || '无'}

输出要求：
1. totalOutline 写全剧总纲，包含主线目标、阶段推进、主要人物关系与结局钩子，300-500 字。
2. episodes 数组必须给出 ${count} 集，每集包含 title（采用“第X集 · 标题”格式）与 summary（40-80 字，写清本集核心冲突与结尾钩子）。
3. 每集只推进一个核心事件，前后集因果清晰，不重复情节。
4. 严格返回 JSON 对象，不要 Markdown 代码围栏，不要附加解释。结构示例：
{"totalOutline":"...","episodes":[{"title":"第1集 · 离婚当天","summary":"..."}]}`;
}

export function parseScriptOutline(input: string, episodeCount: number): {
  masterOutline: string;
  episodes: Array<Pick<ScriptEpisode, 'title' | 'summary'>>;
} {
  const record = (() => {
    try {
      return extractJsonObject(input);
    } catch {
      throw new ServiceError(502, '模型未返回有效的分集大纲', 'AI_INVALID_RESPONSE');
    }
  })();
  const masterOutline = text(record.totalOutline) || text(record.masterOutline) || text(record.master);
  const rawEpisodes = Array.isArray(record.episodes) ? record.episodes : [];
  const episodes = rawEpisodes.flatMap((value, index) => {
    if (typeof value !== 'object' || value === null) return [];
    const episode = value as Record<string, unknown>;
    const title = text(episode.title) || `第${index + 1}集`;
    return [{ title, summary: text(episode.summary) }];
  }).slice(0, Math.min(100, Math.max(1, episodeCount)));
  if (!masterOutline || !episodes.length) {
    throw new ServiceError(502, '模型未返回有效的分集大纲', 'AI_INVALID_RESPONSE');
  }
  return { masterOutline, episodes };
}

/** Step3：生成单集剧本正文。 */
export function buildScriptEpisodePrompt(input: {
  project: ScriptProject;
  idea: ScriptIdea;
  episode: ScriptEpisode;
  previousTail?: string;
}): string {
  const { project, idea, episode } = input;
  const previous = input.previousTail?.trim()
    ? `【上一集结尾（用于承接，不要重复）】\n${trimTo(input.previousTail.trim(), 600)}\n`
    : '';
  return `【单集剧本任务】
请写出短剧《${project.title}》第 ${episode.index} 集的完整剧本。

【类型】${project.genre || '未指定'}
【元素】${project.elements.length ? project.elements.join('、') : '未指定'}
【全剧创意】${idea.title}
【剧情梗概】${trimTo(idea.synopsis || idea.logline || '无', 500)}
【全剧总纲】
${trimTo(project.masterOutline, 2000)}
【本集大纲】
${episode.title}
${episode.summary}
${previous}
输出要求：
1. 本集正文约 1200-1800 字，按 1-3 分钟短剧节奏，只写一个核心冲突，结尾留钩子。
2. 使用剧本格式：先写场景标题（第X集 / 场次 / 内景或外景 / 地点 / 日或夜），再写动作与对白。
3. 对白口语化，避免小说化心理描写和旁白解释。
4. 人物、地点、道具名称全剧统一，不新增未铺垫的主线。
5. 只输出本集剧本正文，不要 JSON、代码围栏或创作说明。`;
}

/** 导出剧本：按集排序，仅包含已有正文的分集。 */
export function formatScriptDocument(project: ScriptProject, options: {
  episodeIndexes?: number[];
  format: 'md' | 'txt';
  generatedAt?: Date;
}): string {
  const selected = options.episodeIndexes?.length
    ? project.episodes.filter((episode) => options.episodeIndexes?.includes(episode.index))
    : project.episodes.filter((episode) => episode.content.trim());
  const episodes = [...selected].sort((a, b) => a.index - b.index).filter((episode) => episode.content.trim());
  if (!episodes.length) throw new ServiceError(400, '所选分集还没有正文');
  const timestamp = options.generatedAt ?? new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = `${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())} ${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}`;
  const idea = project.ideas.find((item) => item.ideaId === project.selectedIdeaId);
  const sections: string[] = [
    `# 《${project.title}》分集剧本`,
    '',
    `> 由墨轩 MoXuan 生成于 ${date}`,
    '',
    '## 一、项目信息',
    `- 类型：${project.genre || '未填写'}`,
    `- 元素：${project.elements.length ? project.elements.join('、') : '未填写'}`,
    `- 集数：共 ${project.episodes.length} 集，本文件导出 ${episodes.length} 集`,
  ];
  if (idea) {
    sections.push('', '## 二、选定创意', `- 标题：${idea.title}`, `- 一句话卖点：${idea.logline || '未填写'}`, `- 剧情梗概：${idea.synopsis || '未填写'}`);
  }
  sections.push('', '## 三、全剧总纲', project.masterOutline.trim() || '（暂无总纲）', '', '## 四、分集正文');
  for (const episode of episodes) {
    sections.push('', `### ${episode.title}`, '');
    if (episode.summary.trim()) sections.push(`> 本集大纲：${episode.summary.trim()}`, '');
    sections.push(episode.content.trim() || '（本集暂无正文）');
  }
  sections.push('', '---', '说明：本文件为本地生成的短剧文本，不含分镜图、视频、音频或字幕文件。');
  const document = `${sections.join('\n')}\n`;
  return options.format === 'txt' ? stripMarkdown(document) : document;
}
