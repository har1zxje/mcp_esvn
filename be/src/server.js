import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { publicModels, resolveModel } from './modelRegistry.js';
import { createMcpClients } from './mcpClient.js';
import { ToolRegistry } from './toolRegistry.js';
import { AgentService } from './agentService.js';

const app = express();
const dataDir = path.resolve(process.cwd(), 'data');
const historyFile = path.join(dataDir, 'conversations.json');
const mcpClients = createMcpClients();
const agent = new AgentService(new ToolRegistry(mcpClients));
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed'));
    },
    credentials: true,
  }),
);

const upstreamAuthHeaders = (req) => {
  const cookie = req.get('cookie');
  if (config.libreChatServiceToken) {
    return {
      authorization: `Bearer ${config.libreChatServiceToken}`,
      ...(cookie ? { cookie } : {}),
    };
  }
  // Preserve the user's LibreChat session when the project facade forwards
  // a request. Provider/API credentials never come from the browser.
  return {
    ...(req.get('authorization') ? { authorization: req.get('authorization') } : {}),
    ...(cookie ? { cookie } : {}),
  };
};

const describeError = (error, status) => {
  const message = String(error?.message || 'Unknown error');
  if (status === 429 || /quota|rate limit|too many requests/i.test(message)) {
    return {
      code: 'GEMINI_QUOTA_EXCEEDED',
      action: 'Kiểm tra quota/billing của Google AI Studio hoặc đổi GOOGLE_KEY; không retry liên tục.',
    };
  }
  if (status === 503 && /GOOGLE_KEY/i.test(message)) {
    return {
      code: 'GOOGLE_KEY_MISSING',
      action: 'Kiểm tra GOOGLE_KEY trong MCPServer/be/.env rồi khởi động lại backend.',
    };
  }
  if (status === 502 || /gemini|upstream|fetch failed|timeout/i.test(message)) {
    return {
      code: 'MODEL_UPSTREAM_ERROR',
      action: 'Kiểm tra trạng thái Gemini, model mapping và kết nối mạng; xem requestId trong log backend.',
    };
  }
  return { code: 'CHAT_BACKEND_ERROR', action: 'Xem log backend theo requestId để xác định nguyên nhân.' };
};

const jsonError = (res, error) => {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const requestId = res.req?.requestId || crypto.randomUUID();
  const details = describeError(error, status);
  console.error(JSON.stringify({
    event: 'api.error', requestId, method: res.req?.method, path: res.req?.originalUrl,
    status, code: details.code, message: error?.message || 'Unknown error',
    retryAfter: error?.retryAfter,
  }));
  if (status === 429 && Number.isFinite(error.retryAfter)) res.setHeader('Retry-After', String(error.retryAfter));
  return res.status(status).json({
    error: status === 500 ? 'Chat backend error' : error.message,
    code: details.code,
    action: details.action,
    requestId,
  });
};

const readCookie = (req, name) => {
  const cookies = (req.get('cookie') || '').split(';').map((item) => item.trim());
  const value = cookies.find((item) => item.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : '';
};

/**
 * The deployment normally provides an auth cookie or Authorization header.
 * For the project-only mode, issue a private browser session cookie so two
 * browsers cannot access each other's conversations by guessing an id.
 */
const getOwnerId = (req, res) => {
  const identity = req.get('authorization') || readCookie(req, 'project_owner');
  if (identity) return crypto.createHash('sha256').update(identity).digest('hex');
  const owner = crypto.randomUUID();
  res.setHeader('Set-Cookie', `project_owner=${encodeURIComponent(owner)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
  return crypto.createHash('sha256').update(owner).digest('hex');
};

const notFound = () => {
  const error = new Error('Conversation not found');
  error.statusCode = 404;
  return error;
};

const readHistory = async () => {
  try {
    return JSON.parse(await fs.readFile(historyFile, 'utf8'));
  } catch {
    return {};
  }
};

const writeHistory = async (history) => {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(historyFile, JSON.stringify(history, null, 2), 'utf8');
};

const callGoogleModel = async (mapping, messages) => {
  if (!config.googleKey) {
    const error = new Error('GOOGLE_KEY is not configured on the backend');
    error.statusCode = 503;
    throw error;
  }
  const model = mapping.model || 'gemini-2.5-flash';
  const contents = messages.map((item) => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.text }],
  }));
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.googleKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents }),
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Model request failed (${response.status})`);
    error.statusCode = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
};

const copyUpstreamResponse = async (upstream, res) => {
  res.status(upstream.status);
  for (const [name, value] of upstream.headers) {
    if (['connection', 'content-length', 'transfer-encoding'].includes(name)) continue;
    res.setHeader(name, value);
  }
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  return res.end();
};

const proxyGenerationRequest = async (req, res, path) => {
  const query = req.originalUrl.includes('?')
    ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
    : '';
  const upstream = await fetch(`${config.libreChatUrl}/api/agents/chat/${path}${query}`, {
    method: req.method,
    headers: {
      ...upstreamAuthHeaders(req),
      ...(req.get('content-type') ? { 'content-type': req.get('content-type') } : {}),
      ...(req.get('user-agent') ? { 'user-agent': req.get('user-agent') } : {}),
      accept: req.get('accept') ?? 'application/json, text/event-stream',
    },
    ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: JSON.stringify(req.body ?? {}) }),
  });
  return copyUpstreamResponse(upstream, res);
};

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/chat/models', (_req, res) => {
  res.json({ models: publicModels() });
});

