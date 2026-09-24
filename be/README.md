# Project chat backend

The browser calls only `POST /api/chat`. The backend owns conversation storage, Gemini function calling, MCP discovery/routing, tool policy and the multi-step agent loop. The browser never receives provider or MCP credentials.

## Configuration

Copy `.env.example` to `.env` and set `GOOGLE_KEY`, `CHAT_MODEL_MAP_JSON`, `MCP_SERVERS_JSON`, and PostgreSQL credentials. PostgreSQL is the runtime persistence store for users, sessions, integrations, and conversations. MCP tools are exposed to Gemini as `server__tool` and routed back to the matching server. `MAX_TOOL_ITERATIONS` and `CONTEXT_MESSAGE_LIMIT` control safety and context limits.

## Request

```json
{
  "conversationId": null,
  "message": "Kiểm tra work overdue rồi gửi kết quả sang Discord",
  "model": "gemini_25_flash"
}
```

MCP failures become structured tool results and do not crash the backend. Destructive tools require `confirm=true`.

## Run

```powershell
npm install
npm start
```

To migrate the existing JSON backup files without deleting them:

```powershell
npm run db:migrate-json
```

The migration is idempotent and imports `data/auth.json`,
`data/user_integrations.json`, and `data/conversations.json` when present. Keep
those files as backups until the database
has been verified. The server does not read JSON persistence files after the
PostgreSQL cutover.

For local PostgreSQL development:

```powershell
docker compose up -d postgres
```

The frontend proxy targets `http://127.0.0.1:3091`; start Plane MCP on `3003` and Discord MCP on `3002` when needed.

### Starting the Plane MCP server locally

`MCP_INTERNAL_TOKEN` is intentionally not committed to `PlaneMCPServer/appsettings.json`.
Configure the same value used by the Node backend in the Plane MCP process before
starting it, either through .NET User Secrets or its environment:

```powershell
dotnet user-secrets --project ..\PlaneMCPServer\PlaneMCPServer.csproj set MCP_INTERNAL_TOKEN "<the shared backend/MCP token>"
dotnet run --project ..\PlaneMCPServer\PlaneMCPServer.csproj
```

The token must match the backend's `MCP_INTERNAL_TOKEN`; otherwise the MCP server
will start but reject backend requests. Do not put the real token in source control,
command history, or logs.

## Account integrations

The settings page starts provider authorization through the project backend. The backend binds short-lived, one-use OAuth state to the authenticated `project_session`, stores provider credentials encrypted in PostgreSQL, and returns metadata only.

Plane OAuth is enabled only when `PLANE_OAUTH_CLIENT_ID`, `PLANE_OAUTH_CLIENT_SECRET`, `PLANE_OAUTH_AUTHORIZE_URL`, `PLANE_OAUTH_TOKEN_URL`, and `PLANE_OAUTH_REDIRECT_URI` are configured for the actual Plane deployment/application. The legacy `PLANE_CLIENT_ID`, `PLANE_CLIENT_SECRET`, and `PLANE_REDIRECT_URI` names remain supported as aliases. Because Plane's OAuth application endpoints are deployment/app-registration specific, the UI keeps Personal API Key under an explicit Advanced setup fallback when those values are absent. OAuth and PAT credentials are distinguished internally and the Plane MCP request uses Bearer or `X-API-Key` accordingly.

Discord OAuth uses the application client and requests `identify`, `guilds`, and `bot`. The Discord MCP service owns the bot token and exposes trusted internal discovery endpoints. Users select only human-readable server/channel names; IDs are persisted as destination data under their authenticated application user.

Register these callback URLs exactly (replace the origin for staging/production):

```text
http://localhost:3090/api/integrations/plane/callback
http://localhost:3090/api/integrations/discord/callback
```

Configure the Discord bot as a guild-installable application with permission to view and send messages in the selected channel. Configure `MCP_INTERNAL_TOKEN` consistently between the Node backend and both MCP services. Never put `DISCORD_BOT_TOKEN`, provider client secrets, or real encryption keys in `.env.example`.
