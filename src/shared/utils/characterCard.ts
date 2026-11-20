export const CHARACTER_FIELDS = ['身份', '性格', '背景', '能力', '外貌', '目标', '关系'] as const;
export type CharacterField = typeof CHARACTER_FIELDS[number];
export type CharacterFields = Record<CharacterField, string>;

export function emptyCharacterFields(): CharacterFields {
  return CHARACTER_FIELDS.reduce((result, field) => {
    result[field] = '';
    return result;
  }, {} as CharacterFields);
}

/** 解析「标签：正文」格式的角色卡内容，无法识别的行归入背景。 */
export function parseCharacterContent(content: string): CharacterFields {
  const fields = emptyCharacterFields();
  const extra: string[] = [];
  for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([^：:]{1,8})[：:]\s*(.*)$/u.exec(line);
    if (match && (CHARACTER_FIELDS as readonly string[]).includes(match[1].trim())) {
      const field = match[1].trim() as CharacterField;
      fields[field] = fields[field] ? `${fields[field]}\n${match[2].trim()}` : match[2].trim();
    } else {
      extra.push(line);
    }
  }
  if (extra.length) fields.背景 = [fields.背景, ...extra].filter(Boolean).join('\n');
  return fields;
}

export function serializeCharacterContent(fields: CharacterFields): string {
  return CHARACTER_FIELDS
    .filter((field) => fields[field].trim())
    .map((field) => `${field}：${fields[field].trim()}`)
    .join('\n');
}
