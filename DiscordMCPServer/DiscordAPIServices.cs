using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

public sealed class DiscordAPIServices
{
    private readonly HttpClient _httpClient;
    private readonly string _botToken;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public DiscordAPIServices(
        IHttpClientFactory httpClientFactory,
        string botToken,
        IHttpContextAccessor httpContextAccessor)
    {
        _httpClient =
            httpClientFactory.CreateClient();

        _botToken = botToken;
        _httpContextAccessor = httpContextAccessor;
    }

    public async Task SendMessageAsync(
        string message,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            throw new ArgumentException(
                "Message không được để trống.",
                nameof(message));
        }

        var channelId = _httpContextAccessor.HttpContext?.Request.Headers["X-Discord-Channel-Id"].ToString();
        if (string.IsNullOrWhiteSpace(channelId) || !IsSnowflake(channelId))
            throw new InvalidOperationException("Discord execution destination is missing.");

        var url = $"https://discord.com/api/v10/channels/{channelId}/messages";

        var body = new
        {
            content = message
        };

        using var request =
            new HttpRequestMessage(HttpMethod.Post, url);

        request.Headers.Authorization =
            new AuthenticationHeaderValue(
                "Bot",
                _botToken);

        request.Content = new StringContent(
            JsonSerializer.Serialize(body),
            Encoding.UTF8,
            "application/json");

        using var response =
            await _httpClient.SendAsync(
                request,
                cancellationToken);

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Discord API request failed with status {(int)response.StatusCode}.");
    }

    public async Task<object> ValidateDestinationAsync(string guildId, string channelId, CancellationToken cancellationToken = default)
    {
        if (!IsSnowflake(guildId) || !IsSnowflake(channelId))
            throw new InvalidOperationException("Discord destination IDs are invalid.");

        using var guildResponse = await SendBotRequestAsync(HttpMethod.Get, $"https://discord.com/api/v10/guilds/{guildId}", cancellationToken);
        if (!guildResponse.IsSuccessStatusCode)
            throw new InvalidOperationException($"Discord guild validation failed with status {(int)guildResponse.StatusCode}.");
        using var guildDocument = JsonDocument.Parse(await guildResponse.Content.ReadAsStringAsync(cancellationToken));
        var guildName = guildDocument.RootElement.TryGetProperty("name", out var name) ? name.GetString() : null;

        using var channelResponse = await SendBotRequestAsync(HttpMethod.Get, $"https://discord.com/api/v10/channels/{channelId}", cancellationToken);
        if (!channelResponse.IsSuccessStatusCode)
            throw new InvalidOperationException($"Discord channel validation failed with status {(int)channelResponse.StatusCode}.");
        using var channelDocument = JsonDocument.Parse(await channelResponse.Content.ReadAsStringAsync(cancellationToken));
        var channel = channelDocument.RootElement;
        var actualGuildId = channel.TryGetProperty("guild_id", out var actualGuild) ? actualGuild.GetString() : null;
        if (!string.Equals(actualGuildId, guildId, StringComparison.Ordinal))
            throw new InvalidOperationException("Discord channel does not belong to the selected guild.");
        var channelName = channel.TryGetProperty("name", out var channelNameValue) ? channelNameValue.GetString() : null;

        return new { valid = true, guildId, channelId, guildName, channelName };
    }

    public async Task<object> GetAuthorizedIdentityAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        using var response = await SendUserRequestAsync(HttpMethod.Get, "https://discord.com/api/v10/users/@me", request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Discord account authorization is invalid.");
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var root = document.RootElement;
        return new { id = root.GetProperty("id").GetString(), username = root.TryGetProperty("global_name", out var name) ? name.GetString() : root.GetProperty("username").GetString() };
    }

    public async Task<object> GetAuthorizedGuildsAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        using var response = await SendUserRequestAsync(HttpMethod.Get, "https://discord.com/api/v10/users/@me/guilds", request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Discord server authorization is invalid.");
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var result = new List<object>();
        foreach (var guild in document.RootElement.EnumerateArray())
        {
            var id = guild.GetProperty("id").GetString()!;
            using var botGuild = await SendBotRequestAsync(HttpMethod.Get, $"https://discord.com/api/v10/guilds/{id}", cancellationToken);
            if (!botGuild.IsSuccessStatusCode) continue;
            result.Add(new { id, name = guild.GetProperty("name").GetString() });
        }
        return result;
    }

    public async Task<object> GetGuildChannelsAsync(string guildId, HttpRequest request, CancellationToken cancellationToken)
    {
        if (!IsSnowflake(guildId)) throw new InvalidOperationException("Discord server ID is invalid.");
        using var botGuild = await SendBotRequestAsync(HttpMethod.Get, $"https://discord.com/api/v10/guilds/{guildId}", cancellationToken);
        if (!botGuild.IsSuccessStatusCode) throw new InvalidOperationException("Discord server is not available to the application.");
        using var response = await SendBotRequestAsync(HttpMethod.Get, $"https://discord.com/api/v10/guilds/{guildId}/channels", cancellationToken);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Discord channels could not be loaded.");
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        return document.RootElement.EnumerateArray().Where(channel => channel.TryGetProperty("type", out var type) && (type.GetInt32() == 0 || type.GetInt32() == 5) && channel.TryGetProperty("name", out _)).Select(channel => new { id = channel.GetProperty("id").GetString(), name = channel.GetProperty("name").GetString(), type = channel.GetProperty("type").GetInt32() == 5 ? "announcement" : "text" }).ToList();
    }

    private async Task<HttpResponseMessage> SendBotRequestAsync(HttpMethod method, string url, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bot", _botToken);
        return await _httpClient.SendAsync(request, cancellationToken);
    }

    private async Task<HttpResponseMessage> SendUserRequestAsync(HttpMethod method, string url, HttpRequest source, CancellationToken cancellationToken)
    {
        var bearer = source.Headers.Authorization.ToString();
        if (!bearer.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Discord user authorization is missing.");
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = AuthenticationHeaderValue.Parse(bearer);
        return await _httpClient.SendAsync(request, cancellationToken);
    }

    private static bool IsSnowflake(string value) => Regex.IsMatch(value, "^\\d{17,20}$");
}
