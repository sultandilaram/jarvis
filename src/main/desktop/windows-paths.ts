import { win32 } from "node:path";
// Validate BEFORE realpath/stat: UNC paths can authenticate to a remote server.
export function windowsLocalPath(value: string): string {
  if (!/^[a-z]:[\\/]/i.test(value) || value.includes("\0")) throw Error("Choose an absolute local drive path; network and device paths are unavailable.");
  const tail=value.slice(3);
  if (tail.includes(":")) throw Error("Alternate data streams are unavailable.");
  const parts=tail.split(/[\\/]/);
  if(parts.some(p=>/[. ]$/.test(p)&&p!==".."&&p!=="." || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(p)))throw Error("Reserved Windows paths are unavailable.");
  return win32.resolve(value);
}
export function windowsWithin(root:string,target:string):boolean {
  const part=win32.relative(windowsLocalPath(root),windowsLocalPath(target));
  return !win32.isAbsolute(part) && part!==".." && !part.startsWith("..\\");
}
export function windowsProtectedPath(path:string,workspace?:string):boolean {
  const normalized=windowsLocalPath(path),parts=normalized.slice(3).toLowerCase().split("\\");
  const secrets=new Set([".ssh",".aws",".codex",".git",".jarvis",".gnupg","keychains"]);
  if(parts.some(p=>secrets.has(p)))return true;
  const system=new Set(["windows","program files","program files (x86)","programdata","appdata"]);
  return parts.some(p=>system.has(p)) && !(workspace && windowsWithin(workspace,normalized));
}
export async function windowsNoLinks(path:string,allowMissing=false):Promise<void> {
  const {lstat}=await import('node:fs/promises');
  const canonical=windowsLocalPath(path),root=win32.parse(canonical).root;
  let current=root;
  for(const component of canonical.slice(root.length).split('\\').filter(Boolean)){
    current=win32.join(current,component);
    try{const stat=await lstat(current);if(stat.isSymbolicLink())throw Error('Windows junctions and symlinks are excluded.');}
    catch(e:any){if(allowMissing && e.code==='ENOENT' && current.toLowerCase()===canonical.toLowerCase())return;throw e;}
  }
}
