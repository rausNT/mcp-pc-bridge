using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PcBridge.Gui;

public sealed record WizardSettings(string Host,string Domain,string DeviceId,string Email,bool AutoTls,string Cert,string Key)
{
    public void Validate()
    {
        if (!Regex.IsMatch(Host,@"\A[A-Za-z0-9][A-Za-z0-9.-]{0,252}\z") || Host.EndsWith(".invalid")) throw new ArgumentException("Enter your SSH host or IPv4 address.");
        if (!Regex.IsMatch(Domain,@"\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\z") || Domain.EndsWith(".invalid") || Domain.Split('.').All(x=>x.All(char.IsDigit))) throw new ArgumentException("Enter your own lowercase DNS domain, not an IP or URL.");
        if (!Regex.IsMatch(DeviceId,@"\A[A-Za-z0-9][A-Za-z0-9._-]{0,63}\z")) throw new ArgumentException("Invalid device ID.");
        if (AutoTls && !Regex.IsMatch(Email,@"\A[^\s@]+@[^\s@]+\.[^\s@]+\z")) throw new ArgumentException("Enter an email for certificate expiry notices.");
        if (!AutoTls && (!Cert.StartsWith('/') || !Key.StartsWith('/'))) throw new ArgumentException("Enter both absolute server TLS paths.");
        foreach(var value in new[]{Host,Domain,DeviceId,Email,Cert,Key}) if(value.IndexOfAny(['\0','\r','\n'])>=0) throw new ArgumentException("Control characters are not allowed.");
    }
}

