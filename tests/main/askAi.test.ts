import { describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// The client picks a session, and the session is what carries the proxy setting: both routes go to the same mock here.
vi.mock('electron', () => {
  const fakeSession = { setProxy: () => Promise.resolve(), fetch: fetchMock };
  return { session: { fromPartition: () => fakeSession, defaultSession: fakeSession } };
});

import { AskCancelled, streamAsk, type AskCall } from '../../src/main/askAi';

const body = (lines: string[]): Response =>
  new Response(lines.join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

const delta = (d: Record<string, string>): string => `data: ${JSON.stringify({ choices: [{ delta: d }] })}`;

function call(over: Partial<AskCall> = {}): { call: AskCall; chunks: Array<{ kind: string; text: string }> } {
  const chunks: Array<{ kind: string; text: string }> = [];
  return {
    chunks,
    call: {
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      system: 'sys',
      question: '现在该做什么？',
      image: 'data:image/jpeg;base64,AAAA',
      onChunk: (c) => chunks.push({ kind: c.kind, text: c.text }),
      signal: new AbortController().signal,
      ...over,
    },
  };
}

describe('streamAsk', () => {
  it('posts the screenshot as an OpenAI image_url and streams thinking and answer apart', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(body([
      delta({ reasoning_content: '先看血量' }),
      delta({ content: '先回城' }),
      delta({ content: '再推线' }),
      'data: [DONE]',
      '',
    ]));
    const { call: c, chunks } = call();
    await streamAsk(c);
    expect(chunks).toEqual([
      { kind: 'reasoning', text: '先看血量' },
      { kind: 'answer', text: '先回城' },
      { kind: 'answer', text: '再推线' },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const sent = JSON.parse(init.body) as {
      model: string; stream: boolean; thinking: unknown; messages: Array<{ role: string; content: unknown }>;
    };
    expect(sent.model).toBe('deepseek-flash');
    expect(sent.stream).toBe(true);
    expect(sent.thinking).toEqual({ type: 'disabled' }); // a game answer wants speed, not a chain of thought
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(sent.messages[1].content).toEqual([
      { type: 'text', text: '现在该做什么？' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA', detail: 'high' } },
    ]);
  });

  it('leaves the image out when there is no screenshot', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(body([delta({ content: 'ok' }), 'data: [DONE]']));
    const { call: c } = call({ image: null });
    await streamAsk(c);
    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      messages: Array<{ content: unknown[] }>;
    };
    expect(sent.messages[1].content).toEqual([{ type: 'text', text: '现在该做什么？' }]);
  });

  it('keeps a trailing slash off the endpoint and tolerates a /v1 base', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(body(['data: [DONE]']));
    await streamAsk(call({ baseUrl: 'http://localhost:11434/v1/' }).call);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('reports what the API said when it refuses, and does not retry an HTTP error', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"Authentication Fails"}}', { status: 401 }));
    const { call: c } = call();
    await expect(streamAsk(c)).rejects.toThrow(/401.*Authentication Fails/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries through the system proxy when nothing can be reached directly', async () => {
    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchMock.mockResolvedValueOnce(body([delta({ content: 'ok' }), 'data: [DONE]']));
    const { call: c, chunks } = call();
    await streamAsk(c);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([{ kind: 'answer', text: 'ok' }]);
  });

  it('drops the thinking switch for an endpoint that does not know it', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"unknown field thinking"}}', { status: 400 }));
    fetchMock.mockResolvedValueOnce(body([delta({ content: 'ok' }), 'data: [DONE]']));
    const { call: c, chunks } = call();
    await streamAsk(c);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>;
    const second = JSON.parse((fetchMock.mock.calls[1] as [string, { body: string }])[1].body) as Record<string, unknown>;
    expect(first.thinking).toEqual({ type: 'disabled' });
    expect('thinking' in second).toBe(false);
    expect(second.model).toBe(first.model); // everything else is unchanged
    expect(chunks).toEqual([{ kind: 'answer', text: 'ok' }]);
  });

  it('does not strip the thinking switch for a bad key', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"Authentication Fails"}}', { status: 401 }));
    await expect(streamAsk(call().call)).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is a cancellation, not a failure, when the user stops the answer', async () => {
    fetchMock.mockReset();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
        controller.enqueue(new TextEncoder().encode(`${delta({ content: '第一段' })}\n`));
      },
    }), { status: 200 }));
    const abort = new AbortController();
    const { call: c, chunks } = call({
      signal: abort.signal,
      onChunk: (chunk) => {
        chunks.push({ kind: chunk.kind, text: chunk.text });
        abort.abort();
        stream.error(new DOMException('aborted', 'AbortError'));
      },
    });
    await expect(streamAsk(c)).rejects.toBeInstanceOf(AskCancelled);
    expect(chunks).toEqual([{ kind: 'answer', text: '第一段' }]); // what arrived is kept
  });

  it('ignores keep-alive comments and payloads it cannot read', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(body([
      ': keep-alive',
      '',
      'data: not json',
      'data: {"choices":[]}',
      delta({ content: 'answer' }),
      'data: [DONE]',
    ]));
    const { call: c, chunks } = call();
    await streamAsk(c);
    expect(chunks).toEqual([{ kind: 'answer', text: 'answer' }]);
  });
});
