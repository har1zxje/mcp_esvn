using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

var builder = Host.CreateApplicationBuilder(args);
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

if(string.IsNullOrEmpty(planeAPIKey) || string.IsNullOrEmpty(baseUrl) || string.IsNullOrEmpty(workspace) || string.IsNullOrEmpty(projectId))
{
    throw new InvalidOperationException("Vui lòng cung cấp PlaneAPIKey, BaseUrl, Workspace và ProjectId trong appsettings.json hoặc User Secrets.");
}

builder.Services.AddHttpClient();
builder.Services.AddSingleton(sp =>
{
    var httpClientFactory = sp.GetRequiredService<IHttpClientFactory>();
    return new PlaneAPIServices(httpClientFactory, baseUrl, workspace, projectId, planeAPIKey);
});

builder.Services.AddMcpServer()
                .WithStdioServerTransport()
                .WithToolsFromAssembly();

await builder.Build().RunAsync();
