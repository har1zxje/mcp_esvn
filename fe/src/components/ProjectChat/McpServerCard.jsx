import { Check, Circle, LoaderCircle, RefreshCw, Server, X } from 'lucide-react';

const statusLabels = { connected: 'Đã kết nối', connecting: 'Đang kết nối', error: 'Mất kết nối', unknown: 'Chưa kiểm tra' };

export default function McpServerCard({ server, selected, onToggle, onRefresh, compact = false }) {
  const status = server.status || 'unknown';
  const StatusIcon = status === 'connected' ? Check : status === 'error' ? X : Circle;
  return (
    <div className={`mcp-server-card ${selected ? 'selected' : ''}`}>
      <button type="button" className="mcp-server-main" onClick={onToggle} title={server.label || server.name}>
        <span className={`mcp-server-icon status-${status}`}><Server size={17} /></span>
        <span className="mcp-server-copy"><strong>{server.label || server.name}</strong><small><StatusIcon size={11} /> {compact ? statusLabels[status] : `${statusLabels[status]}${server.toolCount ? ` · ${server.toolCount} tools` : ''}`}</small></span>
      </button>
      <button type="button" className="icon-button mcp-refresh" onClick={onRefresh} disabled={status === 'connecting'} title="Làm mới kết nối" aria-label={`Làm mới ${server.label || server.name}`}>
        {status === 'connecting' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
      </button>
    </div>
  );
}
