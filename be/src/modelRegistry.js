import { config } from './config.js';

export function resolveModel(modelId) {
  const selectedId = modelId || config.defaultModelId;
  const direct = config.modelMap[selectedId];
  const alias = Object.entries(config.modelMap).find(([, entry]) => entry.agentId === selectedId);
  const mapping = direct ?? alias?.[1];
  if (!mapping) {
    const error = new Error(`Unknown modelId: ${selectedId || '(empty)'}`);
    error.statusCode = 400;
    throw error;
  }
  const resolvedModelId = direct ? selectedId : alias[0];
  return { modelId: resolvedModelId, ...mapping };
}

export function publicModels() {
  return Object.entries(config.modelMap).map(([modelId, mapping]) => ({
    modelId,
    label: mapping.label ?? modelId,
    description: mapping.description ?? null,
    provider: mapping.provider ?? null,
    model: mapping.model ?? null,
  }));
}
