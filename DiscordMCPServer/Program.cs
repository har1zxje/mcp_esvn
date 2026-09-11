using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

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

var discordBotToken =
    builder.Configuration["DiscordBotToken"];

var discordChannelId =
    builder.Configuration["DiscordChannelId"];

if (string.IsNullOrWhiteSpace(discordBotToken))
{
    throw new InvalidOperationException(
        "DiscordBotToken chưa được cấu hình.");
}

if (string.IsNullOrWhiteSpace(discordChannelId))
{
    throw new InvalidOperationException(
        "DiscordChannelId chưa được cấu hình.");
}

builder.Services.AddHttpClient();

builder.Services.AddSingleton(sp =>
{
    var httpClientFactory =
        sp.GetRequiredService<IHttpClientFactory>();

    return new DiscordAPIServices(
        httpClientFactory,
        discordBotToken,
        discordChannelId);
});

builder.Services
    .AddMcpServer()
    .WithStdioServerTransport()
    .WithToolsFromAssembly();

await builder.Build().RunAsync();