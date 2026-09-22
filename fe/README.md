# Project LibreChat frontend

This is the LibreChat client copied into a project-owned `fe` directory.

## Run

Start LibreChat on `http://localhost:3080` and the project backend on
`http://localhost:3091`, then run:

```powershell
npm run dev:project
```

Open `http://localhost:3090`.

The Vite proxy sends:

- `/api/chat`, `/api/chat/models` and `/api/agents/chat*` to `be`;
- all other `/api/*` and `/oauth/*` requests to LibreChat.

The browser therefore never needs the Gemini/MCP credentials. The bearer
token is still managed by LibreChat's normal authentication flow.
