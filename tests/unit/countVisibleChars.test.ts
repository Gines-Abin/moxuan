import { describe, expect, it } from 'vitest';
import { countVisibleChars, isWithinTargetLength, stripMarkdown } from '../../src/shared/utils/countVisibleChars';

describe('countVisibleChars', () => {
  it('忽略空白并统计中英文字符和标点', () => {
    expect(countVisibleChars('')).toBe(0);
    expect(countVisibleChars(' \n\t')).toBe(0);
    expect(countVisibleChars('你好， world!\n')).toBe(9);
  });

  it('按 Unicode 码点统计 emoji、组合字符和旗帜', () => {
    expect(countVisibleChars('😀')).toBe(1);
    expect(countVisibleChars('👨‍👩‍👧‍👦')).toBe(7);
    expect(countVisibleChars('🇨🇳')).toBe(2);
    expect(countVisibleChars('e\u0301')).toBe(2);
    expect(countVisibleChars('A😀B')).toBe(3);
  });

  it('不统计 Markdown 标记但保留实际文本和代码', () => {
    expect(countVisibleChars('# 标题')).toBe(2);
    expect(countVisibleChars('**加粗**与*斜体*')).toBe(5);
    expect(countVisibleChars('[链接](https://example.com)')).toBe(2);
    expect(countVisibleChars('![替代](image.png)')).toBe(2);
    expect(countVisibleChars('`代码`')).toBe(2);
    expect(countVisibleChars('~~删除~~')).toBe(2);
    expect(countVisibleChars('- 项目\n1. 第二')).toBe(4);
    expect(countVisibleChars('```js\nconst a = 1;\n```')).toBe(9);
  });

  it('处理转义、换行和边界输入', () => {
    expect(stripMarkdown('\\*不是斜体\\*')).toBe('*不是斜体*');
    expect(countVisibleChars('\\*不是斜体\\*')).toBe(6);
    expect(countVisibleChars('\u200b')).toBe(1);
    expect(countVisibleChars('。\n')).toBe(1);
    expect(countVisibleChars('甲\u3000乙\u00A0丙')).toBe(3);
  });
});

describe('isWithinTargetLength', () => {
  it('按目标字数的 ±20% 闭区间判断', () => {
    expect(isWithinTargetLength('一'.repeat(80), 100)).toBe(true);
    expect(isWithinTargetLength('一'.repeat(120), 100)).toBe(true);
    expect(isWithinTargetLength('一'.repeat(79), 100)).toBe(false);
    expect(isWithinTargetLength('一'.repeat(121), 100)).toBe(false);
  });

  it('拒绝无效目标并统一忽略 Markdown 与空白', () => {
    expect(isWithinTargetLength(`**${'字'.repeat(100)}**`, 100)).toBe(true);
    expect(isWithinTargetLength('内容', 0)).toBe(false);
    expect(isWithinTargetLength('内容', Number.NaN)).toBe(false);
    expect(isWithinTargetLength('内容', -1)).toBe(false);
  });
});
