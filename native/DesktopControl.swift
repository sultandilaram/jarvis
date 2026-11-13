import Cocoa
import ApplicationServices
func attr(_ e: AXUIElement,_ key: String)->CFTypeRef? { var v:CFTypeRef?; guard AXUIElementCopyAttributeValue(e,key as CFString,&v) == .success else{return nil};return v }
func string(_ e:AXUIElement,_ key:String)->String { return attr(e,key) as? String ?? "" }
func children(_ e:AXUIElement)->[AXUIElement] {return attr(e,kAXChildrenAttribute) as? [AXUIElement] ?? []}
func window(_ pid:pid_t)throws->AXUIElement {let app=AXUIElementCreateApplication(pid);guard let w=attr(app,kAXFocusedWindowAttribute) else{throw NSError(domain:"No focused window",code:1)};return (w as! AXUIElement)}
let browserBundles:Set<String> = ["company.thebrowser.Browser","com.apple.Safari","com.google.Chrome","com.brave.Browser","com.microsoft.edgemac","org.mozilla.firefox"]
func fieldIsSensitive(_ role:String,_ subrole:String,_ label:String,_ identifier:String="",_ help:String="",_ placeholder:String="")->Bool {
 if subrole.lowercased().contains("secure"){return true}
 guard ["AXTextField","AXTextArea","AXComboBox","AXSecureTextField"].contains(role) else{return false}
 let context=[label,identifier,help,placeholder].joined(separator:" ")
 return context.range(of:"password|passcode|secret|token|api.?key|private.?key|cvv|cvc|credit.?card|card.?number|one.?time|otp|verification.?code|security.?code|bank.?account|routing.?number|iban|social.?security|ssn|seed.?phrase|recovery.?code|(?:^|[^a-z])pin(?:$|[^a-z])",options:[.regularExpression,.caseInsensitive]) != nil
}
func browserPageAllowed(_ value:String)->Bool {guard let u=URL(string:value),["http","https","file"].contains(u.scheme ?? ""),u.user==nil,u.password==nil else{return false};return true}
func elementSensitive(_ e:AXUIElement)->Bool {fieldIsSensitive(string(e,kAXRoleAttribute),string(e,kAXSubroleAttribute),string(e,kAXTitleAttribute)+" "+string(e,kAXDescriptionAttribute),string(e,"AXIdentifier"),string(e,kAXHelpAttribute),string(e,"AXPlaceholderValue"))}
func boundedValue(_ value:String,_ secure:Bool)->(String,Bool) {if secure{return ("[redacted]",false)};return (String(value.prefix(1000)),value.count>1000)}
func valueString(_ e:AXUIElement)->String {let v=attr(e,kAXValueAttribute);if let s=v as? String{return s};if let n=v as? NSNumber{return n.stringValue};return ""}
func pageRoot(_ root:AXUIElement)->(AXUIElement,[Int])? {
 var queue:[(AXUIElement,[Int])]=[(root,[])],index=0;let deadline=Date().addingTimeInterval(0.4)
 while index<queue.count && index<400 && Date()<deadline {let(e,path)=queue[index];index+=1;if string(e,kAXRoleAttribute)=="AXWebArea" {return (e,path)};if path.count<12 {queue += children(e).enumerated().map{($0.element,path+[$0.offset])}}};return nil
}
func pageURL(_ root:AXUIElement)->String {
 guard let(e,_)=pageRoot(root) else{return ""};if let u=attr(e,"AXURL") as? URL{return u.absoluteString};if let u=attr(e,"AXURL") as? String{return u};return ""
}
func prepareBrowserAccessibility(_ application:AXUIElement,_ w:AXUIElement){
 _ = AXUIElementSetAttributeValue(application,"AXManualAccessibility" as CFString,kCFBooleanTrue)
 _ = AXUIElementSetAttributeValue(application,"AXEnhancedUserInterface" as CFString,kCFBooleanTrue)
 _ = AXUIElementSetAttributeValue(w,"AXEnhancedUserInterface" as CFString,kCFBooleanTrue)
 let deadline=Date().addingTimeInterval(1.5)
 while Date()<deadline {if !pageURL(w).isEmpty{return};RunLoop.current.run(until:Date().addingTimeInterval(0.1))}
}
func output(_ value:Any){if let d=try? JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]){FileHandle.standardOutput.write(d)}}
func run(_ a:[String:Any])throws->[String:Any]{
 let action=a["action"] as? String ?? ""
 #if JARVIS_TESTING
 if action == "test.snapshotValue" {let(value,truncated)=boundedValue(a["value"] as? String ?? "",a["secure"] as? Bool ?? false);return ["value":value,"truncated":truncated]}
 if action == "test.browserPagePolicy" {return ["allowed":browserPageAllowed(a["url"] as? String ?? "")]}
 if action == "test.fieldPolicy" {return ["sensitive":fieldIsSensitive(a["role"] as? String ?? "",a["subrole"] as? String ?? "",a["label"] as? String ?? "",a["identifier"] as? String ?? "",a["help"] as? String ?? "",a["placeholder"] as? String ?? "")]}
 #endif
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
 if action == "browser.open_external" {
  let browsers=browserBundles
  guard let bundle=a["bundleId"] as? String,browsers.contains(bundle),let appURL=NSWorkspace.shared.urlForApplication(withBundleIdentifier:bundle),let raw=a["url"] as? String,raw.count<=8192,let target=URL(string:raw),target.user==nil,target.password==nil else{throw NSError(domain:"Choose an installed supported browser and an explicit URL",code:1)}
  if target.isFileURL {
   guard target.host==nil || target.host=="" || target.host=="localhost",["html","htm"].contains(target.pathExtension.lowercased()) else{throw NSError(domain:"Only local HTML files can open in an external browser",code:1)}
  }else{guard ["http","https"].contains(target.scheme ?? ""),target.host != nil else{throw NSError(domain:"Only HTTP(S) URLs or approved local HTML files are supported",code:1)}}
  let config=NSWorkspace.OpenConfiguration();config.activates=true
  var result:[String:Any]?;var failure:Error?;let lock=NSLock();let finished=DispatchSemaphore(value:0)
  NSWorkspace.shared.open([target],withApplicationAt:appURL,configuration:config){app,error in
   lock.lock();failure=error;if let app=app{result=["bundleId":bundle,"pid":app.processIdentifier,"url":target.absoluteString,"launchAccepted":true,"verified":false,"note":"macOS accepted the browser open request. Observe the browser to verify the page; this does not provide DOM control."]};lock.unlock();finished.signal()
  }
  guard finished.wait(timeout:.now()+15) == .success else{throw NSError(domain:"Browser open outcome uncertain; inspect before retrying",code:1)}
  lock.lock();let error=failure;let opened=result;lock.unlock()
  if let e=error{throw e};guard let r=opened else{throw NSError(domain:"Browser open outcome uncertain; inspect before retrying",code:1)};return r
 }
 guard AXIsProcessTrusted() else{throw NSError(domain:"Accessibility permission is required for JARVIS. Open System Settings > Privacy & Security > Accessibility and enable JARVIS, then try again.",code:1)}
 let app: NSRunningApplication?
 if let bundle=a["bundleId"] as? String{app=NSRunningApplication.runningApplications(withBundleIdentifier:bundle).first}else{app=NSWorkspace.shared.frontmostApplication}
 guard let app=app else{throw NSError(domain:"Target app is not running",code:1)}
 var w=try window(app.processIdentifier)
 let isBrowser=browserBundles.contains(app.bundleIdentifier ?? "")
 if action == "desktop.observe" && isBrowser {prepareBrowserAccessibility(AXUIElementCreateApplication(app.processIdentifier),w);w=try window(app.processIdentifier)}
 let title=string(w,kAXTitleAttribute)
 if action == "desktop.observe" {
  var nodes:[[String:Any]]=[];var truncated=false;let limit=isBrowser ? 500 : 200;let depthLimit=isBrowser ? 20 : 8
  func visit(_ e:AXUIElement,_ path:[Int],_ depth:Int){if nodes.count>=limit||depth>depthLimit{truncated=true;return};let role=string(e,kAXRoleAttribute);let sub=string(e,kAXSubroleAttribute);let secure=elementSensitive(e);let(value,valueTruncated)=boundedValue(valueString(e),secure);if valueTruncated {truncated=true};var actions:CFArray?;AXUIElementCopyActionNames(e,&actions)
   nodes.append(["id":path.map(String.init).joined(separator:"."),"role":role,"subrole":sub,"label":string(e,kAXTitleAttribute).isEmpty ? string(e,kAXDescriptionAttribute) : string(e,kAXTitleAttribute),"value":value,"secure":secure,"actions":actions as? [String] ?? []]);if !secure {for(i,c) in children(e).enumerated(){visit(c,path+[i],depth+1)}}
  };let document=isBrowser ? pageURL(w) : "";let available = !isBrowser || browserPageAllowed(document)
  if isBrowser {if available,let(root,path)=pageRoot(w){visit(root,path,0)}}else{visit(w,[],0)}
  return ["bundleId":app.bundleIdentifier ?? "","pid":app.processIdentifier,"window":title,"elements":nodes,"documentURL":available ? document : "","windowIdentifier":string(w,"AXIdentifier"),"truncated":truncated,"pageContentAvailable":available]

 }
 if isBrowser {
  guard let expected=a["documentURL"] as? String,browserPageAllowed(expected),expected==pageURL(w),let identity=a["windowIdentifier"] as? String,identity==string(w,"AXIdentifier") else{throw NSError(domain:"Browser page or window changed; inspect it again",code:1)}
 }
 guard let path=a["elementId"] as? String else{throw NSError(domain:"Element id required",code:1)}
 guard title == a["window"] as? String,app.processIdentifier == a["pid"] as? Int32 else{throw NSError(domain:"Target window changed; observe again",code:1)}
 var target=w
 for part in path.split(separator:"."){guard let i=Int(part),i>=0,i<children(target).count else{throw NSError(domain:"Element changed",code:1)};target=children(target)[i]}
 let role=string(target,kAXRoleAttribute),sub=string(target,kAXSubroleAttribute),label=string(target,kAXTitleAttribute).isEmpty ? string(target,kAXDescriptionAttribute) : string(target,kAXTitleAttribute)
 guard role == a["role"] as? String,label == a["label"] as? String,sub == a["subrole"] as? String,valueString(target) == a["value"] as? String,!elementSensitive(target) else{throw NSError(domain:"Element changed or is secure; observe again",code:1)}
 app.activate(options:[])
 if action == "desktop.press" {guard AXUIElementPerformAction(target,kAXPressAction as CFString) == .success else{throw NSError(domain:"App rejected press",code:1)};return ["dispatched":true,"verified":false,"note":"Observe the app to verify the effect."]}
 if action == "desktop.type",let text=a["text"] as? String,[kAXTextFieldRole,kAXTextAreaRole].contains(role){guard AXUIElementSetAttributeValue(target,kAXValueAttribute as CFString,text as CFString) == .success else{throw NSError(domain:"App rejected text change",code:1)};return ["verified":valueString(target)==text,"value":valueString(target)]}
 throw NSError(domain:"Unsupported desktop operation",code:1)
}
do {let data=FileHandle.standardInput.readDataToEndOfFile();let args=try JSONSerialization.jsonObject(with:data) as? [String:Any] ?? [:];output(try run(args))}catch{output(["error":error.localizedDescription,"detail":String(describing:error),"verified":false]);exit(1)}
