import urllib.request,json,hashlib,zipfile,tarfile,os,pathlib,subprocess,shutil
root=pathlib.Path('.jarvis/android-tools').resolve();root.mkdir(parents=True,exist_ok=True)
def fetch(url,path,sha=None):
 if not path.exists():
  print('Downloading',path.name,flush=True)
  req=urllib.request.Request(url,headers={'User-Agent':'JARVIS-build/0.2'})
  with urllib.request.urlopen(req,timeout=120) as r,open(path,'wb') as f:shutil.copyfileobj(r,f)
 if sha and hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise RuntimeError('Checksum mismatch: '+str(path))
 return path
jdk=root/'jdk'
if not jdk.exists():
 req=urllib.request.Request('https://api.github.com/repos/adoptium/temurin17-binaries/releases/latest',headers={'User-Agent':'JARVIS-build/0.2'})
 metadata=json.load(urllib.request.urlopen(req));assets=metadata['assets'];pkg=next(a for a in assets if a['name'].startswith('OpenJDK17U-jdk_aarch64_mac_hotspot_') and a['name'].endswith('.tar.gz'))
 checksum=next(a for a in assets if a['name']==pkg['name']+'.sha256.txt');sha=urllib.request.urlopen(checksum['browser_download_url']).read().decode().split()[0]
 archive=fetch(pkg['browser_download_url'],root/'jdk.tar.gz',sha)
 with tarfile.open(archive) as t:t.extractall(root/'jdk-stage')
 home=next((root/'jdk-stage').glob('*/Contents/Home'));shutil.move(str(home),jdk)
platform=root/'gradle-8.11.1'
if not platform.exists():
 sha=urllib.request.urlopen('https://services.gradle.org/distributions/gradle-8.11.1-bin.zip.sha256').read().decode().strip()
 archive=fetch('https://services.gradle.org/distributions/gradle-8.11.1-bin.zip',root/'gradle.zip',sha)
 with zipfile.ZipFile(archive) as z:z.extractall(root)
 (platform/'bin/gradle').chmod(0o755)
sdk=root/'sdk';manager=sdk/'cmdline-tools/latest/bin/sdkmanager'
if not manager.exists():
 archive=fetch('https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip',root/'android-commandline.zip')
 with zipfile.ZipFile(archive) as z:z.extractall(root/'sdk-stage')
 manager.parent.parent.parent.mkdir(parents=True,exist_ok=True);shutil.move(str(root/'sdk-stage/cmdline-tools'),str(manager.parent.parent))
 for f in manager.parent.iterdir():f.chmod(0o755)
env={**os.environ,'JAVA_HOME':str(jdk),'ANDROID_HOME':str(sdk),'ANDROID_USER_HOME':str(root/'user'),'GRADLE_USER_HOME':str(root/'gradle-cache')}
# SDK package installation uses Google's standard SDK licence prompt.
subprocess.run([str(manager),'--sdk_root='+str(sdk),'--licenses'],input=('y\n'*100).encode(),env=env,check=True,stdout=subprocess.DEVNULL)
subprocess.run([str(manager),'--sdk_root='+str(sdk),'platform-tools','platforms;android-35','build-tools;35.0.0'],env=env,check=True)
(root/'environment.json').write_text(json.dumps({'javaHome':str(jdk),'androidHome':str(sdk),'gradle':str(platform/'bin/gradle'),'gradleHome':str(root/'gradle-cache')}))
print('Android build tools ready',flush=True)
