package com.sultan.jarvis.mobile;
import com.google.firebase.messaging.*;import org.json.JSONObject;
public class PushService extends FirebaseMessagingService {
 @Override public void onNewToken(String token){getSharedPreferences("push",0).edit().putString("token",token).apply();VoiceService.emit("pushToken",token);}
 @Override public void onMessageReceived(RemoteMessage message){
  try{String id=message.getData().get("callId"),phone=message.getData().get("deviceId");long expires=Long.parseLong(message.getData().getOrDefault("expiresAt","0"));
   JSONObject pair=new JSONObject(SecurePair.read(this));if(phone==null||!phone.equals(pair.optString("id")))return;
   if("cancel".equals(message.getData().get("action"))){if(id!=null&&id.equals(CallCoordinator.id)&&CallCoordinator.phase.equals("ringing"))CallCoordinator.end(this,android.telecom.DisconnectCause.REMOTE,"Call answered elsewhere");return;}
   CallCoordinator.incoming(this,id,expires);
  }catch(Exception ignored){}
 }
}
