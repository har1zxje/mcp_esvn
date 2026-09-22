import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '../project-standalone.css';
import '../project-chat-position.css';
import NavigationRail from './ProjectChat/NavigationRail';
import McpSidebar from './ProjectChat/McpSidebar';
import ChatHeader from './ProjectChat/ChatHeader';
import ProjectMessage from './ProjectChat/ProjectMessage';
import ChatComposer from './ProjectChat/ChatComposer';
import RightUtilitySidebar from './ProjectChat/RightUtilitySidebar';

const fallbackModels = [{ modelId: 'gemini_flash', label: 'Gemini 3.5 Flash', model: 'gemini-3.5-flash' }, { modelId: 'gemini_flash_lite', label: 'Gemini 3.5 Flash Lite', model: 'gemini-3.5-flash-lite' }, { modelId: 'gemini_25_flash', label: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash' }];
const defaultServers = [{ name: 'plane', label: 'Plane', status: 'unknown', toolCount: 0, tools: [] }, { name: 'discord', label: 'Discord', status: 'unknown', toolCount: 0, tools: [] }, { name: 'clickhouse', label: 'ClickHouse', status: 'unknown', toolCount: 0, tools: [] }];
const MCP_SELECTIONS_KEY = 'project-mcp-selections';
const PROJECT_THEME_KEY = 'project-theme';

function readMcpSelections() {
  try { return JSON.parse(localStorage.getItem(MCP_SELECTIONS_KEY) || '{}'); } catch { return {}; }
}

function saveMcpSelection(conversationId, servers) {
  if (!conversationId) return;
  const selections = readMcpSelections();
  selections[conversationId] = servers;
  localStorage.setItem(MCP_SELECTIONS_KEY, JSON.stringify(selections));
}

async function readChatResponse(response, onStreamText) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) { const payload = await response.json(); if (payload?.usage) window.dispatchEvent(new CustomEvent('project-context-usage', { detail: payload.usage })); return payload; }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let text = ''; let finalPayload = null;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const events = buffer.split('\n\n'); buffer = events.pop() || '';
    for (const event of events) {
      const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
      if (!data || data === '[DONE]') continue;
      try { const payload = JSON.parse(data); if (payload.error) { const error = new Error(payload.action ? `${payload.error} ${payload.action}` : payload.error); error.code = payload.code; throw error; } if (payload.usage) window.dispatchEvent(new CustomEvent('project-context-usage', { detail: payload.usage })); if (payload.conversation) finalPayload = payload; else { const chunk = payload.delta || payload.text || payload.content || ''; if (chunk) { text += chunk; onStreamText(text); } } } catch (error) { if (error?.code) throw error; /* tolerate keepalive events */ }
    }
  }
  return finalPayload || { text, conversation: null };
}

function groupMessages(messages) {
  const rows = []; let toolCalls = [];
  for (const message of messages) {
    if (message.role === 'tool_result') { toolCalls.push(message); continue; }
    rows.push({ message, toolCalls: message.role === 'assistant' ? toolCalls : [] });
    if (message.role === 'assistant') toolCalls = [];
  }
  return rows;
}

async function getApiError(response) {
  const payload = await response.json().catch(() => null);
  const message = payload?.error || `HTTP ${response.status}`;
  const error = new Error(payload?.action ? `${message} ${payload.action}` : message);
  error.status = response.status;
  error.code = payload?.code;
  error.requestId = payload?.requestId;
  return error;
}

