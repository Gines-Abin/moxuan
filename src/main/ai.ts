import { randomUUID } from 'node:crypto';
import type { ConsistencyIssue } from '../shared/models';
import { ServiceError } from './errors';

export interface ResolvedProvider {
  baseURL: string;
  apiKey: string;
  modelChat: string;
  temperature: number;
  maxTokens: number;
}

export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AiUsage { promptTokens?: number; completionTokens?: number }
export interface CompletionResult { text: string; usage?: AiUsage }

type FetchImplementation = typeof fetch;

function readUsage(value: unknown): AiUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const usage = value as { prompt_tokens?: unknown; completion_tokens?: unknown };
  const result: AiUsage = {};
  if (typeof usage.prompt_tokens === 'number') result.promptTokens = usage.prompt_tokens;
  if (typeof usage.completion_tokens === 'number') result.completionTokens = usage.completion_tokens;
  return Object.keys(result).length ? result : undefined;
}

function readDelta(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return '';
  const choice = choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown } };
  const content = choice.delta?.content ?? choice.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text : '').join('');
  }
  return '';
}

export async function parseOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
): Promise<CompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage: AiUsage | undefined;

  const processEvent = (event: string): void => {
    const data = event.split(/\r\n|\r|\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') return;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new ServiceError(502, '模型服务返回了无效的流式数据', 'AI_INVALID_RESPONSE');
    }
    const delta = readDelta(payload);
    if (delta) {
      text += delta;
      onDelta(delta);
    }
    usage = readUsage((payload as { usage?: unknown }).usage) ?? usage;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
    while (separator) {
      const event = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      processEvent(event);
      separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
    }
    if (done) break;
  }
  if (buffer.trim()) processEvent(buffer);
  return { text, usage };
}

export const parseSSEStream = parseOpenAIStream;

export function assertSecureBaseURL(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ServiceError(400, 'Base URL 格式不正确', 'INVALID_BASE_URL');
  }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new ServiceError(400, 'Base URL 必须使用 HTTPS（localhost 除外）', 'INSECURE_BASE_URL');
  }
  return url;
}

