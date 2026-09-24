const TARGET_CONNECTORS = /(?:\b(?:tren|bang|qua|su dung|dung|vao|on|in|using|via|through|from|to|tu|sang)\b)\s+/giu;
const TARGET_STOP_WORDS = new Set(['va', 'dat', 'ten', 'co', 'name', 'is', 'named', 'called', 'with', 'gui', 'sang']);

function normalizeText(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function comparable(value) {
  return normalizeText(value).trim().replace(/(?:mcp|server)$/i, '').replace(/[^\p{L}\p{N}]/gu, '');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function registeredTargetPattern(knownServers) {
  const targets = [...new Set((knownServers ?? []).map(comparable).filter(Boolean))]
    .sort((left, right) => right.length - left.length).map(escapeRegex);
  return targets.length > 0
    ? new RegExp(`(?<![\\p{L}\\p{N}])(${targets.join('|')})(?![\\p{L}\\p{N}])`, 'gu')
    : null;
}

function extractTargetsAfterConnectors(text, knownServers) {
  const normalized = normalizeText(text);
  const targets = [];
  const registeredPattern = registeredTargetPattern(knownServers);

  if (registeredPattern) {
    for (const match of normalized.matchAll(registeredPattern)) targets.push(comparable(match[1]));
    return [...new Set(targets)];
  }

  for (const connector of normalized.matchAll(TARGET_CONNECTORS)) {
    const remainder = normalized.slice(connector.index + connector[0].length);
    // Keep mismatch protection for unknown targets, but consume one token only.
    const token = remainder.match(/^[\p{L}\p{N}_.:-]+/u)?.[0];
    if (token && !TARGET_STOP_WORDS.has(token)) targets.push(comparable(token));
  }

  return [...new Set(targets)];
}

export function extractExplicitMcpTargets(text, knownServers = []) {
  if (typeof text !== 'string') return [];
  return extractTargetsAfterConnectors(text, knownServers);
}

export function extractExplicitMcpTarget(text, knownServers = []) {
  return extractExplicitMcpTargets(text, knownServers)[0];
}

export function validateMcpServerTarget(text, actualServer, knownServers = []) {
  const requestedTargets = extractExplicitMcpTargets(text, knownServers);
  const actual = comparable(actualServer);
  if (requestedTargets.length === 0 || !actual || requestedTargets.includes(actual)) return undefined;
  return `Không thể thực hiện thao tác trên "${requestedTargets.join(', ')}" vì MCP server đang được chọn là "${actualServer}". Không được chuyển sang server khác.`;
}
