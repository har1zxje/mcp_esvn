using ModelContextProtocol.AspNetCore;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.Sources.Clear();
builder.Configuration.SetBasePath(AppContext.BaseDirectory).AddJsonFile("appsettings.json", optional: false).AddUserSecrets<Program>().AddEnvironmentVariables();
var internalToken = builder.Configuration["MCP_INTERNAL_TOKEN"];
var hrmToken = builder.Configuration["HRM_INTERNAL_TOKEN"];
var baseUrl = builder.Configuration["HRM_API_BASE_URL"] ?? builder.Configuration["HrmApiBaseUrl"];
var port = builder.Configuration.GetValue<int?>("McpPort") ?? 3004;
var timeoutMs = builder.Configuration.GetValue<int?>("HRM_API_TIMEOUT_MS") ?? 10000;
var enabledServers = builder.Configuration["MCP_ENABLED_SERVERS"] ?? string.Empty;
var learningMode = enabledServers.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).SequenceEqual(["hrm"], StringComparer.Ordinal);
if (string.IsNullOrWhiteSpace(internalToken) || string.IsNullOrWhiteSpace(hrmToken) || string.IsNullOrWhiteSpace(baseUrl)) throw new InvalidOperationException("MCP_INTERNAL_TOKEN, HRM_INTERNAL_TOKEN, and HrmApiBaseUrl are required.");
if (port is < 1 or > 65535) throw new InvalidOperationException("McpPort must be a valid TCP port.");
if (timeoutMs is < 1 or > 30000) throw new InvalidOperationException("HRM_API_TIMEOUT_MS must be between 1 and 30000.");
builder.Services.AddHttpClient("hrm", client => client.Timeout = TimeSpan.FromMilliseconds(timeoutMs));
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton(sp => new HrmApiClient(sp.GetRequiredService<IHttpClientFactory>(), baseUrl!, hrmToken!, sp.GetRequiredService<IHttpContextAccessor>(), sp.GetRequiredService<ILogger<HrmApiClient>>(), learningMode));
builder.Services.AddMcpServer().WithHttpTransport().WithToolsFromAssembly();
var app = builder.Build();
var tokenFingerprint = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(hrmToken!))).ToLowerInvariant()[..12];
app.Logger.LogInformation("HRM MCP configured HRM API {Hostname} with token fingerprint {HrmTokenFingerprint}; learning mode {LearningMode}", new Uri(baseUrl!).Host, tokenFingerprint, learningMode);
var contextId = new Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$", RegexOptions.Compiled);
var requestId = new Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", RegexOptions.Compiled);
app.Use(async (context, next) => {
  if (context.Request.Path.StartsWithSegments("/mcp")) {
    var supplied = context.Request.Headers["X-MCP-Internal-Token"].ToString();
    var userId = context.Request.Headers["X-MCP-User-Id"].ToString();
    var request = context.Request.Headers["X-MCP-Request-Id"].ToString();
    var suppliedBytes = System.Text.Encoding.UTF8.GetBytes(supplied);
    var expectedBytes = System.Text.Encoding.UTF8.GetBytes(internalToken!);
    var validToken = suppliedBytes.Length == expectedBytes.Length && CryptographicOperations.FixedTimeEquals(suppliedBytes, expectedBytes);
    var validContext = contextId.IsMatch(userId) && requestId.IsMatch(request);
    if (!validToken || !validContext) { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return; }
  }
  await next();
});
app.MapMcp("/mcp");
app.Run($"http://0.0.0.0:{port}");
