import { ChevronUp, Info, NotebookTabs } from 'lucide-react';

function formatTokens(value) {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

export default function ContextWindow({ usage, open, onToggle }) {
  return <div className="context-window-wrap">
    <button type="button" className={`composer-icon context-trigger ${open ? 'active' : ''}`} title="Context window" aria-label="Context window" aria-expanded={open} onClick={onToggle}><NotebookTabs size={18} /></button>
    {open && <section className="context-window" aria-label="Context window">
      <header className="context-window-header"><strong>Context window</strong>{usage && <span>Provider usage</span>}<button type="button" onClick={onToggle} aria-label="Đóng context window"><ChevronUp size={16} /></button></header>
      {!usage ? <div className="context-empty"><Info size={16} /><span>Chưa có dữ liệu usage từ model. Dữ liệu sẽ xuất hiện sau khi Gemini trả lời.</span></div> : <>
        <div className="context-provider-badge">Google Gemini · usageMetadata</div>
        <div className="context-totals context-provider-totals"><strong>USAGE METADATA</strong><div><span>Input tokens</span><b>{formatTokens(usage.promptTokenCount)}</b></div><div><span>Output tokens</span><b>{formatTokens(usage.candidatesTokenCount)}</b></div>{Number.isFinite(usage.thoughtsTokenCount) && <div><span>Thoughts tokens</span><b>{formatTokens(usage.thoughtsTokenCount)}</b></div>}<div><span>Total tokens</span><b>{formatTokens(usage.totalTokenCount)}</b></div></div>
        <p className="context-note"><Info size={13} /> Chỉ hiển thị dữ liệu Gemini cung cấp</p>
      </>}
    </section>}
  </div>;
}
