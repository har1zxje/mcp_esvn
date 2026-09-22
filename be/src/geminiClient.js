import { config } from './config.js';

export class GeminiClient {
  async generate({ model, messages, tools, signal, onText }) {
    if (!config.googleKey) { const error = new Error('GOOGLE_KEY is not configured on the backend'); error.statusCode = 503; throw error; }
    const body = { contents: messages, ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}) };
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.googleKey)}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(config.modelTimeoutMs)]) : AbortSignal.timeout(config.modelTimeoutMs);
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: requestSignal });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const error = new Error(payload?.error?.message || `Gemini request failed (${response.status})`);
          error.statusCode = response.status >= 500 ? 502 : response.status;
          if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); continue; }
          throw error;
        }
        if (!response.body) throw new Error('Gemini returned an empty stream');
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let text = ''; let parts = []; let usage = null;
        const consume = (payload) => {
          const candidate = payload?.candidates?.[0];
          const nextParts = candidate?.content?.parts ?? [];
          for (const part of nextParts) {
            if (part.text) { text += part.text; onText?.(part.text); }
            parts.push(part);
          }
          usage = payload?.usageMetadata ?? usage;
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || '';
          for (const event of events) {
            const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
            if (data && data !== '[DONE]') consume(JSON.parse(data));
          }
        }
        if (buffer.trim()) {
          const data = buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
          if (data && data !== '[DONE]') consume(JSON.parse(data));
        }
        const content = { parts };
        const toolCalls = parts.filter((part) => part.functionCall).map((part) => part.functionCall);
        if (!text && !toolCalls.length) { const error = new Error('Gemini không trả về nội dung'); error.statusCode = 502; throw error; }
        return { content, text, toolCalls, usage };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (error.name === 'TimeoutError') { const timeoutError = new Error(`Gemini không phản hồi sau ${config.modelTimeoutMs / 1000} giây với model ${model || 'gemini-2.5-flash'}`); timeoutError.statusCode = 504; throw timeoutError; }
        if (attempt < 2 && (error.name === 'TypeError' || error.name === 'TimeoutError')) { await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); continue; }
        throw error;
      }
    }
    throw new Error('Gemini request failed after retry');
  }
}
