// Adapted from the owner's reviewed WPF panel. Legacy server management and
// binary resources are intentionally absent; the core is built from this tree.
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PcBridge.Gui;

public sealed class BridgeConfig
{
    [JsonPropertyName("sshHost")] public string SshHost { get; set; } = "";
    [JsonPropertyName("sshUser")] public string SshUser { get; set; } = "mcp-pc-bridge-agent";
    [JsonPropertyName("sshKey")] public string SshKey { get; set; } = "";
    [JsonPropertyName("localPort")] public int LocalPort { get; set; } = 18890;
    [JsonPropertyName("deviceId")] public string DeviceId { get; set; } = "desktop";
    [JsonPropertyName("nodePath")] public string NodePath { get; set; } = "";
    [JsonPropertyName("agentScript")] public string AgentScript { get; set; } = "";
}

public sealed record BridgeStatus(bool Configured, bool PortOpen, bool RelayHealthy,
    bool AgentRunning, int OwnedCores, bool AutoStart, string RelayVersion, BridgeConfig Config);

public sealed class BridgeService
{
    // A local diagnostic must not use the user's system proxy or follow a
    // redirect from an unrelated process occupying the configured port.
    private static readonly HttpClient Http = new(new HttpClientHandler
        { UseProxy = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(2) };
    public string StateDirectory { get; }
    public string ConfigPath => Path.Combine(StateDirectory, "config.json");
    public string CorePath { get; }
    private readonly bool _externalCore;
    public string StartupPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "MCP PC Bridge.vbs");

