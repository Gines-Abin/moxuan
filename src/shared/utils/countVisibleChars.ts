export function stripMarkdown(input: string): string {
  const escaped: string[] = [];
  const source = input.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (_match, character: string) => {
    escaped.push(character);
    return `\uE000${escaped.length - 1}\uE001`;
  });
  const stripped = source
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:```|~~~)[^\n]*\n?/gm, '')
    .replace(/^(?:```|~~~)\s*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>+)\s+/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(?:(?:[-*_]\s*){3,})$/gm, '')
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, '')
    .replace(/(\*\*|__)(.*?)\1/gs, '$2')
    .replace(/(\*|_)(.*?)\1/gs, '$2')
    .replace(/~~(.*?)~~/gs, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_~]/g, '');
  return stripped.replace(/\uE000(\d+)\uE001/g, (match, index: string) => escaped[Number(index)] ?? match);
}

export function countVisibleChars(input: string): number {
  if (!input) return 0;
  const visible = stripMarkdown(input).replace(/[\s\u3000\u00A0]/gu, '');
  return Array.from(visible).length;
}

export function isWithinTargetLength(input: string, target: number): boolean {
  if (!Number.isFinite(target) || target < 0) return false;
  const actual = countVisibleChars(input);
  return actual >= Math.floor(target * 0.8) && actual <= Math.ceil(target * 1.2);
}
