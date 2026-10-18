using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;

namespace PcBridge.Gui;

public partial class SetupWizard : Window
{
    private readonly BridgeService _bridge;
    private readonly WizardService _service;
    private int _step;
    private bool _busy;
    private WizardSettings? _settings;
    private readonly HashSet<int> _completed=[];
    public SetupWizard(BridgeService bridge)
    {
        InitializeComponent();_bridge=bridge;_service=new(bridge);
        var config=bridge.LoadConfig();Host.Text=config.SshHost;Device.Text=config.DeviceId;ShowStep();
    }
    private void ShowStep()
    {
        for(var i=0;i<7;i++) ((StackPanel)FindName("Step"+i)).Visibility=i==_step?Visibility.Visible:Visibility.Collapsed;
        StepTitle.Text=$"Step {_step+1} of 7 · "+new[]{"Welcome","Your server","Install server","Windows setup","Pair the PC","ChatGPT plugin","Finish"}[_step];
        Back.IsEnabled=_step>0 && !_busy;
        Next.Content=_step switch {2=>Existing.IsChecked==true?"Verify server":"Install server",3=>"Set up Windows",4=>"Pair and start",6=>"Finish",_=>"Next"};
        Progress.Text="";
    }
    private async Task RunAsync(Func<Task> action)
    {
        if(_busy)return;_busy=true;Back.IsEnabled=Next.IsEnabled=false;Progress.Text="Working… Complete any prompts in the local terminal.";
        try { await action(); }
        catch(Exception ex) { Progress.Text=ex.Message;MessageBox.Show(this,ex.Message,"PC Bridge setup",MessageBoxButton.OK,MessageBoxImage.Warning); }
        finally {_busy=false;Back.IsEnabled=_step>0;Next.IsEnabled=true;}
    }
    private async void Next_Click(object sender,RoutedEventArgs e)
    {
        await RunAsync(async()=>
        {
            if(_step==0 && Consent.IsChecked!=true)throw new InvalidOperationException("Read and accept the remote-access notice to continue.");
            if(_step==0 && InstallApp.IsChecked==true && !_completed.Contains(0)) {await _service.InstallApplicationAsync();_completed.Add(0);}
            if(_step==1)
            {
                if(Existing.IsChecked!=true && AutomaticTls.IsChecked==true && AcmeConsent.IsChecked!=true)throw new InvalidOperationException("Accept the certificate provider's agreement or use your own certificate.");
                _settings=new(Host.Text.Trim(),Domain.Text.Trim(),Device.Text.Trim(),Email.Text.Trim(),AutomaticTls.IsChecked==true,Cert.Text.Trim(),Key.Text.Trim());
                // Existing installations do not request a new certificate.
                if(Existing.IsChecked==true)_settings=_settings with {AutoTls=false,Cert="/existing/fullchain.pem",Key="/existing/privkey.pem"};
                _settings.Validate();
                Review.Text=Existing.IsChecked==true?$"Verify HTTPS on {_settings.Domain}. No server installation is requested.":$"Server: root@{_settings.Host}\nDomain: {_settings.Domain}\nDevice: {_settings.DeviceId}\n\nInstall prerequisites via apt, the relay and gateway under /opt/mcp-pc-bridge, independent credentials under /etc/mcp-pc-bridge, and dedicated systemd services. "+(_settings.AutoTls?"Obtain a Let's Encrypt certificate and enable its renewal timer.":"Use the TLS paths you supplied.");
                Endpoint.Text="MCP URL: https://"+_settings.Domain+"/mcp";
            }
            if(_step==2 && !_completed.Contains(2))
            {
                if(Existing.IsChecked!=true)await _service.InstallServerAsync(_settings!);
                await _service.CheckHttpsAsync(_settings!.Domain);_completed.Add(2);Step1.IsEnabled=false;
            }
            if(_step==3 && !_completed.Contains(3))
            {
                var token=Token.Password;Token.Clear();if(!Regex.IsMatch(token,@"\A[a-f0-9]{64}\z"))throw new InvalidOperationException("Enter the new deviceToken from your server.");
                await _bridge.RunCoreAsync(["configure",_settings!.Host,_settings.DeviceId]);
                await _bridge.RunCoreAsync(["setup"],token);_completed.Add(3);
            }
            if(_step==4 && !_completed.Contains(4))
            {
                await _service.PairAsync(_settings!);await _bridge.StartAsync();_completed.Add(4);
            }
            if(_step==5 && Verified.IsChecked!=true)throw new InvalidOperationException("Complete the ChatGPT OAuth step and verify dc_remote_status before confirming.");
            if(_step==6){_busy=false;Close();return;}
            _step++;ShowStep();
        });
    }
    private void Back_Click(object sender,RoutedEventArgs e){if(!_busy && _step>0){_step--;ShowStep();}}
    private void Window_Closing(object? sender,CancelEventArgs e){if(_busy){e.Cancel=true;MessageBox.Show(this,"Wait for the active setup operation. If its terminal was interrupted, inspect the server before repeating writes.","PC Bridge");}}
    private async void InstallApp_Click(object sender,RoutedEventArgs e)=>await RunAsync(async()=>{await _service.InstallApplicationAsync();Progress.Text="Application installed. No startup entry or remote connection was enabled.";});
    private async void Inspect_Click(object sender,RoutedEventArgs e)=>await RunAsync(()=>_service.InspectServerAsync(_settings!));
    private async void Secrets_Click(object sender,RoutedEventArgs e)=>await RunAsync(()=>_service.ShowSetupAsync(_settings!));
    private async void Callback_Click(object sender,RoutedEventArgs e)=>await RunAsync(async()=>{await _service.AddCallbackAsync(_settings!,Callback.Text.Trim());Progress.Text="Exact callback added; only this gateway was restarted.";});
    private async void Plugin_Click(object sender,RoutedEventArgs e)=>await RunAsync(async()=>
    {
        await _service.CheckHttpsAsync(_settings!.Domain);
        var zip=_service.CreatePlugin(_settings,ClientId.Text.Trim());BridgeService.OpenFolder(Path.GetDirectoryName(zip)!);
        Open(WizardService.PluginPage);Progress.Text="Plugin ZIP prepared locally. Complete the connection and consent in ChatGPT.";
    });
    private void Acme_Click(object sender,RoutedEventArgs e)=>Open("https://letsencrypt.org/repository/");
    private static void Open(string url)=>Process.Start(new ProcessStartInfo(url){UseShellExecute=true});
}
