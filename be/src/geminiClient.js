import { config } from './config.js';

export class GeminiClient {
  async generate({ model, messages, tools }) {
    if (!config.googleKey) { const error = new Error('GOOGLE_KEY is not configured on the backend'); error.statusCode = 503; throw error; }
    const body = { contents: messages, ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}) };
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(config.googleKey)}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const retryAfterHeader = Number(response.headers.get('retry-after'));
          const retryInfo = payload?.error?.details?.find((detail) => detail['@type']?.includes('RetryInfo'))?.retryDelay;
          const retryAfterPayload = retryInfo ? Number.parseFloat(retryInfo) : NaN;
          const error = new Error(payload?.error?.message || `Gemini request failed (${response.status})`);
          error.statusCode = response.status >= 500 ? 502 : response.status;
          error.retryAfter = Number.isFinite(retryAfterHeader) ? retryAfterHeader : Number.isFinite(retryAfterPayload) ? retryAfterPayload : undefined;
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            const retryAfterMs = Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : Number.isFinite(retryAfterPayload) ? retryAfterPayload * 1000 : 1000 * (attempt + 1);
            await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfterMs, 500), 10000)));
            continue;
          }
          throw error;
        }
        const candidate = payload?.candidates?.[0];
        const content = candidate?.content ?? { parts: [] };
        const text = content.parts?.filter((part) => part.text).map((part) => part.text).join('') ?? '';
        const toolCalls = content.parts?.filter((part) => part.functionCall).map((part) => part.functionCall) ?? [];
        if (!text && !toolCalls.length) {
          const error = new Error(candidate?.finishReason ? `Gemini kết thúc với trạng thái ${candidate.finishReason}` : 'Gemini không trả về nội dung');
          error.statusCode = 502;
          throw error;
        }
        return { content, text, toolCalls, usage: payload.usageMetadata ?? null };
      } catch (error) {
        if (attempt < 2 && (error.name === 'TypeError' || error.name === 'TimeoutError')) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Gemini request failed after retry');
  }
}
