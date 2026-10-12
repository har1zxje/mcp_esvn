import { act, render, screen } from '@testing-library/react';
import ProjectStandaloneApp from './ProjectStandaloneApp';

let mockUser = null;

jest.mock('../project-auth', () => ({
  useProjectAuth: () => ({ user: mockUser, logout: jest.fn() }),
  projectFetch: jest.fn(async (path) => ({
    ok: true,
    json: async () => path === '/api/chat/history'
      ? { conversations: [] }
      : path === '/api/chat/mcp'
        ? { servers: [] }
        : path === '/api/chat/profile'
          ? { email: mockUser?.email || '' }
          : { models: [] },
  })),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useParams: () => ({ conversationId: 'new' }),
}));
jest.mock('./ProjectChat/NavigationRail', () => () => null);
jest.mock('./ProjectChat/McpSidebar', () => () => null);
jest.mock('./ProjectChat/ChatHeader', () => () => null);
jest.mock('./ProjectChat/ProjectMessage', () => () => null);
jest.mock('./ProjectChat/ChatComposer', () => () => null);
jest.mock('./ProjectChat/RightUtilitySidebar', () => () => null);
jest.mock('./ProjectSettings', () => () => null);

test('the new chat greeting follows the current account and clears on logout', async () => {
  mockUser = { id: 'account-a', email: 'a@example.test', name: 'Nguyễn An' };
  let rerender;
  await act(async () => { ({ rerender } = render(<ProjectStandaloneApp />)); });
  expect(screen.getByRole('heading', { name: 'Xin chào Nguyễn An!' })).toBeInTheDocument();

  mockUser = null;
  rerender(<ProjectStandaloneApp />);
  expect(screen.getByRole('heading', { name: 'Xin chào!' })).toBeInTheDocument();

  mockUser = { id: 'account-b', email: 'b@example.test', name: 'Trần Bình' };
  rerender(<ProjectStandaloneApp />);
  expect(screen.getByRole('heading', { name: 'Xin chào Trần Bình!' })).toBeInTheDocument();
  expect(screen.queryByText('Xin chào Nguyễn An!')).not.toBeInTheDocument();

  mockUser = { id: 'account-b', email: 'b@example.test', name: '   ' };
  rerender(<ProjectStandaloneApp />);
  expect(screen.getByRole('heading', { name: 'Xin chào!' })).toBeInTheDocument();
});
