import { useMemo, useCallback } from 'react';
import { EModelEndpoint, Constants } from 'librechat-data-provider';
import {
  useGetAssistantDocsQuery,
  useGetEndpointsQuery,
  useGetStartupConfig,
} from '~/data-provider';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import { getIconEndpoint, getEntity, getModelSpec } from '~/utils';
import { useSubmitMessage } from '~/hooks';
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  FileText,
  Lightbulb,
  Mail,
  MoreHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react';

const legacyConversationStarters = [
  'Tóm tắt email chưa đọc',
  'Danh sách công việc hôm nay',
  'Lịch họp trong ngày',
  'Tìm tài liệu liên quan',
  'Xem yêu cầu nghỉ phép',
  'Báo cáo tiến độ dự án',
  'Phân tích dữ liệu kinh doanh',
  'Khác',
];

const defaultConversationStarters = [
  'Tóm tắt email chưa đọc',
  'Danh sách công việc hôm nay',
  'Lịch họp trong ngày',
  'Tìm tài liệu liên quan',
  'Xem yêu cầu nghỉ phép',
  'Báo cáo tiến độ dự án',
  'Phân tích dữ liệu kinh doanh',
  'Khác',
];

const starterIcons: Array<{ icon: LucideIcon; tone: string }> = [
  { icon: Mail, tone: 'text-blue-500 bg-blue-50' },
  { icon: CheckSquare, tone: 'text-emerald-500 bg-emerald-50' },
  { icon: CalendarDays, tone: 'text-violet-500 bg-violet-50' },
  { icon: FileText, tone: 'text-blue-500 bg-blue-50' },
  { icon: Users, tone: 'text-orange-500 bg-orange-50' },
  { icon: BarChart3, tone: 'text-pink-500 bg-pink-50' },
  { icon: Lightbulb, tone: 'text-amber-500 bg-amber-50' },
  { icon: MoreHorizontal, tone: 'text-slate-500 bg-slate-100' },
];

const ConversationStarters = () => {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();

  const endpointType = useMemo(() => {
    let ep = conversation?.endpoint ?? '';
    if (ep === EModelEndpoint.azureOpenAI) {
      ep = EModelEndpoint.openAI;
    }
    return getIconEndpoint({
      endpointsConfig,
      iconURL: conversation?.iconURL,
      endpoint: ep,
    });
  }, [conversation?.endpoint, conversation?.iconURL, endpointsConfig]);

  const { data: documentsMap = new Map() } = useGetAssistantDocsQuery(endpointType, {
    select: (data) => new Map(data.map((dbA) => [dbA.assistant_id, dbA])),
  });

  const { entity, isAgent } = getEntity({
    endpoint: endpointType,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });

  const modelSpec = useMemo(
    () => getModelSpec({ specName: conversation?.spec, startupConfig }),
    [conversation?.spec, startupConfig],
  );

  const conversation_starters = useMemo(() => {
    if (entity?.conversation_starters?.length) {
      return entity.conversation_starters;
    }

    if (modelSpec?.conversation_starters?.length) {
      return modelSpec.conversation_starters;
    }

    if (isAgent) {
      return [];
    }

    return documentsMap.get(entity?.id ?? '')?.conversation_starters ?? defaultConversationStarters;
  }, [documentsMap, isAgent, entity, modelSpec]);

  const { submitMessage } = useSubmitMessage();
  const sendConversationStarter = useCallback(
    (text: string) => submitMessage({ text }),
    [submitMessage],
  );

  if (!conversation_starters.length) {
    return null;
  }

  return (
    <div className="mb-8 mt-2 grid w-full grid-cols-2 gap-2 px-4 sm:grid-cols-4">
      {conversation_starters
        .slice(0, Constants.MAX_CONVO_STARTERS)
        .map((text: string, index: number) => {
          const { icon: Icon, tone } = starterIcons[index] ?? starterIcons[7];
          return (
            <button
              key={index}
              onClick={() => sendConversationStarter(text)}
              style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}
              className="flex min-h-[52px] cursor-pointer items-center gap-2 rounded-xl border border-border-light bg-surface-primary px-3 py-2 text-left text-xs text-text-secondary shadow-sm transition-colors duration-200 fade-in hover:border-blue-300 hover:bg-blue-50/50 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary sm:text-sm"
            >
              <span className={`shrink-0 rounded-lg p-1.5 ${tone}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="line-clamp-2 text-balance break-words">{text}</span>
            </button>
          );
        })}
    </div>
  );
};

export default ConversationStarters;
