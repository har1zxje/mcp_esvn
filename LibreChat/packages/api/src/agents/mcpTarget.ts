import { Constants, normalizeServerName } from 'librechat-data-provider';

const TARGET_CONNECTOR =
  /(?:\b(?:trên|tren|on|in|using|via|through|from|to)\b)\s+([\p{L}\p{N}][\p{L}\p{N}_.:-]*(?:\s+[\p{L}\p{N}_.:-]+){0,3}?)(?=\s+(?:đặt\s+tên|dat\s+ten|có\s+tên|co\s+ten|named|called|with\s+name|name\s+is)\b|\s*[,!?]|$)/iu;

function comparable(value: string): string {
  return normalizeServerName(value)
    .toLowerCase()
    .replace(/(?:mcp|server)$/i, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Extracts an explicitly named destination from common Vietnamese/English phrasing. */
export function extractExplicitMCPTarget(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const match = text.match(TARGET_CONNECTOR)?.[1]?.trim();
  return match ? comparable(match) : undefined;
}

/** Returns the MCP server suffix from a model-facing tool key. */
export function extractMCPServerFromToolName(toolName: string): string | undefined {
  const index = toolName.lastIndexOf(Constants.mcp_delimiter);
  if (index < 0) return undefined;
  const server = toolName.slice(index + Constants.mcp_delimiter.length);
  return server ? comparable(server) : undefined;
}

/**
 * Returns a user-visible error when a model tries to execute an MCP tool on a
 * different server than the one explicitly named by the user.
 */
export function validateMCPToolTarget(text: unknown, toolName: string): string | undefined {
  const requested = extractExplicitMCPTarget(text);
  const actual = extractMCPServerFromToolName(toolName);
  if (!requested || !actual || requested === actual) return undefined;

  return `The requested MCP target "${requested}" is not available for this operation. The selected tool belongs to "${actual}". Do not substitute another MCP server; report that the requested target is unavailable.`;
}
