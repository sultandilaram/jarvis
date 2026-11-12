"""Fetch pinned official offline wake assets. No Python packages are installed."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request, hashlib, zipfile, shutil, json
ROOT=Path(__file__).resolve().parent.parent
CACHE=ROOT/'.jarvis/wake-assets'; CACHE.mkdir(parents=True,exist_ok=True)
WHEEL='https://files.pythonhosted.org/packages/44/19/5e8299237bc2005c3d155d3b48adba6fd6484465ad5c970302fc1d37947d/vosk-0.3.44-py3-none-macosx_10_6_universal2.whl'
MODEL='https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'
def fetch(item):
 name,url,expected=item; path=CACHE/name
 if not path.exists():
  print('Downloading '+name,flush=True);urllib.request.urlretrieve(url,path)
 digest=hashlib.sha256(path.read_bytes()).hexdigest()
 if expected and digest!=expected:raise RuntimeError('Checksum mismatch: '+name)
 return path,digest
with ThreadPoolExecutor(max_workers=2) as pool:
 artifacts=list(pool.map(fetch,[('vosk.whl',WHEEL,'029d0b3d6a5cff874c575b8a5814a4cccfb37608cff52e846c02a8c67a882801'),('model.zip',MODEL,'30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498')]))
DEST=ROOT/'dist/native';DEST.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(artifacts[0][0]) as wheel:
 lib=next(n for n in wheel.namelist() if n.endswith(('libvosk.so','libvosk.dylib','libvosk.dyld')))
 (DEST/'libvosk.dylib').write_bytes(wheel.read(lib))
 for n in wheel.namelist():
  if 'LICENSE' in n.upper() and not n.endswith('/'): (DEST/'VOSK-LICENSE.txt').write_bytes(wheel.read(n));break
model=DEST/'wake-model'
if not (model/'am/final.mdl').exists():
 with zipfile.ZipFile(artifacts[1][0]) as archive:
  for entry in archive.infolist():
   parts=Path(entry.filename).parts[1:]
   if not parts:continue
   target=model.joinpath(*parts)
   if '..' in parts:raise RuntimeError('Invalid archive path')
   if entry.is_dir():target.mkdir(parents=True,exist_ok=True)
   else:target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(entry))
(DEST/'wake-assets.json').write_text(json.dumps({'engine':'Vosk 0.3.44','model':'vosk-model-small-en-us-0.15','sources':[{'url':WHEEL,'sha256':artifacts[0][1]},{'url':MODEL,'sha256':artifacts[1][1]}],'license':'Apache-2.0'},indent=2))
print(json.dumps({'assetsReady':True,'modelSha256':artifacts[1][1]}),flush=True)
