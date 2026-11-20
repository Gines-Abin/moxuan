import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { scoreContinuity } from '../../src/shared/utils/continuity';
import { splitChapters } from '../../src/shared/utils/importText';
import {
  CHARACTER_FIELDS, emptyCharacterFields, parseCharacterContent, serializeCharacterContent,
} from '../../src/shared/utils/characterCard';
import {
  buildCardPrompt, buildCharacterExtractPrompt, buildPrompt, buildSeasonPrompt, parseCharacterNames, parseSeasonDrafts,
} from '../../src/main/promptTemplates';
import { countMatches, previewMatches } from '../../src/shared/utils/searchReplace';
import { formatManuscript, hasManuscriptChanges } from '../../src/shared/utils/manuscript';
import { parseCardImport } from '../../src/shared/utils/cardImport';
import { extractDocxText } from '../../src/main/docxImport';
import { calculateStreak, formatWordCount, localDayKey } from '../../src/shared/utils/stats';
import {
  countPromptVariables, extractDynamicPromptVariables, extractPromptVariables, extractSystemPromptVariables,
} from '../../src/shared/utils/promptVars';

describe('接力评分', () => {
  it('首章无前文给满分', () => {
    expect(scoreContinuity('', '第一章正文')).toEqual({ score: 10, message: '首章无前文' });
  });

  it('开场复现上一章结尾关键词时评分更高', () => {
    const previous = '他在灯塔下停住脚步，听见礁石深处传来姐姐的声音。';
    const connected = scoreContinuity(previous, '灯塔下，礁石深处又一次传来姐姐的声音，他握紧了手电。');
    const disconnected = scoreContinuity(previous, '三个月后，北方的雪原上，一列货车缓缓停下。');
    expect(connected.score).toBeGreaterThan(disconnected.score);
    expect(connected.score).toBeGreaterThanOrEqual(4);
    expect(disconnected.message).toContain('未明显承接');
  });

  it('开场直接复现上一章结尾原句时给出承接加分', () => {
    const previous = '脚步声停在门后。手机屏幕亮起，发件人是他自己的号码，内容只有四个字：“别回头，跑。”';
    const pickup = scoreContinuity(previous, '“别回头，跑。”沈砚盯着屏幕，脚底的石板缝里正往外渗水。');
    const jump = scoreContinuity(previous, '三个月后，北方的雪原上，一列货车缓缓停下。');
    expect(pickup.score).toBeGreaterThanOrEqual(5);
    expect(pickup.score).toBeGreaterThan(jump.score);
    expect(pickup.message).toContain('直接承接');
  });

  it('空稿返回 0 分提示', () => {
    expect(scoreContinuity('上一章正文', '   ').score).toBe(0);
  });
});

describe('整书导入分章', () => {
  it('识别第X章标题并保留正文', () => {
    const chapters = splitChapters('书名\n\n第一章 潮声\n沈砚走进灯塔。\n\n第二章 回声\n礁石在响。');
    expect(chapters).toEqual([
      { title: '第一章 潮声', content: '书名\n\n沈砚走进灯塔。' },
      { title: '第二章 回声', content: '礁石在响。' },
    ]);
  });

  it('识别 Markdown 标题', () => {
    const chapters = splitChapters('# 序章\n海风很咸。\n\n## 第一章 失踪\n姐姐没有回来。');
    expect(chapters.map((chapter) => chapter.title)).toEqual(['序章', '第一章 失踪']);
  });

  it('识别回、节、幕、场、话标题', () => {
    const chapters = splitChapters('第一回 归潮\n正文一。\n\n第二节 灯塔\n正文二。\n\n第三幕 对峙\n正文三。\n\n第四场 雨夜\n正文四。\n\n第五话 回声\n正文五。');
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      '第一回 归潮', '第二节 灯塔', '第三幕 对峙', '第四场 雨夜', '第五话 回声',
    ]);
    expect(chapters.map((chapter) => chapter.content)).toEqual(['正文一。', '正文二。', '正文三。', '正文四。', '正文五。']);
  });

  it('无标题时退化为单章', () => {
    expect(splitChapters('只有一段正文。')).toEqual([{ title: '全文', content: '只有一段正文。' }]);
    expect(splitChapters('   ')).toEqual([]);
  });
});

