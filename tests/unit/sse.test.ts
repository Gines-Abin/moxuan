import { describe, expect, it } from 'vitest';
import { extractJsonArray, parseConsistencyIssues, parseOpenAIStream } from '../../src/main/ai';

function fragmentedStream(data: string, sizes: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(data);
  let offset = 0;
  let chunk = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[chunk % sizes.length];
      chunk += 1;
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

describe('OpenAI SSE 跨分片解析', () => {
  it('处理任意字节边界、CRLF、注释、usage 和 DONE', async () => {
    const source = [
      ': keep-alive\n\n',
      'data: {"choices":[{"delta":{"content":"你😀"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2}}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ].join('');
    const deltas: string[] = [];
    const result = await parseOpenAIStream(fragmentedStream(source, [1, 2, 5, 3, 11]), (delta) => deltas.push(delta));
    expect(deltas).toEqual(['你😀', '好']);
    expect(result).toEqual({ text: '你😀好', usage: { promptTokens: 12, completionTokens: 2 } });
  });

  it('处理最后一个没有空行结束符的事件', async () => {
    const result = await parseOpenAIStream(
      fragmentedStream('data: {"choices":[{"delta":{"content":"结尾"}}]}', [4]),
      () => undefined,
    );
    expect(result.text).toBe('结尾');
    expect(result.usage).toBeUndefined();
  });

  it('从代码围栏或说明文字中稳健提取 JSON 数组', () => {
    const expected = [{ paragraph: '他说“]”', explanation: '矛盾' }];
    expect(extractJsonArray(`分析如下：\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\``)).toEqual(expected);
    expect(() => extractJsonArray('不是 JSON')).toThrowError(/JSON/);
  });

  it('一致性问题保留类型并为旧格式响应提供默认类型', () => {
    const issues = parseConsistencyIssues(JSON.stringify([
      { issueType: 'character', paragraph: '他十八岁', cardTitle: '主角', explanation: '年龄冲突', suggestion: '统一 age' },
      { paragraph: '城门在南方', explanation: '方位冲突', suggestion: '修改方位' },
      { paragraph: '缺少问题说明' },
    ]));
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ issueType: 'character', cardTitle: '主角' });
    expect(issues[1]).toMatchObject({ issueType: 'setting_conflict', cardTitle: '未知设定' });
    expect(issues[0].id).not.toBe(issues[1].id);
  });
});
