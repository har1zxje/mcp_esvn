# ES Chat Frontend

Frontend độc lập mô phỏng bố cục VFI Assistant. Frontend không gọi trực tiếp LibreChat hoặc API key; mặc định gọi backend proxy tại `http://localhost:4000/api/chat`.

## Chạy giao diện

Chạy static server thuần Node, không cần cài package:

```powershell
cd MCPServer\ESChatFrontend
npm start
```

Sau đó mở `http://localhost:3001`.

Hoặc cấu hình web server phục vụ thư mục này. Nếu backend chạy ở host khác, đặt biến trước khi tải `app.js`:

```html
<script>window.ES_API_BASE_URL = 'http://localhost:4000/api';</script>
<script src="./app.js"></script>
```

## Contract của backend proxy

Request:

```json
{ "message": "Tạo task cho dự án ERP", "conversationId": null }
```

Response JSON tối thiểu:

```json
{ "text": "Đã tạo task...", "conversationId": "..." }
```

Hoặc trả về `text/event-stream` với từng dòng:

```text
data: {"token":"Đã "}
data: {"token":"xử lý","conversationId":"..."}
```

## Kết nối tới LibreChat

Luồng production nên là:

```text
VFI Frontend → VFI Backend Proxy → LibreChat API → AI model → MCP Client → Plane/Discord MCP
```

Backend proxy giữ cookie/JWT của LibreChat ở server-side, kiểm tra quyền user rồi chuyển tiếp request chat và stream response. Không đưa `OPENAI_API_KEY`, `PlaneAPIKey` hoặc token LibreChat vào `app.js`.

Backend proxy tương ứng nằm trong `../ESChatBackend`. Tạo file `.env` từ `.env.example`, điền tài khoản service của LibreChat và `LIBRECHAT_AGENT_ID`, sau đó chạy:

```powershell
cd MCPServer\ESChatBackend
npm install
$env:LIBRECHAT_EMAIL = 'service-account@example.com'
$env:LIBRECHAT_PASSWORD = 'your-password'
$env:LIBRECHAT_AGENT_ID = 'your-agent-id'
npm start
```

Trong terminal khác chạy frontend:

```powershell
cd MCPServer\ESChatFrontend
npx serve . -l 3001
```

Trong LibreChat, Agent được chọn bởi `LIBRECHAT_AGENT_ID` phải được bật các MCP server Plane/Discord. MCP server hiện tại cần trỏ tới các endpoint đang chạy, ví dụ Plane MCP tại `http://host.docker.internal:3003/mcp` khi LibreChat chạy bằng Docker. Frontend chỉ gọi proxy; nó không cần biết MCP port `3003`.

Lưu ý: phiên bản proxy này dùng một tài khoản LibreChat dùng chung ở server-side. Khi cần phân quyền riêng từng người dùng, thay cơ chế đăng nhập service account bằng việc chuyển tiếp JWT/cookie của từng user.
