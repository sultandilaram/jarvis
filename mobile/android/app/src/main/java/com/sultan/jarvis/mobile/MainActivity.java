package com.sultan.jarvis.mobile;
import android.Manifest;import android.app.Activity;import android.content.*;import android.content.pm.PackageManager;import android.graphics.Color;import android.os.*;import com.google.zxing.integration.android.*;
public class MainActivity extends Activity {
 static java.lang.ref.WeakReference<MainActivity> current=new java.lang.ref.WeakReference<>(null);
 VoiceService service;boolean bound;String pendingIncoming="";
 final ServiceConnection connection=new ServiceConnection(){
  @Override public void onServiceConnected(ComponentName name,IBinder binder){service=((VoiceService.LocalBinder)binder).service();service.attach(MainActivity.this);if(!pendingIncoming.isEmpty()){service.incoming(pendingIncoming);pendingIncoming="";}}
  @Override public void onServiceDisconnected(ComponentName name){service=null;}
 };
 @Override public void onCreate(Bundle state){super.onCreate(state);current=new java.lang.ref.WeakReference<>(this);getWindow().setStatusBarColor(Color.rgb(3,12,19));bound=bindService(new Intent(this,VoiceService.class),connection,BIND_AUTO_CREATE);String config=getSharedPreferences("push",0).getString("config",null);if(config!=null)FirebaseRegistration.configure(this,config);}
 @Override protected void onNewIntent(Intent i){super.onNewIntent(i);setIntent(i);if("voice-hud".equals(i.getAction())&&service!=null)service.event("back",true);}
 @Override protected void onResume(){super.onResume();current=new java.lang.ref.WeakReference<>(this);if(service!=null)service.attach(this);AndroidUpdates.resume(this);}
 void scan(){new IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("Scan the QR in JARVIS desktop Settings").setBeepEnabled(false).initiateScan();}
 void requestMicrophone(){requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},77);}
 void requestNotifications(){if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},78);else VoiceService.emit("notifications",true);}
 @Override public void onRequestPermissionsResult(int code,String[] names,int[] grants){super.onRequestPermissionsResult(code,names,grants);VoiceService.emit(code==77?"microphone":"notifications",grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED);}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);IntentResult scanned=IntentIntegrator.parseActivityResult(request,result,data);if(scanned!=null&&scanned.getContents()!=null)VoiceService.emit("qr",scanned.getContents());}
 @Override public void onBackPressed(){if(service!=null&&!service.mainTab.equals("talk")){service.event("back",true);service.mainTab="talk";}else moveTaskToBack(true);}
 @Override protected void onDestroy(){if(service!=null)service.detach(this);if(bound)unbindService(connection);if(current.get()==this)current.clear();super.onDestroy();}
}
