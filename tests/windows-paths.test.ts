import {test} from 'node:test';
import assert from 'node:assert/strict';
import {windowsLocalPath,windowsWithin,windowsProtectedPath} from '../src/main/desktop/windows-paths.ts';
test('Windows file scope rejects cross-drive, sibling and remote escapes before filesystem access',()=>{
  assert.equal(windowsWithin('C:\\Work','D:\\secret.txt'),false);
  assert.equal(windowsWithin('C:\\Work','C:\\Work2\\secret.txt'),false);
  assert.equal(windowsWithin('C:\\Work','c:\\work\\draft.txt'),true);
  for(const p of ['\\\\server\\share','\\\\?\\C:\\a','\\\\.\\pipe\\a','C:relative','C:\\a.txt:secret','C:\\NUL.txt','C:\\folder.\\a','C:\\foo \\a','C:\\COM¹.txt','C:\\LPT²','C:\\CONIN$','C:\\CONOUT$'])assert.throws(()=>windowsLocalPath(p),p);
});
test('Windows protected paths are case insensitive; workspace exception stays confined',()=>{
  assert.equal(windowsProtectedPath('C:\\Users\\Me\\.SSH\\id_rsa'),true);
  assert.equal(windowsProtectedPath('C:\\Windows\\a'),true);
  const w='C:\\Users\\Me\\AppData\\Roaming\\JARVIS\\Workspace';
  assert.equal(windowsProtectedPath(w+'\\draft.txt',w),false);
  assert.equal(windowsProtectedPath('C:\\Users\\Me\\AppData\\Roaming\\JARVIS\\secret',w),true);
});
