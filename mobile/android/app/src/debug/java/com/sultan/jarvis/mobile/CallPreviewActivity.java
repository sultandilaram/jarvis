package com.sultan.jarvis.mobile;

// Emulator-only UI and Telecom fixture. This source is absent from release APKs.
public class CallPreviewActivity extends android.app.Activity {
 @Override public void onCreate(android.os.Bundle state){
  super.onCreate(state);
  String mode=getIntent().getStringExtra("mode");
  if("incoming-telecom".equals(mode)){
   try{SecurePair.save(this,"{\"id\":\"emulator-only\"}");}catch(Exception e){throw new RuntimeException(e);}
   CallCoordinator.incoming(this,"emulator-incoming",System.currentTimeMillis()+90000);finish();return;
  }
  if("telecom".equals(mode)){
   CallCoordinator.prepare(this,"outgoing","");
   new android.os.Handler(getMainLooper()).postDelayed(()->{startActivity(CallCoordinator.launch(this,false));finish();},1000);
   return;
  }
  CallCoordinator.incomingCall=true;CallCoordinator.id="emulator-call";CallCoordinator.nonce="emulator-only";
  CallCoordinator.phase="active".equals(mode)?"active":"ringing";
  CallCoordinator.startedAt=System.currentTimeMillis()-65000;
  CallCoordinator.expiresAt=System.currentTimeMillis()+90000;
  startActivity(CallCoordinator.launch(this,false).putExtra("preview",true));finish();
 }
}
