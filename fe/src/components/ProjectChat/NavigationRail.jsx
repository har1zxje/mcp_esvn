import { MessageSquare, PanelLeft, Plus, Settings, Wrench } from 'lucide-react';
import AvatarMenu from './AvatarMenu';

const items = [
  ['menu', PanelLeft, 'Mở sidebar'], ['new', Plus, 'Cuộc trò chuyện mới'],
  ['conversations', MessageSquare, 'Cuộc trò chuyện'], ['mcp', Wrench, 'MCP tools'],
  ['settings', Settings, 'Integration settings'],
];

export default function NavigationRail({ onNewConversation, onToggleSidebar, onShowSidebar, activeSection, onSectionChange, userEmail, theme, onToggleTheme, onLogout }) {
  return <aside className="project-rail" aria-label="Điều hướng">
    <div className="rail-items">{items.map(([id, Icon, label]) => <button key={id} type="button" className={`rail-icon ${id === activeSection ? 'active' : ''}`} title={label} aria-label={label} onClick={id === 'menu' ? onToggleSidebar : id === 'new' ? onNewConversation : ['conversations', 'mcp', 'settings'].includes(id) ? () => { onSectionChange(id); onShowSidebar(); } : undefined}><Icon size={19} strokeWidth={2.1} /></button>)}</div>
    <div className="rail-spacer" />
    <AvatarMenu email={userEmail} theme={theme} onToggleTheme={onToggleTheme} onLogout={onLogout} />
  </aside>;
}
