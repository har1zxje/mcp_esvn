/* eslint-disable i18next/no-literal-string */
import { useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useParams } from 'react-router-dom';
import { CalendarDays, CheckSquare, FileText, Lightbulb, Mail, X } from 'lucide-react';
import { Sidebar } from '@librechat/client';
import {
  Constants,
  getConfigDefaults,
  PermissionTypes,
  Permissions,
} from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useHasAccess, useSubmitMessage } from '~/hooks';
import { TraceButton, useTraceControl } from './Trace';
import ExportAndShareMenu from './ExportAndShareMenu';
import { TemporaryChat, TemporaryChatIndicator } from './TemporaryChat';
import store from '~/store';

const defaultInterface = getConfigDefaults().interface;

const quickTools = [
  { label: 'Tạo công việc', prompt: 'Tạo công việc mới giúp tôi', icon: CheckSquare },
  { label: 'Tạo cuộc họp', prompt: 'Giúp tôi tạo một cuộc họp mới', icon: CalendarDays },
  { label: 'Soạn email', prompt: 'Giúp tôi soạn một email', icon: Mail },
  { label: 'Tìm tài liệu', prompt: 'Tìm tài liệu liên quan giúp tôi', icon: FileText },
];
const recentActivities = [
  ['Dự án ERP', 'VFI Work · 10:24', 'Tóm tắt dự án ERP'],
  ['Biên bản họp 12/09', 'AI Meeting · Hôm qua', 'Tóm tắt biên bản họp 12/09'],
  ['Báo cáo kinh doanh Q3', 'Tài liệu · Hôm qua', 'Phân tích báo cáo kinh doanh Q3'],
  ['Chính sách nghỉ phép', 'HRM · 10/09', 'Tìm chính sách nghỉ phép'],
  ['Email từ khách hàng', 'Email · 09/09', 'Soạn phản hồi email từ khách hàng'],
];

export type ContextPanelSection = 'quick' | 'recent';