    public BridgeService(string? stateDirectory = null, string? corePath = null)
    {
        StateDirectory = Path.GetFullPath(stateDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MCP PC Bridge"));
        CorePath = corePath ?? Path.Combine(StateDirectory, "core", "0.2.0-preview.1", "pc-bridge-core.exe");
        _externalCore = corePath is not null;
    }

    public string EnsureCoreInstalled()
    {
        if (_externalCore) return CorePath;
        using var source = Assembly.GetExecutingAssembly().GetManifestResourceStream("PcBridge.Core")
            ?? throw new FileNotFoundException("Build the PC Bridge core before building the panel.");
        using var memory = new MemoryStream(); source.CopyTo(memory);
        var bytes = memory.ToArray();
        if (File.Exists(CorePath))
        {
            if (SHA256.HashData(File.ReadAllBytes(CorePath)).SequenceEqual(SHA256.HashData(bytes))) return CorePath;
            throw new InvalidOperationException("The installed core differs from this build. Stop it and review the upgrade before replacing it.");
        }
        Directory.CreateDirectory(Path.GetDirectoryName(CorePath)!);
        // Exclusive creation: never overwrite an installed or running image.
        using var target = new FileStream(CorePath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        target.Write(bytes); target.Flush(true);
        return CorePath;
    }

    public BridgeConfig LoadConfig()
    {
        if (!File.Exists(ConfigPath)) return new BridgeConfig();
        var config = JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(ConfigPath).TrimStart('\uFEFF'))
            ?? throw new InvalidDataException("The configuration is empty.");
        if (config.LocalPort is < 1024 or > 65535) throw new InvalidDataException("Invalid local port.");
        return config;
    }

    public async Task<BridgeStatus> GetStatusAsync()
    {
        var config = LoadConfig();
        var configured = File.Exists(ConfigPath) && !string.IsNullOrWhiteSpace(config.SshHost);
        var open = configured && await CanConnectAsync(config.LocalPort);
        var healthy = false; var version = "—";
        if (open)
        {
            try
            {
                using var doc = JsonDocument.Parse(await Http.GetStringAsync($"http://127.0.0.1:{config.LocalPort}/healthz"));
                healthy = doc.RootElement.GetProperty("ok").GetBoolean() &&
                    doc.RootElement.GetProperty("mode").GetString() == "loopback-stage1";
                if (healthy) version = doc.RootElement.GetProperty("version").GetString() ?? "unknown";
            }
            catch { /* A port or process alone is not a healthy relay. */ }
        }
        var agent = false;
        if (configured && Path.IsPathFullyQualified(config.NodePath) && Path.IsPathFullyQualified(config.AgentScript))
        {
            var output = await RunPowerShellAsync("if(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object {" +
                "$_.ExecutablePath -eq " + Ps(config.NodePath) + " -and $_.CommandLine -and $_.CommandLine.Contains(" + Ps(config.AgentScript) + ")}){'YES'}");
            agent = output.Trim() == "YES";
        }
        var cores = (await FindCoresAsync()).Length;
        return new(configured, open, healthy, agent, cores, File.Exists(StartupPath), version, config);
    }

    private static async Task<bool> CanConnectAsync(int port)
    {
        try
        {
            using var client = new TcpClient(); using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
            await client.ConnectAsync("127.0.0.1", port, timeout.Token); return true;
        }
        catch { return false; }
    }

    private sealed class BridgeProcess
    {
        public int Pid { get; set; }
        public string Path { get; set; } = "";
        public long StartedUtcTicks { get; set; }
    }

    private async Task<BridgeProcess[]> FindCoresAsync()
    {
        var script = "$ErrorActionPreference='Stop';$result=@(Get-CimInstance Win32_Process -Filter \"Name='" +
            Path.GetFileName(CorePath).Replace("'", "''") + "'\" | Where-Object { $_.ExecutablePath -eq " + Ps(CorePath) +
            " -and $_.CommandLine -match '\\srun(?:\\s|$)'} | ForEach-Object {" +
            "$p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue;if($p){[pscustomobject]@{Pid=$p.Id;Path=$_.ExecutablePath;StartedUtcTicks=$p.StartTime.ToUniversalTime().Ticks}}});" +
            "ConvertTo-Json -InputObject $result -Compress";
        return JsonSerializer.Deserialize<BridgeProcess[]>(await RunPowerShellAsync(script)) ?? [];
    }

    public async Task StartAsync(bool visible = true)
    {
        var status = await GetStatusAsync();
        if (!status.Configured) throw new InvalidOperationException("Configure and set up this installation first.");
        if (status.PortOpen || status.AgentRunning || status.OwnedCores != 0)
            throw new InvalidOperationException("Components are already running or the local port is occupied. No second instance started.");
        var psi = CoreCommand("run");
        psi.CreateNoWindow = !visible;
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Could not start the core.");
        await Task.Delay(700);
        if (process.HasExited) throw new InvalidOperationException("The core stopped during startup. Inspect its console and check setup, SSH trust and port availability.");
    }

    public async Task StopAsync()
    {
        // Never select whoever owns a port or an unrelated equal-named process.
        byte[] expectedHash;
        if (_externalCore) expectedHash=SHA256.HashData(File.ReadAllBytes(CorePath));
        else
        {
            using var embedded=Assembly.GetExecutingAssembly().GetManifestResourceStream("PcBridge.Core") ?? throw new FileNotFoundException("Core resource missing.");
            expectedHash=SHA256.HashData(embedded);
            if(!SHA256.HashData(File.ReadAllBytes(CorePath)).SequenceEqual(expectedHash)) throw new InvalidOperationException("Installed core differs from this build. Nothing was stopped.");
        }
        var records = await FindCoresAsync();
        if (records.Length != 1) throw new InvalidOperationException("Exactly one verified core is required. Nothing was stopped; use its own console for a separately launched CLI instance.");
        var target = records[0];
        using var process = Process.GetProcessById(target.Pid);
        if (process.StartTime.ToUniversalTime().Ticks != target.StartedUtcTicks ||
            !string.Equals(process.MainModule?.FileName, CorePath, StringComparison.OrdinalIgnoreCase) ||
            !SHA256.HashData(File.ReadAllBytes(target.Path)).SequenceEqual(expectedHash))
            throw new InvalidOperationException("Process identity changed. Nothing was stopped.");
        process.Kill(entireProcessTree: true);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await process.WaitForExitAsync(timeout.Token);
    }

    public async Task RestartAsync(bool visible = true) { await StopAsync(); await Task.Delay(700); await StartAsync(visible); }

    private ProcessStartInfo CoreCommand(params string[] args)
    {
        var psi = new ProcessStartInfo(EnsureCoreInstalled()) { UseShellExecute = false, WorkingDirectory = StateDirectory };
        psi.ArgumentList.Add("--state-dir"); psi.ArgumentList.Add(StateDirectory);
        foreach (var arg in args) psi.ArgumentList.Add(arg);
        return psi;
    }

    public async Task<string> RunCoreAsync(string[] args, string? secret = null)
    {
        var psi = CoreCommand(args); psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = psi.RedirectStandardError = true;
        psi.RedirectStandardInput = secret is not null;
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("Could not start the core.");
        var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
        if (secret is not null) { await process.StandardInput.WriteLineAsync(secret); process.StandardInput.Close(); }
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException)
        {
            try { process.Kill(true); } catch { }
            throw new TimeoutException("Setup timed out. Inspect this installation before retrying; some files may already exist.");
        }
        var output = await stdout; var error = await stderr;
        if (secret is not null) { output = output.Replace(secret, "[redacted]"); error = error.Replace(secret, "[redacted]"); }
        if (process.ExitCode != 0) throw new InvalidOperationException(error.Trim());
        return output;
    }

