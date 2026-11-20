import type { ContinuityScore } from '../models';

const WINDOW = 400;
const PICKUP_WINDOW = 200;

function bigrams(value: string): Set<string> {
  const normalized = value.replace(/\s+/g, '');
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  return result;
}

/** 最长公共子串长度，用于识别开场是否直接复现上一章结尾原句。 */
function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

/**
 * 粗略评估新稿开场与上一章结尾的承接程度。
 * 仅用于写作提示，不作为硬性质量判定。
 */
export function scoreContinuity(previousText: string, nextText: string): ContinuityScore {
  const previous = previousText.trim();
  if (!previous) return { score: 10, message: '首章无前文' };
  const head = nextText.trim().slice(0, WINDOW);
  if (!head) return { score: 0, message: '新稿为空，无法判断承接' };
  const previousBigrams = bigrams(previous.slice(-WINDOW));
  const nextBigrams = bigrams(head);
  if (!nextBigrams.size) return { score: 0, message: '新稿缺少可比较的文字' };
  let hits = 0;
  nextBigrams.forEach((gram) => {
    if (previousBigrams.has(gram)) hits += 1;
  });
  const ratio = hits / nextBigrams.size;
  // 直接复现上一章结尾原句属于最强的承接，词频重叠会低估，单独加分。
  const pickup = longestCommonSubstring(
    head.slice(0, PICKUP_WINDOW).replace(/\s+/g, ''),
    previous.replace(/\s+/g, '').slice(-PICKUP_WINDOW),
  );
  const bonus = pickup >= 6 ? 4 : pickup >= 4 ? 2 : 0;
  const score = Math.max(0, Math.min(10, Math.round(ratio * 30) + bonus));
  const message = score < 4
    ? '开场未明显承接上一章，可手动优化开场'
    : bonus >= 2
      ? '开场直接承接上一章结尾'
      : '开场与上一章有可见承接';
  return { score, message };
}
