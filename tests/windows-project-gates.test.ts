import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JobManager} from '../src/main/jobs.ts';
import {Maintenance} from '../src/main/maintenance.ts';
test('Windows unsupported project and maintenance requests fail before persistence or filesystem access',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform')!;
 try {
  Object.defineProperty(process,'platform',{...descriptor,value:'win32'});
  assert.throws(()=>JobManager.prototype.enqueue.call({list(){throw Error('should not access jobs');}} as any,{goal:'Inert project',profile:'project'}),/confinement/);
  const target={get root(){throw Error('should not access filesystem');}};
  assert.throws(()=>Maintenance.prototype.ensure.call(target as any),/unavailable/);
  await assert.rejects(()=>Maintenance.prototype.plan.call({} as any,'repo.start',{text:'Inert source task'}),/unavailable/);
 } finally {Object.defineProperty(process,'platform',descriptor);}
});
