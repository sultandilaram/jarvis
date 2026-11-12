package com.sultan.jarvis.mobile;
import android.content.*;import android.telecom.DisconnectCause;
public class CallActionReceiver extends BroadcastReceiver{
 @Override public void onReceive(Context c,Intent i){if(!CallCoordinator.validAction(i))return;if(i.getBooleanExtra("decline",false))VoiceService.emit("callDeclined",CallCoordinator.id);CallCoordinator.end(c,i.getBooleanExtra("decline",false)?DisconnectCause.REJECTED:DisconnectCause.LOCAL,"Call ended");}
}
