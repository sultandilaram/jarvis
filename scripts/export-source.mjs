import { readdir, lstat, readFile, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve('.');
const checkOnly = process.argv.includes('--check');
const bundleOnly = process.argv.includes('--bundle');
const bundle = {}; 
const output = join(root, '.jarvis', 'public-source');
const roots = ['src', 'native', 'scripts', 'tests', 'mobile/web', 'mobile/android/app/src', '.github', 'docs'];
const singles = ['package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', 'LICENSE', 'NOTICE', 'SECURITY.md', 'SELF-MANAGEMENT.md', 'mobile/tsconfig.json', 'mobile/android/build.gradle', 'mobile/android/settings.gradle', 'mobile/android/gradle.properties', 'mobile/android/app/build.gradle'];
const brand = ['jarvis-icon.png', 'jarvis-64.png', 'jarvisTrayTemplate.png', 'jarvisTrayTemplate@2x.png', 'Jarvis.icns'];
const extensions = new Set(['.ts','.tsx','.js','.mjs','.cjs','.py','.swift','.cs','.csproj','.manifest','.json','.html','.css','.java','.xml','.gradle','.properties','.yml','.yaml','.md','.txt']);
const binaryAssets = new Set([...brand.map(n => 'assets/brand/' + n), 'mobile/android/app/src/main/res/drawable/app_icon.png', ...['positive','unrelated','near-name'].map(n=>'tests/fixtures/windows-wake/'+n+'.wav')]);
const files = [...singles, ...brand.map(n => 'assets/brand/' + n)];
async function visit(relative) {
  for (const e of await readdir(join(root, relative), {withFileTypes:true})) {
    const name = relative + '/' + e.name;
    if (['build','.gradle','assets','node_modules','.git','bin','obj'].includes(e.name)) continue;
    if (e.isSymbolicLink()) throw Error('Symlink excluded: '+name);
    if (e.isDirectory()) await visit(name);
    else if (e.isFile() && (extensions.has(extname(name)) || binaryAssets.has(name) || e.name === 'CODEOWNERS')) files.push(name);
    else throw Error('Unreviewed file type: '+name);
  }
}
for (const r of roots) await visit(r);
// Public docs replace historical owner-specific setup documents; never copy the
// working folder, personal history, build output or a private signing/vault cache.
const replacements = new Map([['README.md','docs/PUBLIC-README.md'], ['MACOS-LOCAL-RELEASE.md','docs/PUBLIC-MACOS.md']]);
for (const [target] of replacements) files.push(target);
const manifest=[];
for (const target of [...new Set(files)].sort()) {
  const source = replacements.get(target) || target;
  if (!(await lstat(join(root, source))).isFile()) throw Error('Not a regular source file: '+source);
  const data = await readFile(join(root,source));
  if (!binaryAssets.has(target)) {
    const text=data.toString('utf8');
    const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{24,}/, /"private_key"\s*:\s*"[^"\n]{20,}/, /\/Users\/sultan\//, /jarvis\.jointops\.dev/, /jarvis-mobile-[a-f0-9]{5}/];
    if (patterns.some(p => p.test(text))) throw Error('Private or owner-specific content requires review: '+source);
  }
  bundle[target]=data.toString('base64');
  manifest.push({path:target,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
if (bundleOnly) {
  await mkdir("dist",{recursive:true});
  const version=JSON.parse(await readFile("package.json","utf8")).version;
  await writeFile("dist/maintenance-source.json",JSON.stringify({schema:1,version,files:bundle}));
}
if (!checkOnly && !bundleOnly) {
  await rm(output,{recursive:true,force:true});
  for (const item of manifest) {
    const destination=join(output,item.path);
    await mkdir(resolve(destination,'..'),{recursive:true});
    await copyFile(join(root,replacements.get(item.path)||item.path),destination);
  }
  await writeFile(join(root,'.jarvis','public-source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}
console.log(JSON.stringify({passed:true,mode:bundleOnly?'bundle':checkOnly?'audit':'export',files:manifest.length,ownerStateExcluded:true,...(!checkOnly&&!bundleOnly?{directory:output}:{})}));
