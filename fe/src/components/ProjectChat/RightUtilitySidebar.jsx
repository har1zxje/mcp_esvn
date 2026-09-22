import { BarChart3, CalendarDays, CheckSquare, ClipboardList, FileText, FolderKanban, Lightbulb, Mail, PanelRight, Share2, Users, X } from 'lucide-react';
import { useState } from 'react';

const quickActions = [
  { id: 'task', label: 'Tạo công việc', icon: CheckSquare, prompt: 'Tạo công việc mới' },
  { id: 'meeting', label: 'Tạo cuộc họp', icon: CalendarDays, prompt: 'Tạo cuộc họp mới' },
  { id: 'email', label: 'Soạn email', icon: Mail, prompt: 'Soạn email giúp tôi' },
  { id: 'document', label: 'Tìm tài liệu', icon: FileText, prompt: 'Tìm tài liệu liên quan' },
];

const recentActivities = [
  { title: 'Dự án ERP', meta: 'VFI Work · 10:24', icon: FolderKanban, prompt: 'Tóm tắt dự án ERP' },
  { title: 'Biên bản họp 12/09', meta: 'AI Meeting · Hôm qua', icon: CalendarDays, prompt: 'Tóm tắt biên bản họp 12/09' },
  { title: 'Báo cáo kinh doanh Q3', meta: 'Tài liệu · Hôm qua', icon: BarChart3, prompt: 'Phân tích báo cáo kinh doanh Q3' },
  { title: 'Chính sách nghỉ phép', meta: 'HRM · 10/09', icon: Users, prompt: 'Tìm chính sách nghỉ phép' },
  { title: 'Email từ khách hàng', meta: 'Email · 09/09', icon: Mail, prompt: 'Soạn phản hồi email từ khách hàng' },
];

export default function RightUtilitySidebar({ setValue, collapsed, onToggle }) {
  const [section, setSection] = useState('quick');
  const openPanel = () => { if (collapsed) onToggle(); };
  const openSection = (nextSection) => {
    setSection(nextSection);
    if (collapsed) onToggle();
  };
  return <aside className={`project-rightbar${collapsed ? ' is-collapsed' : ''}`} aria-label="Tiện ích cuộc trò chuyện">
    <div className="utility-toolbar">
      <button type="button" className="utility-toolbar-button" onClick={onToggle} title={collapsed ? 'Mở tiện ích' : 'Thu gọn tiện ích'} aria-label={collapsed ? 'Mở tiện ích' : 'Thu gọn tiện ích'}><PanelRight size={18} /></button>
      <button type="button" className="utility-toolbar-button" onClick={openPanel} title="Chia sẻ" aria-label="Chia sẻ"><Share2 size={18} /></button>
      <button type="button" className="utility-toolbar-button" onClick={openPanel} title="Activity và details" aria-label="Activity và details"><ClipboardList size={18} /></button>
      <button type="button" className={`utility-toolbar-button ${section === 'quick' && !collapsed ? 'active' : ''}`} onClick={() => openSection('quick')} title="Làm nhanh" aria-label="Làm nhanh" aria-pressed={section === 'quick'}><Lightbulb size={18} /></button>
      <button type="button" className={`utility-toolbar-button ${section === 'recent' && !collapsed ? 'active' : ''}`} onClick={() => openSection('recent')} title="Gần đây" aria-label="Gần đây" aria-pressed={section === 'recent'}><ClipboardList size={18} /></button>
    </div>
    {!collapsed && <div className={`utility-panel-content utility-panel-${section}`}>
      <div className="right-card quick-card"><h3>Làm nhanh</h3>{quickActions.map(({ id, label, icon: Icon, prompt }) => <button key={id} type="button" onClick={() => setValue(prompt)}><Icon size={17} />{label}</button>)}</div>
      <div className="right-card tip-card"><div className="tip-title"><Lightbulb size={17} /> Gợi ý <button type="button" onClick={onToggle} title="Đóng" aria-label="Đóng"><X size={15} /></button></div><p>Bạn có thể yêu cầu tôi xử lý công việc, tìm tài liệu hoặc tóm tắt nội dung.</p></div>
      <div className="right-card recent-card"><h3>Gần đây</h3>{recentActivities.map(({ title, meta, icon: Icon, prompt }) => <button key={title} type="button" className="recent-activity" onClick={() => setValue(prompt)}><Icon size={15} /><span><strong>{title}</strong><small>{meta}</small></span></button>)}</div>
    </div>}
  </aside>;
}