export default function ContextPanel({
  collapsed,
  onToggle,
  section,
  onSectionChange,
  parentConversationId,
  readOnly = false,
}: {
  collapsed: boolean;
  onToggle: () => void;
  section: ContextPanelSection;
  onSectionChange: (section: ContextPanelSection) => void;
  parentConversationId?: string;
  readOnly?: boolean;
}) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('vfi-tip-dismissed') === '1',
  );
  const { submitMessage } = useSubmitMessage();
  const { data: startupConfig } = useGetStartupConfig();
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(0));
  const { conversationId: routeConversationId } = useParams();
  const isNewChat = routeConversationId == null || routeConversationId === Constants.NEW_CONVO;
  const interfaceConfig = startupConfig?.interface ?? defaultInterface;
  const trace = useTraceControl({
    conversationId: isNewChat ? null : routeConversationId,
    traceViewer: interfaceConfig.traceViewer,
    isSubmitting,
    enabled: !readOnly && parentConversationId == null,
  });
  const hasAccessToTemporaryChat = useHasAccess({
    permissionType: PermissionTypes.TEMPORARY_CHAT,
    permission: Permissions.USE,
  });
  const temporaryChat = hasAccessToTemporaryChat === true ? <TemporaryChat /> : null;
  const buttonClass =
    'pointer-events-auto relative z-20 flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover';
  const shortcutClass = (active = false) =>
    `flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
      active
        ? 'bg-surface-active-alt text-text-primary'
        : 'text-text-secondary hover:bg-surface-hover'
    }`;

  const openSection = (nextSection: ContextPanelSection) => {
    onSectionChange(nextSection);
    if (collapsed) {
      onToggle();
    }
  };

  return (
    <div className="hidden h-full shrink-0 flex-row xl:flex">
      {!collapsed && (
        <aside
          className="sticky top-0 z-10 h-full w-[224px] min-w-[224px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border-light bg-surface-primary-alt p-4 xl:flex"
          aria-label="VFI workspace context"
        >
          <TemporaryChatIndicator />
          {section === 'quick' ? (
            <section className="rounded-xl border border-border-light bg-surface-primary p-3">
              <h2 className="mb-2 text-sm font-semibold text-text-primary">Làm nhanh</h2>
              <div className="space-y-2">
                {quickTools.map(({ label, prompt, icon: Icon }) => (
                  <button
                    type="button"
                    key={label}
                    className="flex w-full items-center gap-2 rounded-lg p-2 text-left hover:bg-surface-hover"
                    onClick={() => submitMessage({ text: prompt })}
                  >
                    <Icon size={18} className="shrink-0 text-text-secondary" />
                    <span className="min-w-0 flex-1 text-xs font-medium text-text-primary">
                      {label}
                    </span>
                    <button
                      type="button"
                      className="hidden"
                      onClick={() => submitMessage({ text: prompt })}
                    >
                      Sử dụng
                    </button>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-border-light bg-surface-primary p-3">
              <h2 className="mb-2 text-sm font-semibold text-text-primary">Gần đây</h2>
              <div className="space-y-2">
                {recentActivities.map(([title, meta, prompt]) => (
                  <div
                    key={title}
                    className="flex items-center gap-2 rounded-lg p-2 hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-text-primary">
                        {title}
                      </span>
                      <span className="block text-[11px] text-text-secondary">{meta}</span>
                    </div>
                    <button
                      type="button"
                      className="hidden"
                      onClick={() => submitMessage({ text: prompt })}
                    >
                      Sử dụng
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {!dismissed && (
            <section className="relative rounded-xl border border-border-light bg-surface-primary p-3">
              <button
                type="button"
                aria-label="Đóng mẹo sử dụng"
                className="absolute right-2 top-2 text-text-secondary"
                onClick={() => {
                  localStorage.setItem('vfi-tip-dismissed', '1');
                  setDismissed(true);
                }}
              >
                <X size={14} />
              </button>
              <div className="flex items-center gap-2 font-semibold text-text-primary">
                <Lightbulb size={16} /> Mẹo sử dụng
              </div>
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                Bạn có thể đặt câu hỏi tự nhiên, ví dụ:
              </p>
              <ul className="mt-1 list-disc pl-4 text-xs leading-5 text-text-secondary">
                <li>Hôm nay tôi có gì cần xử lý?</li>
                <li>Tóm tắt dự án ERP</li>
                <li>Tìm tài liệu quy trình</li>
              </ul>
            </section>
          )}
        </aside>
      )}
      <aside className="sticky top-0 z-10 flex h-full w-12 shrink-0 flex-col items-center gap-1 border-l border-border-light bg-surface-primary-alt px-1.5 py-3">
        <button
          type="button"
          className={buttonClass}
          onPointerDown={onToggle}
          aria-label={collapsed ? 'Mở khung bên phải' : 'Thu gọn khung bên phải'}
          title={collapsed ? 'Mở khung bên phải' : 'Thu gọn khung bên phải'}
          aria-expanded={!collapsed}
        >
          <Sidebar aria-hidden="true" className="h-5 w-5 text-text-primary" />
        </button>
        {trace.show && <TraceButton onClick={trace.open} />}
        <ExportAndShareMenu isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false} />
        <div className="my-2 w-7 border-b border-border-light" />
        {temporaryChat && <div title="Temporary Chat">{temporaryChat}</div>}
        <button
          type="button"
          className={shortcutClass(section === 'quick')}
          onClick={() => openSection('quick')}
          aria-label="Làm nhanh"
          title="Làm nhanh"
          aria-pressed={section === 'quick'}
        >
          <Lightbulb size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={shortcutClass(section === 'recent')}
          onClick={() => openSection('recent')}
          aria-label="Gần đây"
          title="Gần đây"
          aria-pressed={section === 'recent'}
        >
          <FileText size={18} aria-hidden="true" />
        </button>
      </aside>
    </div>
  );
}