// Expose only the minimal identity needed by the project UI. Authentication
// remains owned by LibreChat; this facade forwards the existing session.
app.get('/api/chat/profile', async (req, res) => {
  try {
    const upstream = await fetch(`${config.libreChatUrl}/api/auth/me`, {
      headers: upstreamAuthHeaders(req),
    });
    if (!upstream.ok) return res.status(upstream.status).json({});
    const payload = await upstream.json();
    const user = payload?.user || payload;
    return res.json({ email: user?.email || '', username: user?.username || '' });
  } catch {
    return res.json({});
  }
});

// Safe, browser-facing MCP catalog. URLs and credentials stay server-side.
app.get('/api/chat/mcp', async (_req, res) => {
  const servers = await Promise.all([...mcpClients.entries()].map(async ([name, client]) => {
    try {
      const tools = await client.listTools();
      return { name, status: 'connected', toolCount: tools.length, tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema })) };
    } catch (error) {
      return { name, status: 'error', toolCount: 0, tools: [], error: error.message };
    }
  }));
  res.json({ servers });
});

app.post('/api/chat/mcp/:name/test', async (req, res) => {
  const client = mcpClients.get(req.params.name);
  if (!client) return res.status(404).json({ error: 'MCP server is not configured' });
  try {
    const tools = await client.listTools();
    return res.json({ name: req.params.name, status: 'connected', toolCount: tools.length, tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema })) });
  } catch (error) {
    return res.status(502).json({ name: req.params.name, status: 'error', error: error.message });
  }
});

app.get('/api/chat/history', async (_req, res) => {
  const ownerId = getOwnerId(_req, res);
  const history = await readHistory();
  const conversations = Object.values(history)
    .filter((conversation) => conversation.ownerId === ownerId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ ownerId: _ownerId, ...conversation }) => conversation);
  res.json({ conversations });
});