describe('角色卡字段', () => {
  it('按标签解析与序列化，未知行归入背景', () => {
    const fields = emptyCharacterFields();
    fields.身份 = '守夜人';
    fields.性格 = '沉默、执拗';
    fields.背景 = '幼年迁入潮汐城';
    const serialized = serializeCharacterContent(fields);
    expect(serialized.split('\n')).toHaveLength(3);
    const parsed = parseCharacterContent(`${serialized}\n喜欢雨夜。`);
    expect(parsed.身份).toBe('守夜人');
    expect(parsed.背景).toContain('喜欢雨夜。');
    expect(CHARACTER_FIELDS).toContain('关系');
    expect(parseCharacterContent('无标签的旧设定').背景).toBe('无标签的旧设定');
  });
});

describe('季规划提示词与解析', () => {
  it('提示词包含分卷名与章节数量约束', () => {
    const prompt = buildSeasonPrompt({
      title: '潮汐尽头', genre: '悬疑', brief: '寻找姐姐', master: '总纲', volumeTitle: '第一卷 · 暗潮', chapterCount: 4,
    });
    expect(prompt).toContain('第一卷 · 暗潮');
    expect(prompt).toContain('约 4 章');
    expect(prompt).toContain('JSON 数组');
  });

  it('解析代码围栏中的季规划并限制上限', () => {
    const drafts = parseSeasonDrafts('```json\n[{"title":"第一季 · 暗潮","summary":"季摘要","chapters":[{"title":"第一章 · 灯塔","summary":"章摘要"},{"title":""}]},{"title":""}]\n```');
    expect(drafts).toEqual([
      { title: '第一季 · 暗潮', summary: '季摘要', chapters: [{ title: '第一章 · 灯塔', summary: '章摘要' }] },
    ]);
    const many = Array.from({ length: 10 }, (_, index) => ({
      title: `第${index + 1}季`, summary: '', chapters: Array.from({ length: 15 }, (_, chapterIndex) => ({
        title: `第${chapterIndex + 1}章`, summary: '',
      })),
    }));
    const limited = parseSeasonDrafts(JSON.stringify(many));
    expect(limited).toHaveLength(8);
    expect(limited[0].chapters).toHaveLength(12);
  });

  it('无有效季时抛出 502', () => {
    expect(() => parseSeasonDrafts('[]')).toThrowError('模型未返回有效的季规划');
  });
});

describe('锁定章节时的人物提取', () => {
  it('提示词包含章节正文，解析去重并限制数量', () => {
    const prompt = buildCharacterExtractPrompt(
      { workId: 'w', title: '潮汐尽头', genre: '', description: '', status: 'active', createdAt: '', updatedAt: '', deletedAt: null },
      '第一章 潮声', '沈砚与林晚在灯塔相遇。',
    );
    expect(prompt).toContain('沈砚与林晚');
    expect(parseCharacterNames('["沈砚","林晚","沈砚","林晚"]')).toEqual(['沈砚', '林晚']);
  });
});

