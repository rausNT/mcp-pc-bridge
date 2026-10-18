using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using PcBridge.Gui;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("child")) { Thread.Sleep(Timeout.Infinite); return 0; }
        if (args.Contains("run"))
        {
            var state = args[Array.IndexOf(args, "--state-dir") + 1];
            using var child = Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "child") { UseShellExecute = false, CreateNoWindow = true })!;
            File.WriteAllText(Path.Combine(state,"fixture-pids.json"), JsonSerializer.Serialize(new[] {Environment.ProcessId,child.Id}));
            Thread.Sleep(Timeout.Infinite); return 0;
        }
        var root = Path.Combine(Path.GetTempPath(), "pc-bridge-gui-test-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var service = new BridgeService(root, Environment.ProcessPath!);
            CheckAsync(service).GetAwaiter().GetResult();
            CheckWizard(service);
            if (args.Length == 2 && args[0] == "--render") Render(service, Path.GetFullPath(args[1]));
            Console.WriteLine("GUI_INTEGRATION_PASSED: isolated start, duplicate rejection, restart, verified tree stop, occupied-port refusal, malformed config, loopback health, unrelated-process survival.");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
        finally { Directory.Delete(root,true); }
    }
    private static void Assert(bool value,string message) { if(!value) throw new Exception(message); }
    private static async Task Reject(Func<Task> operation)
    {
        try { await operation(); } catch(InvalidOperationException) { return; }
        throw new Exception("Operation should have been rejected");
    }
    private static bool Alive(int pid) { try { using var p=Process.GetProcessById(pid); return !p.HasExited; } catch(ArgumentException) { return false; } }
    private static async Task CheckAsync(BridgeService service)
    {
        Assert(!(await service.GetStatusAsync()).Configured,"New state unexpectedly configured");
        await Reject(()=>service.StartAsync(false));
        var listener=new TcpListener(IPAddress.Loopback,0); listener.Start();
        var port=((IPEndPoint)listener.LocalEndpoint).Port;
        var config=new BridgeConfig {SshHost="localhost",LocalPort=port};
        File.WriteAllText(service.ConfigPath,JsonSerializer.Serialize(config));
        await Reject(()=>service.StartAsync(false));
        listener.Stop(); listener=new TcpListener(IPAddress.Loopback,0); listener.Start();
        config.LocalPort=((IPEndPoint)listener.LocalEndpoint).Port;
        File.WriteAllText(service.ConfigPath,JsonSerializer.Serialize(config));
        var healthTask=Task.Run(async()=>
        {
            // GetStatus performs a TCP probe followed by HTTP.
            using(var probe=await listener.AcceptTcpClientAsync()) { }
            using var client=await listener.AcceptTcpClientAsync();
            var stream=client.GetStream();
            using var reader=new StreamReader(stream,Encoding.ASCII,false,1024,true);
            while(!string.IsNullOrEmpty(await reader.ReadLineAsync())) { }
            var body="{\"ok\":true,\"mode\":\"loopback-stage1\",\"version\":\"synthetic\"}";
            var response=Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+body.Length+"\r\nConnection: close\r\n\r\n"+body);
            await stream.WriteAsync(response);
        });
        var health=await service.GetStatusAsync(); await healthTask.WaitAsync(TimeSpan.FromSeconds(10));
        Assert(health.RelayHealthy && !health.AgentRunning,"Health response incorrectly implies agent authentication");
        listener.Stop();
        using var unrelated=Process.Start(new ProcessStartInfo(Environment.ProcessPath!,"child") {UseShellExecute=false,CreateNoWindow=true})!;
        try
        {
            await service.StartAsync(false);
            var pids=JsonSerializer.Deserialize<int[]>(File.ReadAllText(Path.Combine(service.StateDirectory,"fixture-pids.json")))!;
            Assert((await service.GetStatusAsync()).OwnedCores==1,"Owned core not found");
            await Reject(()=>service.StartAsync(false));
            await service.RestartAsync(false);
            var replacement=JsonSerializer.Deserialize<int[]>(File.ReadAllText(Path.Combine(service.StateDirectory,"fixture-pids.json")))!;
            Assert(replacement[0]!=pids[0] && !Alive(pids[0]) && !Alive(pids[1]),"Restart did not stop original tree");
            await service.StopAsync();
            Assert(!Alive(replacement[0]) && !Alive(replacement[1]),"Stop left fixture tree alive");
            Assert(!unrelated.HasExited,"Unrelated process was stopped");
            await Reject(service.StopAsync);
        }
        finally
        {
            if(!unrelated.HasExited) { unrelated.Kill(true); await unrelated.WaitForExitAsync(); }
            try { await service.StopAsync(); } catch { }
        }
        File.WriteAllText(service.ConfigPath,"malformed");
        try { service.LoadConfig(); throw new Exception("Corrupt config silently accepted"); } catch(JsonException) { }
        File.Delete(service.ConfigPath);
    }
    private static void Render(BridgeService service,string output)
    {
        Directory.CreateDirectory(output);
        var app=new Application(); var window=new MainWindow(service);
        var visual=(System.Windows.Controls.Grid)window.Content;
        window.Content=null;visual.Resources=window.Resources;
        visual.Background=(Brush)window.FindResource("WindowBrush");
        foreach(var pageName in new[]{"Overview","Setup","Ssh","Server","Settings"})
        {
            foreach(var name in new[]{"Overview","Setup","Ssh","Server","Settings"}) ((FrameworkElement)window.FindName(name+"Page")).Visibility=name==pageName?Visibility.Visible:Visibility.Collapsed;
            visual.Measure(new Size(1040,760));visual.Arrange(new Rect(0,0,1040,760));visual.UpdateLayout();
            var bitmap=new RenderTargetBitmap(1040,760,96,96,PixelFormats.Pbgra32);bitmap.Render(visual);
            var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using var stream=File.Create(Path.Combine(output,pageName+".png"));encoder.Save(stream);
        }
        window.Close();
        var wizard=new SetupWizard(service);var layout=(System.Windows.Controls.Grid)wizard.Content;
        wizard.Content=null;layout.Resources=wizard.Resources;layout.Background=(Brush)wizard.FindResource("WindowBrush");
        for(var step=0;step<7;step++)
        {
            for(var i=0;i<7;i++)((FrameworkElement)wizard.FindName("Step"+i)).Visibility=i==step?Visibility.Visible:Visibility.Collapsed;
            ((System.Windows.Controls.TextBlock)wizard.FindName("StepTitle")).Text=$"Step {step+1} of 7";
            layout.Measure(new Size(800,790));layout.Arrange(new Rect(0,0,800,790));layout.UpdateLayout();
            var bitmap=new RenderTargetBitmap(800,790,96,96,PixelFormats.Pbgra32);bitmap.Render(layout);
            var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using var stream=File.Create(Path.Combine(output,$"Wizard-{step+1}.png"));encoder.Save(stream);
        }
        wizard.Close();app.Shutdown();Console.WriteLine("Rendered all five panel pages and seven wizard steps.");
    }
    private static void CheckWizard(BridgeService service)
    {
        var settings=new WizardSettings("mcp.example.org","mcp.example.org","desktop","owner@example.org",true,"","");
        settings.Validate();
        foreach(var bad in new[]{settings with {Host="-oProxyCommand=bad"},settings with {Domain="x;command"},settings with {DeviceId="../bad"},settings with {Email="bad\ncommand"}})
        {
            try {bad.Validate();throw new Exception("Invalid wizard input accepted");}catch(ArgumentException) { }
        }
        Assert(WizardService.Shell("a'b")=="'a'\"'\"'b'","POSIX quoting failed");
        var command=WizardService.InstallCommand(settings,"/tmp/synthetic");
        Assert(command.Contains("--accept-remote-command-access") && command.Contains("--accept-acme-terms"),"Explicit installation flags missing");
        var serviceWizard=new WizardService(service);var zip=serviceWizard.CreatePlugin(settings,"synthetic-client");
        using(var archive=System.IO.Compression.ZipFile.OpenRead(zip))
        foreach(var name in new[]{"mcp.json",".mcp.json"})
        {
            using var reader=new StreamReader(archive.GetEntry(name)!.Open());var text=reader.ReadToEnd();
            using var json=JsonDocument.Parse(text);var server=json.RootElement.GetProperty("mcpServers").GetProperty("desktop-bridge");
            Assert(server.GetProperty("url").GetString()=="https://mcp.example.org/mcp","Wrong personal endpoint");
            Assert(server.GetProperty("extensions").GetProperty("com.openai").GetProperty("auth").GetProperty("client").GetProperty("clientId").GetString()=="synthetic-client","Wrong OAuth client");
            Assert(!text.Contains("clientSecret"),"Secret field packaged");
        }
        serviceWizard.CreatePlugin(settings,"synthetic-client"); // safe local rebuild
        Console.WriteLine("WIZARD_TESTS_PASSED: input rejection, shell quoting, explicit flags, personal package OAuth, repeat packaging.");
    }
}
