"""Install only the pinned public offline model; never copy a macOS native cache."""
from pathlib import Path
import hashlib, urllib.request, zipfile, json, shutil
root=Path(__file__).resolve().parents[2]
cache=root/'.jarvis/wake-assets/model.zip'
url='https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'
expected='30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498'
cache.parent.mkdir(parents=True,exist_ok=True)
if not cache.exists(): urllib.request.urlretrieve(url,cache)
if hashlib.sha256(cache.read_bytes()).hexdigest()!=expected: raise RuntimeError('Offline model checksum mismatch')
destination=root/'.jarvis/windows-native/wake-model'
if destination.exists(): shutil.rmtree(destination)
with zipfile.ZipFile(cache) as archive:
 for entry in archive.infolist():
  parts=Path(entry.filename).parts[1:]
  if not parts: continue
  if any(p in ('..','.') or ':' in p or '\\' in p for p in parts): raise RuntimeError('Unsafe model archive')
  target=destination.joinpath(*parts)
  if entry.is_dir(): target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True)
   target.write_bytes(archive.read(entry))
(destination.parent/'wake-assets.json').write_text(json.dumps({'engine':'Vosk 0.3.38 (NuGet locked)','model':'vosk-model-small-en-us-0.15','url':url,'sha256':expected,'onDevice':True},indent=2))
print('Verified Windows offline wake model installed.')
