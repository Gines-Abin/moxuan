import type { Card, CardType, OutlineNode, Work } from '../models';

const CARD_GROUPS: Array<{ type: CardType; label: string }> = [
  { type: 'character', label: '角色' },
  { type: 'world', label: '世界观与场景' },
  { type: 'item', label: '道具' },
  { type: 'plot', label: '情节线索' },
  { type: 'term', label: '术语' },
];

function line(value: string | undefined, fallback = '未填写'): string {
  return value?.trim() || fallback;
}

/** 把作品资料、总纲、设定卡、章节清单与可选正文整理成可交给漫剧/短剧改编工具的资料包。 */
export function formatAdaptationPack(input: {
  work: Work;
  master: string;
  cards: Card[];
  outline: OutlineNode[];
  chapters?: Array<{ title: string; content: string }>;
  generatedAt?: Date;
}): string {
  const { work, master, cards, outline } = input;
  const timestamp = input.generatedAt ?? new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = `${timestamp.getFullYear()}-${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())} ${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}`;
  const activeCards = cards.filter((card) => !card.deprecatedAt);
  const sections: string[] = [
    `# 《${work.title}》改编资料包`,
    '',
    `> 由墨轩 MoXuan 生成于 ${date}`,
    '',
    '## 一、作品信息',
    `- 分类：${line(work.genre)}`,
    `- 简介：${line(work.description)}`,
    `- 文风：${line(work.style)}`,
    `- 目标字数：${work.targetWords ? `${work.targetWords} 字` : '未填写'}`,
    `- 发布平台：${line(work.platform)}`,
    `- 画幅比例：${line(work.visualRatio)}`,
    `- 画风预设：${line(work.visualStyle)}`,
    `- 视觉备注：${line(work.visualNotes)}`,
    `- 补充要求：${line(work.requirements)}`,
    '',
    '## 二、短剧改编提示词',
    '> 同一项目请固定使用这一条提示词，避免逐集换风格。',
    '',
    `你是短剧编剧。请把《${work.title}》中“选中章节”的正文改编为分集短剧剧本。`,
    '',
    '硬规则：',
    '1. 按 1-3 分钟一集拆分，每集只保留一个核心冲突，结尾留钩子。',
    '2. 统一使用第三人称与现在时态；对白口语化，避免小说化心理描写。',
    '3. 场景标题统一格式：第X集 / 场次 / 内景或外景 / 地点 / 日或夜。',
    '4. 人物、地点、道具名称与下方资料一致，不新增未铺垫的主线。',
    '5. 每集输出：标题、出场人物、场景列表、剧本正文（动作 + 对白）。',
    '6. 只改编选中章节，不续写原著未发生的情节。',
    '',
    '## 三、故事总纲',
    master.trim() || '（暂无总纲）',
    '',
    '## 四、资产清单',
  ];

  for (const group of CARD_GROUPS) {
    const items = activeCards.filter((card) => card.type === group.type);
    sections.push('', `### ${group.label}（${items.length}）`);
    if (!items.length) {
      sections.push('（暂无）');
      continue;
    }
    for (const card of items) {
      const tags = card.tags.length ? `（${card.tags.join('、')}）` : '';
      sections.push(`- **${card.title}**${tags}`);
      for (const contentLine of card.content.trim().split(/\r?\n/)) {
        sections.push(`  ${contentLine}`);
      }
    }
  }

  sections.push('', '## 五、章节清单');
  const nodes = [...outline].sort((a, b) => a.orderIndex - b.orderIndex);
  if (!nodes.length) {
    sections.push('（暂无章节）');
  } else {
    for (const node of nodes) {
      const indent = '  '.repeat(Math.max(0, node.level - 1));
      const summary = node.summary?.trim() ? `：${node.summary.trim()}` : '';
      sections.push(`${indent}- ${node.title}${summary}`);
    }
  }

  if (input.chapters?.length) {
    sections.push('', '## 六、所选章节正文');
    for (const chapter of input.chapters) {
      sections.push('', `### ${chapter.title}`, '', chapter.content.trim() || '（本章暂无正文）');
    }
  }

  sections.push('', '---', '说明：本资料包只包含文本资料，不包含分镜图、视频或音频素材。');
  return `${sections.join('\n')}\n`;
}
