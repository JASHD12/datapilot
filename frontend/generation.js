/* Opt-in hosted generation. Health checks do not invoke a model. */
import {normalizeQuestion} from './generation-core.js';

export class GenerationClient {
  constructor({fetcher = globalThis.fetch.bind(globalThis), baseURL = '', timeoutMs = 60000} = {}) {
    this.fetcher=fetcher; this.baseURL=baseURL; this.timeoutMs=timeoutMs;
    this.ready=null; this.loading=null; this.generating=false; this.epoch=0; this.controllers=new Set();
  }
  async request(path, options = {}) {
    const controller=new AbortController(); this.controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try {
      const response=await this.fetcher(this.baseURL+path,{...options,signal:controller.signal,cache:'no-store'});
      if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('The live service is unavailable here. Open the hosted DataPilot demo.');
      const result=await response.json();
      if(!response.ok) throw new Error(result.error?.message||'The live service is unavailable. Saved results remain readable.');
      return result;
    } catch(error) {
      if(controller.signal.aborted) throw new Error('Stopped waiting for generation. A remote request may still finish.');
      throw error;
    } finally {clearTimeout(timer);this.controllers.delete(controller);}
  }
  async load(onProgress) {
    if(this.ready)return this.ready;
    if(!this.loading){const epoch=this.epoch;onProgress?.({status:'Checking the hosted service; no model call yet.'});
      this.loading=this.request('/api/generation-health').then(value=>{if(epoch===this.epoch)this.ready=value;return value;})
        .finally(()=>{if(epoch===this.epoch)this.loading=null;});}
    return this.loading;
  }
  async generate(question, _contexts=[], variant='grounded', onProgress) {
    const query=normalizeQuestion(question);
    if(!['plain','grounded'].includes(variant))throw new Error('Unknown generation method.');
    if(this.generating)throw new Error('An answer is already being generated.');
    this.generating=true;const epoch=this.epoch;const start=performance.now();
    try {
      await this.load(onProgress);if(epoch!==this.epoch)throw new Error('Generation cancelled.');
      onProgress?.({status:'Retrieving public sources and generating on Cloudflare…'});
      const result=await this.request('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:query,variant})});
      if(epoch!==this.epoch)throw new Error('Generation cancelled.');
      return {...result,timings:{...result.timings,client_total_ms:performance.now()-start}};
    } finally {if(epoch===this.epoch)this.generating=false;}
  }
  cancel(){this.epoch++;for(const controller of this.controllers)controller.abort();this.controllers.clear();this.ready=null;this.loading=null;this.generating=false;}
  dispose(){this.cancel();}
}
