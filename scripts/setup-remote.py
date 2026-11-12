import urllib.request,json,hashlib,tarfile,pathlib,shutil
root=pathlib.Path('.jarvis/remote-tools');root.mkdir(parents=True,exist_ok=True)
req=urllib.request.Request('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',headers={'User-Agent':'JARVIS-build/0.2'})
release=json.load(urllib.request.urlopen(req));asset=next(a for a in release['assets'] if a['name']=='cloudflared-darwin-arm64.tgz');digest=asset.get('digest','')
if not digest.startswith('sha256:'):raise RuntimeError('Release has no SHA-256 digest; refusing unverified helper')
archive=root/'cloudflared.tgz'
if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest()!=digest[7:]:
 print('Downloading Cloudflare helper',release['tag_name'],flush=True)
 with urllib.request.urlopen(asset['browser_download_url']) as r,open(archive,'wb') as f:shutil.copyfileobj(r,f)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=digest[7:]:raise RuntimeError('Tunnel helper checksum mismatch')
with tarfile.open(archive) as t:
 member=next(m for m in t.getmembers() if pathlib.Path(m.name).name=='cloudflared' and m.isfile());data=t.extractfile(member).read()
path=pathlib.Path('dist/native/cloudflared');path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);path.chmod(0o755)
license=urllib.request.urlopen('https://raw.githubusercontent.com/cloudflare/cloudflared/'+release['tag_name']+'/LICENSE').read();path.with_name('cloudflared-LICENSE').write_bytes(license)
path.with_name('cloudflared-release.json').write_text(json.dumps({'version':release['tag_name'],'sha256':digest[7:],'url':asset['browser_download_url']}))
print('Verified tunnel helper ready',flush=True)
