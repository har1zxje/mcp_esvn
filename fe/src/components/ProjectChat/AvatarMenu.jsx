import { Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

function getInitials(email) {
  const value = String(email || '').trim();
  if (!value) return 'U';
  return value.split('@')[0].slice(0, 2).toUpperCase();
}

export default function AvatarMenu({ email, theme, onToggleTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isDark = theme === 'dark';

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return <div ref={ref} className="avatar-menu-wrap">
    <button type="button" className="rail-avatar" title="Tài khoản" aria-label="Mở menu tài khoản" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{getInitials(email)}</button>
    {open && <div className="avatar-menu" role="dialog" aria-label="Menu tài khoản">
      <div className="avatar-menu-email" title={email || 'Tài khoản'}>{email || 'Tài khoản'}</div>
      <div className="avatar-menu-divider" />
      <button type="button" className="avatar-theme-item" onClick={onToggleTheme}>
        {isDark ? <Moon size={17} /> : <Sun size={17} />}
        <span>{isDark ? 'Chế độ sáng' : 'Chế độ tối'}</span>
        <span className={`theme-switch ${isDark ? 'is-on' : ''}`} aria-hidden="true"><span /></span>
      </button>
    </div>}
  </div>;
}
