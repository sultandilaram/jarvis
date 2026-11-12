package com.sultan.jarvis.mobile;
import android.telecom.*;import android.net.Uri;import android.os.Bundle;
public class JarvisConnectionService extends ConnectionService {
 private boolean matches(ConnectionRequest r){return CallCoordinator.live()&&r.getExtras()!=null&&CallCoordinator.id.equals(r.getExtras().getString("jarvisCallId"));}
 private Connection create(ConnectionRequest request,boolean incoming){
  if(!matches(request))return Connection.createFailedConnection(new DisconnectCause(DisconnectCause.ERROR));
  JarvisConnection c=new JarvisConnection(CallCoordinator.id);CallCoordinator.connection=c;
  c.setConnectionProperties(Connection.PROPERTY_SELF_MANAGED);c.setConnectionCapabilities(Connection.CAPABILITY_MUTE);c.setAudioModeIsVoip(true);c.setCallerDisplayName("JARVIS",TelecomManager.PRESENTATION_ALLOWED);c.setAddress(Uri.parse("jarvis:desktop"),TelecomManager.PRESENTATION_ALLOWED);
  if(incoming)c.setRinging();else{c.setDialing();CallCoordinator.ready(this);}return c;
 }
 @Override public Connection onCreateIncomingConnection(PhoneAccountHandle h,ConnectionRequest r){return create(r,true);}
 @Override public Connection onCreateOutgoingConnection(PhoneAccountHandle h,ConnectionRequest r){return create(r,false);}
 @Override public void onCreateIncomingConnectionFailed(PhoneAccountHandle h,ConnectionRequest r){if(!matches(r))return;CallCoordinator.end(this,DisconnectCause.BUSY,"Another call is using the phone");}
 @Override public void onCreateOutgoingConnectionFailed(PhoneAccountHandle h,ConnectionRequest r){if(!matches(r))return;VoiceService.emit("callError","Android could not start the call.");CallCoordinator.end(this,DisconnectCause.ERROR,"Call unavailable");}
 public class JarvisConnection extends Connection {
  final String callId;JarvisConnection(String id){callId=id;}boolean current(){return CallCoordinator.connection==this&&callId.equals(CallCoordinator.id);}
  boolean defaultRoutePending=true,defaultRouteInFlight=false;
  void useDefaultRoute(){
   if(!current()||!defaultRoutePending||defaultRouteInFlight||!CallCoordinator.phase.equals("active"))return;
   int desired=CallCoordinator.incomingCall?CallAudioState.ROUTE_EARPIECE:CallAudioState.ROUTE_SPEAKER;
   if(android.os.Build.VERSION.SDK_INT>=34){
    int type=CallCoordinator.incomingCall?CallEndpoint.TYPE_EARPIECE:CallEndpoint.TYPE_SPEAKER;
    for(CallEndpoint endpoint:endpoints)if(endpoint.getEndpointType()==type){
     defaultRouteInFlight=true;
     requestCallEndpointChange(endpoint,getMainExecutor(),new android.os.OutcomeReceiver<Void,CallEndpointException>(){
      public void onResult(Void v){if(current()){defaultRoutePending=false;defaultRouteInFlight=false;}}
      public void onError(CallEndpointException e){if(current()){defaultRoutePending=false;defaultRouteInFlight=false;VoiceService.emit("error","Default audio route unavailable. Choose Audio to select an output.");}}
     });return;
    }
   }else{
    CallAudioState audio=getCallAudioState();if(audio==null)return;
    defaultRoutePending=false;if((audio.getSupportedRouteMask()&desired)!=0)setAudioRoute(desired);
   }
  }
  java.util.List<CallEndpoint> endpoints=new java.util.ArrayList<>();
  @Override public void onAvailableCallEndpointsChanged(java.util.List<CallEndpoint> values){if(!current())return;endpoints=values;if(BuildConfig.DEBUG)android.util.Log.i("JarvisAudio", "incoming="+CallCoordinator.incomingCall+" phase="+CallCoordinator.phase+" endpoints="+values);useDefaultRoute();}
  @Override public void onCallEndpointChanged(CallEndpoint endpoint){if(!current())return;int t=endpoint.getEndpointType();CallCoordinator.route=t==CallEndpoint.TYPE_SPEAKER?CallAudioState.ROUTE_SPEAKER:t==CallEndpoint.TYPE_BLUETOOTH?CallAudioState.ROUTE_BLUETOOTH:t==CallEndpoint.TYPE_WIRED_HEADSET?CallAudioState.ROUTE_WIRED_HEADSET:CallAudioState.ROUTE_EARPIECE;CallCoordinator.changed(JarvisConnectionService.this);}
  @Override public void onMuteStateChanged(boolean value){if(!current())return;CallCoordinator.systemMuted=value;CallCoordinator.muted=value||CallCoordinator.userMuted;CallCoordinator.changed(JarvisConnectionService.this);}
  @Override public void onShowIncomingCallUi(){if(!current())return;CallCoordinator.showIncoming(JarvisConnectionService.this);}
  @Override public void onAnswer(){if(!current())return;CallCoordinator.answer(JarvisConnectionService.this);}
  @Override public void onAnswer(int videoState){onAnswer();}
  @Override public void onReject(){if(!current())return;VoiceService.emit("callDeclined",CallCoordinator.id);CallCoordinator.end(JarvisConnectionService.this,DisconnectCause.REJECTED,"Call declined");}
  @Override public void onDisconnect(){if(!current())return;CallCoordinator.end(JarvisConnectionService.this,DisconnectCause.LOCAL,"Call ended");}
  @Override public void onAbort(){onDisconnect();}
  @Override public void onCallAudioStateChanged(CallAudioState state){if(!current())return;CallCoordinator.systemMuted=state.isMuted();CallCoordinator.muted=CallCoordinator.userMuted||CallCoordinator.systemMuted;CallCoordinator.route=state.getRoute();useDefaultRoute();CallCoordinator.changed(JarvisConnectionService.this);}
 }
}
