import { EventEmitter } from 'node:events';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { releaseRepository, releasePublicKey } from '../shared/release-config.ts';
import { githubBytes, verifyManifest, assetURL, verifyArtifact, versionParts, newer, type ReleaseManifest } from './releases.ts';
export type UpdateState={ current:string; repository:string; phase:'idle'|'checking'|'available'|'latest'|'downloading'|'ready'|'error'; release?:{version:string;notes:string;commit:string;size:number}; error?:string; checkedAt?:number };
export class ReleaseUpdater extends EventEmitter {
  manifest?:ReleaseManifest;
  state:UpdateState;
  busy=false;
  constructor(public current:string,public directory:string,public fetchBytes=githubBytes, public verificationKey=releasePublicKey) {super();this.state={current,repository:releaseRepository,phase:'idle'};}
  change(patch:Partial<UpdateState>) {this.state={...this.state,...patch};this.emit('change');}
  async check() {
    if(this.busy)return this.state;
    this.busy=true;this.manifest=undefined;this.change({phase:'checking',error:undefined,release:undefined});
    try {
      const release=JSON.parse((await this.fetchBytes(`https://api.github.com/repos/${releaseRepository}/releases/latest`,1024*1024)).toString('utf8'));
      if(release.draft || release.prerelease || typeof release.tag_name!=='string' || !release.tag_name.startsWith('v'))throw Error('No stable release is available.');
      const v=release.tag_name.slice(1);versionParts(v);
      const raw=await this.fetchBytes(assetURL(v,'release.json'),65536);
      const sig=await this.fetchBytes(assetURL(v,'release.sig'),64);
      this.manifest=verifyManifest(raw,sig,"0.0.0",this.verificationKey,v);
      const m=this.manifest;
      if(!newer(v,this.current)){this.change({phase:"latest",checkedAt:Date.now()});return this.state;}
      this.change({phase:'available',checkedAt:Date.now(),release:{version:m.version,notes:m.notes,commit:m.commit,size:m.assets.macArm64.size}});
    } catch(e) {this.change({phase:'error',error:(e as Error).message,checkedAt:Date.now()});}
    finally {this.busy=false;}
    return this.state;
  }
  async download(signal?:AbortSignal) {
    if(this.busy || !this.manifest || this.state.phase!=='available')throw Error('Check for a verified available update first.');
    this.busy=true;const m=this.manifest;this.change({phase:'downloading',error:undefined});
    const stage=join(this.directory,randomUUID());
    try {
      await mkdir(stage,{recursive:true,mode:0o700});
      const bytes=await this.fetchBytes(assetURL(m.version,m.assets.macArm64.name),m.assets.macArm64.size,signal);
      signal?.throwIfAborted();verifyArtifact(bytes,m.assets.macArm64);
      const archive=join(stage,'update.zip');await writeFile(archive,bytes,{mode:0o600,flag:'wx'});
      this.change({phase:'ready'});return {stage,archive,version:m.version,commit:m.commit};
    } catch(e) {await rm(stage,{recursive:true,force:true});this.change({phase:'available',error:(e as Error).message});throw e;}
    finally {this.busy=false;}
  }
}
