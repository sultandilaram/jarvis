package com.sultan.jarvis.mobile;

// FCM may start a fresh process before any Activity or voice service exists.
public final class JarvisApplication extends android.app.Application {
 @Override public void onCreate(){
  super.onCreate();
  String config=getSharedPreferences("push",0).getString("config","");
  if(!config.isEmpty())FirebaseRegistration.configure(this,config);
 }
}
