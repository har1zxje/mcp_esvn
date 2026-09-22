import { Bookmark, Check, ChevronDown, Copy, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export default function ChatHeader({ models, modelId, onModelChange, onNewConversation }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const activeModel = models.find((model) => model.modelId === modelId) || models[0];

  useEffect(() => {
    const close = (event) => { if (ref.current && !ref.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return <header className="project-header"><div className="model-picker" ref={ref}><button type="button" className="model-select-wrap" onClick={() => setOpen((value) => !value)} aria-haspopup="listbox" aria-expanded={open}><span className="model-mark">G</span><span className="model-current-name">{activeModel?.label || 'Chọn model'}</span><ChevronDown size={15} className={open ? 'rotate-180' : ''} /></button>{open && <div className="model-menu" role="listbox" aria-label="Danh sách model">{models.map((model) => <button type="button" role="option" aria-selected={model.modelId === modelId} className={`model-option ${model.modelId === modelId ? 'active' : ''}`} key={model.modelId} onClick={() => { onModelChange(model.modelId); setOpen(false); }}><span className="model-option-mark">G</span><span className="model-option-copy"><strong>{model.label}</strong><small>{model.description || model.model || model.provider || model.modelId}</small></span>{model.modelId === modelId && <Check size={16} />}</button>)}</div>}</div><div className="header-actions"><button type="button" className="header-icon" title="Sao chép cuộc trò chuyện" aria-label="Sao chép cuộc trò chuyện"><Copy size={18} /></button><button type="button" className="header-icon" title="Lưu cuộc trò chuyện" aria-label="Lưu cuộc trò chuyện"><Bookmark size={18} /></button><button type="button" className="header-icon" onClick={onNewConversation} title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới"><Plus size={19} /></button></div></header>;
}
