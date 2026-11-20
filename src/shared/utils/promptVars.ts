/** 提示词变量统一使用 {{变量名}}，支持中文、英文、数字与下划线。 */
export const PROMPT_VARIABLE_PATTERN = /\{\{\s*([\w\u4e00-\u9fff]+)\s*\}\}/g;

/** 由墨轩自动填充的系统变量，不需要用户手动填写。 */
export const SYSTEM_PROMPT_VARIABLES = [
  'workTitle', 'workDescription', 'workStyle', 'workTargetWords', 'workPlatform', 'workRequirements',
  'chapterTitle', 'content', 'selectedText', 'cards', 'targetChars', 'strategy',
] as const;

/** 提取提示词中的 {{变量}} 名称，去重并保持出现顺序。 */
export function extractPromptVariables(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(PROMPT_VARIABLE_PATTERN)) names.add(match[1]);
  return [...names];
}

/** 生成卡片上展示的“参数 N”。 */
export function countPromptVariables(content: string): number {
  return extractPromptVariables(content).length;
}

/** 只保留需要用户在使用时填写的动态字段，排除系统自动变量。 */
export function extractDynamicPromptVariables(content: string): string[] {
  const system = new Set<string>(SYSTEM_PROMPT_VARIABLES);
  return extractPromptVariables(content).filter((name) => !system.has(name));
}

/** 提取会被自动填充的系统变量，用于预览中区分两类变量。 */
export function extractSystemPromptVariables(content: string): string[] {
  const system = new Set<string>(SYSTEM_PROMPT_VARIABLES);
  return extractPromptVariables(content).filter((name) => system.has(name));
}
