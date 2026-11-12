import Cocoa
import ApplicationServices
func attr(_ e: AXUIElement,_ key: String)->CFTypeRef? { var v:CFTypeRef?; guard AXUIElementCopyAttributeValue(e,key as CFString,&v) == .success else{return nil};return v }
func string(_ e:AXUIElement,_ key:String)->String { return attr(e,key) as? String ?? "" }
func children(_ e:AXUIElement)->[AXUIElement] {return attr(e,kAXChildrenAttribute) as? [AXUIElement] ?? []}
func window(_ pid:pid_t)throws->AXUIElement {let app=AXUIElementCreateApplication(pid);guard let w=attr(app,kAXFocusedWindowAttribute) else{throw NSError(domain:"No focused window",code:1)};return (w as! AXUIElement)}
func output(_ value:Any){if let d=try? JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]){FileHandle.standardOutput.write(d)}}
func run(_ a:[String:Any])throws->[String:Any]{
 let action=a["action"] as? String ?? ""
 if action == "permissions" {return ["accessibility":AXIsProcessTrusted(),"note":"Enable JARVIS in System Settings > Privacy & Security > Accessibility to inspect and control other apps."]}
 if action == "apps.list" {return ["apps":NSWorkspace.shared.runningApplications.filter{$0.activationPolicy == .regular}.map{["name":$0.localizedName ?? "","bundleId":$0.bundleIdentifier ?? "","pid":$0.processIdentifier] as [String:Any]}]}
 if action == "apps.open" {
  guard let bundle=a["bundleId"] as? String,let url=NSWorkspace.shared.urlForApplication(withBundleIdentifier:bundle) else{throw NSError(domain:"Application bundle identifier not found",code:1)}
  let config=NSWorkspace.OpenConfiguration();config.activates=true
  var result:[String:Any]?;var failure:Error?
  NSWorkspace.shared.openApplication(at:url,configuration:config){app,error in failure=error;if let app=app {result=["bundleId":bundle,"pid":app.processIdentifier,"running":!app.isTerminated,"verified":!app.isTerminated]}}
  let until=Date().addingTimeInterval(15);while result == nil && failure == nil && Date()<until {RunLoop.current.run(until:Date().addingTimeInterval(0.05))}
  if let e=failure{throw e};guard let r=result else{throw NSError(domain:"App launch outcome uncertain",code:1)};return r
 }
 guard AXIsProcessTrusted() else{throw NSError(domain:"Accessibility permission is required for JARVIS. Open System Settings > Privacy & Security > Accessibility and enable JARVIS, then try again.",code:1)}
 let app: NSRunningApplication?
 if let bundle=a["bundleId"] as? String{app=NSRunningApplication.runningApplications(withBundleIdentifier:bundle).first}else{app=NSWorkspace.shared.frontmostApplication}
 guard let app=app else{throw NSError(domain:"Target app is not running",code:1)}
 let w=try window(app.processIdentifier);let title=string(w,kAXTitleAttribute)
 if action == "desktop.observe" {
  var nodes:[[String:Any]]=[]
  func visit(_ e:AXUIElement,_ path:[Int],_ depth:Int){if nodes.count>=200||depth>8{return};let role=string(e,kAXRoleAttribute);let sub=string(e,kAXSubroleAttribute);let secure=sub.lowercased().contains("secure");var actions:CFArray?;AXUIElementCopyActionNames(e,&actions)
   nodes.append(["id":path.map(String.init).joined(separator:"."),"role":role,"subrole":sub,"label":string(e,kAXTitleAttribute).isEmpty ? string(e,kAXDescriptionAttribute) : string(e,kAXTitleAttribute),"value":secure ? "[redacted]" : String(string(e,kAXValueAttribute).prefix(1000)),"secure":secure,"actions":actions as? [String] ?? []]);if !secure {for(i,c) in children(e).enumerated(){visit(c,path+[i],depth+1)}}
  };visit(w,[],0);return ["bundleId":app.bundleIdentifier ?? "","pid":app.processIdentifier,"window":title,"elements":nodes]
 }
 guard let path=a["elementId"] as? String else{throw NSError(domain:"Element id required",code:1)}
 guard title == a["window"] as? String,app.processIdentifier == a["pid"] as? Int32 else{throw NSError(domain:"Target window changed; observe again",code:1)}
 var target=w
 for part in path.split(separator:"."){guard let i=Int(part),i>=0,i<children(target).count else{throw NSError(domain:"Element changed",code:1)};target=children(target)[i]}
 let role=string(target,kAXRoleAttribute),sub=string(target,kAXSubroleAttribute),label=string(target,kAXTitleAttribute).isEmpty ? string(target,kAXDescriptionAttribute) : string(target,kAXTitleAttribute)
 guard role == a["role"] as? String,label == a["label"] as? String,sub == a["subrole"] as? String,string(target,kAXValueAttribute) == a["value"] as? String,!sub.lowercased().contains("secure") else{throw NSError(domain:"Element changed or is secure; observe again",code:1)}
 app.activate(options:[])
 if action == "desktop.press" {guard AXUIElementPerformAction(target,kAXPressAction as CFString) == .success else{throw NSError(domain:"App rejected press",code:1)};return ["dispatched":true,"verified":false,"note":"Observe the app to verify the effect."]}
 if action == "desktop.type",let text=a["text"] as? String,[kAXTextFieldRole,kAXTextAreaRole].contains(role){guard AXUIElementSetAttributeValue(target,kAXValueAttribute as CFString,text as CFString) == .success else{throw NSError(domain:"App rejected text change",code:1)};return ["verified":string(target,kAXValueAttribute)==text,"value":string(target,kAXValueAttribute)]}
 throw NSError(domain:"Unsupported desktop operation",code:1)
}
do {let data=FileHandle.standardInput.readDataToEndOfFile();let args=try JSONSerialization.jsonObject(with:data) as? [String:Any] ?? [:];output(try run(args))}catch{output(["error":error.localizedDescription,"detail":String(describing:error),"verified":false]);exit(1)}
