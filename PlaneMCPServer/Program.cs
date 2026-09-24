using ModelContextProtocol.AspNetCore;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Cryptography;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.Sources.Clear();
builder.Configuration
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
    .AddUserSecrets<Program>()
    .AddEnvironmentVariables(); 

var baseUrl = builder.Configuration["BaseUrl"];
var workspace = builder.Configuration["Workspace"];
var projectId = builder.Configuration["ProjectId"];
var mcpInternalToken = builder.Configuration["MCP_INTERNAL_TOKEN"];
var mcpPort = builder.Configuration.GetValue<int?>("McpPort") ?? 3003;

if (mcpPort is < 1 or > 65535)
{
    throw new InvalidOperationException("McpPort phải nằm trong khoảng 1-65535.");
}

var missingConfiguration = new[]
{
    (Name: "MCP_INTERNAL_TOKEN", Value: mcpInternalToken),
    (Name: "BaseUrl", Value: baseUrl),
    (Name: "Workspace", Value: workspace),
    (Name: "ProjectId", Value: projectId)
}
    .Where(setting => string.IsNullOrWhiteSpace(setting.Value))
    .Select(setting => setting.Name)
    .ToArray();

if (missingConfiguration.Length > 0)
{
    throw new InvalidOperationException(
        $"Plane MCP configuration is incomplete. Missing: {string.Join(", ", missingConfiguration)}. " +
        "Configure MCP_INTERNAL_TOKEN in User Secrets or the process environment; BaseUrl, Workspace, and ProjectId may be configured in appsettings.json.");
}

builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();

builder.Services.AddSingleton(sp =>
{
    var httpClientFactory = sp.GetRequiredService<IHttpClientFactory>();

    return new PlaneAPIServices(
        httpClientFactory, 
        baseUrl, 
        workspace,
        projectId,
        sp.GetRequiredService<IHttpContextAccessor>(),
        sp.GetRequiredService<ILogger<PlaneAPIServices>>());
});

builder.Services.AddMcpServer()
                .WithHttpTransport()
                .WithToolsFromAssembly();

var app = builder.Build();

app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/mcp"))
    {
        var supplied = context.Request.Headers["X-MCP-Internal-Token"].ToString();
        if (string.IsNullOrEmpty(supplied) || !CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(supplied),
                System.Text.Encoding.UTF8.GetBytes(mcpInternalToken)))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
    }
    await next();
});

app.MapMcp("/mcp");

app.Run($"http://0.0.0.0:{mcpPort}");
