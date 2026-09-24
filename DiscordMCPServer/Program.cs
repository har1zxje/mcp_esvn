using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();

builder.Logging.AddConsole(options =>
{
    options.LogToStandardErrorThreshold = LogLevel.Trace;
});

builder.Configuration.Sources.Clear();

builder.Configuration
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile(
        "appsettings.json",
        optional: false,
        reloadOnChange: false)
    .AddUserSecrets<Program>()
    .AddEnvironmentVariables();

var discordBotToken = builder.Configuration["DiscordBotToken"];
var mcpInternalToken = builder.Configuration["MCP_INTERNAL_TOKEN"];

if (string.IsNullOrWhiteSpace(discordBotToken))
{
    throw new InvalidOperationException(
        "DiscordBotToken chưa được cấu hình.");
}

if (string.IsNullOrWhiteSpace(mcpInternalToken))
{
    throw new InvalidOperationException(
        "MCP_INTERNAL_TOKEN chưa được cấu hình.");
}

builder.Services.AddHttpClient();
builder.Services.AddHttpContextAccessor();

builder.Services.AddSingleton(sp =>
{
    var httpClientFactory =
        sp.GetRequiredService<IHttpClientFactory>();

    return new DiscordAPIServices(
        httpClientFactory,
        discordBotToken,
        sp.GetRequiredService<IHttpContextAccessor>());
});

builder.Services
    .AddMcpServer()
    .WithHttpTransport()
    .WithToolsFromAssembly();

var app = builder.Build();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/mcp") || context.Request.Path.StartsWithSegments("/internal"))
    {
        var supplied = context.Request.Headers["X-MCP-Internal-Token"].ToString();
        if (string.IsNullOrEmpty(supplied) || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(supplied), System.Text.Encoding.UTF8.GetBytes(mcpInternalToken)))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
    }
    await next();
});

app.MapPost("/internal/discord/destination", async (
    DiscordDestinationRequest request,
    DiscordAPIServices discordApiServices,
    CancellationToken cancellationToken) => Results.Ok(await discordApiServices.ValidateDestinationAsync(
        request.GuildId, request.ChannelId, cancellationToken)));

app.MapGet("/internal/discord/identity", async (HttpRequest request, DiscordAPIServices services, CancellationToken cancellationToken) => Results.Ok(await services.GetAuthorizedIdentityAsync(request, cancellationToken)));
app.MapGet("/internal/discord/guilds", async (HttpRequest request, DiscordAPIServices services, CancellationToken cancellationToken) => Results.Ok(await services.GetAuthorizedGuildsAsync(request, cancellationToken)));
app.MapGet("/internal/discord/guilds/{guildId}/channels", async (string guildId, HttpRequest request, DiscordAPIServices services, CancellationToken cancellationToken) => Results.Ok(await services.GetGuildChannelsAsync(guildId, request, cancellationToken)));

app.MapMcp("/mcp");
app.Run("http://0.0.0.0:3002");
