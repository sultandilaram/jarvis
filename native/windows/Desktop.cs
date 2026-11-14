using System.IO;
using System.ComponentModel;

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Windows.Automation;
namespace JarvisNative;
static class Desktop {
    record AppEntry(string BundleId,string Name,string Path);
    static readonly Regex Protected = new("(?:^|[ ._-])(cmd|powershell|pwsh|terminal|windowsterminal|wt|openconsole|conhost|alacritty|wezterm(?:-gui)?|mintty|conemu(?:64)?|tabby|hyper|kitty|putty|wscript|cscript|node|python|pythonw|ruby|bash|wsl|mshta|rundll32|regedit|mmc|control|systemsettings|sechealthui|windowssecurity|securityhealth(?:systray|service)?|credential(?:manager|uibroker)?|authenticator|authy(?:desktop)?|dashlane|lastpass|keepass(?:xc)?|bitwarden|1password|passwordsafe|jarvis|codex|chatgpt)(?:[ ._-]|$)", RegexOptions.IgnoreCase);
    static readonly Regex Sensitive = LoadSensitivePolicy();
    static Regex LoadSensitivePolicy() {
        using var resource=typeof(Desktop).Assembly.GetManifestResourceStream("JarvisNative.DesktopSensitivePolicy.json")??throw new Exception("Sensitive-field policy is missing.");
        using var policy=JsonDocument.Parse(resource);
        if(policy.RootElement.GetProperty("schema").GetInt32()!=1)throw new Exception("Unsupported sensitive-field policy.");
        return new Regex(policy.RootElement.GetProperty("pattern").GetString()!,RegexOptions.IgnoreCase|RegexOptions.CultureInvariant);
    }
    static bool SensitiveControl(AutomationElement node) {
        var c=node.Current;if(c.IsPassword)return true;
        var context=string.Join(" ",c.Name,c.AutomationId,c.HelpText,c.LabeledBy?.Current.Name);
        context=Regex.Replace(Regex.Replace(context,"([a-z])([A-Z])","$1 $2"),@"\s+"," ");
        return Sensitive.IsMatch(context);
    }
    static string Id(string path) => "windows.exe."+Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(System.IO.Path.GetFullPath(path).ToUpperInvariant()))).ToLowerInvariant();
    static string Exe(Process p) => p.MainModule?.FileName ?? throw new Exception("Process path is unavailable.");
    static void LocalNoLinks(string path) {
        var full=System.IO.Path.GetFullPath(path);
        if(!System.IO.Path.IsPathFullyQualified(full)||full.StartsWith("\\\\"))throw new Exception("Only local application paths are supported.");
        var current=System.IO.Path.GetPathRoot(full)!;
        foreach(var component in full[current.Length..].Split(System.IO.Path.DirectorySeparatorChar,StringSplitOptions.RemoveEmptyEntries)) {
            current=System.IO.Path.Combine(current,component);
            if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new Exception("Application symlinks and junctions require direct interaction.");
        }
    }
    static void Ordinary(string path) {
        if(!System.IO.Path.IsPathFullyQualified(path)||path.StartsWith("\\\\")||System.IO.Path.GetExtension(path).ToLowerInvariant()!=".exe"||Protected.IsMatch(System.IO.Path.GetFileNameWithoutExtension(path)))throw new Exception("Security, console, credential and assistant applications require direct interaction.");
        LocalNoLinks(path);
        if(System.IO.Path.GetFullPath(path).StartsWith(AppContext.BaseDirectory,StringComparison.OrdinalIgnoreCase))throw new Exception("JARVIS cannot control its own application.");
        var metadata=FileVersionInfo.GetVersionInfo(path);
        if(Protected.IsMatch(string.Join(" ",metadata.OriginalFilename,metadata.ProductName,metadata.FileDescription)))throw new Exception("Security, console, credential and assistant applications require direct interaction.");
    }
    static bool Elevated(Process p) {
        if(!OpenProcessToken(p.Handle,8,out var token))throw new Exception("Cannot verify target privilege level.");
        try {if(!GetTokenInformation(token,20,out int elevation,4,out _))throw new Exception("Cannot verify target privilege level.");return elevation!=0;}finally{CloseHandle(token);}
    }
    static List<AppEntry> Apps() {
        var entries=new Dictionary<string,AppEntry>();
        void Add(string path) {try {Ordinary(path);if(!File.Exists(path))return;var id=Id(path);entries[id]=new(id,System.IO.Path.GetFileNameWithoutExtension(path),path);}catch{}}
        foreach(var process in Process.GetProcesses())using(process){try{if(process.MainWindowHandle!=IntPtr.Zero)Add(Exe(process));}catch{}}
        Add(System.IO.Path.Combine(Environment.SystemDirectory,"notepad.exe"));
        Add(System.IO.Path.Combine(Environment.SystemDirectory,"calc.exe"));
        // Read shortcut targets only. Never execute shortcuts, command arguments or scripts.
        var comType=Type.GetTypeFromProgID("WScript.Shell");
        if(comType!=null) {
            dynamic? shell=null;
            try {
                shell=Activator.CreateInstance(comType);
                foreach(var folder in new[]{Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu)}) {
                    try{LocalNoLinks(folder);}catch{continue;}
                    if(!Directory.Exists(folder))continue;
                    foreach(var link in Directory.EnumerateFiles(folder,"*.lnk",new EnumerationOptions{RecurseSubdirectories=true,IgnoreInaccessible=true,AttributesToSkip=FileAttributes.ReparsePoint}).Take(1000)) {
                        object? shortcut=null;
                        try {shortcut=shell!.CreateShortcut(link);dynamic sc=shortcut;string target=sc.TargetPath;string arguments=sc.Arguments;if(string.IsNullOrWhiteSpace(arguments))Add(target);}catch{}finally{if(shortcut!=null)Marshal.FinalReleaseComObject(shortcut);}
                    }
                }
            }catch{}finally{if(shell!=null)Marshal.FinalReleaseComObject(shell);}
        }
        return entries.Values.OrderBy(a=>a.BundleId,StringComparer.Ordinal).ToList();
    }
    static AppEntry Resolve(string id) => Apps().FirstOrDefault(a=>a.BundleId==id)??throw new Exception("App is not in the current installed/running application catalog.");
    static (AutomationElement Window,Process Process) Target(string id,string? windowId=null) {
        var entry=Resolve(id); Ordinary(entry.Path);
        foreach(var p in Process.GetProcesses()) {
            try {
                if(p.MainWindowHandle==IntPtr.Zero||!string.Equals(Exe(p),entry.Path,StringComparison.OrdinalIgnoreCase))continue;
                if(windowId!=null&&p.MainWindowHandle.ToInt64().ToString()!=windowId)continue;
                if(Elevated(p))throw new Exception("Elevated applications require direct interaction. JARVIS never requests elevation.");
                var root=AutomationElement.FromHandle(p.MainWindowHandle);
                if(root.Current.ProcessId!=p.Id)throw new Exception("Window identity changed.");
                return(root,p);
            }catch(Win32Exception){}catch(InvalidOperationException){}
            p.Dispose();
        }
        throw new Exception("No accessible ordinary window is open for that app.");
    }
    sealed record Frame(double X,double Y,double Width,double Height);
    sealed record Element(string Id,string RuntimeId,string Role,string Subrole,string Label,string Value,bool Secure,bool Sensitive,string[] Actions,string? PressMethod,Frame Frame);
    sealed record Snapshot(string BundleId,int Pid,string Window,string WindowIdentifier,string DocumentURL,string WindowKind,bool PageContentAvailable,bool Truncated,List<Element> Elements);
    static string Bounded(string text,ref bool truncated) {if(text.Length>10000){truncated=true;return text[..10000];}return text;}
    static Snapshot Observe(string id,string? windowId=null) {
        var (root,process)=Target(id,windowId);using var lifetime=process;
        var elements=new List<Element>();bool truncated=false;
        // Browsers require page-origin evidence; use JARVIS's embedded browser instead.
        var browser=Regex.IsMatch(System.IO.Path.GetFileNameWithoutExtension(Exe(process)),"^(chrome|msedge|firefox|brave|arc|opera)$",RegexOptions.IgnoreCase);
        if(browser)return new(id,process.Id,SensitiveControl(root)?"[sensitive window]":root.Current.Name??"",process.MainWindowHandle.ToInt64().ToString(),"","application",false,false,elements);
        var clock=Stopwatch.StartNew();
        void Visit(AutomationElement node,string path,int depth) {
            if(elements.Count>=300||depth>18||clock.ElapsedMilliseconds>3000){truncated=true;return;}
            var c=node.Current;
            if(c.ProcessId!=process.Id){truncated=true;return;}
            bool secure=SensitiveControl(node);
            string label=secure?"[sensitive control]":Bounded(c.Name??"",ref truncated),value="";
            var walker=TreeWalker.ControlViewWalker;
            var child=secure?null:walker.GetFirstChild(node);
            // Container text/value patterns may aggregate protected descendants.
            // Read values only at unprotected leaves; never enter protected trees.
            if(!secure&&child==null) {
                if(node.TryGetCurrentPattern(ValuePattern.Pattern,out var raw))value=Bounded(((ValuePattern)raw).Current.Value??"",ref truncated);
                else if(node.TryGetCurrentPattern(TextPattern.Pattern,out var text))value=Bounded(((TextPattern)text).DocumentRange.GetText(10001),ref truncated);
            }
            var type=c.ControlType;
            string role=type==ControlType.Edit?"AXTextField":type==ControlType.Document?"AXTextArea":type==ControlType.Button?"AXButton":type==ControlType.Hyperlink?"AXLink":type==ControlType.Window?"AXWindow":"AXGroup";
            var actions=new List<string>();
            if(!secure&&c.IsEnabled&&node.TryGetCurrentPattern(InvokePattern.Pattern,out _))actions.Add("AXPress");
            if(!secure&&node.TryGetCurrentPattern(ScrollItemPattern.Pattern,out _))actions.Add("AXScrollToVisible");
            var rect=c.BoundingRectangle;var frame=rect.IsEmpty?new Frame(0,0,0,0):new Frame(rect.X,rect.Y,rect.Width,rect.Height);
            elements.Add(new(path,string.Join(".",node.GetRuntimeId()),role,secure?"[sensitive]":c.AutomationId??"",label,value,secure,secure,actions.ToArray(),actions.Contains("AXPress")?"accessibility":null,frame));
            if(secure)return;
            int index=0;
            while(child!=null) {Visit(child,path+"."+index++,depth+1);if(truncated)break;child=walker.GetNextSibling(child);}
        }
        Visit(root,"0",0);
        return new(id,process.Id,SensitiveControl(root)?"[sensitive window]":root.Current.Name??"",process.MainWindowHandle.ToInt64().ToString(),"","application",!browser,truncated,elements);
    }
    static AutomationElement Locate(AutomationElement root,string path) {
        if(!Regex.IsMatch(path,@"^0(?:\.\d{1,3}){0,18}$"))throw new Exception("Invalid element identity.");
        var current=root;foreach(var segment in path.Split('.').Skip(1)){var child=TreeWalker.ControlViewWalker.GetFirstChild(current);for(int i=0;i<int.Parse(segment)&&child!=null;i++)child=TreeWalker.ControlViewWalker.GetNextSibling(child);current=child??throw new Exception("Element changed.");}return current;
    }
    static string Required(JsonElement req,string key) => req.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.String?v.GetString()!:throw new Exception("Missing "+key);
    public static object Run(JsonElement req) {
        if(Elevated(Process.GetCurrentProcess()))throw new Exception("Run JARVIS as an ordinary user, not as administrator.");
        var action=Required(req,"action");
        if(action=="permissions")return new{accessibility=true,eventPosting=false,screenCapture=false,platform="win32",scope="UI Automation for ordinary apps; no elevation or global input"};
        if(action=="apps.list")return new{apps=Apps()};
        var id=Required(req,"bundleId");
        if(action=="apps.resolve") {var app=Resolve(id);using var file=File.OpenRead(app.Path);return new{app.BundleId,app.Name,app.Path,executableSha256=Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant()};}
        if(action=="apps.open") {
            var app=Resolve(id);Ordinary(app.Path);
            if(!req.TryGetProperty("executableSha256",out var expected)||expected.GetString()!=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(app.Path))).ToLowerInvariant())throw new Exception("App executable changed or was not reviewed.");
            Process.Start(new ProcessStartInfo(app.Path){UseShellExecute=false,WorkingDirectory=System.IO.Path.GetDirectoryName(app.Path)!});
            return new{launchAccepted=true,verified=false,bundleId=id};
        }
        if(action=="desktop.observe")return Observe(id);
        if(action is not ("desktop.press" or "desktop.type" or "desktop.scroll_to"))throw new Exception("This Windows native action is unavailable. Use the embedded browser for web pages.");
        var context=req.GetProperty("contextSnapshot");var windowId=Required(req,"windowIdentifier");
        var before=Observe(id,windowId);
        if(before.Truncated||!before.PageContentAvailable||!JsonNode.DeepEquals(JsonSerializer.SerializeToNode(before,Program.Json),JsonNode.Parse(context.GetRawText())))throw new Exception("Window changed after review; inspect and approve a fresh action.");
        var elementId=Required(req,"elementId");var e=before.Elements.FirstOrDefault(e=>e.Id==elementId)??throw new Exception("Unknown element.");
        if(e.Secure||e.Sensitive)throw new Exception("Sensitive controls require direct interaction.");
        var (root,process)=Target(id,windowId);using var lifetime=process;var target=Locate(root,elementId);
        if(target.Current.ProcessId!=before.Pid||string.Join(".",target.GetRuntimeId())!=e.RuntimeId||SensitiveControl(target))throw new Exception("Target identity or sensitivity changed.");
        // Revalidate the complete tree immediately before the one semantic action.
        if(!JsonNode.DeepEquals(JsonSerializer.SerializeToNode(before,Program.Json),JsonSerializer.SerializeToNode(Observe(id,windowId),Program.Json)))throw new Exception("Window changed before input.");
        if(SensitiveControl(target))throw new Exception("Target became sensitive before input.");
        if(action=="desktop.press") {if(!e.Actions.Contains("AXPress"))throw new Exception("Control has no Invoke pattern.");((InvokePattern)target.GetCurrentPattern(InvokePattern.Pattern)).Invoke();}
        if(action=="desktop.scroll_to") {if(!e.Actions.Contains("AXScrollToVisible"))throw new Exception("Control cannot scroll into view.");((ScrollItemPattern)target.GetCurrentPattern(ScrollItemPattern.Pattern)).ScrollIntoView();}
        if(action=="desktop.type") {var text=Required(req,"text");if(text.Length>10000||e.Role is not ("AXTextField" or "AXTextArea"))throw new Exception("Choose an editable text control and bounded text.");var pattern=(ValuePattern)target.GetCurrentPattern(ValuePattern.Pattern);if(pattern.Current.IsReadOnly)throw new Exception("Control is read-only.");pattern.SetValue(text);}
        return new{accepted=true,verified=false,notice="Inspect the window to verify the result; never automatically replay an uncertain action."};
    }
    [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(IntPtr token,int kind,out int value,int size,out int length);
    [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
}