public sealed class WizardService(BridgeService bridge)
{
    public const string PluginPage="https://chatgpt.com/plugins";
    public string WorkDirectory => Path.Combine(bridge.StateDirectory,"wizard");
    public static string Shell(string value) => "'"+value.Replace("'","'\"'\"'")+"'";
    private static string Ps(string value) => "'"+value.Replace("'","''")+"'";
    private static string Call(string exe,params string[] args) => "& "+Ps(exe)+" "+string.Join(" ",args.Select(Ps))+"; if($LASTEXITCODE -ne 0){throw 'The command failed. Inspect state before retrying.'}";
    private static string Ssh(string host,string command,bool firstContact=false) => Call("ssh.exe","-t","-o",firstContact?"StrictHostKeyChecking=ask":"StrictHostKeyChecking=yes","-o","ConnectTimeout=15","root@"+host,command);
    private static async Task TerminalAsync(string commands)
    {
        // Credentials are entered into native SSH, never into a script/argument/log.
        var script="$ErrorActionPreference='Stop';try {"+commands+";Write-Host 'Step completed.';Read-Host 'Press Enter to return to PC Bridge';exit 0}catch{Write-Host $_ -ForegroundColor Red;Read-Host 'Inspect the error; press Enter to return';exit 1}";
        var psi=new ProcessStartInfo("powershell.exe") {UseShellExecute=false,CreateNoWindow=false};
        foreach(var arg in new[]{"-NoProfile","-EncodedCommand",Convert.ToBase64String(Encoding.Unicode.GetBytes(script))}) psi.ArgumentList.Add(arg);
        using var process=Process.Start(psi) ?? throw new InvalidOperationException("Cannot open the local setup terminal.");
        await process.WaitForExitAsync();
        if(process.ExitCode!=0) throw new InvalidOperationException("The setup step did not finish successfully. Inspect the server before repeating any writes (OUTCOME_UNKNOWN).");
    }
    private string Asset(string resource,string name)
    {
        Directory.CreateDirectory(WorkDirectory);var target=Path.Combine(WorkDirectory,name);
        using var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(resource) ?? throw new FileNotFoundException("The release setup payload is missing.");
        using var output=File.Create(target);stream.CopyTo(output);return target;
    }
    public static string InstallCommand(WizardSettings s,string remote)
    {
        s.Validate();
        var command="python3 "+Shell(remote+"/mcp-pc-bridge/server/wizard-install.py")+" --install --accept-remote-command-access --domain "+Shell(s.Domain)+" --device-id "+Shell(s.DeviceId);
        return command+(s.AutoTls?" --accept-acme-terms --email "+Shell(s.Email):" --cert "+Shell(s.Cert)+" --key "+Shell(s.Key));
    }
    public async Task InstallServerAsync(WizardSettings s)
    {
        s.Validate();Directory.CreateDirectory(WorkDirectory);
        var receipt=Path.Combine(WorkDirectory,"server-attempt.json");
        if(File.Exists(receipt)) throw new InvalidOperationException("A previous server install attempt is recorded. Inspect the server and use the existing-server path; automatic reinstallation is blocked.");
        var archive=Asset("PcBridge.Server","server.tar.gz");
        var remote="/tmp/mcp-pc-bridge-"+Guid.NewGuid().ToString("N");
        // Record BEFORE the first remote write. A closed terminal is not evidence of rollback.
        File.WriteAllText(receipt,JsonSerializer.Serialize(new {s.Host,s.Domain,remote,status="OUTCOME_UNKNOWN"}));
        var commands=Ssh(s.Host,"umask 077; mkdir "+Shell(remote),true)+";"+
            Call("scp.exe","-o","StrictHostKeyChecking=yes",archive,"root@"+s.Host+":"+remote+"/server.tar.gz")+";"+
            Ssh(s.Host,"tar -xzf "+Shell(remote+"/server.tar.gz")+" -C "+Shell(remote)+" && "+InstallCommand(s,remote));
        await TerminalAsync(commands);
        File.WriteAllText(receipt,JsonSerializer.Serialize(new {s.Host,s.Domain,remote,status="INSTALLED"}));
    }
    public Task ShowSetupAsync(WizardSettings s)
    {
        s.Validate();return TerminalAsync(Ssh(s.Host,"python3 /opt/mcp-pc-bridge/admin/show-setup.py",true));
    }
    public Task InspectServerAsync(WizardSettings s)
    {
        s.Validate();return TerminalAsync(Ssh(s.Host,"systemctl status mcp-pc-bridge-relay mcp-pc-bridge-gateway --no-pager; test -f /etc/mcp-pc-bridge/owner-setup.json",true));
    }
    public async Task PairAsync(WizardSettings s)
    {
        s.Validate();var config=bridge.LoadConfig();
        if(config.SshHost!=s.Host || config.DeviceId!=s.DeviceId) throw new InvalidOperationException("PC settings do not match this server. Return to the PC setup step.");
        var pub=config.SshKey+".pub";if(!File.Exists(pub))throw new FileNotFoundException("Complete PC setup first.");
        // Inspect actual access before retrying a possibly completed authorization.
        try {await bridge.TestRestrictedSshAsync();return;} catch(InvalidOperationException) { }
        Directory.CreateDirectory(WorkDirectory);
        var receipt=Path.Combine(WorkDirectory,"pair-attempt.json");
        if(File.Exists(receipt))throw new InvalidOperationException("A pairing attempt is recorded and forwarding is unavailable. Inspect the server/key authorization before another write; no automatic retry was performed.");
        var remote="/tmp/mcp-pc-bridge-public-"+Guid.NewGuid().ToString("N")+".pub";
        File.WriteAllText(receipt,JsonSerializer.Serialize(new {s.Host,remote,status="OUTCOME_UNKNOWN"}));
        await TerminalAsync(Call("scp.exe","-o","StrictHostKeyChecking=yes",pub,"root@"+s.Host+":"+remote)+";"+
            Ssh(s.Host,"python3 /opt/mcp-pc-bridge/admin/authorize-device.py --configure-ssh --public-key-file "+Shell(remote)));
        await bridge.TestRestrictedSshAsync();
        File.WriteAllText(receipt,JsonSerializer.Serialize(new {s.Host,remote,status="PAIRED"}));
    }
    public Task AddCallbackAsync(WizardSettings s,string callback)
    {
        s.Validate();
        if(callback!="https://chatgpt.com/connector_platform_oauth_redirect" && !Regex.IsMatch(callback,@"\Ahttps://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]+\z")) throw new ArgumentException("Paste only the exact ChatGPT callback shown by the connection screen.");
        return TerminalAsync(Ssh(s.Host,"python3 /opt/mcp-pc-bridge/admin/admin.py add-redirect "+Shell(callback)));
    }
    public async Task CheckHttpsAsync(string domain)
    {
        using var client=new HttpClient(new HttpClientHandler {AllowAutoRedirect=false}) {Timeout=TimeSpan.FromSeconds(15)};
        using var metadata=JsonDocument.Parse(await client.GetStringAsync("https://"+domain+"/.well-known/oauth-protected-resource"));
        if(metadata.RootElement.GetProperty("resource").GetString()!="https://"+domain+"/mcp") throw new InvalidDataException("Unexpected protected resource metadata.");
    }
    public string CreatePlugin(WizardSettings s,string clientId)
    {
        s.Validate();if(!Regex.IsMatch(clientId,@"\A[A-Za-z0-9._-]{1,128}\z"))throw new ArgumentException("Enter the public OAuth client ID (not the secret).");
        var template=Asset("PcBridge.Plugin","plugin-template.zip");var output=Path.Combine(WorkDirectory,"my-pc-bridge-plugin.zip");
        using var input=ZipFile.OpenRead(template);using var file=File.Create(output);using var archive=new ZipArchive(file,ZipArchiveMode.Create);
        foreach(var entry in input.Entries)
        {
            var target=archive.CreateEntry(entry.FullName);
            if(entry.FullName is "mcp.json" or ".mcp.json")
            {
                using var reader=new StreamReader(entry.Open());var content=reader.ReadToEnd();
                var doc=JsonNode.Parse(content)!;var server=doc["mcpServers"]!["desktop-bridge"]!;server["url"]="https://"+s.Domain+"/mcp";
                server["extensions"]=JsonSerializer.SerializeToNode(new Dictionary<string,object> { ["com.openai"]=new {auth=new {type="oauth",client=new {mode="provided",clientId,tokenEndpointAuthMethod="client_secret_basic"},baseScopes=new[]{"desktop"}}} });
                content=doc.ToJsonString(new JsonSerializerOptions{WriteIndented=true});
                using var writer=new StreamWriter(target.Open(),new UTF8Encoding(false));writer.Write(content);
            }
            else {using var source=entry.Open();using var destination=target.Open();source.CopyTo(destination);}
        }
        return output;
    }
    public async Task InstallApplicationAsync()
    {
        var source=Environment.ProcessPath ?? throw new InvalidOperationException("Executable location is unavailable.");
        if(Path.GetFileName(source)!="pc-bridge.exe") throw new InvalidOperationException("Use the published pc-bridge.exe to install the application.");
        var dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","MCP PC Bridge");
        Directory.CreateDirectory(dir);var target=Path.Combine(dir,"pc-bridge.exe");
        if(!string.Equals(source,target,StringComparison.OrdinalIgnoreCase))
        {
            if(File.Exists(target) && !System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(source)).SequenceEqual(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(target)))) throw new InvalidOperationException("Another build is installed. Review the upgrade before replacing it.");
            if(!File.Exists(target))File.Copy(source,target);
        }
        var shortcut=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"PC Bridge.lnk");
        var script="$ErrorActionPreference='Stop';$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut("+Ps(shortcut)+");$s.TargetPath="+Ps(target)+";$s.WorkingDirectory="+Ps(dir)+";$s.Save()";
        var psi=new ProcessStartInfo("powershell.exe") {UseShellExecute=false,CreateNoWindow=true};
        foreach(var arg in new[]{"-NoProfile","-NonInteractive","-EncodedCommand",Convert.ToBase64String(Encoding.Unicode.GetBytes(script))})psi.ArgumentList.Add(arg);
        using var process=Process.Start(psi)??throw new InvalidOperationException("Cannot create the Start menu shortcut.");
        await process.WaitForExitAsync();if(process.ExitCode!=0)throw new InvalidOperationException("The app was copied, but shortcut creation failed.");
    }
}
