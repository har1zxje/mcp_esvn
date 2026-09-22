const TARGET_CONNECTOR = /(?:\b(?:trên|tren|on|in|using|via|through|from|to)\b)\s+([\p{L}\p{N}][\p{L}\p{N}_.:-]*(?:\s+[\p{L}\p{N}_.:-]+){0,3}?)(?=\s+(?:đặt\s+tên|dat\s+ten|có\s+tên|co\s+ten|named|called|with\s+name|name\s+is)\b|\s*[,!?]|$)/iu;

function comparable(value) {
  return String(value).trim().toLowerCase()
    .replace(/(?:mcp|server)$/i, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function extractExplicitMcpTarget(text) {
  if (typeof text !== 'string') return undefined;
  const target = text.match(TARGET_CONNECTOR)?.[1];
  return target ? comparable(target) : undefined;
}

export function validateMcpServerTarget(text, actualServer) {
  const requested = extractExplicitMcpTarget(text);
  const actual = comparable(actualServer);
  if (!requested || !actual || requested === actual) return undefined;
  return `Không thể thực hiện thao tác trên "${requested}" vì MCP server đang được chọn là "${actualServer}". Server Jira không khả dụng; không được chuyển sang server khác.`;
}
