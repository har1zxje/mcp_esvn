import { FileText, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import McpServerCard from './McpServerCard';

export default function McpSidebar({ servers, selectedServers, onToggle, onRefresh, onNewConversation, conversations, conversationId, onOpenConversation, collapsed, activeSection, onResizeStart }) {
  const [filter, setFilter] = useState('');
  const [chatFilterOpen, setChatFilterOpen] = useState(false);
  const visibleServers = useMemo(() => servers.filter((server) => (server.label || server.name).toLowerCase().includes(filter.toLowerCase())), [servers, filter]);
  const visibleConversations = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return conversations.filter((conversation) => !query || (conversation.title || '').toLowerCase().includes(query));
  }, [conversations, filter]);
  const conversationGroups = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    const groups = [
      { label: 'Today', items: [] },
      { label: 'Previous 7 days', items: [] },
      { label: 'Older', items: [] },
    ];

    visibleConversations.forEach((conversation) => {
      const rawUpdatedAt = conversation.updatedAt || conversation.createdAt || 0;
      const updatedAt = typeof rawUpdatedAt === 'number' ? rawUpdatedAt : Date.parse(rawUpdatedAt) || 0;
      const group = updatedAt >= todayStart ? groups[0] : updatedAt >= weekStart ? groups[1] : groups[2];
      group.items.push(conversation);
    });

    return groups.filter((group) => group.items.length > 0);
  }, [visibleConversations]);
  if (collapsed) return <aside className="project-sidebar mcp-sidebar is-collapsed" aria-hidden="true" />;

  if (activeSection === 'mcp') return <aside className="project-sidebar mcp-sidebar">
    <div className="mcp-sidebar-header"><div><span className="eyebrow">TOOLING</span><strong>MCP Servers</strong></div><button type="button" className="icon-button" onClick={onNewConversation} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới"><Plus size={18} /></button></div>
    <label className="mcp-filter"><Search size={15} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter MCP servers by name" /></label>
    <div className="mcp-server-list">{visibleServers.map((server) => <McpServerCard key={server.name} server={server} selected={selectedServers.includes(server.name)} onToggle={() => onToggle(server.name)} onRefresh={() => onRefresh(server.name)} />)}</div><div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="Điều chỉnh độ rộng sidebar" onPointerDown={onResizeStart} />
  </aside>;

  return <aside className="project-sidebar mcp-sidebar">
    <div className="sidebar-project-heading"><strong>Projects</strong></div>
    <div className="project-tree-item" aria-label="Project workspace"><FileText size={16} /><span>Project workspace</span></div>
    <div className="sidebar-section-heading"><strong>Chats</strong><div><button type="button" className="icon-button" onClick={onNewConversation} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới"><Plus size={17} /></button><button type="button" className={`icon-button ${chatFilterOpen ? 'active' : ''}`} onClick={() => setChatFilterOpen((value) => !value)} title="Lọc cuộc trò chuyện" aria-label="Lọc cuộc trò chuyện"><SlidersHorizontal size={15} /></button></div></div>
    {chatFilterOpen && <label className="mcp-filter chat-filter"><Search size={15} /><input autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Lọc cuộc trò chuyện" /><button type="button" onClick={() => { setFilter(''); setChatFilterOpen(false); }} aria-label="Xóa bộ lọc"><X size={14} /></button></label>}
    <div className="conversation-history conversation-history-panel">{conversationGroups.length ? conversationGroups.map((group) => <section key={group.label} className="conversation-group"><div className="conversation-period">{group.label}</div>{group.items.map((conversation) => <button type="button" className={`conversation-history-item ${conversation.id === conversationId ? 'active' : ''}`} key={conversation.id} onClick={() => onOpenConversation(conversation)} title={conversation.title}><span className="conversation-icon"><FileText size={14} /></span><span>{conversation.title || 'Cuộc trò chuyện mới'}</span></button>)}</section>) : <p className="conversation-empty">{conversations.length ? 'Không tìm thấy cuộc trò chuyện.' : 'Chưa có cuộc trò chuyện nào.'}</p>}</div>
    <div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="Điều chỉnh độ rộng sidebar" onPointerDown={onResizeStart} />
  </aside>;
}
