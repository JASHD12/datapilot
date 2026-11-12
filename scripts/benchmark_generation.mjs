/** Record actual hosted generation; never synthesize answers or substitute fixtures. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {MODEL,REVISION,PROMPT_VERSION,ABSTENTION,GENERATION_OPTIONS,pickContext,normalizeContexts,buildMessages,checkGeneration} from '../frontend/generation-core.js';
const {values}=parseArgs({options:{endpoint:{type:'string'},split:{type:'string',default:'dev'},output:{type:'string',default:'artifacts/generation-runs.json'},merge:{type:'string'}}});
const root=new URL('..',import.meta.url);
const read=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=value=>hash(JSON.stringify(canonical(value)));
const manifest=await read('data/evaluation/generation_questions.json'),retrieval=await read('frontend/retrieval-study.json');
assert.equal(fingerprint(retrieval.passages),manifest.corpus_fingerprint);
const protocolFiles=['frontend/generation-core.js','frontend/semantic-search.js','cloudflare/generation-worker.js','scripts/build_generation_worker.mjs'];
const protocol=Object.fromEntries(await Promise.all(protocolFiles.map(async path=>[path,hash(await readFile(new URL(path,root)))])));
const destination=resolve(values.output);await mkdir(dirname(destination),{recursive:true});
let output;
if(values.merge){
 const parts=await Promise.all(values.merge.split(',').map(async path=>JSON.parse(await readFile(resolve(path),'utf8'))));
 for(const part of parts){assert.deepEqual(part.run_metadata.protocol_files,protocol);assert.deepEqual(part.model,parts[0].model);assert.equal(part.run_metadata.question_fingerprint,fingerprint(manifest));}
 assert.deepEqual(parts.map(p=>p.run_metadata.split).sort(),['dev','test']);
 assert.ok(parts[0].run_metadata.split==='dev');
 assert.ok(parts[0].run_metadata.finished_at<=parts[1].run_metadata.started_at,'Finish development before starting test.');
 output={...parts[0],runs:parts.flatMap(p=>p.runs),run_metadata:{...parts[0].run_metadata,split:'all',finished_at:parts.at(-1).run_metadata.finished_at,batches:parts.map(p=>p.run_metadata)}};
}else{
 if(!['dev','test'].includes(values.split))throw new Error('Run dev first, freeze the protocol, then run test separately.');
 if(!values.endpoint)throw new Error('--endpoint must be the deployed DataPilot URL.');
 const endpoint=new URL(values.endpoint);if(endpoint.protocol!=='https:')throw new Error('Use an HTTPS deployment.');
 const health=await fetch(new URL('/api/generation-health',endpoint));if(!health.ok)throw new Error('Live generation health check failed.');
 const info=await health.json();assert.equal(info.model.id,MODEL);assert.equal(info.model.revision,REVISION);assert.equal(info.prompt_version,PROMPT_VERSION);
 output={schema_version:1,model:info.model,run_metadata:{started_at:new Date().toISOString(),split:values.split,endpoint:endpoint.origin,node:process.version,prompt_version:PROMPT_VERSION,generation_options:GENERATION_OPTIONS,
   protocol_files:protocol,protocol_fingerprint:fingerprint(protocol),question_fingerprint:fingerprint(manifest),corpus_fingerprint:manifest.corpus_fingerprint,
   timing_scope:'Server measures awaited AI binding latency. Client total includes HTTP/network. One sequential run per condition; no repeated latency experiment or device benchmark.',
   protocol:'Actual plain and grounded model calls per question. Validated condition reuses the grounded draft. Prompt and evidence differ between plain and grounded; this is not an isolated causal estimate of retrieval.',
   annotation_status:'human_questions_reviewed',errors:[]},runs:[]};
 for(const question of manifest.questions.filter(q=>q.split===values.split)){
  const selected=pickContext(question.question,retrieval);
  for(const variant of ['plain','grounded']){
   const start=performance.now();
   const response=await fetch(new URL('/api/generate',endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:question.question,variant}),signal:AbortSignal.timeout(65000)});
   const clientMs=performance.now()-start;const result=await response.json();
   if(!response.ok){output.run_metadata.errors.push({question_id:question.id,variant,http_status:response.status,error:result.error});await writeFile(destination,JSON.stringify(output,null,2));throw new Error('Provider request failed; partial runs and error retained. Do not score as a refusal.');}
   assert.equal(result.model_invoked,true);assert.equal(result.model.id,MODEL);assert.equal(result.prompt_version,PROMPT_VERSION);
   const contexts=variant==='plain'?[]:normalizeContexts(selected.contexts);
   assert.deepEqual(result.contexts,contexts);assert.deepEqual(result.messages,buildMessages(question.question,contexts,variant));
   assert.deepEqual(result.checks,checkGeneration(result.raw_answer,contexts,{truncated:result.completion.truncated}));
   const common={...result,question_id:question.id,variant,answer:result.raw_answer,status:'generated',timings:{...result.timings,client_total_ms:clientMs},executed_at:new Date().toISOString()};
   output.runs.push(common);
   if(variant==='grounded')output.runs.push({...structuredClone(common),variant:'grounded_validated',reuse_of:'grounded',model_invoked:false,status:result.status,answer:result.status==='accepted'?result.raw_answer:ABSTENTION,timing_note:'Reuses grounded generation and validation timing; no second model call.'});
   await writeFile(destination,JSON.stringify(output,null,2));
   console.log(JSON.stringify({id:question.id,variant,status:result.status,generation_ms:result.timings.generation_ms,raw_answer:result.raw_answer}));
  }
 }
 output.run_metadata.finished_at=new Date().toISOString();
}
for(const path of protocolFiles)assert.equal(hash(await readFile(new URL(path,root))),protocol[path],'Protocol changed during evaluation.');
await writeFile(destination,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({saved:destination,runs:output.runs.length,split:output.run_metadata.split}));
