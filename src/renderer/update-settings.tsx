import React from 'react';
import type { Snapshot } from '../shared/types';
export function UpdateSettings({state,voiceBusy,run}:{state:Snapshot;voiceBusy:boolean;run:(fn:()=>Promise<unknown>)=>unknown}) {
 const u=state.updates;const phase=u?.phase||'idle';
 const busy=['checking','downloading','ready'].includes(phase);
 const releaseBusy=!!state.releases&&['preparing','building','verifying','publishing'].includes(state.releases.phase);
 const waiting=!!state.activeTaskId||voiceBusy||!!state.remote?.voiceActive||releaseBusy;
 return <details className="settings-section" open><summary>App updates</summary>
  <p>Installed version {u?.current||'development'}. Updates come from sultandilaram/jarvis and require a verified release signature.</p>
  <p role="status" aria-live="polite">{phase==='idle'?'Check for a published release.':phase==='checking'?'Checking GitHub…':phase==='latest'?'No newer stable release was reported.':phase==='available'?`Version ${u?.release?.version} is verified and available.`:phase==='downloading'?'Downloading and verifying the update…':phase==='ready'?'Update verified. Preparing restart…':'The update check could not finish.'}</p>
  {u?.error&&<p role="alert">{u.error}</p>}
  {u?.release&&<details><summary>Release notes · {u.release.version}</summary><p style={{whiteSpace:'pre-wrap'}}>{u.release.notes}</p><p className="muted">Source commit {u.release.commit.slice(0,12)}</p></details>}
  <div className="settings-actions"><button disabled={busy} onClick={()=>run(()=>window.jarvis.checkForUpdates())}>{phase==='error'?'Try update check again':'Check for updates'}</button>
  {phase==='available'&&<button disabled={waiting} onClick={()=>run(()=>window.jarvis.installUpdate())}>Review update and restart</button>}</div>
  {phase==='available'&&waiting&&<p className="muted">Finish or stop current work and end voice before installing.</p>}
  <p className="muted">JARVIS checks periodically. Nothing is installed without your approval. Restarting briefly disconnects your phone.</p>
 </details>;
}
