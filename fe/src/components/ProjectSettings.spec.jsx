import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectSettings, { navigateToOAuthStart } from './ProjectSettings';
import ToolExecutionSummary from './ProjectChat/ToolExecutionSummary';
import { projectFetch } from '../project-auth';

jest.mock('../project-auth', () => ({ projectFetch: jest.fn() }));

const response = (body, ok = true) => ({ ok, json: async () => body });
const planeWithoutScope = { provider: 'plane', connected: true, status: 'scopeIncomplete', credentialType: 'oauth', workspaceSlug: null, metadata: {} };
const planeReady = { ...planeWithoutScope, status: 'ready', workspaceSlug: 'workspace-a', metadata: { defaultProjectId: 'project-a' } };
const discord = { provider: 'discord', connected: false, status: 'disconnected' };

function mockSettingsApi(plane = planeWithoutScope) {
  projectFetch.mockImplementation((url) => {
    if (url === '/api/chat/integrations') return Promise.resolve(response({ integrations: [plane, discord] }));
    if (String(url).startsWith('/api/integrations/plane/projects')) return Promise.resolve(response({ projects: [{ id: 'project-a', name: 'Project A' }] }));
    if (url === '/api/integrations/plane/scope') return Promise.resolve(response({ integration: planeReady }));
    return Promise.resolve(response({}));
  });
}

beforeEach(() => { projectFetch.mockReset(); window.confirm = jest.fn(() => true); });

test('one Plane reconnect action creates exactly one OAuth start navigation', () => {
  const inFlight = { current: false };
  const navigate = jest.fn();
  expect(navigateToOAuthStart('plane', inFlight, navigate)).toBe(true);
  expect(navigateToOAuthStart('plane', inFlight, navigate)).toBe(false);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('/api/integrations/plane/oauth/start');
});

test('loading Plane projects verifies a workspace without treating its scope as saved', async () => {
  mockSettingsApi();
  render(<ProjectSettings onClose={jest.fn()} />);
  await screen.findByText('Scope incomplete');
  const workspace = screen.getByLabelText('Workspace slug');
  fireEvent.change(workspace, { target: { value: 'workspace-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load projects' }));
  await screen.findByText('Workspace verified. Select a project and save Plane scope to finish setup.');
  expect(screen.getByRole('button', { name: 'Save Plane scope' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Default project'), { target: { value: 'project-a' } });
  expect(screen.getByRole('button', { name: 'Save Plane scope' })).toBeEnabled();
});

test('saved Plane scope is restored from the integration endpoint when Settings is reopened', async () => {
  mockSettingsApi(planeReady);
  const { unmount } = render(<ProjectSettings onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Workspace slug')).toHaveValue('workspace-a'));
  await waitFor(() => expect(screen.getByLabelText('Default project')).toHaveValue('project-a'));
  unmount();
  render(<ProjectSettings onClose={jest.fn()} />);
  await waitFor(() => expect(screen.getByLabelText('Workspace slug')).toHaveValue('workspace-a'));
  await waitFor(() => expect(screen.getByLabelText('Default project')).toHaveValue('project-a'));
});

test('unsaved Plane draft is confirmed before Settings closes', async () => {
  mockSettingsApi(); window.confirm.mockReturnValue(false);
  const onClose = jest.fn(); render(<ProjectSettings onClose={onClose} />);
  await screen.findByText('Scope incomplete');
  fireEvent.change(screen.getByLabelText('Workspace slug'), { target: { value: 'workspace-a' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(onClose).not.toHaveBeenCalled();
});

test('PLANE_SCOPE_REQUIRED shows setup guidance and a direct Plane Settings action', () => {
  const onOpenPlaneSettings = jest.fn();
  render(<ToolExecutionSummary toolCalls={[{ name: 'get_my_tasks', text: JSON.stringify({ success: false, error: { code: 'PLANE_SCOPE_REQUIRED', message: 'internal error' } }) }]} onOpenPlaneSettings={onOpenPlaneSettings} />);
  fireEvent.click(screen.getByRole('button', { name: /tool execution/i }));
  expect(screen.getByText(/Plane đã được kết nối nhưng bạn chưa chọn workspace/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Plane Settings' }));
  expect(onOpenPlaneSettings).toHaveBeenCalledTimes(1);
});
