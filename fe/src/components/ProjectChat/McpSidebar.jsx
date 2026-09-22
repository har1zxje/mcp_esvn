import { ChevronDown, FileText, Folder, FolderOpen, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import McpServerCard from './McpServerCard';

export default function McpSidebar({ servers, selectedServers, onToggle, onRefresh, onNewConversation, conversations, conversationId, onOpenConversation, collapsed, activeSection, onResizeStart }) {
  const [filter, setFilter] = useState('');
  const visibleServers = useMemo(() => servers.filter((server) => (server.label || server.name).toLowerCase().includes(filter.toLowerCase())), [servers, filter]);
  if (collapsed) return <aside className="project-sidebar mcp-sidebar is-collapsed" aria-hidden="true" />;

  if (activeSection === 'mcp') return <aside className="project-sidebar mcp-sidebar">
    <div className="mcp-sidebar-header"><div><span className="eyebrow">TOOLING</span><strong>MCP Servers</strong></div><button type="button" className="icon-button" onClick={onNewConversation} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới"><Plus size={18} /></button></div>
    <label className="mcp-filter"><Search size={15} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter MCP servers by name" /></label>
    <div className="mcp-server-list">{visibleServers.map((server) => <McpServerCard key={server.name} server={server} selected={selectedServers.includes(server.name)} onToggle={() => onToggle(server.name)} onRefresh={() => onRefresh(server.name)} />)}</div><div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="Điều chỉnh độ rộng sidebar" onPointerDown={onResizeStart} />
  </aside>;

  return <aside className="project-sidebar mcp-sidebar">
    <div className="sidebar-project-heading"><button type="button" className="sidebar-heading-button"><span>Projects</span><ChevronDown size={15} /></button><button type="button" className="icon-button" aria-label="Tạo project"><Folder size={17} /></button></div>
    <button type="button" className="project-tree-item"><FolderOpen size={16} /><span>Project workspace</span><ChevronDown size={13} /></button>
    <div className="sidebar-section-heading"><strong>Chats</strong><div><button type="button" className="icon-button" onClick={onNewConversation} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới"><Plus size={17} /></button><button type="button" className="icon-button" title="Lọc cuộc trò chuyện" aria-label="Lọc cuộc trò chuyện"><SlidersHorizontal size={15} /></button></div></div>
    <div className="conversation-period">Previous 7 days</div>
    <div className="conversation-history conversation-history-panel">{conversations.length ? conversations.map((conversation) => <button type="button" className={`conversation-history-item ${conversation.id === conversationId ? 'active' : ''}`} key={conversation.id} onClick={() => onOpenConversation(conversation)} title={conversation.title}><span className="conversation-icon"><FileText size={14} /></span><span>{conversation.title || 'Cuộc trò chuyện mới'}</span><span className="conversation-more">···</span></button>) : <p className="conversation-empty">Chưa có cuộc trò chuyện nào.</p>}</div>
    <div className="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="Điều chỉnh độ rộng sidebar" onPointerDown={onResizeStart} />
  </aside>;
}
