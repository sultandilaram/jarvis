using System.Windows;
using System.Windows.Controls;
using System.Windows.Automation;
using System.Reflection;
using System.Text.Json;
namespace NativeControlFixture;
static class Fixture {
 [STAThread]static void Main(string[] args){
  if(args.Length==4&&args[0]=="--probe-ordinary") {
   try {
    var method=Assembly.LoadFrom(args[1]).GetType("JarvisNative.Desktop")?.GetMethod("Ordinary",BindingFlags.Static|BindingFlags.NonPublic)??throw new Exception("Production path policy was not found.");
    object result;try{method.Invoke(null,new object[]{args[2]});result=new{allowed=true,reason=""};}catch(TargetInvocationException e){result=new{allowed=false,reason=e.InnerException?.Message??e.Message};}
    System.IO.File.WriteAllText(args[3],JsonSerializer.Serialize(result));
   }catch(Exception e){System.IO.File.WriteAllText(args[3],JsonSerializer.Serialize(new{error=e.Message}));Environment.ExitCode=2;}
   return;
  }
  var app=new Application();var panel=new StackPanel{Margin=new Thickness(24)};
  var input=new TextBox{Text="Before",Height=35};AutomationProperties.SetName(input,"Fixture message");
  var secret=new PasswordBox{Password="fixture-secret-must-not-leak",Height=35};AutomationProperties.SetName(secret,"Password");
  var output=new TextBlock{Text="Not submitted"};var button=new Button{Content="Submit local fixture",Height=35};
  button.Click+=(_,_)=>output.Text="Submitted: "+input.Text;
  panel.Children.Add(input);panel.Children.Add(secret);
  foreach(var label in new[]{"PIN","OTP","Bank account","Routing number","IBAN","SSN"}) {
   var sensitive=new TextBox{Text="fixture-"+label+"-must-not-leak",Height=35};AutomationProperties.SetName(sensitive,label);AutomationProperties.SetAutomationId(sensitive,label+"-fixture-ID-must-not-leak");panel.Children.Add(sensitive);
  }
  var helpOnly=new TextBox{Text="fixture-help-only-must-not-leak",Height=35};AutomationProperties.SetHelpText(helpOnly,"Verification code");panel.Children.Add(helpOnly);
  var nested=new TextBox{Text="fixture-nested-must-not-leak",Height=35};AutomationProperties.SetName(nested,"Nested ordinary fixture");
  var protectedGroup=new GroupBox{Header="Credentials",Content=nested};AutomationProperties.SetName(protectedGroup,"Credentials");panel.Children.Add(protectedGroup);
  panel.Children.Add(button);panel.Children.Add(output);
  var window=new Window{Title="JARVIS inert Windows control fixture",Content=panel,Width=480,Height=650};app.Run(window);
 }
}
