import { describe, expect, it } from 'vitest';
import type { Card, OutlineNode, Work } from '../../src/shared/models';
import { formatAdaptationPack } from '../../src/shared/utils/adaptationPack';

const work: Work = {
  workId: 'w', title: '潮汐尽头', genre: '悬疑', description: '守夜人寻找失踪的姐姐',
  style: '冷峻', targetWords: 200000, platform: '起点中文网', requirements: '不新增设定',
  visualRatio: '9:16', visualStyle: '国风厚涂', visualNotes: '冷色调、雨夜',
  status: 'active', createdAt: '', updatedAt: '', deletedAt: null,
};
const cards: Card[] = [
  {
    cardId: 'c1', workId: 'w', type: 'character', title: '沈砚', content: '身份：守夜人\n目标：寻找姐姐',
    tags: ['主角'], pinned: false, createdAt: '', updatedAt: '', deletedAt: null,
  },
  {
    cardId: 'c2', workId: 'w', type: 'world', title: '潮汐城', content: '退潮时礁石会发出回声。',
    tags: ['场景'], pinned: false, createdAt: '', updatedAt: '', deletedAt: null,
  },
  {
    cardId: 'c3', workId: 'w', type: 'item', title: '旧手电', content: '姐姐留下的手电。',
    tags: [], pinned: false, deprecatedAt: '2026-01-01T00:00:00.000Z', createdAt: '', updatedAt: '', deletedAt: null,
  },
];
const outline: OutlineNode[] = [
  {
    nodeId: 'n1', workId: 'w', chapterId: 'ch1', title: '第一章 · 灯塔', summary: '沈砚在灯塔遇见林晚',
    orderIndex: 1, level: 1, parentId: null, createdAt: '', updatedAt: '', deletedAt: null,
  },
  {
    nodeId: 'n2', workId: 'w', chapterId: 'ch2', title: '第二章 · 退潮', summary: '',
    orderIndex: 2, level: 1, parentId: null, createdAt: '', updatedAt: '', deletedAt: null,
  },
];

describe('改编资料包', () => {
  it('包含视觉设定、资产与章节清单，并排除弃用卡', () => {
    const pack = formatAdaptationPack({ work, cards, outline, master: '沈砚寻找姐姐。', generatedAt: new Date('2026-11-20T10:30:00') });
    expect(pack).toContain('# 《潮汐尽头》改编资料包');
    expect(pack).toContain('- 画幅比例：9:16');
    expect(pack).toContain('- 画风预设：国风厚涂');
    expect(pack).toContain('### 角色（1）');
    expect(pack).toContain('**沈砚**（主角）');
    expect(pack).toContain('### 世界观与场景（1）');
    expect(pack).toContain('### 道具（0）');
    expect(pack).not.toContain('旧手电');
    expect(pack).toContain('第一章 · 灯塔：沈砚在灯塔遇见林晚');
    expect(pack).toContain('不包含分镜图、视频或音频素材');
  });

  it('包含统一短剧改编提示词与可选章节正文', () => {
    const pack = formatAdaptationPack({
      work, cards, outline, master: '沈砚寻找姐姐。', generatedAt: new Date('2026-11-20T10:30:00'),
      chapters: [{ title: '第一章 · 灯塔', content: '海风从礁石间穿过。' }],
    });

    expect(pack).toContain('## 二、短剧改编提示词');
    expect(pack).toContain('只改编选中章节，不续写原著未发生的情节');
    expect(pack).toContain('## 六、所选章节正文');
    expect(pack).toContain('海风从礁石间穿过。');
  });
});
