# Project chat backend

The browser calls only `POST /api/chat`. The backend owns conversation storage, Gemini function calling, MCP discovery/routing, tool policy and the multi-step agent loop. The browser never receives provider or MCP credentials.

## Configuration

Copy `.env.example` to `.env` and set `GOOGLE_KEY`, `CHAT_MODEL_MAP_JSON`, and `MCP_SERVERS_JSON`. MCP tools are exposed to Gemini as `server__tool` and routed back to the matching server. `MAX_TOOL_ITERATIONS` and `CONTEXT_MESSAGE_LIMIT` control safety and context limits.

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

The frontend proxy targets `http://127.0.0.1:3091`; start Plane MCP on `3003` and Discord MCP on `3002` when needed.
