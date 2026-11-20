import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleAdapter, assertSecureBaseURL, type ResolvedProvider } from '../../src/main/ai';

const provider: ResolvedProvider = {
  baseURL: 'https://api.example.test/v1', apiKey: 'secret', modelChat: 'test-model', temperature: 0.7, maxTokens: 100,
};

function stalledFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  void input;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    },
  });
  return Promise.resolve(new Response(body, { status: 200 }));
}

describe('OpenAICompatibleAdapter', () => {
  it('只允许 HTTPS 或 localhost HTTP', () => {
    expect(assertSecureBaseURL('https://api.example.com/v1').protocol).toBe('https:');
    expect(assertSecureBaseURL('http://localhost:11434/v1').hostname).toBe('localhost');
    expect(() => assertSecureBaseURL('http://api.example.com/v1')).toThrowError(/HTTPS/);
    expect(() => assertSecureBaseURL('not a url')).toThrowError(/格式/);
  });

  it.each([
    { status: 401, errorCode: 'AI_UNAUTHORIZED' },
    { status: 402, errorCode: 'AI_PAYMENT_REQUIRED' },
    { status: 403, errorCode: 'AI_FORBIDDEN' },
    { status: 404, errorCode: 'AI_MODEL_NOT_FOUND' },
    { status: 429, errorCode: 'AI_RATE_LIMITED' },
    { status: 503, errorCode: 'AI_SERVICE_UNAVAILABLE' },
  ])('HTTP $status 映射为 $errorCode 且不自动重试', async ({ status, errorCode }) => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status })));
    const adapter = new OpenAICompatibleAdapter(provider, fetchMock as typeof fetch);
    await expect(adapter.complete('测试')).rejects.toMatchObject({ errorCode });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络错误有明确错误码', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('connection failed')));
    const adapter = new OpenAICompatibleAdapter(provider, fetchMock as typeof fetch);
    await expect(adapter.complete('测试')).rejects.toMatchObject({ errorCode: 'AI_NETWORK_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('响应头返回后仍可中止流式读取', async () => {
    const adapter = new OpenAICompatibleAdapter(provider, stalledFetch as typeof fetch);
    const controller = new AbortController();
    const pending = adapter.stream('测试', {}, () => undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ errorCode: 'AI_ABORTED' });
  });

  it('超时覆盖整个流式读取阶段', async () => {
    const adapter = new OpenAICompatibleAdapter(provider, stalledFetch as typeof fetch);
    await expect(adapter.stream('测试', { timeoutMs: 5 }, () => undefined)).rejects.toMatchObject({ errorCode: 'AI_TIMEOUT' });
  });
});
