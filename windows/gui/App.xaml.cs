using System.Windows;
using System.IO;
using System.Reflection;

namespace PcBridge.Gui;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        if(e.Args.Length==2 && e.Args[0]=="--verify-release")
        {
            try
            {
                var target=Path.GetFullPath(e.Args[1]);
                if(Directory.Exists(target)) throw new IOException("Verification destination must not exist.");
                Directory.CreateDirectory(target);
                foreach(var (resource,name) in new[]{("PcBridge.Core","pc-bridge-core.exe"),("PcBridge.Server","mcp-pc-bridge-server.tar.gz"),("PcBridge.Plugin","mcp-pc-bridge-plugin-template.zip")})
                {
                    using var source=Assembly.GetExecutingAssembly().GetManifestResourceStream(resource) ?? throw new FileNotFoundException(resource);
                    using var file=File.Create(Path.Combine(target,name));source.CopyTo(file);
                }
                Shutdown(0);
            }
            catch { Shutdown(1); }
            return;
        }
        base.OnStartup(e);
    }
}
