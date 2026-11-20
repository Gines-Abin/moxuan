import { describe, expect, it } from 'vitest';
import {
  buildScriptEpisodePrompt, buildScriptIdeaPrompt, buildScriptOutlinePrompt,
  formatScriptDocument, parseScriptIdeas, parseScriptOutline,
} from '../../src/main/scriptStudio';
import type { ScriptProject } from '../../src/shared/models';

function createProject(): ScriptProject {
  return {
    projectId: 'script-1',
    title: '测试短剧',
    genre: '都市',
    elements: ['逆袭', '爽感'],
    episodeCount: 2,
    batchSize: 2,
    ideas: [{ ideaId: 'idea-1', title: '离婚当天', logline: '转身成债主。', synopsis: '苏晚离婚当天发现前夫欠她巨款。' }],
    selectedIdeaId: 'idea-1',
    masterOutline: '苏晚步步反击，最终拿回一切。',
    episodes: [
      { index: 1, title: '第1集 · 离婚', summary: '被净身出户。', content: '第1集正文。', status: 'done' },
      { index: 2, title: '第2集 · 反转', summary: '债主上门。', content: '第2集正文。', status: 'done' },
      { index: 3, title: '第3集 · 收网', summary: '真相揭开。', content: '', status: 'pending' },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('短剧创意与分集大纲解析', () => {
  it('生成创意提示词包含元素与补充想法，并能解析代码围栏中的 JSON', () => {
    const prompt = buildScriptIdeaPrompt({
      title: '测试短剧', genre: '都市', elements: ['逆袭', '爽感'], instruction: '第一集打脸',
    });
    expect(prompt).toContain('【短剧创意任务】');
    expect(prompt).toContain('逆袭、爽感');
    expect(prompt).toContain('第一集打脸');
    expect(prompt).toContain('严格返回 JSON 数组');

    const ideas = parseScriptIdeas('```json\n[{"title":"离婚当天","logline":"卖点","synopsis":"梗概"},{"title":"","logline":"忽略"}]\n```');
    expect(ideas).toEqual([{ title: '离婚当天', logline: '卖点', synopsis: '梗概' }]);
  });

  it('模型未返回有效创意时抛出可读错误', () => {
    expect(() => parseScriptIdeas('抱歉，我无法完成。')).toThrow('未返回有效的短剧创意');
  });

  it('分集大纲按设定集数截断，并校验总纲', () => {
    const prompt = buildScriptOutlinePrompt({
      title: '测试短剧', genre: '都市', elements: ['逆袭'], episodeCount: 2,
      idea: { ideaId: 'idea-1', title: '离婚当天', logline: '卖点', synopsis: '梗概' },
    });
    expect(prompt).toContain('扩展为 2 集');
    expect(prompt).toContain('【分集大纲任务】');

    const outline = parseScriptOutline(JSON.stringify({
      totalOutline: '全剧总纲',
      episodes: [
        { title: '第1集 · 开场', summary: '冲突一' },
        { title: '第2集 · 反转', summary: '冲突二' },
        { title: '第3集 · 多余', summary: '冲突三' },
      ],
    }), 2);
    expect(outline.masterOutline).toBe('全剧总纲');
    expect(outline.episodes.map((episode) => episode.title)).toEqual(['第1集 · 开场', '第2集 · 反转']);
    expect(() => parseScriptOutline('{"episodes":[]}', 2)).toThrow('未返回有效的分集大纲');
  });

  it('单集提示词带入上一集结尾，避免重复推进', () => {
    const project = createProject();
    const prompt = buildScriptEpisodePrompt({
      project, idea: project.ideas[0], episode: project.episodes[1], previousTail: '第1集结尾：苏晚被赶出家门。',
    });
    expect(prompt).toContain('【单集剧本任务】');
    expect(prompt).toContain('第 2 集');
    expect(prompt).toContain('上一集结尾');
    expect(prompt).toContain('苏晚被赶出家门');
    expect(prompt).toContain('只输出本集剧本正文');
  });
});

describe('分集剧本导出', () => {
  it('只导出有正文的分集并包含项目信息、创意与总纲', () => {
    const document = formatScriptDocument(createProject(), { format: 'md', generatedAt: new Date('2026-05-01T08:00:00') });
    expect(document).toContain('# 《测试短剧》分集剧本');
    expect(document).toContain('- 类型：都市');
    expect(document).toContain('- 元素：逆袭、爽感');
    expect(document).toContain('## 二、选定创意');
    expect(document).toContain('## 三、全剧总纲');
    expect(document).toContain('### 第1集 · 离婚');
    expect(document).toContain('### 第2集 · 反转');
    expect(document).not.toContain('### 第3集 · 收网');
    expect(document).toContain('不含分镜图、视频、音频或字幕文件');
  });

  it('支持指定分集导出，纯文本去除 Markdown 标记', () => {
    const document = formatScriptDocument(createProject(), { format: 'txt', episodeIndexes: [2] });
    expect(document).toContain('第2集正文。');
    expect(document).not.toContain('第1集正文。');
    expect(document).not.toContain('# 《测试短剧》');
  });

  it('没有可导出正文时抛出明确错误', () => {
    const project = createProject();
    project.episodes = project.episodes.map((episode) => ({ ...episode, content: '' }));
    expect(() => formatScriptDocument(project, { format: 'md' })).toThrow('还没有正文');
  });
});
