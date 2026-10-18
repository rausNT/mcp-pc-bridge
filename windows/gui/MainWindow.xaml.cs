using Microsoft.Win32;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PcBridge.Gui;

public partial class MainWindow : Window
{
    private readonly BridgeService _bridge;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(4) };
    private bool _busy, _refreshing, _updating, _dark;
    public MainWindow() : this(new BridgeService()) { }
    public MainWindow(BridgeService bridge)
    {
        _bridge = bridge;
        InitializeComponent();
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        _dark = key?.GetValue("AppsUseLightTheme") is int i && i == 0;
        if (!_dark)
        {
            foreach (var (name, color) in new[] { ("WindowBrush", "#F3F6FA"), ("SidebarBrush", "#EAF0F6"), ("CardBrush", "#FFFFFF"), ("CardHoverBrush", "#E2EAF3"), ("TextBrush", "#142235"), ("MutedTextBrush", "#506070"), ("BorderBrush", "#CCD6E0"), ("AccentBrush", "#55B8EE"), ("GoodBrush", "#147D38"), ("BadBrush", "#BA2020"), ("WarnBrush", "#8A5D00") })
                Resources[name] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
        }
        PathsText.Text = $"State: {_bridge.StateDirectory}\n\nCore: {_bridge.CorePath}";
        Loaded += async (_, _) =>
        {
            try { var config = _bridge.LoadConfig(); HostInput.Text = config.SshHost; DeviceInput.Text = config.DeviceId; }
            catch (Exception ex) { ShowError(ex); }
            await RefreshAsync(); _timer.Start();
        };
        _timer.Tick += async (_, _) => { if (!_busy) await RefreshAsync(); };
    }
    private void Window_SourceInitialized(object sender, EventArgs e) => DwmHelper.Apply(this, _dark);
    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_busy) { e.Cancel = true; MessageBox.Show(this, "Wait for the current operation to finish before closing.", "PC Bridge"); return; }
        _timer.Stop(); // Closing the panel does not stop the core.
    }
    private void ShowError(Exception ex) => MessageBox.Show(this, ex.Message, "PC Bridge", MessageBoxButton.OK, MessageBoxImage.Warning);
    private async Task RefreshAsync()
    {
        if (_refreshing) return;
        _refreshing = true;
        try
        {
            var s = await _bridge.GetStatusAsync();
            var ready = s.RelayHealthy && s.AgentRunning && s.OwnedCores == 1;
            StatusText.Text = !s.Configured ? "Not configured" : ready ? "Local components respond" : s.PortOpen || s.AgentRunning || s.OwnedCores > 0 ? "Partial connection — check the core console" : "Disconnected";
            StatusText.Foreground = (Brush)FindResource(ready ? "GoodBrush" : "WarnBrush");
            StatusDetail.Text = $"Server: {(s.Configured ? s.Config.SshHost : "not set")}\nLoopback port {s.Config.LocalPort}: {(s.PortOpen ? "open" : "closed")}\nRelay: {(s.RelayHealthy ? s.RelayVersion : "no valid health response")}\nAgent process: {(s.AgentRunning ? "present" : "not found")}\nOwned core processes: {s.OwnedCores}";
            StartButton.IsEnabled = !_busy && s.Configured && !s.PortOpen && !s.AgentRunning && s.OwnedCores == 0;
            StopButton.IsEnabled = RestartButton.IsEnabled = !_busy && s.OwnedCores == 1;
            SshDetails.Text = $"Server: {s.Config.SshHost}\nSSH user: {s.Config.SshUser}\nKey: {s.Config.SshKey}\nDestination: 127.0.0.1:8787";
            TrustCommand.Text = string.IsNullOrEmpty(s.Config.SshKey) ? "Complete setup first." : $"ssh -T -i '{s.Config.SshKey.Replace("'", "''")}' -o StrictHostKeyChecking=ask '{s.Config.SshUser}@{s.Config.SshHost}'";
            _updating = true; StartupCheck.IsChecked = s.AutoStart; _updating = false;
        }
        catch (Exception ex)
        {
            StatusText.Text = "Status unavailable"; StatusText.Foreground = (Brush)FindResource("BadBrush");
            StatusDetail.Text = ex.Message; StartButton.IsEnabled = StopButton.IsEnabled = RestartButton.IsEnabled = false;
        }
        finally { _refreshing = false; }
    }
    private async Task RunAsync(Func<Task> action)
    {
        if (_busy) return;
        _busy = true; ActionPanel.IsEnabled = SetupButton.IsEnabled = SshTestButton.IsEnabled = StartupCheck.IsEnabled = false;
        StatusText.Text = "Working…";
        try { await action(); }
        catch (Exception ex) { ShowError(ex); }
        finally { _busy = false; ActionPanel.IsEnabled = SetupButton.IsEnabled = SshTestButton.IsEnabled = StartupCheck.IsEnabled = true; await RefreshAsync(); }
    }
    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        var selected = (Button)sender;
        foreach (var (page, name) in new[] { (OverviewPage, "Overview"), (SetupPage, "Setup"), (SshPage, "Ssh"), (ServerPage, "Server"), (SettingsPage, "Settings") }) page.Visibility = (string)selected.Tag == name ? Visibility.Visible : Visibility.Collapsed;
    }
    private async void Start_Click(object sender, RoutedEventArgs e) => await RunAsync(() => _bridge.StartAsync());
    private async void Stop_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show(this, "Disconnect this bridge and stop its verified core process tree? Active jobs may stop; detached jobs may continue. Completed changes are not undone.", "Stop PC Bridge", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) == MessageBoxResult.Yes) await RunAsync(_bridge.StopAsync);
    }
    private async void Restart_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show(this, "Restart this bridge? The connection will be interrupted and active jobs may stop.", "Restart PC Bridge", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) == MessageBoxResult.Yes) await RunAsync(() => _bridge.RestartAsync());
    }
    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RunAsync(RefreshAsync);
    private async void Setup_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show(this, "Prepare this PC for remote file access and command execution? Setup downloads dependencies and creates local credentials. It does not start the connection.", "Set up PC Bridge", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        await RunAsync(async () =>
        {
            var token = TokenInput.Password; TokenInput.Clear();
            if (!System.Text.RegularExpressions.Regex.IsMatch(token, "\\A[a-f0-9]{64}\\z")) throw new InvalidOperationException("Enter the 64-character lowercase hex device token from your own server.");
            SetupOutput.Text = "Preparing this installation…";
            await _bridge.RunCoreAsync(["configure", HostInput.Text.Trim(), DeviceInput.Text.Trim()]);
            SetupOutput.Text = await _bridge.RunCoreAsync(["setup"], token);
        });
    }
    private async void SshTest_Click(object sender, RoutedEventArgs e) => await RunAsync(async () => SshOutput.Text = await _bridge.TestRestrictedSshAsync());
    private async void PublicKey_Click(object sender, RoutedEventArgs e) => await RunAsync(async () => SshOutput.Text = await _bridge.RunCoreAsync(["pubkey"]));
    private async void Startup_Changed(object sender, RoutedEventArgs e)
    {
        if (_updating || _busy) return;
        var enable = StartupCheck.IsChecked == true;
        if (enable && MessageBox.Show(this, "Enable remote access at Windows sign-in using the visible core console?", "Startup", MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes) { await RefreshAsync(); return; }
        await RunAsync(async () => await _bridge.RunCoreAsync([enable ? "install-startup" : "uninstall-startup"]));
    }
    private void Folder_Click(object sender, RoutedEventArgs e) { try { BridgeService.OpenFolder(_bridge.StateDirectory); } catch (Exception ex) { ShowError(ex); } }
    private void Licenses_Click(object sender,RoutedEventArgs e)
    {
        var assembly=System.Reflection.Assembly.GetExecutingAssembly();var text=new System.Text.StringBuilder();
        foreach(var name in assembly.GetManifestResourceNames().Where(n=>n.StartsWith("PcBridge.Licenses.")).Order())
        {
            using var reader=new StreamReader(assembly.GetManifestResourceStream(name)!);
            text.AppendLine("===== "+name["PcBridge.Licenses.".Length..]+" =====").AppendLine(reader.ReadToEnd()).AppendLine();
        }
        new Window {Title="PC Bridge — included licenses",Owner=this,Width=900,Height=700,WindowStartupLocation=WindowStartupLocation.CenterOwner,
            Content=new TextBox {Text=text.ToString(),IsReadOnly=true,TextWrapping=TextWrapping.Wrap,VerticalScrollBarVisibility=ScrollBarVisibility.Auto,Margin=new Thickness(16)}}.ShowDialog();
    }
    private void Guide_Click(object sender, RoutedEventArgs e) => Process.Start(new ProcessStartInfo("https://github.com/rausNT/mcp-pc-bridge/blob/main/docs/DEPLOYMENT.md") { UseShellExecute = true });
    private void Wizard_Click(object sender,RoutedEventArgs e)
    {
        if(_busy)return;
        try { var wizard=new SetupWizard(_bridge){Owner=this};wizard.ShowDialog(); }
        catch(Exception ex){ShowError(ex);}
    }
}
