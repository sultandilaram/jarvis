import React,{useState} from 'react';
import type { Snapshot } from '../shared/types';
export function MaintenanceSettings({state,run}:{state:Snapshot;run:(fn:()=>Promise<unknown>)=>unknown}) {
 const [review,setReview]=useState<any>();
 const [loading,setLoading]=useState(false);
 const inspect=(id:string)=>run(async()=>{setLoading(true);try{setReview(await window.jarvis.maintenanceReview(id));}finally{setLoading(false);}});
 return <details className="settings-section"><summary>JARVIS source and maintenance</summary>
  <p>Ask “Improve JARVIS…” to prepare an isolated source change. Checks and a separate reviewer come before a merge. Sensitive changes need your approval.</p>
  <p className="muted">{state.maintenance?.githubConfigured?'GitHub maintenance identities configured':'Local mode · JARVIS GitHub identities not configured'}. Repository: sultandilaram/jarvis. Merging source does not update the installed app.</p>
  <button onClick={()=>run(()=>state.maintenance?.githubConfigured?window.jarvis.removeGitHubMaintenance():window.jarvis.configureGitHubMaintenance())}>{state.maintenance?.githubConfigured?'Disconnect GitHub maintenance':'Configure GitHub maintenance'}</button>
  {state.maintenance?.pulls?.map(p=><p key={p.number}>PR #{p.number} · {p.state.replaceAll('_',' ')}{p.error?' · '+p.error:''}</p>)}
  {!state.maintenance?.proposals.length&&<p>No source improvements proposed yet.</p>}
  {state.maintenance?.proposals.map(p=><div className="maintenance-proposal" key={p.id}>
   <h3>{p.goal}</h3><p>{({draft:'Coding',reviewing:'Independent review',owner_review:'Needs your source review',merged:'Merged locally',rejected:'Review rejected',conflict:'Source changed · new review needed'} as const)[p.state]}</p>
   <p className="muted">{p.checks.length} of 3 required checks recorded</p>
   {p.changes?.length?<button disabled={loading} onClick={()=>inspect(p.id)}>Review source changes</button>:null}
  </div>)}
  {review&&<section aria-label="Source change review"><h3>{review.goal}</h3><p>{review.review||'Independent review is still pending.'}</p>
   <p className="muted">Snapshot {review.digest?.slice(0,16)}</p>
   {review.changes?.map((c:any)=><details key={c.path}><summary>{c.path}</summary><h4>Before</h4><pre className="source-diff">{c.before??'(new file)'}</pre><h4>After</h4><pre className="source-diff">{c.after??'(deleted file)'}</pre></details>)}
   {state.maintenance?.proposals.find(p=>p.id===review.id)?.state==='owner_review'&&<button onClick={()=>run(async()=>{await window.jarvis.maintenanceMerge(review.id,review.digest);setReview(undefined);})}>Review and approve local merge</button>}
   <button onClick={()=>setReview(undefined)}>Close source review</button>
  </section>}
 </details>;
}