app.post('/api/chat/conversations', async (req, res) => {
  try {
    const ownerId = getOwnerId(req, res);
    const history = await readHistory();
    const id = crypto.randomUUID();
    const conversation = {
      id,
      ownerId,
      title: 'Cuộc trò chuyện mới',
      modelId: resolveModel(req.body?.modelId ?? config.defaultModelId).modelId,
      mcpServers: [],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    history[id] = conversation;
    await writeHistory(history);
    const { ownerId: _ownerId, ...publicConversation } = conversation;
    return res.status(201).json({ conversationId: id, conversation: publicConversation });
  } catch (error) {
    return jsonError(res, error);
  }
});

app.patch('/api/chat/conversations/:conversationId', async (req, res) => {
  try {
    const ownerId = getOwnerId(req, res);
    const history = await readHistory();
    const conversation = history[req.params.conversationId];
    if (!conversation || conversation.ownerId !== ownerId) return res.status(404).json({ error: 'Conversation not found' });
    if (Array.isArray(req.body?.mcpServers)) conversation.mcpServers = req.body.mcpServers;
    conversation.updatedAt = Date.now();
    await writeHistory(history);
    const { ownerId: _ownerId, ...publicConversation } = conversation;
    return res.json({ conversation: publicConversation });
  } catch (error) {
    return jsonError(res, error);
  }
});

app.get('/api/chat/conversations/:conversationId', async (req, res) => {
  const ownerId = getOwnerId(req, res);
  const conversation = (await readHistory())[req.params.conversationId];
  if (!conversation || conversation.ownerId !== ownerId) return res.status(404).json({ error: 'Conversation not found' });
  const { ownerId: _ownerId, ...publicConversation } = conversation;
  res.json({ conversation: publicConversation });
});

app.delete('/api/chat/history/:conversationId', async (req, res) => {
  const ownerId = getOwnerId(req, res);
  const history = await readHistory();
  if (!history[req.params.conversationId] || history[req.params.conversationId].ownerId !== ownerId) return res.status(404).json({ error: 'Conversation not found' });
  delete history[req.params.conversationId];
  await writeHistory(history);
  res.status(204).end();
});

/**
 * The endpoint accepts the normal project contract and the existing LibreChat
 * agent payload. Keeping the latter shape lets us preserve SSE, attachments,
 * tool calls, resume, steering, and conversation metadata during migration.
 */
app.post('/api/chat', async (req, res) => {
  try {
    const body = req.body ?? {};
    const ownerId = getOwnerId(req, res);
    const mapping = {
      ...resolveModel(body.modelId ?? body.model),
      mcpServers: Array.isArray(body.mcpServers) ? body.mcpServers : null,
    };
    const message = (typeof body.message === 'string' ? body.message : body.text ?? body.userMessage?.text ?? '').trim();
    if (!message) {
      const error = new Error('message is required');
      error.statusCode = 400;
      throw error;
    }
    const conversationId = body.conversationId || crypto.randomUUID();
    const history = await readHistory();
    const existingConversation = history[conversationId];
    if (existingConversation && existingConversation.ownerId !== ownerId) throw notFound();
    const conversation = existingConversation ?? {
      id: conversationId,
      ownerId,
      title: message.slice(0, 80),
      modelId: mapping.modelId,
      mcpServers: mapping.mcpServers ?? [],
      messages: [],
      createdAt: Date.now(),
    };
    conversation.ownerId = ownerId;
    conversation.modelId = mapping.modelId;
    // Store the MCP scope with the conversation so reopening or refreshing
    // the page restores the exact tool selection used for this chat.
    conversation.mcpServers = mapping.mcpServers ?? conversation.mcpServers ?? [];
    // Persist the scope before calling Gemini. A provider/MCP failure should
    // not discard the user's selection for the next attempt.
    history[conversationId] = conversation;
    await writeHistory(history);
    conversation.messages.push({ role: 'user', text: message, createdAt: Date.now() });
    const result = await agent.run(conversation, mapping);
    conversation.messages.push({ role: 'assistant', text: result.text, createdAt: Date.now() });
    conversation.updatedAt = Date.now();
    history[conversationId] = conversation;
    await writeHistory(history);
    return res.json({ conversationId, modelId: mapping.modelId, text: result.text, usage: result.usage, conversation });

    /* Legacy LibreChat payload kept below for reference during migration. */
    const isLibreChatPayload = typeof body.text === 'string' || body.userMessage;

    const payload = isLibreChatPayload
      ? {
          ...body,
          endpoint: 'agents',
          agent_id: mapping.agentId,
          modelId: mapping.modelId,
          // `modelId` is the project alias; LibreChat needs the trusted
          // provider model when it builds the agent endpoint option.
          model: mapping.model,
        }
      : {
          text: body.message,
          endpoint: 'agents',
          agent_id: mapping.agentId,
          modelId: mapping.modelId,
          model: mapping.model,
          conversationId: body.conversationId ?? null,
        };

    if (typeof payload.text !== 'string' && !payload.userMessage) {
      const error = new Error('message is required');
      error.statusCode = 400;
      throw error;
    }

    const upstream = await fetch(`${config.libreChatUrl}/api/agents/chat`, {
      method: 'POST',
      headers: {
        ...upstreamAuthHeaders(req),
        'content-type': 'application/json',
        ...(req.get('user-agent') ? { 'user-agent': req.get('user-agent') } : {}),
        accept: req.get('accept') ?? 'text/event-stream',
      },
      body: JSON.stringify(payload),
    });

    return copyUpstreamResponse(upstream, res);
  } catch (error) {
    if (res.headersSent) return res.end();
    return jsonError(res, error);
  }
});

// Keep lifecycle operations behind the same project-owned boundary. The
// browser must not know LibreChat's internal generation routes.
app.all('/api/chat/:path(*)', async (req, res) => {
  try {
    return await proxyGenerationRequest(req, res, req.params.path);
  } catch (error) {
    if (res.headersSent) return res.end();
    return jsonError(res, error);
  }
});

// Do not expose LibreChat's provider/agent routes or user-key APIs through
// the project browser boundary. The only model operation the UI may perform
// is POST /api/chat, with modelId resolved by the server-side allowlist.
app.all(['/api/agents/chat', '/api/agents/chat/:path(*)'], (_req, res) => {
  res.status(403).json({ error: 'Use the project chat endpoint' });
});
app.all(['/api/keys', '/api/keys/:path(*)', '/api/api-keys', '/api/api-keys/:path(*)'], (_req, res) => {
  res.status(403).json({ error: 'API key settings are managed by the project administrator' });
});

// Proxy the remaining LibreChat-compatible UI APIs through this BE. This keeps
// the existing LibreChat interface working while keeping LibreChat off the
// browser network boundary.
app.all('/api/:path(*)', async (req, res) => {
  try {
    const query = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
      : '';
    const upstream = await fetch(`${config.libreChatUrl}/api/${req.params.path}${query}`, {
      method: req.method,
      headers: {
        ...upstreamAuthHeaders(req),
        ...(req.get('content-type') ? { 'content-type': req.get('content-type') } : {}),
        ...(req.get('user-agent') ? { 'user-agent': req.get('user-agent') } : {}),
        accept: req.get('accept') ?? 'application/json, text/event-stream',
      },
      ...(req.method === 'GET' || req.method === 'HEAD'
        ? {}
        : { body: JSON.stringify(req.body ?? {}) }),
    });
    return copyUpstreamResponse(upstream, res);
  } catch (error) {
    if (res.headersSent) return res.end();
    return jsonError(res, error);
  }
});

app.use((error, _req, res, _next) => jsonError(res, error));

app.listen(config.port, config.host, () => {
  console.log(`Chat backend listening on http://${config.host}:${config.port}`);
  console.log(`Forwarding chat requests to ${config.libreChatUrl}`);
});
