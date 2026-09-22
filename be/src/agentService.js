import { config } from './config.js';
import { GeminiClient } from './geminiClient.js';

const SYSTEM = 'You are the project assistant. Use available tools when they are needed. Never invent tool results. Explain tool failures briefly and safely.';

function requiresUserConfirmation(value) {
  if (value == null) return false;
  if (typeof value === 'string') {
    try { return requiresUserConfirmation(JSON.parse(value)); } catch { return false; }
  }
  if (Array.isArray(value)) return value.some(requiresUserConfirmation);
  if (typeof value !== 'object') return false;
  if (value.confirmationRequired === true) return true;
  return Object.values(value).some(requiresUserConfirmation);
}

export class AgentService {
  constructor(registry, gemini = new GeminiClient()) { this.registry = registry; this.gemini = gemini; }

  async run(conversation, mapping) {
    await this.registry.refresh(mapping.mcpServers);
    const messages = [{ role: 'user', parts: [{ text: SYSTEM }] }, ...this.toGeminiMessages(conversation.messages)];
    const usage = {};
    const addUsage = (metadata) => {
      if (!metadata) return;
      for (const key of ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'thoughtsTokenCount']) {
        if (Number.isFinite(metadata[key])) usage[key] = (usage[key] || 0) + metadata[key];
      }
    };
    for (let iteration = 0; iteration < config.maxToolIterations; iteration += 1) {
      const response = await this.gemini.generate({ model: mapping.model, messages, tools: this.registry.definitions() });
      addUsage(response.usage);
      messages.push(response.content);
      if (!response.toolCalls.length) return { text: response.text, usage: Object.keys(usage).length ? usage : null };
      for (const call of response.toolCalls) {
        const result = await this.registry.execute(call.name, call.args ?? {});
        console.log(JSON.stringify({ event: 'agent.tool', conversationId: conversation.id, tool: call.name, success: result.success }));
        messages.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: result } }] });
        conversation.messages.push({ role: 'tool_result', name: call.name, text: JSON.stringify(result), createdAt: Date.now() });

        /** A destructive tool may first return a read-only preview. Stop the
         * current orchestration turn here so the model cannot approve its own
         * deletion by calling the same tool again before the user responds. */
        if (requiresUserConfirmation(result)) {
          const confirmationResponse = await this.gemini.generate({ model: mapping.model, messages, tools: [] });
          addUsage(confirmationResponse.usage);
          return { text: confirmationResponse.text || 'Tôi đã tìm thấy kết quả phù hợp. Bạn có xác nhận thực hiện thao tác xóa không?', usage: Object.keys(usage).length ? usage : null };
        }
      }
    }
    const error = new Error('Agent loop limit reached'); error.statusCode = 508; throw error;
  }

  toGeminiMessages(history) {
    return history.slice(-config.contextMessageLimit).filter((item) => item.role === 'user' || item.role === 'assistant').map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.text }] }));
  }
}
