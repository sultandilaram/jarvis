import './prepare-ui-fixtures.mjs';
import { _electron as electron } from 'playwright-core';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const app=await electron.launch({args:[resolve('.jarvis/ui-test/desktop-main.cjs')]});
try{
 const p=await app.firstWindow(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.getByRole('button',{name:'Settings',exact:true}).waitFor();await p.evaluate(()=>window.__critiqueSeed('maintenance'));await p.getByRole('button',{name:'Settings',exact:true}).click();
 await p.getByText('App updates',{exact:true}).click();await p.getByText('Version 0.6.1 is verified and available.',{exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.__installReviews),undefined);
 await p.getByText('Release notes · 0.6.1',{exact:true}).click();
 await p.getByRole('button',{name:'Review update and restart',exact:true}).click();assert.equal(await p.evaluate(()=>window.__installReviews),1);
 await p.getByText('JARVIS source and maintenance',{exact:true}).click();await p.getByRole('button',{name:'Review source changes',exact:true}).click();
 await p.getByText('src/main/jobs.ts',{exact:true}).click();await p.getByText('new reviewed source',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.__sourceMerge),undefined);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,650));
 assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
 await mkdir('.jarvis/verification/self-management',{recursive:true});await p.screenshot({path:'.jarvis/verification/self-management/source-review.png'});
 await p.getByRole('button',{name:'Review and approve local merge',exact:true}).click();assert.deepEqual(await p.evaluate(()=>window.__sourceMerge),{id:'proposal1',digest:'abc123'});
 await p.evaluate(()=>window.__updateFailure=true);await p.getByRole('button',{name:'Check for updates',exact:true}).click();await p.getByText('No public release is available yet.',{exact:true}).waitFor();await p.getByRole('button',{name:'Try update check again',exact:true}).waitFor();
 await p.getByText('JARVIS source and maintenance',{exact:true}).click();await p.getByRole('button',{name:'Try update check again',exact:true}).scrollIntoViewIfNeeded();
 await p.screenshot({path:'.jarvis/verification/self-management/update-error.png'});assert.deepEqual(errors,[]);
 console.log('Self-management UI passed: explicit install review, full source inspection before merge, error/retry, compact layout and no automatic approval effects.');
}finally{await app.close();}