describe('AI 补充要求', () => {
  const template = {
    templateId: 'test', scene: 'continue' as const, name: '测试模板', content: '《{{workTitle}}》{{chapterTitle}}\n{{content}}',
    isBuiltin: false, createdAt: '', updatedAt: '',
  };
  const work = {
    workId: 'w', title: '潮汐尽头', genre: '', description: '', status: 'active' as const,
    createdAt: '', updatedAt: '', deletedAt: null,
  };
  const chapter = {
    chapterId: 'c', workId: 'w', nodeId: 'n', title: '第一章', wordCount: 0, status: 'draft' as const,
    revision: 0, createdAt: '', updatedAt: '', deletedAt: null,
  };
  const request = {
    requestId: 'r', workId: 'w', chapterId: 'c', scene: 'continue' as const, cardIds: [], targetChars: 800,
    baseRevision: 0, instruction: '加强雨夜的压抑感',
  };

  it('有补充要求时追加到提示词末尾', () => {
    const prompt = buildPrompt(request, template, work, chapter, '正文', []);
    expect(prompt).toContain('【补充要求】\n加强雨夜的压抑感');
  });

  it('补充要求为空时不追加', () => {
    expect(buildPrompt({ ...request, instruction: '   ' }, template, work, chapter, '正文', [])).not.toContain('补充要求');
    expect(buildPrompt({ ...request, instruction: undefined }, template, work, chapter, '正文', [])).not.toContain('补充要求');
  });

  it('填入文风、目标字数、平台与要求后注入作品基础信息', () => {
    const rich = {
      ...work, style: '第一人称限知', targetWords: 200000, platform: '起点中文网', requirements: '不新增设定',
    };
    const prompt = buildPrompt(request, template, rich, chapter, '正文', []);
    expect(prompt).toContain('【作品基础信息】');
    expect(prompt).toContain('文风：第一人称限知');
    expect(prompt).toContain('目标字数：约 200000 字');
    expect(prompt).toContain('发布平台：起点中文网');
    expect(prompt).toContain('补充要求：不新增设定');
  });

  it('基础信息留空时不产生空段落', () => {
    expect(buildPrompt(request, template, work, chapter, '正文', [])).not.toContain('【作品基础信息】');
  });

  it('章节提取提示词包含正文、视觉设定与只提取约束', () => {
    const prompt = buildCardPrompt(
      { ...work, visualRatio: '9:16', visualStyle: '国风厚涂' }, '', [],
      ['character', 'world', 'item'], '', 8, '雨夜，沈砚在灯塔遇见林晚。',
    );
    expect(prompt).toContain('只从此处提取');
    expect(prompt).toContain('画幅 9:16');
    expect(prompt).toContain('国风厚涂');
    expect(prompt).toContain('雨夜，沈砚在灯塔遇见林晚。');
  });

  it('注入用户填写的动态字段，系统变量优先', () => {
    const custom = { ...template, content: '《{{workTitle}}》按{{文风偏好}}续写' };
    const prompt = buildPrompt(
      { ...request, variables: { 文风偏好: '冷峻', workTitle: '被覆盖' } },
      custom, work, chapter, '正文', [],
    );
    expect(prompt).toContain('《潮汐尽头》按冷峻续写');
  });
});

