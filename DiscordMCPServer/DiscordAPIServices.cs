using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

public sealed class DiscordAPIServices
{
    private readonly HttpClient _httpClient;
    private readonly string _botToken;
    private readonly string _channelId;

    public DiscordAPIServices(
        IHttpClientFactory httpClientFactory,
        string botToken,
        string channelId)
    {
        _httpClient =
            httpClientFactory.CreateClient();

        _botToken = botToken;
        _channelId = channelId;
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

        var url = $"https://discord.com/api/v10/channels/{_channelId}/messages";

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

        var responseBody =
            await response.Content.ReadAsStringAsync(
                cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Discord API lỗi " +
                $"{(int)response.StatusCode}: " +
                responseBody);
        }
    }
}