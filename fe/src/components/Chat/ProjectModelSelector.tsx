import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EModelEndpoint } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import store from '~/store';

type ProjectModel = {
  modelId: string;
  label: string;
  provider?: string | null;
  model?: string | null;
};

const fetchProjectModels = async (): Promise<ProjectModel[]> => {
  const response = await fetch('/api/chat/models');
  if (!response.ok) throw new Error(`Unable to load project models (${response.status})`);
  const data = (await response.json()) as { models?: ProjectModel[] };
  return data.models ?? [];
};

/** Project-owned model picker. It deliberately has no API-key or endpoint settings. */
export default function ProjectModelSelector() {
  const localize = useLocalize();
  const { data: models = [], isLoading, isError } = useQuery({
    queryKey: ['project-models'],
    queryFn: fetchProjectModels,
    staleTime: 5 * 60 * 1000,
  });
  const conversation = store.useCreateConversationAtom(0).conversation;
  const { setConversation } = store.useSetConversationAtom(0);

  const selectedModel = useMemo(() => {
    if (models.length === 0) return '';
    return models.some((model) => model.modelId === conversation?.model)
      ? (conversation?.model as string)
      : models[0].modelId;
  }, [conversation?.model, models]);

  useEffect(() => {
    if (!selectedModel) return;
    if (conversation?.endpoint === EModelEndpoint.agents && conversation.model === selectedModel) {
      return;
    }
    setConversation((current) => current && ({
      ...current,
      endpoint: EModelEndpoint.agents,
      model: selectedModel,
      agent_id: undefined,
    }));
  }, [conversation?.endpoint, conversation?.model, selectedModel, setConversation]);

  const onChange = (modelId: string) => {
    setConversation((current) => current && ({
      ...current,
      endpoint: EModelEndpoint.agents,
      model: modelId,
      agent_id: undefined,
    }));
  };

  return (
    <label className="flex h-9 max-w-[260px] items-center rounded-xl border border-border-light bg-presentation px-3 text-sm text-text-primary">
      <span className="sr-only">{localize('com_ui_select_model')}</span>
      <select
        data-testid="project-model-selector"
        aria-label={localize('com_ui_select_model')}
        value={selectedModel}
        onChange={(event) => onChange(event.target.value)}
        disabled={isLoading || isError || models.length === 0}
        className="max-w-[220px] truncate bg-transparent outline-none"
      >
        {isLoading && <option value="">Đang tải model...</option>}
        {isError && <option value="">Không tải được model</option>}
        {models.map((model) => (
          <option key={model.modelId} value={model.modelId}>
            {model.label}
          </option>
        ))}
      </select>
    </label>
  );
}
