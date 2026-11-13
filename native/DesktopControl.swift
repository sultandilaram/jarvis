import Cocoa
import ApplicationServices
import ScreenCaptureKit
import CryptoKit
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
// Pointer input is derived from an observed accessible button/link, never caller coordinates.
func validFrame(_ f:[String:Double])->Bool {
 guard let x=f["x"],let y=f["y"],let w=f["width"],let h=f["height"] else{return false}
 return [x,y,w,h].allSatisfy{$0.isFinite} && abs(x)<=100000 && abs(y)<=100000 && w>0 && h>0 && w<=10000 && h<=10000
}
func elementFrame(_ e:AXUIElement)->[String:Double] {
 guard let position=attr(e,kAXPositionAttribute),CFGetTypeID(position)==AXValueGetTypeID(),let size=attr(e,kAXSizeAttribute),CFGetTypeID(size)==AXValueGetTypeID() else{return [:]}
 var point=CGPoint.zero,extent=CGSize.zero
 guard AXValueGetValue(position as! AXValue,.cgPoint,&point),AXValueGetValue(size as! AXValue,.cgSize,&extent) else{return [:]}
 return ["x":Double(point.x),"y":Double(point.y),"width":Double(extent.width),"height":Double(extent.height)]
}
func frameCenter(_ f:[String:Double])->CGPoint {CGPoint(x:f["x"]!+f["width"]!/2,y:f["y"]!+f["height"]!/2)}
func centerOnDisplay(_ frame:[String:Double])->Bool {
 guard validFrame(frame) else{return false};var display=CGDirectDisplayID(),count:UInt32=0
 return CGGetDisplaysWithPoint(frameCenter(frame),1,&display,&count) == .success && count==1
}
func pressMethod(_ role:String,_ secure:Bool,_ pointerAllowed:Bool,_ actions:[String],_ enabled:Bool?,_ frameValid:Bool)->String {
 if secure || enabled == false{return "none"}
 if actions.contains("AXPress"){return "accessibility"}
 if pointerAllowed && enabled == true && ["AXButton","AXLink"].contains(role) && frameValid{return "pointer"}
 return "none"
}
func actionNames(_ e:AXUIElement)->[String] {var names:CFArray?;AXUIElementCopyActionNames(e,&names);return names as? [String] ?? []}
func safeHitDescendant(_ role:String,_ actions:[String])->Bool {
 ["AXStaticText","AXImage","AXGroup","AXHeading"].contains(role) && !actions.contains("AXPress")
}
func hitIsTarget(_ hit:AXUIElement,_ target:AXUIElement,_ pid:pid_t)->Bool {
 var node=hit
 for _ in 0..<12 {
  var owner:pid_t=0;guard AXUIElementGetPid(node,&owner) == .success,owner==pid else{return false}
  if CFEqual(node,target){return true}
  guard safeHitDescendant(string(node,kAXRoleAttribute),actionNames(node)),let parent=attr(node,kAXParentAttribute),CFGetTypeID(parent)==AXUIElementGetTypeID() else{return false}
  node=parent as! AXUIElement
 }
 return false
}
func sameControlSnapshot(_ expected:[String:Any],_ actual:[String:Any],_ isBrowser:Bool,_ requireIdentity:Bool)->Bool {
 guard expected["pageContentAvailable"] as? Bool == true,actual["pageContentAvailable"] as? Bool == true,expected["truncated"] as? Bool == false,actual["truncated"] as? Bool == false else{return false}
 if isBrowser || expected["windowKind"] as? String == "web" {guard let url=expected["documentURL"] as? String,browserPageAllowed(url) else{return false}}
 if requireIdentity {guard let identity=expected["windowIdentifier"] as? String,!identity.isEmpty else{return false}}
 guard let before=try? JSONSerialization.data(withJSONObject:expected,options:[.sortedKeys]),let after=try? JSONSerialization.data(withJSONObject:actual,options:[.sortedKeys]) else{return false}
 return before==after
}
func sameBrowserSnapshot(_ expected:[String:Any],_ actual:[String:Any])->Bool {sameControlSnapshot(expected,actual,true,true)}
func verifyFocusedContext(_ app:NSRunningApplication,_ w:AXUIElement,_ a:[String:Any],_ isBrowser:Bool,_ requireIdentity:Bool)throws {
 _ = AXUIElementPerformAction(w,kAXRaiseAction as CFString)
 let until=ProcessInfo.processInfo.systemUptime+1
 func focused()->Bool {guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier,let current=try? window(app.processIdentifier) else{return false};return CFEqual(current,w)}
 while !focused() && ProcessInfo.processInfo.systemUptime<until {RunLoop.current.run(until:Date().addingTimeInterval(0.03))}
 guard focused(),let expected=a["contextSnapshot"] as? [String:Any],sameControlSnapshot(expected,nativeSnapshot(app,w,isBrowser),isBrowser,requireIdentity) else{throw NSError(domain:"Complete window context changed after focus; no input sent",code:1)}
}
func nativeSnapshot(_ app:NSRunningApplication,_ w:AXUIElement,_ browserHint:Bool)->[String:Any] {
 let isBrowser=browserHint || pageRoot(w) != nil
 let title=string(w,kAXTitleAttribute)
  var nodes:[[String:Any]]=[];var truncated=false;let limit=500;let depthLimit=20;let deadline=ProcessInfo.processInfo.systemUptime+2
  func visit(_ e:AXUIElement,_ path:[Int],_ depth:Int){if nodes.count>=limit||depth>depthLimit||ProcessInfo.processInfo.systemUptime>=deadline{truncated=true;return};let role=string(e,kAXRoleAttribute);let sub=string(e,kAXSubroleAttribute);let secure=elementSensitive(e);let(value,valueTruncated)=boundedValue(valueString(e),secure);if valueTruncated {truncated=true};let actions=actionNames(e);let frame = !secure && ["AXButton","AXLink"].contains(role) && !actions.contains("AXPress") ? elementFrame(e) : [:];let method=pressMethod(role,secure,!string(w,"AXIdentifier").isEmpty,actions,attr(e,kAXEnabledAttribute) as? Bool,centerOnDisplay(frame))
   nodes.append(["id":path.map(String.init).joined(separator:"."),"role":role,"subrole":sub,"label":string(e,kAXTitleAttribute).isEmpty ? string(e,kAXDescriptionAttribute) : string(e,kAXTitleAttribute),"value":value,"secure":secure,"actions":actions,"pressMethod":method,"frame":method=="pointer" ? frame : [:]]);if !secure {for(i,c) in children(e).enumerated(){visit(c,path+[i],depth+1)}}
  };let document=isBrowser ? pageURL(w) : "";let available = !isBrowser || browserPageAllowed(document)
  if isBrowser {if available,let(root,path)=pageRoot(w){visit(root,path,0)}}else{visit(w,[],0)}
  return ["bundleId":app.bundleIdentifier ?? "","pid":app.processIdentifier,"window":title,"windowKind":isBrowser ? "web" : "native","elements":nodes,"documentURL":available ? document : "","windowIdentifier":string(w,"AXIdentifier"),"truncated":truncated,"pageContentAvailable":available]
}
// Event posting is asynchronous. Keep this short-lived sender alive after posting;
// neither a successful preflight nor queueing an event proves that the page acted.
func postClickOnce(_ permitted:()->Bool,_ down:()->Void,_ up:()->Void,_ drain:()->Void)throws {
 guard permitted() else{throw NSError(domain:"macOS event-posting access is unavailable for JARVIS; no click sent. Check JARVIS in System Settings > Privacy & Security > Device Control and Data Access (Accessibility).",code:1)}
 down();up();drain()
}
func drainPostedClick(){
 let end=ProcessInfo.processInfo.systemUptime+0.5
 while ProcessInfo.processInfo.systemUptime<end {RunLoop.current.run(until:Date().addingTimeInterval(0.01))}
}
func dispatchPointerPress(_ target:AXUIElement,_ w:AXUIElement,_ app:NSRunningApplication,_ a:[String:Any],_ isBrowser:Bool)throws->[String:Any] {
 guard let expected=a["frame"] as? [String:Double],validFrame(expected),elementFrame(target)==expected,centerOnDisplay(expected) else{throw NSError(domain:"Control bounds changed or are off screen; inspect again",code:1)}
 try verifyFocusedContext(app,w,a,isBrowser,true)
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier,CFEqual(try window(app.processIdentifier),w),string(w,kAXTitleAttribute)==a["window"] as? String,string(w,"AXIdentifier")==a["windowIdentifier"] as? String,(!isBrowser || pageURL(w)==a["documentURL"] as? String),elementFrame(target)==expected,!elementSensitive(target),valueString(target)==a["value"] as? String,string(target,kAXRoleAttribute)==a["role"] as? String,string(target,kAXSubroleAttribute)==a["subrole"] as? String,(string(target,kAXTitleAttribute).isEmpty ? string(target,kAXDescriptionAttribute):string(target,kAXTitleAttribute))==a["label"] as? String,(attr(target,kAXEnabledAttribute) as? Bool)==true else{throw NSError(domain:"Control or focused window changed before click; inspect again",code:1)}
 guard let context=a["contextSnapshot"] as? [String:Any],sameControlSnapshot(context,nativeSnapshot(app,w,isBrowser),isBrowser,true) else{throw NSError(domain:"Window context changed after focus; no click sent",code:1)}
 let center=frameCenter(expected);var hit:AXUIElement?
 guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),Float(center.x),Float(center.y),&hit) == .success,let hit=hit,hitIsTarget(hit,target,app.processIdentifier) else{throw NSError(domain:"Control is covered or hit test changed; no click sent",code:1)}
 guard let down=CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:center,mouseButton:.left),let up=CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:center,mouseButton:.left) else{throw NSError(domain:"Cannot create click events; no click sent",code:1)}
 guard !CGEventSource.buttonState(.combinedSessionState,button:.left),!CGEventSource.buttonState(.combinedSessionState,button:.right),!CGEventSource.buttonState(.combinedSessionState,button:.center),CGEventSource.flagsState(.combinedSessionState).intersection([.maskShift,.maskControl,.maskAlternate,.maskCommand]).isEmpty else{throw NSError(domain:"Mouse or modifier keys are in use; no click sent",code:1)}
 down.flags=[];up.flags=[];down.setIntegerValueField(.mouseEventClickState,value:1);up.setIntegerValueField(.mouseEventClickState,value:1)
 try postClickOnce({CGPreflightPostEventAccess()},{down.post(tap:.cghidEventTap)},{up.post(tap:.cghidEventTap)},drainPostedClick)
 return ["dispatched":true,"verified":false,"inputMethod":"pointer","note":"One click queued for the revalidated, hit-tested accessible control; sender stayed alive briefly. Event-posting permission and queueing do not prove delivery. Observe the page to verify its effect; do not replay an uncertain submission."]
}
func settledValue(_ read:()->String,_ expected:String,_ timeout:TimeInterval=1.5)->String {
 let end=ProcessInfo.processInfo.systemUptime+timeout;var value=read()
 while value != expected && ProcessInfo.processInfo.systemUptime<end {RunLoop.current.run(until:Date().addingTimeInterval(0.03));value=read()}
 return value
}
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
final class VisualResult<T>: @unchecked Sendable {
 private let lock=NSLock();private var stored:Result<T,Error>?
 func set(_ value:Result<T,Error>){lock.lock();stored=value;lock.unlock()}
 func get()->Result<T,Error>? {lock.lock();defer{lock.unlock()};return stored}
}
func waitVisual<T>(_ result:VisualResult<T>,_ seconds:Double)throws->T {
 let end=ProcessInfo.processInfo.systemUptime+seconds
 while ProcessInfo.processInfo.systemUptime<end {if let value=result.get(){return try value.get()};RunLoop.current.run(until:Date().addingTimeInterval(0.01))}
 throw NSError(domain:"Window capture timed out; no input sent",code:1)
}
func visualPointAllowed(_ f:[String:Double],_ width:Double,_ height:Double,_ x:Double,_ y:Double)->Bool {
 validFrame(f) && [width,height,x,y].allSatisfy{$0.isFinite} && width>=1 && height>=1 && width<=3000 && height<=2000 && width*height<=4000000 && x>=0 && y>=0 && x<width && y<height
}
func completeVisualContext(_ snapshot:[String:Any])->Bool {
 guard snapshot["pageContentAvailable"] as? Bool == true,snapshot["truncated"] as? Bool == false,let nodes=snapshot["elements"] as? [[String:Any]],!nodes.isEmpty else{return false}
 return !nodes.contains{$0["secure"] as? Bool == true}
}
@available(macOS 14.0, *)
func captureScene(_ app:NSRunningApplication,_ w:AXUIElement)throws->[String:Any] {
 guard CGPreflightScreenCaptureAccess() else{throw NSError(domain:"JARVIS needs macOS Screen Recording access to capture this window. Grant it directly in System Settings; no permission was requested automatically.",code:1)}
 let frame=elementFrame(w)
 guard validFrame(frame),let fw=frame["width"],let fh=frame["height"],fw<=3000,fh<=2000,fw*fh<=4000000 else{throw NSError(domain:"Window is too large or its bounds are unavailable; no capture made",code:1)}
 let content=VisualResult<SCShareableContent>()
 SCShareableContent.getExcludingDesktopWindows(true,onScreenWindowsOnly:true){value,error in if let value=value{content.set(.success(value))}else{content.set(.failure(error ?? NSError(domain:"Cannot enumerate the requested window",code:1)))}}
 let windows=try waitVisual(content,4).windows.filter{candidate in
  guard candidate.owningApplication?.processID==app.processIdentifier,candidate.windowLayer==0 else{return false}
  let f=candidate.frame
  return abs(f.origin.x-frame["x"]!)<0.5 && abs(f.origin.y-frame["y"]!)<0.5 && abs(f.width-fw)<0.5 && abs(f.height-fh)<0.5 && (string(w,kAXTitleAttribute).isEmpty || (candidate.title ?? "").isEmpty || candidate.title==string(w,kAXTitleAttribute))
 }
 guard windows.count==1,let target=windows.first else{throw NSError(domain:"Cannot identify exactly one matching app window; no capture made",code:1)}
 let config=SCStreamConfiguration();config.width=Int(ceil(fw));config.height=Int(ceil(fh));config.showsCursor=false;config.capturesAudio=false;config.ignoreShadowsSingleWindow=true
 let image=VisualResult<CGImage>()
 SCScreenshotManager.captureImage(contentFilter:SCContentFilter(desktopIndependentWindow:target),configuration:config){value,error in if let value=value{image.set(.success(value))}else{image.set(.failure(error ?? NSError(domain:"Cannot capture the requested window",code:1)))}}
 let captured=try waitVisual(image,3)
 guard captured.width==config.width,captured.height==config.height else{throw NSError(domain:"Window image dimensions changed; no image returned",code:1)}
 var encoded:Data?;let bitmap=NSBitmapImageRep(cgImage:captured)
 for quality in [0.75,0.55,0.35] {if let data=bitmap.representation(using:.jpeg,properties:[.compressionFactor:quality]),data.count<=240000 {encoded=data;break}}
 guard let data=encoded else{throw NSError(domain:"Window image exceeded its safe size; no image returned",code:1)}
 return ["frame":frame,"width":captured.width,"height":captured.height,"windowId":Int(target.windowID),"sceneHash":SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined(),"imageUrl":"data:image/jpeg;base64,"+data.base64EncodedString()]
}
func visualCapture(_ app:NSRunningApplication,_ w:AXUIElement,_ isBrowser:Bool)throws->[String:Any] {
 guard #available(macOS 14.0, *) else{throw NSError(domain:"Visual window control requires macOS 14 or later",code:1)}
 app.activate(options:[]);_ = AXUIElementPerformAction(w,kAXRaiseAction as CFString)
 let until=ProcessInfo.processInfo.systemUptime+1
 while NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier && ProcessInfo.processInfo.systemUptime<until {RunLoop.current.run(until:Date().addingTimeInterval(0.03))}
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier,CFEqual(try window(app.processIdentifier),w) else{throw NSError(domain:"The requested window did not become focused; no capture made",code:1)}
 let before=nativeSnapshot(app,w,isBrowser)
 guard completeVisualContext(before) else{throw NSError(domain:"This window is incomplete or contains recognized sensitive inputs; use direct interaction",code:1)}
 var scene=try captureScene(app,w)
 let after=nativeSnapshot(app,w,isBrowser)
 guard sameControlSnapshot(before,after,isBrowser,false),completeVisualContext(after),CFEqual(try window(app.processIdentifier),w) else{throw NSError(domain:"Window changed during capture; no image returned",code:1)}
 scene["contextSnapshot"]=after;return scene
}
func dispatchVisualClick(_ app:NSRunningApplication,_ w:AXUIElement,_ a:[String:Any],_ isBrowser:Bool)throws->[String:Any] {
 guard #available(macOS 14.0, *) else{throw NSError(domain:"Visual window control requires macOS 14 or later",code:1)}
 guard let frame=a["frame"] as? [String:Double],let width=a["width"] as? Double,let height=a["height"] as? Double,let x=a["x"] as? Double,let y=a["y"] as? Double,visualPointAllowed(frame,width,height,x,y),elementFrame(w)==frame else{throw NSError(domain:"Invalid or changed visual target; no click sent",code:1)}
 try verifyFocusedContext(app,w,a,isBrowser,false)
 let scene=try captureScene(app,w)
 guard scene["sceneHash"] as? String==a["sceneHash"] as? String,scene["windowId"] as? Int==a["windowId"] as? Int,scene["width"] as? Int==Int(width),scene["height"] as? Int==Int(height),let context=a["contextSnapshot"] as? [String:Any],completeVisualContext(context),sameControlSnapshot(context,nativeSnapshot(app,w,isBrowser),isBrowser,false),NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier,CFEqual(try window(app.processIdentifier),w),elementFrame(w)==frame else{throw NSError(domain:"Approved image or window context changed; no click sent. Capture and review a fresh action.",code:1)}
 let point=CGPoint(x:frame["x"]!+x/width*frame["width"]!,y:frame["y"]!+y/height*frame["height"]!);var display=CGDirectDisplayID(),count:UInt32=0;var hit:AXUIElement?
 guard CGGetDisplaysWithPoint(point,1,&display,&count) == .success,count==1,AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),Float(point.x),Float(point.y),&hit) == .success,var node=hit else{throw NSError(domain:"Visual point is not available on screen; no click sent",code:1)}
 var matched=false
 for _ in 0..<24 {var pid:pid_t=0;guard AXUIElementGetPid(node,&pid) == .success,pid==app.processIdentifier,!elementSensitive(node) else{throw NSError(domain:"Visual point is covered or sensitive; no click sent",code:1)};if CFEqual(node,w){matched=true;break};guard let parent=attr(node,kAXParentAttribute),CFGetTypeID(parent)==AXUIElementGetTypeID() else{break};node=parent as! AXUIElement}
 guard matched,!CGEventSource.buttonState(.combinedSessionState,button:.left),!CGEventSource.buttonState(.combinedSessionState,button:.right),!CGEventSource.buttonState(.combinedSessionState,button:.center),CGEventSource.flagsState(.combinedSessionState).intersection([.maskShift,.maskControl,.maskAlternate,.maskCommand]).isEmpty,let down=CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:point,mouseButton:.left),let up=CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:point,mouseButton:.left) else{throw NSError(domain:"Visual point or active input changed; no click sent",code:1)}
 down.flags=[];up.flags=[];down.setIntegerValueField(.mouseEventClickState,value:1);up.setIntegerValueField(.mouseEventClickState,value:1)
 try postClickOnce({CGPreflightPostEventAccess()},{down.post(tap:.cghidEventTap)},{up.post(tap:.cghidEventTap)},drainPostedClick)
 return ["dispatched":true,"verified":false,"inputMethod":"visual-pointer","note":"One click queued for the exact reviewed window image. Capture/observe to verify the effect. Do not replay an uncertain action."]
}
func run(_ a:[String:Any])throws->[String:Any]{
 let action=a["action"] as? String ?? ""
 #if JARVIS_TESTING
 if action == "test.visualPolicy" {return ["allowed":visualPointAllowed(a["frame"] as? [String:Double] ?? [:],a["width"] as? Double ?? 0,a["height"] as? Double ?? 0,a["x"] as? Double ?? -1,a["y"] as? Double ?? -1)]}
 if action == "test.visualContext" {return ["allowed":completeVisualContext(a["snapshot"] as? [String:Any] ?? [:])]}
 if action == "test.pointerDispatch" {var sequence:[String]=[];do{try postClickOnce({sequence.append("preflight");return a["allowed"] as? Bool ?? false},{sequence.append("down")},{sequence.append("up")},{sequence.append("drain")});return ["sequence":sequence,"blocked":false]}catch{return ["sequence":sequence,"blocked":true]}}
 if action == "test.controlContextPolicy" {return ["allowed":sameControlSnapshot(a["expected"] as? [String:Any] ?? [:],a["actual"] as? [String:Any] ?? [:],a["browser"] as? Bool ?? false,a["pointer"] as? Bool ?? false)]}
 if action == "test.hitPolicy" {return ["allowed":safeHitDescendant(a["role"] as? String ?? "",a["actions"] as? [String] ?? [])]}
 if action == "test.contextPolicy" {return ["allowed":sameBrowserSnapshot(a["expected"] as? [String:Any] ?? [:],a["actual"] as? [String:Any] ?? [:])]}
 if action == "test.readback" {let values=a["values"] as? [String] ?? [""];var reads=0;let value=settledValue({let i=min(reads,max(0,values.count-1));reads+=1;return values.isEmpty ? "" : values[i]},a["expected"] as? String ?? "",a["timeout"] as? Double ?? 0.15);return ["value":value,"reads":reads]}
 if action == "test.pressPolicy" {return ["method":pressMethod(a["role"] as? String ?? "",a["secure"] as? Bool ?? false,a["pointerAllowed"] as? Bool ?? a["browser"] as? Bool ?? false,a["actions"] as? [String] ?? [],a["enabled"] as? Bool,validFrame(a["frame"] as? [String:Double] ?? [:]))]}
 if action == "test.snapshotValue" {let(value,truncated)=boundedValue(a["value"] as? String ?? "",a["secure"] as? Bool ?? false);return ["value":value,"truncated":truncated]}
 if action == "test.browserPagePolicy" {return ["allowed":browserPageAllowed(a["url"] as? String ?? "")]}
 if action == "test.fieldPolicy" {return ["sensitive":fieldIsSensitive(a["role"] as? String ?? "",a["subrole"] as? String ?? "",a["label"] as? String ?? "",a["identifier"] as? String ?? "",a["help"] as? String ?? "",a["placeholder"] as? String ?? "")]}
 #endif
 if action == "permissions" {return ["accessibility":AXIsProcessTrusted(),"eventPosting":CGPreflightPostEventAccess(),"screenCapture":CGPreflightScreenCaptureAccess(),"note":"JARVIS needs Accessibility to inspect apps and event-posting access for pointer clicks. Check System Settings > Privacy & Security > Device Control and Data Access (Accessibility). No access is requested automatically."]}
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
 let isBrowser=browserBundles.contains(app.bundleIdentifier ?? "") || pageRoot(w) != nil
 if ["desktop.observe","desktop.capture"].contains(action) && (isBrowser || ["net.whatsapp.WhatsApp","com.tinyspeck.slackmacgap","com.microsoft.teams2","com.hnc.Discord"].contains(app.bundleIdentifier ?? "")) {prepareBrowserAccessibility(AXUIElementCreateApplication(app.processIdentifier),w);w=try window(app.processIdentifier)}
 let title=string(w,kAXTitleAttribute)
 if action == "desktop.capture" {return try visualCapture(app,w,isBrowser)}
 if action == "desktop.click_image" {return try dispatchVisualClick(app,w,a,isBrowser)}
 if action == "desktop.observe" {
  return nativeSnapshot(app,w,isBrowser)

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
 if action == "desktop.scroll_to" {
  try verifyFocusedContext(app,w,a,isBrowser,isBrowser)
  guard actionNames(target).contains("AXScrollToVisible"),AXUIElementPerformAction(target,"AXScrollToVisible" as CFString) == .success else{throw NSError(domain:"App refused scroll-to-visible; inspect again",code:1)}
  return ["dispatched":true,"verified":false,"inputMethod":"accessibility-scroll","note":"Scroll-to-visible requested once. Observe to verify visibility before further input."]
 }
 if action == "desktop.press" {
  let method=pressMethod(role,elementSensitive(target),!string(w,"AXIdentifier").isEmpty,actionNames(target),attr(target,kAXEnabledAttribute) as? Bool,centerOnDisplay(elementFrame(target)))
  guard method==a["pressMethod"] as? String else{throw NSError(domain:"Press capability changed; inspect again",code:1)}
  if method=="pointer" {return try dispatchPointerPress(target,w,app,a,isBrowser)}
  try verifyFocusedContext(app,w,a,isBrowser,isBrowser)
  guard method=="accessibility",AXUIElementPerformAction(target,kAXPressAction as CFString) == .success else{throw NSError(domain:"App rejected press; inspect before retrying",code:1)}
  return ["dispatched":true,"verified":false,"inputMethod":"accessibility","note":"Observe the app to verify the effect; do not replay an uncertain submission."]
 }
 if action == "desktop.type",let text=a["text"] as? String,[kAXTextFieldRole,kAXTextAreaRole].contains(role){try verifyFocusedContext(app,w,a,isBrowser,isBrowser);guard AXUIElementSetAttributeValue(target,kAXValueAttribute as CFString,text as CFString) == .success else{throw NSError(domain:"App rejected text change",code:1)};let value=settledValue({valueString(target)},text);return ["dispatched":true,"verified":value==text,"value":value,"note":"Text was sent once. Re-observe the field and page input effects; do not replay an uncertain change."]}
 throw NSError(domain:"Unsupported desktop operation",code:1)
}
do {let data=FileHandle.standardInput.readDataToEndOfFile();let args=try JSONSerialization.jsonObject(with:data) as? [String:Any] ?? [:];output(try run(args))}catch{output(["error":error.localizedDescription,"detail":String(describing:error),"verified":false]);exit(1)}
