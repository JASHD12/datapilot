/* Pages advanced-mode endpoint: only public corpus evidence, bounded model inputs. */
import {MODEL, REVISION, PROMPT_VERSION, GENERATION_OPTIONS, MAX_NEW_TOKENS, ABSTENTION,
  normalizeQuestion, normalizeContexts, pickContext, buildMessages, checkGeneration} from '../frontend/generation-core.js';

export const MODEL_METADATA=Object.freeze({id:MODEL,revision:REVISION,display_name:'Llama 3.1 8B Instruct (FP8 Fast)',provider:'Cloudflare Workers AI',runtime:'Cloudflare Workers AI binding',model_card:'https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8-fast/',license:'Llama 3.1 Community License',reproducibility:'Hosted model alias; provider weights and serving revision are not pinned.'});
const MAX_BODY=8192;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const failure=(code,message,status=400,invoked=false)=>json({error:{code,message},model_invoked:invoked},status);

async function boundedJSON(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('Use application/json.');
  const reader=request.body?.getReader();if(!reader)throw new Error('A question is required.');
  let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw new Error('Request exceeds 8 KiB.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>!['question','variant'].includes(key)))throw new Error('Only question and variant are accepted.');
  return body;
}

export function interpretProvider(result){
  const raw=result?.response??result?.choices?.[0]?.message?.content;
  if(typeof raw!=='string'||!raw.trim()||raw.length>6000)throw new Error('invalid_provider_output');
  const usage=result.usage&&typeof result.usage==='object'?result.usage:null;
  const finish=result?.choices?.[0]?.finish_reason??result?.finish_reason??null;
  const count=usage?.completion_tokens??usage?.output_tokens;
  const truncated=finish==='length'||(Number.isInteger(count)&&count>=MAX_NEW_TOKENS);
  return {raw,usage,completion:{provider_finish_reason:finish,stop_reason:finish??'not_reported',truncated,
    truncation_basis:finish==='length'?'provider_finish_reason':Number.isInteger(count)&&count>=MAX_NEW_TOKENS?'conservative_output_token_limit':'no_reported_limit_hit',
    token_ids_available:false}};
}

/** corpus is supplied by the deterministic build, never by a visitor. */
export async function handleGeneration(request,env,corpus){
  const url=new URL(request.url);
  if(!['/api/generation-health','/api/generate'].includes(url.pathname))return env.ASSETS.fetch(request);
  if(url.pathname==='/api/generation-health'){
    if(request.method!=='GET')return failure('method','Use GET.',405);
    if(!env.AI?.run)return failure('unconfigured','Live generation is not configured. Saved evaluation remains available.',503);
    return json({ready:true,model:MODEL_METADATA,prompt_version:PROMPT_VERSION,quota:'Shared Workers Free daily allowance; service may be unavailable when exhausted.',privacy:'Your question is processed by Cloudflare. Use public, nonsensitive questions only.'});
  }
  if(request.method!=='POST')return failure('method','Use POST.',405);
  const origin=request.headers.get('Origin');
  if(origin&&origin!==url.origin)return failure('origin','Use the DataPilot site to send this request.',403);
  if(!env.AI?.run)return failure('unconfigured','Live generation is not configured. Saved evaluation remains available.',503);
  let question,variant;
  try{const body=await boundedJSON(request);question=normalizeQuestion(body.question);variant=body.variant??'grounded';if(!['plain','grounded'].includes(variant))throw new Error('Unknown generation method.');}
  catch(error){return failure('invalid_request',error instanceof SyntaxError?'Invalid JSON.':error.message);}
  const started=performance.now();let invoked=false;
  try{
    const retrieved=pickContext(question,corpus);
    const contexts=variant==='plain'?[]:normalizeContexts(retrieved.contexts);
    const messages=buildMessages(question,contexts,variant);
    const preflightMs=performance.now()-started;
    const generationStarted=performance.now();invoked=true;
    const response=await env.AI.run(MODEL,{messages,...GENERATION_OPTIONS});
    const generationMs=performance.now()-generationStarted;
    const {raw,usage,completion}=interpretProvider(response);
    const checkStart=performance.now();const checks=checkGeneration(raw,contexts,{truncated:completion.truncated});
    const status=checks.abstained?'abstained':checks.accepted?'accepted':'blocked';
    const result={raw_answer:raw,answer:status==='accepted'?raw:ABSTENTION,status,checks,model_invoked:true,
      contexts,context_ids:contexts.map(item=>item.id),retrieval:{...retrieved,contexts:undefined},messages,
      timings:{preflight_ms:preflightMs,retrieval_ms:retrieved.retrieval_ms,generation_ms:generationMs,check_ms:performance.now()-checkStart,total_ms:performance.now()-started},
      usage,completion,model:MODEL_METADATA,prompt_version:PROMPT_VERSION,generation_options:GENERATION_OPTIONS,variant,
      scope:'Experimental hosted generation over public excerpts. Citation checks verify format only, not factual support.'};
    console.log(JSON.stringify({event:'generation',variant,status,generation_ms:Math.round(generationMs),completion_tokens:usage?.completion_tokens??null}));
    return json(result);
  }catch(error){
    console.error(JSON.stringify({event:'generation_error',model_invoked:invoked,kind:error?.name||'Error'}));
    return failure('provider_unavailable','Generation is unavailable or the shared free allowance is exhausted. Try later; saved results remain readable.',503,invoked);
  }
}
