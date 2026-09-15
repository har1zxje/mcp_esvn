using System.ComponentModel;
using ModelContextProtocol.Server;

[McpServerToolType]
public sealed class DiscordTools
{
    [McpServerTool]
    [Description(
        "Gửi bất kỳ nội dung thông báo nào tới Discord.")]
    public static async Task<string> SendDiscordMessage(
        DiscordAPIServices discordApiServices,

        [Description(
            "Nội dung cần gửi tới Discord")]
        string message,

        CancellationToken cancellationToken = default)
    {
        await discordApiServices.SendMessageAsync(
            message,
            cancellationToken);

        return "Đã gửi thông báo tới Discord.";
    }
}
