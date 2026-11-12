package com.sultan.jarvis.mobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.media.AudioManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.telecom.*;
import android.webkit.*;
import android.view.ViewGroup;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;

// The call engine belongs to the service, so Activity recreation or leaving the
// screen does not destroy the WebRTC call. No microphone is opened by a push.
public class VoiceService extends Service {
 static VoiceService current;
 final Handler handler=new Handler(Looper.getMainLooper());
 final IBinder binder=new LocalBinder();
 android.os.PowerManager.WakeLock callWake,proximityWake;
 long lastHeartbeat=SystemClock.elapsedRealtime();
 final Runnable watchdog=new Runnable(){public void run(){if(CallCoordinator.live()){if(SystemClock.elapsedRealtime()-lastHeartbeat>60000)CallCoordinator.end(VoiceService.this,DisconnectCause.ERROR,"The call connection stopped responding.");else handler.postDelayed(this,15000);}}};
 WebView web;MutableContextWrapper webContext;boolean pageReady=false,foreground=false,voiceActive=false;
 volatile String incoming="",mainTab="talk";String lastDelivered="";
 final java.util.ArrayDeque<String> queuedEvents=new java.util.ArrayDeque<>();
 public class LocalBinder extends Binder {VoiceService service(){return VoiceService.this;}}
 @Override public void onCreate(){super.onCreate();current=this;createEngine();}
 @Override public IBinder onBind(Intent i){return binder;}
 void createEngine(){
  webContext=new MutableContextWrapper(getApplicationContext());web=new WebView(webContext);web.setBackgroundColor(0xff030c13);
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMediaPlaybackRequiresUserGesture(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(false);settings.setTextZoom(Math.round(100*getResources().getConfiguration().fontScale));
  WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
  WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return loader.shouldInterceptRequest(r.getUrl());}
   @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !r.getUrl().toString().startsWith("https://appassets.androidplatform.net/assets/");}
   @Override public void onPageFinished(WebView v,String u){}
   @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){CallCoordinator.end(VoiceService.this,DisconnectCause.ERROR,"The call engine stopped. Please call again.");return false;}
  });
  web.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest request){handler.post(()->{
   if(!request.getOrigin().toString().equals("https://appassets.androidplatform.net/")||checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){request.deny();return;}
   for(String resource:request.getResources())if(!resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)){request.deny();return;}
   request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
  });}});
  web.addJavascriptInterface(new Bridge(),"JarvisNative");web.loadUrl("https://appassets.androidplatform.net/assets/index.html?build="+BuildConfig.VERSION_CODE+(BuildConfig.DEBUG?"&preview="+System.currentTimeMillis():""));
 }
 void attach(Activity activity){web.getSettings().setTextZoom(Math.round(100*getResources().getConfiguration().fontScale));if(web.getParent() instanceof ViewGroup)((ViewGroup)web.getParent()).removeView(web);webContext.setBaseContext(activity);web.setImportantForAccessibility(android.view.View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);android.widget.FrameLayout host=new android.widget.FrameLayout(activity);host.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1));if(Build.VERSION.SDK_INT>=30)host.setOnApplyWindowInsetsListener((view,insets)->{android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout()|android.view.WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});activity.setContentView(host);}
 void attachBehindCall(Activity activity,android.widget.FrameLayout root){if(web.getParent() instanceof ViewGroup)((ViewGroup)web.getParent()).removeView(web);webContext.setBaseContext(activity);web.setImportantForAccessibility(android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);root.addView(web,0,new android.widget.FrameLayout.LayoutParams(-1,-1));}
 void detach(Activity activity){if(webContext.getBaseContext()!=activity)return;if(web!=null&&web.getParent() instanceof ViewGroup)((ViewGroup)web.getParent()).removeView(web);webContext.setBaseContext(getApplicationContext());}
 static void emit(String type,Object value){VoiceService s=current;if(s!=null)s.event(type,value);}
 void event(String type,Object value){try{String json=new JSONObject().put("type",type).put("value",value).toString();handler.post(()->{if(web==null)return;if(!pageReady){if(queuedEvents.size()<100)queuedEvents.add(json);return;}web.evaluateJavascript("window.dispatchEvent(new CustomEvent('jarvis-native',{detail:"+JSONObject.quote(json)+"}))",null);});}catch(Exception ignored){}}
 void incoming(String value){incoming=value;deliverIncoming();}
 void deliverIncoming(){if(!pageReady||incoming.isEmpty()||incoming.equals(lastDelivered))return;lastDelivered=incoming;event("incoming",incoming);}
 @Override public int onStartCommand(Intent i,int flags,int startId){
  if(CallCoordinator.live()){lastHeartbeat=SystemClock.elapsedRealtime();handler.removeCallbacks(watchdog);handler.postDelayed(watchdog,15000);refreshForeground();}
  if(i!=null&&"answer-call".equals(i.getAction())&&CallCoordinator.live())incoming(CallCoordinator.incomingData(true));
  return START_NOT_STICKY;
 }
 void refreshForeground(){
  if(!CallCoordinator.live()||CallCoordinator.phase.equals("ringing"))return;
  updateProximity();
  try{int types=ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL;if(voiceActive&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)types|=ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
   if(Build.VERSION.SDK_INT>=29)startForeground(CallCoordinator.NOTIFICATION,CallCoordinator.notification(this,false),types);else startForeground(CallCoordinator.NOTIFICATION,CallCoordinator.notification(this,false));foreground=true;
  }catch(SecurityException e){event("callError","Android blocked background microphone access. Open JARVIS and grant microphone permission.");CallCoordinator.end(this,DisconnectCause.ERROR,"Call permission required");}
 }
 void updateProximity(){PowerManager power=getSystemService(PowerManager.class);boolean needed=CallCoordinator.phase.equals("active")&&CallCoordinator.route==CallAudioState.ROUTE_EARPIECE;if(needed&&power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)){if(proximityWake==null)proximityWake=power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,"JARVIS:call-proximity");if(!proximityWake.isHeld())proximityWake.acquire();}else if(proximityWake!=null&&proximityWake.isHeld())proximityWake.release();}
 void endForeground(){if(proximityWake!=null&&proximityWake.isHeld())proximityWake.release();handler.removeCallbacks(watchdog);if(callWake!=null&&callWake.isHeld())callWake.release();voiceActive=false;if(foreground){stopForeground(STOP_FOREGROUND_REMOVE);foreground=false;}handler.postDelayed(()->{if(!CallCoordinator.live())stopSelf();},3000);}
 void heartbeat(){lastHeartbeat=SystemClock.elapsedRealtime();if(CallCoordinator.live()&&!CallCoordinator.phase.equals("ringing")){if(callWake==null){callWake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"JARVIS:voice-call");callWake.setReferenceCounted(false);}if(callWake.isHeld())callWake.release();callWake.acquire(70000);}}
 @Override public void onConfigurationChanged(android.content.res.Configuration config){super.onConfigurationChanged(config);if(web!=null)web.getSettings().setTextZoom(Math.round(100*config.fontScale));}
 class Bridge {
  @JavascriptInterface public void hideKeyboard(){handler.post(()->{if(web!=null)getSystemService(android.view.inputmethod.InputMethodManager.class).hideSoftInputFromWindow(web.getWindowToken(),0);});}
  @JavascriptInterface public void installVerifiedUpdate(String raw){handler.post(()->{MainActivity a=MainActivity.current.get();if(a!=null)AndroidUpdates.request(a,raw);});}
  @JavascriptInterface public String getAppVersion(){return BuildConfig.VERSION_NAME;}
  @JavascriptInterface public void setMainTab(String value){if(value.matches("talk|chats|tasks|settings"))mainTab=value;}
  @JavascriptInterface public void callHeartbeat(){handler.post(()->heartbeat());}
  @JavascriptInterface public void ready(){handler.post(()->{if(web==null)return;pageReady=true;while(!queuedEvents.isEmpty()){String json=queuedEvents.remove();web.evaluateJavascript("window.dispatchEvent(new CustomEvent('jarvis-native',{detail:"+JSONObject.quote(json)+"}))",null);}deliverIncoming();});}
  @JavascriptInterface public String readPairing(){try{return SecurePair.read(VoiceService.this);}catch(Exception e){return "";}}
  @JavascriptInterface public void savePairing(String value){if(value.length()>20000)return;try{new JSONObject(value);SecurePair.save(VoiceService.this,value);}catch(Exception e){event("error","Secure pairing storage failed.");}}
  @JavascriptInterface public void clearPairing(){getSharedPreferences("pair",0).edit().clear().commit();}
  @JavascriptInterface public void scan(){handler.post(()->{MainActivity a=MainActivity.current.get();if(a!=null)a.scan();});}
  @JavascriptInterface public void requestMicrophone(){handler.post(()->{if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)event("microphone",true);else{CallActivity call=CallActivity.current.get();if(call!=null)call.requestMicrophone();else{MainActivity a=MainActivity.current.get();if(a!=null)a.requestMicrophone();else event("microphone",false);}}});}
  @JavascriptInterface public void requestNotifications(){handler.post(()->{MainActivity a=MainActivity.current.get();if(a!=null)a.requestNotifications();});}
  @JavascriptInterface public void configurePush(String value){if(value.length()<5000)handler.post(()->FirebaseRegistration.configure(VoiceService.this,value));}
  @JavascriptInterface public String getIncoming(){String value=incoming;incoming="";return value;}
  @JavascriptInterface public String getPushToken(){return getSharedPreferences("push",0).getString("token","");}
  @JavascriptInterface public void prepareCall(String direction,String callId){if(!direction.equals("incoming")&&!direction.equals("outgoing"))return;handler.post(()->CallCoordinator.prepare(VoiceService.this,direction,callId));}
  @JavascriptInterface public void updateCallState(String value){if(!value.matches("off|error|connecting|listening|speaking"))return;handler.post(()->CallCoordinator.state(VoiceService.this,value));}
  @JavascriptInterface public void endCall(){handler.post(()->CallCoordinator.end(VoiceService.this,DisconnectCause.LOCAL,"Call ended"));}
  @JavascriptInterface public void showIncoming(String id,long expires){handler.post(()->CallCoordinator.incoming(VoiceService.this,id,expires));}
  @JavascriptInterface public String getCallState(){return CallCoordinator.snapshot();}
  @JavascriptInterface public void setMuted(boolean mute){handler.post(()->{CallCoordinator.setMuted(VoiceService.this,mute);});}
  @JavascriptInterface public void selectAudioRoute(){handler.post(()->{MainActivity a=MainActivity.current.get();if(a!=null)CallCoordinator.audioRoutes(a);});}
  @JavascriptInterface public boolean canShowIncomingScreen(){return Build.VERSION.SDK_INT<34||getSystemService(NotificationManager.class).canUseFullScreenIntent();}
  @JavascriptInterface public void openIncomingScreenSettings(){handler.post(()->{if(Build.VERSION.SDK_INT>=34){MainActivity a=MainActivity.current.get();if(a!=null)a.startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,Uri.parse("package:"+getPackageName())));}});}
  @JavascriptInterface public void setVoiceActive(boolean active){handler.post(()->{voiceActive=active;if(active&&CallCoordinator.live())refreshForeground();else if(!active&&!CallCoordinator.live())endForeground();});}
 }
 @Override public void onDestroy(){
  CallCoordinator.end(this,DisconnectCause.ERROR,"Call engine stopped");current=null;handler.removeCallbacksAndMessages(null);if(callWake!=null&&callWake.isHeld())callWake.release();
  if(web!=null){web.removeJavascriptInterface("JarvisNative");web.destroy();web=null;}super.onDestroy();
 }
}
