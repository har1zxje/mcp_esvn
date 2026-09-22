import { CalendarDays, CheckSquare, ClipboardList, FileText, Lightbulb, Mail, PanelRight, Share2, X } from 'lucide-react';

const quickActions = [
  { id: 'task', label: 'Tạo công việc', icon: CheckSquare, prompt: 'Tạo công việc mới' },
  { id: 'meeting', label: 'Tạo cuộc họp', icon: CalendarDays, prompt: 'Tạo cuộc họp mới' },
  { id: 'email', label: 'Soạn email', icon: Mail, prompt: 'Soạn email giúp tôi' },
  { id: 'document', label: 'Tìm tài liệu', icon: FileText, prompt: 'Tìm tài liệu liên quan' },
];

export default function RightUtilitySidebar({ setValue, collapsed, onToggle }) {
  const openPanel = () => { if (collapsed) onToggle(); };
  return <aside className={`project-rightbar${collapsed ? ' is-collapsed' : ''}`} aria-label="Tiện ích cuộc trò chuyện">
    <div className="utility-toolbar">
      <button type="button" className="utility-toolbar-button" onClick={onToggle} title={collapsed ? 'Mở tiện ích' : 'Thu gọn tiện ích'} aria-label={collapsed ? 'Mở tiện ích' : 'Thu gọn tiện ích'}><PanelRight size={18} /></button>
      <button type="button" className="utility-toolbar-button" onClick={openPanel} title="Chia sẻ" aria-label="Chia sẻ"><Share2 size={18} /></button>
      <button type="button" className="utility-toolbar-button" onClick={openPanel} title="Gợi ý" aria-label="Gợi ý"><Lightbulb size={18} /></button>
      <button type="button" className="utility-toolbar-button" onClick={openPanel} title="Activity và details" aria-label="Activity và details"><ClipboardList size={18} /></button>
    </div>
    {!collapsed && <div className="utility-panel-content">
      <div className="right-card quick-card"><h3>Làm nhanh</h3>{quickActions.map(({ id, label, icon: Icon, prompt }) => <button key={id} type="button" onClick={() => setValue(prompt)}><Icon size={17} />{label}</button>)}</div>
      <div className="right-card tip-card"><div className="tip-title"><Lightbulb size={17} /> Gợi ý <button type="button" onClick={onToggle} title="Đóng" aria-label="Đóng"><X size={15} /></button></div><p>Bạn có thể yêu cầu tôi xử lý công việc, tìm tài liệu hoặc tóm tắt nội dung.</p></div>
    </div>}
  </aside>;
}