    public async Task<string> TestRestrictedSshAsync()
    {
        var config = LoadConfig();
        if (string.IsNullOrWhiteSpace(config.SshHost) || !File.Exists(config.SshKey))
            throw new InvalidOperationException("Complete configuration and setup first.");
        var listener = new TcpListener(System.Net.IPAddress.Loopback, 0); listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
        var psi = new ProcessStartInfo("ssh.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true };
        foreach (var arg in new[] { "-N", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=8", "-i", config.SshKey, "-L", $"127.0.0.1:{port}:127.0.0.1:8787", config.SshUser + "@" + config.SshHost }) psi.ArgumentList.Add(arg);
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("OpenSSH could not start.");
        var stderr = process.StandardError.ReadToEndAsync();
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(12);
            while (DateTime.UtcNow < deadline && !process.HasExited)
            {
                try
                {
                    using var doc = JsonDocument.Parse(await Http.GetStringAsync($"http://127.0.0.1:{port}/healthz"));
                    if (doc.RootElement.GetProperty("ok").GetBoolean() && doc.RootElement.GetProperty("mode").GetString() == "loopback-stage1")
                        return "SSH forwarding and relay health respond. Device authentication and ChatGPT OAuth are not checked.";
                }
                catch { }
                await Task.Delay(250);
            }
        }
        finally { if (!process.HasExited) process.Kill(true); await process.WaitForExitAsync(); }
        // Read stderr only after exit, so a failed diagnostic cannot wait forever.
        var error = await stderr;
        throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? "SSH/relay diagnostic timed out." : error.Trim());
    }

    public static void OpenFolder(string path)
    {
        if (!Directory.Exists(path)) throw new DirectoryNotFoundException("The folder has not been created yet.");
        var psi = new ProcessStartInfo("explorer.exe") { UseShellExecute = false };
        psi.ArgumentList.Add(path); Process.Start(psi);
    }

    private static string Ps(string value) => "'" + value.Replace("'", "''") + "'";
    private static async Task<string> RunPowerShellAsync(string command)
    {
        var psi = new ProcessStartInfo("powershell.exe")
        {
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            UseShellExecute = false, CreateNoWindow = true
        };
        foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" + command)) }) psi.ArgumentList.Add(arg);
        using var process = Process.Start(psi) ?? throw new InvalidOperationException("PowerShell could not start.");
        var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) { try { process.Kill(true); } catch { } throw new TimeoutException("Local diagnostic timed out."); }
        var output = await stdout; var error = await stderr;
        if (process.ExitCode != 0) throw new InvalidOperationException(error.Trim());
        return output;
    }
}
