import { verify, createHash } from 'node:crypto';
import { releaseRepository, releasePublicKey, releaseDataSchema } from '../shared/release-config.ts';
export type ReleaseAsset = { name: string; sha256: string; size: number };
export type ReleaseManifest = { schema: 1; repository: string; version: string; commit: string; publishedAt: string; notes: string; dataSchema: number; assets: { macArm64: ReleaseAsset; android: ReleaseAsset } };
export function versionParts(value: string) {
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw Error('Only stable x.y.z releases are supported.');
  const parts=value.split('.').map(Number);
  if(parts.some(n=>!Number.isSafeInteger(n))) throw Error('Invalid release version.');
  return parts;
}
export function newer(candidate: string, current: string) {
  const a=versionParts(candidate),b=versionParts(current);
  for(let i=0;i<3;i++) if(a[i]!==b[i]) return a[i]>b[i];
  return false;
}
export function verifyManifest(bytes: Buffer, signature: Buffer, current: string, key=releasePublicKey, expectedVersion?: string): ReleaseManifest {
  if(bytes.length>65536 || signature.length!==64 || !verify(null,bytes,key,signature)) throw Error('Release signature verification failed. Nothing was installed.');
  const m=JSON.parse(bytes.toString('utf8'));
  if(m.schema!==1 || m.repository!==releaseRepository || typeof m.version!=='string' || !newer(m.version,current) || (expectedVersion && m.version!==expectedVersion)) throw Error('Release identity/version is invalid or is not newer.');
  if(m.dataSchema!==releaseDataSchema) throw Error('This release changes the data format; a separately reviewed migration is required.');
  if(!/^[a-f0-9]{40}$/.test(m.commit) || typeof m.notes!=='string' || m.notes.length>8000 || typeof m.publishedAt!=='string' || !Number.isFinite(Date.parse(m.publishedAt))) throw Error('Release metadata is invalid.');
  for(const [platform,ext,max] of [['macArm64','zip',1024*1024*1024],['android','apk',256*1024*1024]] as const) {
    const a=m.assets?.[platform];
    if(!a || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.size) || a.size<=0 || a.size>max || a.name!==`JARVIS-${platform==='macArm64'?'macOS-AppleSilicon':'Android'}-${m.version}.${ext}`) throw Error('Release artifact metadata is invalid.');
  }
  return m;
}
export function assetURL(version: string,name: string) {
  versionParts(version);
  if(!/^[A-Za-z0-9._-]+$/.test(name)) throw Error('Invalid release artifact name.');
  return `https://github.com/${releaseRepository}/releases/download/v${version}/${name}`;
}
export function verifyArtifact(bytes: Buffer, asset: ReleaseAsset) {
  if(bytes.length!==asset.size || createHash('sha256').update(bytes).digest('hex')!==asset.sha256) throw Error('Downloaded update does not match its signed hash/size.');
}
export async function githubBytes(url: string, maximum: number, signal?: AbortSignal): Promise<Buffer> {
  let current=new URL(url);
  const allowed=(u:URL)=>u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') && ['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname);
  for(let hop=0;hop<5;hop++) {
    if(!allowed(current)) throw Error('Update redirect left the allowed GitHub hosts.');
    const r=await fetch(current,{redirect:'manual',headers:{'User-Agent':'JARVIS-updater','Accept':current.hostname==='api.github.com'?'application/vnd.github+json':'application/octet-stream'},signal:AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])])});
    if([301,302,303,307,308].includes(r.status)) {const location=r.headers.get('location'); await r.body?.cancel(); if(!location)throw Error('Invalid update redirect.'); current=new URL(location,current); continue;}
    if(!r.ok) {await r.body?.cancel();throw Error(r.status===404?'No public release is available yet.':`GitHub returned HTTP ${r.status}.`);}
    if(Number(r.headers.get('content-length')||0)>maximum){await r.body?.cancel();throw Error('Update response exceeds its size limit.');}
    const chunks:Uint8Array[]=[];let size=0;
    if(!r.body)throw Error('Empty update response.');
    for await(const chunk of r.body as any) {size+=chunk.length;if(size>maximum){await r.body.cancel().catch(()=>{});throw Error('Update response exceeds its size limit.');}chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  throw Error('Too many update redirects.');
}
