import {
  extractExplicitMCPTarget,
  extractMCPServerFromToolName,
  validateMCPToolTarget,
} from './mcpTarget';

describe('MCP target enforcement', () => {
  it.each([
    ['tạo công việc mới trên jira đặt tên là test', 'jira'],
    ['create a task in Jira called test', 'jira'],
    ['create an issue via github with name test', 'github'],
  ])('extracts the explicit target from %s', (text, expected) => {
    expect(extractExplicitMCPTarget(text)).toBe(expected);
  });

  it('extracts the server from a model-facing MCP tool name', () => {
    expect(extractMCPServerFromToolName('create_work_mcp_plane')).toBe('plane');
  });

  it('blocks a different server instead of allowing a side effect', () => {
    expect(validateMCPToolTarget('tạo công việc mới trên jira đặt tên là test', 'create_work_mcp_plane'))
      .toContain('Do not substitute another MCP server');
  });

  it('allows the requested server and non-targeted requests', () => {
    expect(validateMCPToolTarget('create a task in Jira called test', 'create_work_mcp_jira')).toBeUndefined();
    expect(validateMCPToolTarget('create a task called test', 'create_work_mcp_plane')).toBeUndefined();
  });
});
