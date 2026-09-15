import crypto from 'node:crypto';
import express from 'express';

const app = express();
const port = Number(process.env.ES_BACKEND_PORT || 4000);
const libreUrl = (process.env.LIBRECHAT_URL || 'http://localhost:3080').replace(/\/$/, '');
const libreEmail = process.env.LIBRECHAT_EMAIL;
const librePassword = process.env.LIBRECHAT_PASSWORD;
const libreAgentId = process.env.LIBRECHAT_AGENT_ID;
let libreToken = null;

app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ES_FRONTEND_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

async function loginToLibreChat() {
  if (!libreEmail || !librePassword) {
    throw new Error('Thiếu LIBRECHAT_EMAIL hoặc LIBRECHAT_PASSWORD.');
  }
  const response = await fetch(`${libreUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: libreUrl, Referer: `${libreUrl}/` },
    body: JSON.stringify({ email: libreEmail, password: librePassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.message || `LibreChat login thất bại (${response.status}).`);
  libreToken = data.token;
  return libreToken;
}

async function libreRequest(path, init = {}, retry = true) {
  const token = libreToken || await loginToLibreChat();
  const headers = { ...(init.headers || {}), Authorization: `Bearer ${token}`, Origin: libreUrl, Referer: `${libreUrl}/` };
  const response = await fetch(`${libreUrl}${path}`, { ...init, headers });
  if (response.status === 401 && retry) { libreToken = null; return libreRequest(path, init, false); }
  return response;
}

function buildLibrePayload({ message, conversationId, parentMessageId, agentId }) {
  const resolvedConversationId = conversationId || 'new';
  return {
    text: message,
    messageId: crypto.randomUUID(),
    parentMessageId: parentMessageId || '00000000-0000-0000-0000-000000000000',
    conversationId: resolvedConversationId,
    isCreatedByUser: true,
    sender: 'User',
    endpoint: 'agents',
    endpointType: 'agents',
    agent_id: agentId || libreAgentId,
    isTemporary: false,
    clientRequestId: crypto.randomUUID(),
  };
}

app.get('/health', (_req, res) => res.json({ ok: true, librechatUrl: libreUrl, hasAgent: Boolean(libreAgentId) }));

app.post('/api/chat', async (req, res) => {
  const { message, conversationId, parentMessageId, agentId } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ message: 'message là bắt buộc.' });
  if (!agentId && !libreAgentId) return res.status(500).json({ message: 'Thiếu LIBRECHAT_AGENT_ID.' });

  try {
    const upstream = await libreRequest('/api/agents/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(buildLibrePayload({ message: message.trim(), conversationId, parentMessageId, agentId })),
    });
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (['content-type', 'cache-control', 'x-accel-buffering'].includes(key.toLowerCase())) res.setHeader(key, value);
    });
    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    console.error('[es-chat-backend]', error);
    if (!res.headersSent) res.status(502).json({ message: error.message || 'Không kết nối được LibreChat.' });
  }
});

app.listen(port, () => console.log(`ES Chat Backend listening on http://localhost:${port}`));
