package com.sultan.jarvis.mobile;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;

final class AndroidUpdates {
 static boolean busy=false,awaitingPermission=false; static File pending; static String pendingHash; static long pendingSize;
 static void status(String value){VoiceService.emit("update",value);}
 static boolean allowed(URL u){return u.getProtocol().equals("https")&&(u.getPort()==-1||u.getPort()==443)&&u.getUserInfo()==null&&Arrays.asList("github.com","release-assets.githubusercontent.com","objects.githubusercontent.com").contains(u.getHost());}
 static void request(MainActivity activity,String raw){
  try{
   if(VoiceService.current!=null&&VoiceService.current.voiceActive)throw new Exception("End the voice conversation before updating.");
   JSONObject p=new JSONObject(raw);String version=p.getString("version"),url=p.getString("url"),sha=p.getString("sha256");long size=p.getLong("size");
   if(!version.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")||!sha.matches("[a-f0-9]{64}")||size<=0||size>268435456||!url.equals("https://github.com/sultandilaram/jarvis/releases/download/v"+version+"/JARVIS-Android-"+version+".apk"))throw new Exception("Invalid verified Android release metadata.");
   if(busy)throw new Exception("An update download is already running.");
   new AlertDialog.Builder(activity).setTitle("Update JARVIS to "+version+"?").setMessage("Download the APK verified by your paired desktop. Android will ask before installation. Your existing app signing identity must match.").setNegativeButton("Cancel",null).setPositiveButton("Download update",(d,w)->{
    awaitingPermission=false;
    if(pending!=null&&sha.equals(pendingHash)&&size==pendingSize){resume(activity);return;}
    busy=true;status("Downloading verified update…");new Thread(()->{
     File temp=new File(activity.getCacheDir(),"updates/update.part");
     try{
      temp.getParentFile().mkdirs();URL current=new URL(url);HttpURLConnection response=null;
      for(int hop=0;hop<5;hop++){
       if(!allowed(current))throw new Exception("Update redirect left GitHub.");
       response=(HttpURLConnection)current.openConnection();response.setInstanceFollowRedirects(false);response.setConnectTimeout(20000);response.setReadTimeout(30000);response.setRequestProperty("User-Agent","JARVIS-Android-updater");
       int code=response.getResponseCode();if(Arrays.asList(301,302,303,307,308).contains(code)){String next=response.getHeaderField("Location");response.disconnect();if(next==null)throw new Exception("Invalid update redirect.");current=new URL(current,next);response=null;continue;}
       if(code!=200)throw new Exception("GitHub update download failed: HTTP "+code);break;
      }
      if(response==null)throw new Exception("Too many update redirects.");
      try(InputStream in=response.getInputStream();OutputStream out=new FileOutputStream(temp)){
       byte[] buffer=new byte[65536];long count=0;int n;while((n=in.read(buffer))!=-1){count+=n;if(count>size)throw new Exception("Update exceeds signed size.");out.write(buffer,0,n);}if(count!=size)throw new Exception("Update size mismatch.");
      }finally{response.disconnect();}
      verify(temp,sha,size);File file=new File(temp.getParentFile(),"JARVIS.apk");if(file.exists()&&!file.delete())throw new Exception("Cannot replace previous download.");if(!temp.renameTo(file))throw new Exception("Cannot stage update.");
      pending=file;pendingHash=sha;pendingSize=size;activity.runOnUiThread(()->resume(activity));
     }catch(Exception e){temp.delete();status("Update failed: "+e.getMessage());}finally{busy=false;}
    },"jarvis-update").start();
   }).show();
  }catch(Exception e){status("Update failed: "+e.getMessage());}
 }
 static void verify(File file,String sha,long size)throws Exception{
  if(file.length()!=size)throw new Exception("Update size mismatch.");MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}StringBuilder actual=new StringBuilder();for(byte b:d.digest())actual.append(String.format("%02x",b&255));if(!MessageDigest.isEqual(actual.toString().getBytes("US-ASCII"),sha.getBytes("US-ASCII")))throw new Exception("Update hash mismatch.");
 }
 static Set<String> signers(PackageInfo info)throws Exception{
  Signature[] signatures=Build.VERSION.SDK_INT>=28?info.signingInfo.getApkContentsSigners():info.signatures;Set<String> out=new HashSet<>();if(signatures==null||signatures.length==0)throw new Exception("Missing APK signature.");for(Signature s:signatures)out.add(Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));return out;
 }
 static void resume(MainActivity activity){
  if(pending==null)return;
  try{
   if(VoiceService.current!=null&&VoiceService.current.voiceActive)throw new Exception("End voice before installation.");
   verify(pending,pendingHash,pendingSize);PackageManager pm=activity.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
   PackageInfo next=pm.getPackageArchiveInfo(pending.getAbsolutePath(),flags),current=pm.getPackageInfo(activity.getPackageName(),flags);
   if(next==null||!activity.getPackageName().equals(next.packageName)||!signers(next).equals(signers(current)))throw new Exception("APK identity does not match installed JARVIS.");
   long a=Build.VERSION.SDK_INT>=28?next.getLongVersionCode():next.versionCode,b=Build.VERSION.SDK_INT>=28?current.getLongVersionCode():current.versionCode;if(a<=b)throw new Exception("Android update is not newer.");
   if(Build.VERSION.SDK_INT>=26&&!pm.canRequestPackageInstalls()){
    if(awaitingPermission){status("Installation permission was not allowed. Tap Review Android update to try again.");return;}
    awaitingPermission=true;status("Allow JARVIS to request this installation in Android settings, then return.");activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));return;
   }
   Uri uri=FileProvider.getUriForFile(activity,activity.getPackageName()+".updates",pending);
   activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));pending=null;status("Verified APK ready. Review Android’s installation prompt.");
  }catch(Exception e){pending=null;status("Update failed: "+e.getMessage());}
 }
}
