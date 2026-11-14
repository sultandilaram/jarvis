import {test} from 'node:test';
import assert from 'node:assert/strict';
import {windowsCodexBinary} from '../src/main/codex-binary.ts';
test('Windows Codex discovery uses native executables and ignores current directory and command wrappers',()=>{
  assert.throws(()=>windowsCodexBinary({PATH:'.;relative'},()=>true),/not found/);
  assert.throws(()=>windowsCodexBinary({JARVIS_CODEX_PATH:'C:\\Tools\\codex.cmd'},()=>true),/native codex.exe/);
  assert.equal(windowsCodexBinary({PATH:'C:\\Tools'},p=>p==='C:\\Tools\\codex.exe'),'C:\\Tools\\codex.exe');
  assert.throws(()=>windowsCodexBinary({JARVIS_CODEX_PATH:'codex.exe'},()=>true));
});
