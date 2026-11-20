import type { Card, CardType } from '../models';

/** 设定卡类型在引用路径中的中文名，与设定库展示一致。 */
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  character: '角色', world: '世界观', plot: '情节', item: '道具', term: '术语',
};

const LABEL_TO_TYPE = Object.fromEntries(
  Object.entries(CARD_TYPE_LABELS).map(([type, label]) => [label, type]),
) as Record<string, CardType>;

/** 引用需单独成行书写，避免与正文连写造成标题歧义。 */
export const CARD_REFERENCE_PATTERN = /@设定-(角色|世界观|情节|道具|术语)-([^\n]+)/g;

/** 生成设定卡的提示词引用 key，例如 @设定-角色-沈砚。 */
export function cardReferenceKey(card: Pick<Card, 'type' | 'title'>): string {
  return `@设定-${CARD_TYPE_LABELS[card.type]}-${card.title.trim()}`;
}

/**
 * 把提示词中的设定引用替换为该作品设定卡的正文。
 * 引用可独占一行，也可在标题后直接接标点继续写正文；
 * 弃用与删除的卡不参与匹配，未命中时写入“待补全”。
 */
export function resolveCardReferences(content: string, cards: Card[]): string {
  const active = cards.filter((card) => !card.deletedAt && !card.deprecatedAt);
  return content.replace(CARD_REFERENCE_PATTERN, (_match, label: string, rawRest: string) => {
    const leading = rawRest.match(/^\s*/)?.[0] ?? '';
    const rest = rawRest.slice(leading.length);
    const candidates = active
      .filter((card) => card.type === LABEL_TO_TYPE[label])
      .sort((a, b) => b.title.trim().length - a.title.trim().length);
    const exact = candidates.find((card) => card.title.trim() === rest.trim());
    const prefixed = candidates.find((card) => {
      const title = card.title.trim();
      return title !== '' && rest.startsWith(title) && /^[。，；、！？!?,;.]/.test(rest.slice(title.length));
    });
    const card = exact ?? prefixed;
    if (card) {
      const consumed = exact ? rest.length : card.title.trim().length;
      return `${leading}【设定：${card.title}｜${label}】\n${card.content}${rest.slice(consumed)}`;
    }
    const punctuation = rest.match(/[。，；、！？!?,;.]+$/)?.[0] ?? '';
    const missing = (punctuation ? rest.slice(0, -punctuation.length) : rest).trim();
    return `${leading}（设定“${missing}”待补全）${punctuation}`;
  });
}
