import { ChevronDown, CircleAlert, CheckCircle2, Clock3, LoaderCircle, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';

function parseToolResult(item) {
  let payload;
  try { payload = typeof item.text === 'string' ? JSON.parse(item.text) : item.text; } catch { payload = { success: false, error: { message: item.text } }; }
  const name = item.name || 'unknown_tool';
  const [server, ...toolParts] = name.split('__');
  return { server: toolParts.length ? server : 'MCP', tool: toolParts.length ? toolParts.join('__') : name, success: payload?.success !== false, payload };
}

const planeScopeGuidance = 'Plane đã được kết nối nhưng bạn chưa chọn workspace/project mặc định. Vào Settings → Plane để hoàn tất cấu hình.';

export default function ToolExecutionSummary({ toolCalls = [], onOpenPlaneSettings }) {
  const [expanded, setExpanded] = useState(false);
  const calls = useMemo(() => toolCalls.map(parseToolResult), [toolCalls]);
  if (!calls.length) return null;
  const grouped = calls.reduce((map, call) => map.set(call.server, (map.get(call.server) || 0) + 1), new Map());
  const summary = [...grouped.entries()].map(([server, count]) => `${server}${count > 1 ? ` ×${count}` : ''}`).join(', ');
  const hasError = calls.some((call) => !call.success);
  return <div className={`tool-execution ${hasError ? 'has-error' : ''}`}>
    <button type="button" className="tool-summary-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <Wrench size={16} /><strong>{hasError ? 'Tool execution có lỗi' : `${calls.length} action${calls.length > 1 ? 's' : ''} đã chạy`}</strong><span>· {summary}</span><ChevronDown size={15} className={expanded ? 'rotate-180' : ''} />
    </button>
    {expanded && <div className="tool-execution-list">{calls.map((call, index) => { const scopeRequired = call.payload?.error?.code === 'PLANE_SCOPE_REQUIRED'; const reconnectRequired = call.payload?.error?.requiredScope === 'projects.states:read'; return <div className="tool-execution-item" key={`${call.server}-${call.tool}-${index}`}><span className={`tool-status ${call.success ? 'success' : 'error'}`}>{call.success ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}</span><div><strong>{call.server}</strong><code>{call.tool}</code><small>{call.success ? 'Completed' : reconnectRequired ? 'Plane cần cấp lại quyền projects.states:read. Hãy reconnect Plane.' : scopeRequired ? planeScopeGuidance : call.payload?.error?.message || 'Execution failed'}</small>{scopeRequired && onOpenPlaneSettings && <button type="button" className="tool-plane-settings-action" onClick={onOpenPlaneSettings}>{reconnectRequired ? 'Reconnect Plane' : 'Open Plane Settings'}</button>}</div><Clock3 size={14} className="tool-time" /></div>; })}</div>}
  </div>;
}