describe('全局查找替换工具', () => {
  it('统计命中并可切换大小写', () => {
    expect(countMatches('雨夜里又想起雨夜', '雨夜')).toBe(2);
    expect(countMatches('Rain rain RAIN', 'rain', true)).toBe(1);
    expect(countMatches('Rain rain RAIN', 'rain', false)).toBe(3);
    expect(countMatches('没有命中', '雨夜')).toBe(0);
  });

  it('预览按行提取并截断过长文本', () => {
    const content = '第一段\n他走进雨夜，雨很大\n第三段\n雨夜结束';
    expect(previewMatches(content, '雨夜')).toEqual(['他走进雨夜，雨很大', '雨夜结束']);
    const longLine = `雨夜${'很长'.repeat(60)}`;
    const preview = previewMatches(longLine, '雨夜')[0];
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBe(81);
  });
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32Of(buffer: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildDocxZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data);
    const checksum = crc32Of(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, compressed);
    centrals.push(central, nameBuffer);
    offset += 30 + nameBuffer.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

describe('正文智能排版', () => {
  it('清理行尾空格、全角缩进与多余空行', () => {
    expect(formatManuscript('\uFEFF第一段  \r\n\u3000\u3000第二段\t\r\n\r\n\r\n\r\n第三段\u3000\u3000'))
      .toBe('第一段\n第二段\n\n第三段');
  });

  it('保留 Markdown 列表缩进与代码块内容', () => {
    const input = '  - 列表项\n    续行\n```\n  code\n```';
    expect(formatManuscript(input)).toBe(input);
    expect(hasManuscriptChanges(input)).toBe(false);
  });
});

describe('设定卡批量导入解析', () => {
  it('按 --- 或 === 分隔，首行为标题', () => {
    const cards = parseCardImport('沈砚\n身份：主角\n---\n# 林晚\n身份：守夜人\n===\n只有标题');
    expect(cards).toEqual([
      { title: '沈砚', content: '身份：主角' },
      { title: '林晚', content: '身份：守夜人' },
    ]);
  });

  it('空输入与纯分隔线返回空数组', () => {
    expect(parseCardImport('   \n---\n')).toEqual([]);
  });
});

describe('DOCX 正文提取', () => {
  it('读取 document.xml 段落、换行与实体', () => {
    const zip = buildDocxZip({
      'word/document.xml': '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>第一章 潮声</w:t></w:r></w:p><w:p><w:r><w:t>沈砚&amp;林晚</w:t></w:r></w:p></w:body></w:document>',
    });
    expect(extractDocxText(zip)).toBe('第一章 潮声\n沈砚&林晚');
  });

  it('缺少 document.xml 时给出明确错误', () => {
    const zip = buildDocxZip({ 'word/styles.xml': '<xml />' });
    expect(() => extractDocxText(zip)).toThrowError('DOCX 文件缺少 word/document.xml');
  });
});

describe('工作台统计工具', () => {
  it('按本地时区生成日期键，无效日期返回空串', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDayKey('2026-11-20T00:00:00')).toBe('2026-11-20');
    expect(localDayKey('不是日期')).toBe('');
  });

  it('今天有记录时向前连续回溯，跨月不断档', () => {
    const today = new Date(2026, 10, 20);
    expect(calculateStreak(['2026-11-20', '2026-11-19', '2026-11-18'], today)).toBe(3);
    expect(calculateStreak(['2026-03-01', '2026-02-28'], new Date(2026, 2, 1))).toBe(2);
  });

  it('今天未写但昨天写过仍算连续，断档两天则归零', () => {
    const today = new Date(2026, 10, 20);
    expect(calculateStreak(['2026-11-19', '2026-11-18'], today)).toBe(2);
    expect(calculateStreak(['2026-11-18'], today)).toBe(0);
    expect(calculateStreak([], today)).toBe(0);
  });

  it('重复日期只计一次', () => {
    const today = new Date(2026, 10, 20);
    expect(calculateStreak(['2026-11-20', '2026-11-20', '2026-11-19'], today)).toBe(2);
  });

  it('字数在万字以上折算，负值归零', () => {
    expect(formatWordCount(0)).toBe('0');
    expect(formatWordCount(-50)).toBe('0');
    expect(formatWordCount(9999)).toBe('9999');
    expect(formatWordCount(10000)).toBe('1 万');
    expect(formatWordCount(12000)).toBe('1.2 万');
    expect(formatWordCount(1000000)).toBe('100 万');
  });
});

describe('提示词参数解析', () => {
  it('提取变量名并去重', () => {
    expect(extractPromptVariables('续写《{{workTitle}}》第 {{ chapterTitle }} 章，约 {{targetChars}} 字，参考 {{workTitle}}。'))
      .toEqual(['workTitle', 'chapterTitle', 'targetChars']);
  });

  it('统计参数数量，忽略空白与非法写法', () => {
    expect(countPromptVariables('{{a}} {{ b }} {{a}} {{-bad-}} {{}}')).toBe(2);
    expect(countPromptVariables('没有变量')).toBe(0);
  });

  it('支持中文变量名并区分系统变量与动态字段', () => {
    const content = '《{{workTitle}}》按{{文风偏好}}续写，情绪：{{ 情绪氛围 }}';
    expect(extractPromptVariables(content)).toEqual(['workTitle', '文风偏好', '情绪氛围']);
    expect(extractSystemPromptVariables(content)).toEqual(['workTitle']);
    expect(extractDynamicPromptVariables(content)).toEqual(['文风偏好', '情绪氛围']);
  });
});
