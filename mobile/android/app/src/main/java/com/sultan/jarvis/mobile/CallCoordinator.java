package com.sultan.jarvis.mobile;

import android.app.*;
import android.content.*;
import android.media.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.telecom.*;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import org.json.JSONObject;
import java.util.UUID;

final class CallCoordinator {
 static final int NOTIFICATION = 17;
 static final String CHANNEL = "jarvis_calls_v2";
 static String id="", phase="off", nonce="";
 static long expiresAt=0, startedAt=0;
 static boolean incomingCall=false;
 static boolean muted=false,userMuted=false,systemMuted=false; static int route=CallAudioState.ROUTE_EARPIECE;
 static JarvisConnectionService.JarvisConnection connection;
 static final Handler handler=new Handler(Looper.getMainLooper());
 static PhoneAccountHandle account(Context c){return new PhoneAccountHandle(new ComponentName(c,JarvisConnectionService.class),"jarvis-desktop");}
 static void register(Context c){
  TelecomManager tm=c.getSystemService(TelecomManager.class);
  tm.registerPhoneAccount(PhoneAccount.builder(account(c),"JARVIS").setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED).addSupportedUriScheme("jarvis").build());
 }
 static boolean live(){return !id.isEmpty() && !phase.equals("off");}
 static void incoming(Context c,String callId,long expiry){
  if(callId==null || !callId.matches("[a-zA-Z0-9-]{1,80}") || expiry<=System.currentTimeMillis() || expiry>System.currentTimeMillis()+125000)return;
  if(live())return;
  try{if(SecurePair.read(c).isEmpty())return;register(c);incomingCall=true;id=callId;phase="ringing";nonce=UUID.randomUUID().toString();expiresAt=expiry;startedAt=0;
   Bundle b=new Bundle();b.putString("jarvisCallId",id);c.getSystemService(TelecomManager.class).addNewIncomingCall(account(c),b);
   final String expected=id;handler.postDelayed(()->{if(id.equals(expected)&&phase.equals("ringing"))end(c,DisconnectCause.MISSED,"Call unanswered");},Math.min(90000,expiry-System.currentTimeMillis()));
  }catch(Exception e){end(c,DisconnectCause.ERROR,"Incoming call could not start");}
 }
 static void prepare(Context c,String direction,String incomingId){
  try{
   if(direction.equals("incoming")){
    if(!id.equals(incomingId)||!live()||expiresAt<System.currentTimeMillis())throw new IllegalStateException();
    phase="connecting";c.getSystemService(NotificationManager.class).cancel(NOTIFICATION);
    if(connection!=null){connection.setInitializing();ready(c);}
   }else{
    if(live())throw new IllegalStateException();register(c);incomingCall=false;id=UUID.randomUUID().toString();phase="connecting";nonce=UUID.randomUUID().toString();expiresAt=System.currentTimeMillis()+45000;startedAt=0;
    Bundle b=new Bundle();b.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE,account(c));Bundle own=new Bundle();own.putString("jarvisCallId",id);b.putBundle(TelecomManager.EXTRA_OUTGOING_CALL_EXTRAS,own);
    c.getSystemService(TelecomManager.class).placeCall(Uri.parse("jarvis:desktop"),b);
   }
   Intent service=new Intent(c,VoiceService.class).setAction("start-call");c.startForegroundService(service);
   final String expected=id;handler.postDelayed(()->{if(id.equals(expected)&&phase.equals("connecting"))end(c,DisconnectCause.ERROR,"Call connection timed out");},45000);
  }catch(Exception e){VoiceService.emit("callError","Android could not prepare the call. Check calling permissions and try again.");end(c,DisconnectCause.ERROR,"Call unavailable");}
 }
 static void ready(Context c){VoiceService.emit("callPrepared",id);changed(c);}
 static void answer(Context c){
  if(!phase.equals("ringing")||expiresAt<System.currentTimeMillis())return;
  phase="connecting";c.getSystemService(NotificationManager.class).cancel(NOTIFICATION);
  Intent open=launch(c,false);if(CallActivity.current.get()==null)try{c.startActivity(open);}catch(Exception ignored){}
  Intent service=new Intent(c,VoiceService.class).setAction("answer-call").putExtra("callId",id);c.startForegroundService(service);
  final String expected=id;handler.postDelayed(()->{if(id.equals(expected)&&phase.equals("connecting"))end(c,DisconnectCause.ERROR,"Call connection timed out");},45000);
  changed(c);
 }
 static Intent launch(Context c,boolean answer){return new Intent(c,incomingCall?CallActivity.class:MainActivity.class).setAction(incomingCall?"incoming-call":"voice-hud").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("callId",id).putExtra("callNonce",nonce).putExtra("answer",answer);}
 static void state(Context c,String value){
  if(!live())return;
  if(value.equals("listening")||value.equals("speaking")){
   phase="active";if(startedAt==0)startedAt=System.currentTimeMillis();if(connection!=null){connection.setActive();connection.useDefaultRoute();}
  }else if(value.equals("connecting")){phase="connecting";}
  else if(value.equals("off")||value.equals("error")){end(c,value.equals("error")?DisconnectCause.ERROR:DisconnectCause.LOCAL,"Call ended");return;}
  changed(c);
 }
 static void end(Context c,int cause,String reason){
  if(!live())return;String prior=id;id="";phase="off";startedAt=0;expiresAt=0;muted=false;userMuted=false;systemMuted=false;
  JarvisConnectionService.JarvisConnection old=connection;connection=null;if(old!=null){old.setDisconnected(new DisconnectCause(cause));old.destroy();}
  c.getSystemService(NotificationManager.class).cancel(NOTIFICATION);
  try{VoiceService.emit("callEnded",new JSONObject().put("id",prior).put("reason",reason).toString());}catch(Exception ignored){}VoiceService s=VoiceService.current;if(s!=null)s.endForeground();
 }
 static String snapshot(){try{return new JSONObject().put("id",id).put("phase",phase).put("incoming",incomingCall).put("startedAt",startedAt).put("muted",muted).put("route",route==CallAudioState.ROUTE_SPEAKER?"speaker":route==CallAudioState.ROUTE_BLUETOOTH?"bluetooth":route==CallAudioState.ROUTE_WIRED_HEADSET?"headset":"earpiece").toString();}catch(Exception e){return "{}";}}
 static void changed(Context c){VoiceService.emit("callState",snapshot());VoiceService s=VoiceService.current;if(s!=null&&live()&&!phase.equals("ringing"))s.refreshForeground();}
 static void showIncoming(Context c){
  if(!phase.equals("ringing"))return;
  Notification n=notification(c,true);n.flags|=Notification.FLAG_INSISTENT;
  try{c.getSystemService(NotificationManager.class).notify(NOTIFICATION,n);}catch(SecurityException ignored){}
  VoiceService.emit("incoming",incomingData(false));
 }
 static String incomingData(boolean answer){try{return new JSONObject().put("id",id).put("answer",answer).toString();}catch(Exception e){return "";}}
 static Notification notification(Context c,boolean ringing){
  NotificationManager manager=c.getSystemService(NotificationManager.class);
  NotificationChannel channel=new NotificationChannel(CHANNEL,"JARVIS calls",NotificationManager.IMPORTANCE_HIGH);
  channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build());channel.enableVibration(true);manager.createNotificationChannel(channel);
  Intent open=launch(c,false);PendingIntent content=PendingIntent.getActivity(c,17,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  PendingIntent answer=PendingIntent.getActivity(c,18,launch(c,true),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Intent hangup=new Intent(c,CallActionReceiver.class).putExtra("callId",id).putExtra("callNonce",nonce).putExtra("decline",ringing);
  PendingIntent end=PendingIntent.getBroadcast(c,19,hangup,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  Person person=new Person.Builder().setName("JARVIS").setImportant(true).build();
  NotificationCompat.Builder builder=new NotificationCompat.Builder(c,CHANNEL).setSmallIcon(R.drawable.notification_icon).setContentTitle("JARVIS").setContentText(ringing?"Incoming voice call":phase.equals("active")?"Voice call in progress":"Connecting to your desktop…").setContentIntent(content).setOngoing(true).setOnlyAlertOnce(!ringing).setSilent(!ringing).setCategory(NotificationCompat.CATEGORY_CALL).setVisibility(NotificationCompat.VISIBILITY_PUBLIC).setStyle(ringing?NotificationCompat.CallStyle.forIncomingCall(person,end,answer):NotificationCompat.CallStyle.forOngoingCall(person,end));
  if(ringing){builder.setTimeoutAfter(Math.max(1000,expiresAt-System.currentTimeMillis()));if(Build.VERSION.SDK_INT<34||manager.canUseFullScreenIntent())builder.setFullScreenIntent(content,true);}
  else if(startedAt>0)builder.setWhen(startedAt).setUsesChronometer(true);
  return builder.build();
 }
 static void setMuted(Context c,boolean value){userMuted=value;muted=userMuted||systemMuted;changed(c);}
 static void audioRoutes(Activity activity){
  if(connection==null)return;
  if(android.os.Build.VERSION.SDK_INT>=34&&!connection.endpoints.isEmpty()){
   java.util.List<CallEndpoint> endpoints=new java.util.ArrayList<>(connection.endpoints);String[] names=endpoints.stream().map(e->e.getEndpointName().toString()).toArray(String[]::new);
   new AlertDialog.Builder(activity).setTitle("Call audio").setItems(names,(dialog,index)->{if(connection!=null){connection.defaultRoutePending=false;connection.requestCallEndpointChange(endpoints.get(index),activity.getMainExecutor(),new android.os.OutcomeReceiver<Void,CallEndpointException>(){public void onResult(Void v){}public void onError(CallEndpointException e){VoiceService.emit("error","That audio route is unavailable.");}});}}).show();return;
  }
  CallAudioState audio=connection.getCallAudioState();if(audio==null)return;
  java.util.ArrayList<String> names=new java.util.ArrayList<>();java.util.ArrayList<Integer> routes=new java.util.ArrayList<>();int[] values={CallAudioState.ROUTE_EARPIECE,CallAudioState.ROUTE_SPEAKER,CallAudioState.ROUTE_WIRED_HEADSET,CallAudioState.ROUTE_BLUETOOTH};String[] labels={"Phone","Speaker","Headset","Bluetooth"};for(int j=0;j<values.length;j++)if((audio.getSupportedRouteMask()&values[j])!=0){names.add(labels[j]);routes.add(values[j]);}
  new AlertDialog.Builder(activity).setTitle("Call audio").setItems(names.toArray(new String[0]),(dialog,index)->{if(connection!=null){connection.defaultRoutePending=false;connection.setAudioRoute(routes.get(index));}}).show();
 }
 static boolean validAction(Intent i){return live()&&id.equals(i.getStringExtra("callId"))&&nonce.equals(i.getStringExtra("callNonce"));}
}