export default function ProjectStandaloneApp() {
  const navigate = useNavigate();
  const { conversationId: routeConversationId } = useParams();
  const [messages, setMessages] = useState([]); const [value, setValue] = useState(''); const [editingMessageId, setEditingMessageId] = useState(null); const [conversationId, setConversationId] = useState(null); const [conversations, setConversations] = useState([]); const [models, setModels] = useState(fallbackModels); const [modelId, setModelId] = useState(fallbackModels[0].modelId); const [servers, setServers] = useState(defaultServers); const [selectedServers, setSelectedServers] = useState([]); const [isSending, setIsSending] = useState(false);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => localStorage.getItem('project-left-sidebar-collapsed') === 'true');
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => Math.min(Math.max(Number(localStorage.getItem('project-left-sidebar-width')) || 270, 250), 520));
  const [activeSection, setActiveSection] = useState('conversations');
  const [userEmail, setUserEmail] = useState('');
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(PROJECT_THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [contextUsage, setContextUsage] = useState(null);
  const composerRef = useRef(null);
  useEffect(() => { const handleContextUsage = (event) => setContextUsage(event.detail || null); window.addEventListener('project-context-usage', handleContextUsage); return () => window.removeEventListener('project-context-usage', handleContextUsage); }, []);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => localStorage.getItem('project-right-sidebar-collapsed') !== 'false');
  const [error, setError] = useState(''); const [statusMessage, setStatusMessage] = useState(''); const controllerRef = useRef(null); const leftResizeRef = useRef(null);

  const startLeftResize = (event) => {
    if (leftSidebarCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftSidebarWidth;
    let currentWidth = startWidth;
    const move = (moveEvent) => {
      currentWidth = Math.min(Math.max(startWidth + moveEvent.clientX - startX, 250), Math.min(520, Math.round(window.innerWidth * 0.4)));
      setLeftSidebarWidth(currentWidth);
    };
    const stop = () => {
      document.body.style.userSelect = '';
      localStorage.setItem('project-left-sidebar-width', String(currentWidth));
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      leftResizeRef.current = null;
    };
    document.body.style.userSelect = 'none';
    leftResizeRef.current = { move, stop };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop, { once: true });
  };

  useEffect(() => () => {
    if (leftResizeRef.current) {
      document.removeEventListener('pointermove', leftResizeRef.current.move);
      document.removeEventListener('pointerup', leftResizeRef.current.stop);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.projectTheme = theme;
    localStorage.setItem(PROJECT_THEME_KEY, theme);
    return () => { delete document.documentElement.dataset.projectTheme; };
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/chat/profile', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((profile) => { if (!cancelled) setUserEmail(profile?.email || profile?.username || ''); })
      .catch(() => { if (!cancelled) setUserEmail(''); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    localStorage.setItem('project-left-sidebar-collapsed', String(leftSidebarCollapsed));
  }, [leftSidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('project-right-sidebar-collapsed', String(rightSidebarCollapsed));
  }, [rightSidebarCollapsed]);
  const activeModel = useMemo(() => models.find((model) => model.modelId === modelId) || models[0], [models, modelId]); const groupedMessages = useMemo(() => groupMessages(messages), [messages]);
  const editMessage = (message) => {
    setEditingMessageId(message.createdAt ?? null);
    setValue(message.text || '');
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };
  const loadServers = async () => {
    try { const response = await fetch('/api/chat/mcp'); if (!response.ok) throw new Error('Không thể tải trạng thái MCP'); const result = await response.json(); const configured = new Map((result.servers || []).map((item) => [item.name, item])); setServers((current) => [...current.filter((server) => !configured.has(server.name)), ...[...configured.values()].map((server) => ({ ...server, label: server.label || server.name }))]); }
    catch (loadError) { setError(loadError.message); }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [modelsResponse, historyResponse] = await Promise.all([fetch('/api/chat/models'), fetch('/api/chat/history')]);
        const modelData = await modelsResponse.json();
        const historyData = await historyResponse.json();
        if (cancelled) return;
        const nextModels = modelData.models?.length ? modelData.models : fallbackModels;
        setModels(nextModels);
        setModelId(nextModels[0].modelId);
        setConversations(historyData.conversations || []);
        if (routeConversationId && routeConversationId !== 'new') {
          const conversationResponse = await fetch(`/api/chat/conversations/${encodeURIComponent(routeConversationId)}`);
          if (!conversationResponse.ok) throw new Error((await conversationResponse.json().catch(() => null))?.error || 'Không tìm thấy cuộc trò chuyện');
          const { conversation } = await conversationResponse.json();
          if (cancelled) return;
          // The local selection is updated immediately when a checkbox is
          // clicked. Prefer it during same-tab navigation; backend data is the
          // fallback for a fresh browser/session.
          const savedSelections = readMcpSelections()[conversation.id];
          const nextServers = Array.isArray(savedSelections) ? savedSelections : (Array.isArray(conversation.mcpServers) ? conversation.mcpServers : []);
          setConversationId(conversation.id);
          setMessages(conversation.messages || []);
          setModelId(conversation.modelId || nextModels[0].modelId);
          setSelectedServers(nextServers);
          saveMcpSelection(conversation.id, nextServers);
        } else {
          setConversationId(null);
          setMessages([]);
          setSelectedServers(Array.isArray(readMcpSelections().new) ? readMcpSelections().new : []);
        }
      } catch (loadError) { if (!cancelled) setError(loadError.message); }
    };
    load();
    loadServers();
    return () => { cancelled = true; };
  }, [routeConversationId]);

  const newConversation = () => {
    controllerRef.current?.abort();
    setMessages([]); setConversationId(null); setSelectedServers([]); saveMcpSelection('new', []); setError(''); setStatusMessage(''); setIsSending(false);
    navigate('/chat/new');
  };
  const stop = () => {
    controllerRef.current?.abort();
    setStatusMessage('Đã dừng tạo câu trả lời.');
    setIsSending(false);
  };
  const openConversation = (conversation) => { controllerRef.current?.abort(); const savedSelections = readMcpSelections()[conversation.id]; const nextServers = Array.isArray(savedSelections) ? savedSelections : (Array.isArray(conversation.mcpServers) ? conversation.mcpServers : []); setConversationId(conversation.id); setMessages(conversation.messages || []); setModelId(conversation.modelId || modelId); setSelectedServers(nextServers); saveMcpSelection(conversation.id, nextServers); setError(''); setIsSending(false); navigate(`/chat/${conversation.id}`); };
  const toggleServer = (name) => setSelectedServers((current) => {
    const next = current.includes(name) ? current.filter((item) => item !== name) : [...current, name];
    const activeConversationId = conversationId || 'new';
    saveMcpSelection(activeConversationId, next);
    if (conversationId) {
      fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mcpServers: next }),
      }).catch(() => { /* local selection remains available if sync fails */ });
    }
    return next;
  });
  const testServer = async (name) => { setServers((current) => current.map((server) => server.name === name ? { ...server, status: 'connecting' } : server)); try { const response = await fetch(`/api/chat/mcp/${encodeURIComponent(name)}/test`, { method: 'POST' }); const result = await response.json(); setServers((current) => current.map((server) => server.name === name ? { ...server, ...result } : server)); } catch (testError) { setServers((current) => current.map((server) => server.name === name ? { ...server, status: 'error', error: testError.message } : server)); } };

  const send = async (event) => {
    event.preventDefault(); const message = value.trim(); if (!message || isSending) return; const editedMessageId = editingMessageId; setEditingMessageId(null); setValue(''); setError(''); setStatusMessage(''); setMessages((current) => { const withoutOldBranch = editedMessageId == null ? current : current.slice(0, current.findIndex((item) => item.role === 'user' && item.createdAt === editedMessageId)); return [...withoutOldBranch.filter((item) => !item.streaming), { role: 'user', text: message, createdAt: Date.now() }]; }); setIsSending(true); const controller = new AbortController(); controllerRef.current = controller;
    try { const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ message, conversationId, modelId, mcpServers: selectedServers }), signal: controller.signal }); if (!response.ok) throw await getApiError(response); const payload = await readChatResponse(response, (text) => setMessages((current) => [...current.filter((item) => !item.streaming), { role: 'assistant', text, streaming: true, createdAt: Date.now() }])); if (payload.conversation) { const nextConversationId = payload.conversationId || payload.conversation.id; setConversationId(nextConversationId); setSelectedServers(Array.isArray(payload.conversation.mcpServers) ? payload.conversation.mcpServers : selectedServers); saveMcpSelection(nextConversationId, selectedServers); setMessages(payload.conversation.messages || []); setConversations((current) => [payload.conversation, ...current.filter((item) => item.id !== payload.conversation.id)]); if (!conversationId) navigate(`/chat/${nextConversationId}`); } else if (payload.text) { setMessages((current) => [...current.filter((item) => !item.streaming), { role: 'assistant', text: payload.text, createdAt: Date.now() }]); } else { throw new Error('Backend không trả về nội dung phản hồi'); } }
    catch (sendError) { if (sendError.name !== 'AbortError') { console.error('[project-chat] request failed', { status: sendError.status, code: sendError.code, requestId: sendError.requestId, message: sendError.message }); setError(sendError.message); } } finally { if (controllerRef.current === controller) controllerRef.current = null; setIsSending(false); }
  };

  const connectedCount = servers.filter((server) => server.status === 'connected').length;
  return <div className={`project-app project-theme-${theme}${leftSidebarCollapsed ? ' left-sidebar-collapsed' : ''}${rightSidebarCollapsed ? ' right-sidebar-collapsed' : ''}`} style={{ '--project-sidebar-width': `${leftSidebarWidth}px` }}>
    <NavigationRail activeSection={activeSection} onSectionChange={setActiveSection} onNewConversation={newConversation} onToggleSidebar={() => setLeftSidebarCollapsed((value) => !value)} onShowSidebar={() => setLeftSidebarCollapsed(false)} userEmail={userEmail} theme={theme} onToggleTheme={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} />
    <McpSidebar activeSection={activeSection} collapsed={leftSidebarCollapsed} servers={servers} selectedServers={selectedServers} onToggle={toggleServer} onRefresh={testServer} onNewConversation={newConversation} conversations={conversations} conversationId={conversationId} onOpenConversation={openConversation} onResizeStart={startLeftResize} />
    <main className="project-main"><ChatHeader models={models} modelId={modelId} onModelChange={setModelId} onNewConversation={newConversation} /><section className="project-messages" aria-live="polite">{groupedMessages.length === 0 ? <div className="project-empty"><div className="project-empty-logo">✦</div><h2>Xin chào Hải Đào!</h2><p>Tôi có thể hỗ trợ gì cho bạn hôm nay?</p></div> : groupedMessages.map(({ message, toolCalls }, index) => <ProjectMessage key={`${message.role}-${message.createdAt || index}`} message={message} toolCalls={toolCalls} modelLabel={activeModel?.label} onEdit={editMessage} />)}{isSending && <div className="project-status"><span className="project-spinner" /> {selectedServers.length ? 'Gemini đang suy nghĩ và gọi MCP…' : 'Gemini đang tạo câu trả lời…'}</div>}{statusMessage && !isSending && <div className="project-status project-status-stopped">{statusMessage}</div>}</section><ChatComposer inputRef={composerRef} value={value} setValue={setValue} onSend={send} onStop={stop} isSending={isSending} servers={servers} selectedServers={selectedServers} onToggleServer={toggleServer} contextUsage={contextUsage} placeholder={`Message ${activeModel?.label || 'Gemini'}`} /><footer className="project-disclaimer">{error || `${connectedCount}/${servers.length} MCP server đã kết nối · AI có thể mắc lỗi, hãy kiểm tra thông tin quan trọng.`}</footer></main>
    <RightUtilitySidebar setValue={setValue} collapsed={rightSidebarCollapsed} onToggle={() => setRightSidebarCollapsed((value) => !value)} />
  </div>;
}