export class OpenAICompatibleAdapter {
  constructor(
    private readonly provider: ResolvedProvider,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  private async execute<T>(
    prompt: string,
    stream: boolean,
    options: GenerationOptions,
    externalSignal: AbortSignal | undefined,
    readResponse: (response: Response) => Promise<T>,
  ): Promise<T> {
    assertSecureBaseURL(this.provider.baseURL);
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    try {
      const endpoint = `${this.provider.baseURL.replace(/\/+$/, '')}/chat/completions`;
      const response = await this.fetchImplementation(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.provider.apiKey ? { Authorization: `Bearer ${this.provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.provider.modelChat,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature ?? this.provider.temperature,
          max_tokens: options.maxTokens ?? this.provider.maxTokens,
          stream,
          ...(stream ? { stream_options: { include_usage: true } } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401) throw new ServiceError(401, 'API Key 无效或已过期', 'AI_UNAUTHORIZED');
        if (response.status === 402) throw new ServiceError(402, '模型服务账户余额不足或配额已用尽，请到服务商控制台充值或检查额度', 'AI_PAYMENT_REQUIRED');
        if (response.status === 403) throw new ServiceError(403, 'API Key 无权访问该模型，或账户使用受到限制', 'AI_FORBIDDEN');
        if (response.status === 404) throw new ServiceError(404, '模型或接口不存在，请检查模型名称与 Base URL', 'AI_MODEL_NOT_FOUND');
        if (response.status === 429) throw new ServiceError(429, '模型服务请求过于频繁，请稍后重试', 'AI_RATE_LIMITED');
        if (response.status >= 500) throw new ServiceError(response.status, `模型服务暂时不可用（HTTP ${response.status}），请稍后重试`, 'AI_SERVICE_UNAVAILABLE');
        throw new ServiceError(response.status, `模型服务请求失败（HTTP ${response.status}）`, 'AI_HTTP_ERROR');
      }
      return await readResponse(response);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (timedOut) throw new ServiceError(408, `模型服务请求超时（${Math.round(timeoutMs / 1000)} 秒）`, 'AI_TIMEOUT');
      if (externalSignal?.aborted) throw new ServiceError(499, '生成已取消', 'AI_ABORTED');
      if (controller.signal.aborted) throw new ServiceError(499, '请求已取消', 'AI_ABORTED');
      throw new ServiceError(503, '无法连接模型服务，请检查网络与服务配置', 'AI_NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  async stream(
    prompt: string,
    options: GenerationOptions,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<CompletionResult> {
    return this.execute(prompt, true, options, signal, async (response) => {
      if (!response.body) throw new ServiceError(502, '模型服务未返回流式响应', 'AI_INVALID_RESPONSE');
      return parseOpenAIStream(response.body, onDelta);
    });
  }

  async complete(prompt: string, options: GenerationOptions = {}, signal?: AbortSignal): Promise<CompletionResult> {
    return this.execute(prompt, false, options, signal, async (response) => {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ServiceError(502, '模型服务返回了无效 JSON', 'AI_INVALID_RESPONSE');
      }
      const text = readDelta(payload);
      if (!text) throw new ServiceError(502, '模型服务未返回有效内容', 'AI_INVALID_RESPONSE');
      return { text, usage: readUsage((payload as { usage?: unknown }).usage) };
    });
  }

  async test(): Promise<number> {
    const startedAt = Date.now();
    await this.complete('请仅回复 OK', { maxTokens: 8 });
    return Date.now() - startedAt;
  }
}

export function extractJsonArray(input: string): unknown[] {
  const candidates = [input.trim(), input.replace(/```(?:json)?/gi, '').trim()];
  for (const candidate of candidates) {
    for (let start = candidate.indexOf('['); start >= 0; start = candidate.indexOf('[', start + 1)) {
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let index = start; index < candidate.length; index += 1) {
        const character = candidate[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') quoted = false;
          continue;
        }
        if (character === '"') quoted = true;
        else if (character === '[') depth += 1;
        else if (character === ']') {
          depth -= 1;
          if (depth === 0) {
            try {
              const parsed: unknown = JSON.parse(candidate.slice(start, index + 1));
              if (Array.isArray(parsed)) return parsed;
            } catch {
              break;
            }
          }
        }
      }
    }
  }
  throw new ServiceError(502, '无法从模型回复中提取 JSON 数组', 'AI_INVALID_RESPONSE');
}

export function extractJsonObject(input: string): Record<string, unknown> {
  const candidate = input.replace(/```(?:json)?/gi, '').trim();
  for (let start = candidate.indexOf('{'); start >= 0; start = candidate.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index += 1) {
      const character = candidate[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed: unknown = JSON.parse(candidate.slice(start, index + 1));
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new ServiceError(502, '无法从模型回复中提取 JSON 对象', 'AI_INVALID_RESPONSE');
}

export function parseConsistencyIssues(input: string): ConsistencyIssue[] {
  return extractJsonArray(input).flatMap((value) => {
    if (typeof value !== 'object' || value === null) return [];
    const issue = value as Record<string, unknown>;
    if (typeof issue.explanation !== 'string' || !issue.explanation.trim()) return [];
    return [{
      id: randomUUID(),
      issueType: typeof issue.issueType === 'string' && issue.issueType.trim() ? issue.issueType : 'setting_conflict',
      paragraph: typeof issue.paragraph === 'string' ? issue.paragraph : '',
      cardTitle: typeof issue.cardTitle === 'string' ? issue.cardTitle : '未知设定',
      explanation: issue.explanation,
      suggestion: typeof issue.suggestion === 'string' ? issue.suggestion : '',
    }];
  });
}
