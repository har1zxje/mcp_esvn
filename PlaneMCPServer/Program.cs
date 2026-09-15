using ModelContextProtocol.AspNetCore;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);

builder.Configuration.Sources.Clear();
builder.Configuration
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: false)
    .AddUserSecrets<Program>()
    .AddEnvironmentVariables(); 

var planeAPIKey = builder.Configuration["PlaneAPIKey"];
var baseUrl = builder.Configuration["BaseUrl"];
var workspace = builder.Configuration["Workspace"];
var projectId = builder.Configuration["ProjectId"];
var mcpPort = builder.Configuration.GetValue<int?>("McpPort") ?? 3003;

if (mcpPort is < 1 or > 65535)
{
    throw new InvalidOperationException("McpPort phải nằm trong khoảng 1-65535.");
}

if(string.IsNullOrEmpty(planeAPIKey) || string.IsNullOrEmpty(baseUrl) || string.IsNullOrEmpty(workspace) || string.IsNullOrEmpty(projectId))
{
    throw new InvalidOperationException("Vui lòng cung cấp PlaneAPIKey, BaseUrl, Workspace và ProjectId trong appsettings.json hoặc User Secrets.");
}

builder.Services.AddHttpClient();

builder.Services.AddSingleton(sp =>
{
    var httpClientFactory = sp.GetRequiredService<IHttpClientFactory>();

    return new PlaneAPIServices(
        httpClientFactory, 
        baseUrl, 
        workspace, 
        projectId, 
        planeAPIKey);
});

builder.Services.AddMcpServer()
                .WithHttpTransport()
                .WithToolsFromAssembly();

var app = builder.Build();

app.MapMcp("/mcp");

app.Run($"http://0.0.0.0:{mcpPort}");
