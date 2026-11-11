/* Opt-in local multilingual search. Model files download only after load(). */
const LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const MODEL = 'Xenova/multilingual-e5-small';
const REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const RRF_K = 60;
const RRF_CANDIDATES = 20;

export function tokens(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) || [];
}

export function lexicalScores(query, index) {
  const positions = new Map(index.vocabulary.map((word, position) => [word, position]));
  const counts = new Map();
  for (const word of tokens(query)) counts.set(word, (counts.get(word) || 0) + 1);
  const values = new Map();
  let squared = 0;
  for (const [word, count] of counts) {
    if (!positions.has(word)) continue;
    const position = positions.get(word);
    const value = (1 + Math.log(count)) * index.idf[position];
    values.set(position, value);
    squared += value * value;
  }
  const norm = Math.sqrt(squared) || 1;
  return index.vectors.map(row => row.reduce((sum, [position, weight]) => sum + weight * (values.get(position) || 0) / norm, 0));
}

export function rank(scores) {
  return scores.map((score, index) => ({score, index})).sort((a, b) => b.score - a.score || a.index - b.index);
}

export function reciprocalRankFusion(lexical, dense) {
  if (lexical.length !== dense.length) throw new Error('Retrieval score dimensions differ.');
  const scores = new Array(dense.length).fill(0);
  for (const [values, positiveOnly] of [[lexical, true], [dense, false]]) {
    rank(values).filter(item => !positiveOnly || item.score > 0).slice(0, RRF_CANDIDATES)
      .forEach((item, position) => { scores[item.index] += 1 / (RRF_K + position + 1); });
  }
  return scores;
}

export function cosine(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('Embedding dimensions differ.');
  let dot = 0, aSquared = 0, bSquared = 0;
  for (let position = 0; position < a.length; position++) {
    if (!Number.isFinite(a[position]) || !Number.isFinite(b[position])) throw new Error('Embedding contains invalid values.');
    dot += a[position] * b[position];
    aSquared += a[position] ** 2;
    bSquared += b[position] ** 2;
  }
  if (!aSquared || !bSquared) throw new Error('Embedding is empty.');
  return dot / Math.sqrt(aSquared * bSquared);
}

export function selectThreshold(rows) {
  if (!rows.length || rows.some(row => row.split !== 'dev')) throw new Error('Threshold selection requires development questions only.');
  const positive = rows.filter(row => row.answerable), negative = rows.filter(row => !row.answerable);
  if (!positive.length || !negative.length) throw new Error('Threshold selection requires both answerable and unanswerable questions.');
  const values = [...new Set(rows.map(row => row.top_score))].sort((a,b) => a-b);
  if (values.some(value => !Number.isFinite(value))) throw new Error('Invalid development scores.');
  const candidates = [values[0]-1e-8, ...values.slice(1).map((value,index) => (values[index]+value)/2), values.at(-1)+1e-8];
  let best = -1, selected = candidates[0];
  for (const threshold of candidates) {
    const objective = (positive.filter(row => row.top_score >= threshold).length/positive.length + negative.filter(row => row.top_score < threshold).length/negative.length)/2;
    if (objective > best || (objective === best && threshold > selected)) { best = objective; selected = threshold; }
  }
  return selected;
}

export function validateArtifact(artifact) {
  if (artifact?.schema_version !== 1 || artifact.model?.browser_id !== MODEL || artifact.model?.browser_revision !== REVISION || artifact.model?.dimensions !== 384) throw new Error('Unsupported semantic artifact or model revision.');
  if (!Array.isArray(artifact.passages) || !artifact.passages.length || artifact.passages.length > 1000 || artifact.passage_embeddings?.length !== artifact.passages.length) throw new Error('Invalid semantic corpus.');
  for (const vector of artifact.passage_embeddings) {
    if (!Array.isArray(vector) || vector.length !== 384 || vector.some(value => !Number.isFinite(value))) throw new Error('Invalid passage embedding.');
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
    if (Math.abs(norm - 1) > 0.01) throw new Error('Passage embedding is not normalized.');
  }
  if (artifact.lexical_index?.vectors?.length !== artifact.passages.length) throw new Error('Lexical and dense corpora differ.');
  const parity = artifact.model.runtime_parity;
  if (!parity || !Number.isFinite(parity.minimum_cosine) || parity.minimum_cosine < 0.99 || parity.minimum_cosine > 1 || parity.probes?.length !== 3) throw new Error('Missing encoder compatibility protocol.');
  for (const probe of parity.probes) {
    if (!Array.isArray(probe.embedding) || probe.embedding.length !== 384 || probe.embedding.some(value => !Number.isFinite(value)) || !Array.isArray(probe.token_ids) || !probe.token_ids.length || probe.token_ids.some(value=>!Number.isInteger(value)||value<0)) throw new Error('Invalid encoder compatibility probe.');
  }
  return artifact;
}

export class SemanticSearch {
  constructor(artifactURL = './retrieval-study.json') {
    this.artifactURL = new URL(artifactURL, typeof document !== 'undefined' ? document.baseURI : import.meta.url).href;
    this.worker = null;
    this.pending = new Map();
    this.serial = 0;
    this.ready = null;
    this.loading = null;
  }

  request(type, payload, onProgress, timeout = 240000) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./semantic-search.js?v=0.3.0', import.meta.url), {type: 'module'});
      this.worker.onmessage = event => {
        const {id, type: eventType, value, error} = event.data || {};
        const pending = this.pending.get(id);
        if (!pending) return;
        if (eventType === 'progress') { pending.onProgress?.(value); return; }
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        if (error) pending.reject(new Error(error)); else pending.resolve(value);
      };
      this.worker.onerror = () => this.cancel('The local embedding worker could not start. Saved evaluation and ordinary evidence search remain available.');
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel('Local semantic search timed out. Try again on a device with more available memory or use the saved study.'), timeout);
      this.pending.set(id, {resolve, reject, onProgress, timeout: timer});
      this.worker.postMessage({id, type, ...payload});
    });
  }

  async load(onProgress) {
    if (this.ready) return this.ready;
    if (!this.loading) {
      this.loading = this.request('load', {artifactURL: this.artifactURL}, onProgress)
        .then(result => { this.ready = result; return result; })
        .finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  async search(query, {mode = 'dense', limit = 4, onProgress} = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 1000) throw new Error('Enter a query of 1–1,000 characters.');
    if (!['dense', 'hybrid'].includes(mode)) throw new Error('Choose dense or hybrid search.');
    await this.load(onProgress);
    return this.request('search', {query: query.trim(), mode, limit: Math.max(1, Math.min(10, Number(limit) || 4))}, onProgress, 30000);
  }

  cancel(message = 'Local semantic search cancelled.') {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.loading = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error(message)); }
    this.pending.clear();
  }
}

// This same module is a dedicated Web Worker only after an explicit load().
if (typeof document === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  let artifact = null, extractor = null, busy = false, browserVectors = null, browserThresholds = null;
  const emit = (id, type, value) => self.postMessage({id, type, value});
  const embed = async (text, kind) => Array.from((await extractor(`${kind}: ${text}`, {pooling: 'mean', normalize: true, truncation: true, max_length: 512})).data);
  const embedQuery = query => embed(query, 'query');
  self.onmessage = async event => {
    const {id, type, artifactURL, query, mode, limit} = event.data || {};
    if (busy) { self.postMessage({id, error: 'A local embedding operation is already running.'}); return; }
    busy = true;
    try {
      if (type === 'load') {
        emit(id, 'progress', {status: 'Loading the saved corpus and pinned embedding runtime.'});
        const response = await fetch(artifactURL);
        if (!response.ok) throw new Error('The saved semantic corpus could not be downloaded.');
        artifact = validateArtifact(await response.json());
        const {pipeline, env} = await import(LIBRARY_URL);
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        env.backends.onnx.wasm.numThreads = 1;
        extractor = await pipeline('feature-extraction', MODEL, {revision: REVISION, dtype: 'q8', device: 'wasm', progress_callback: progress => emit(id, 'progress', {status: progress.status, file: progress.file, progress: progress.progress})});
        emit(id, 'progress', {status: 'Checking browser tokenization and three reference embeddings.'});
        const probeResults = [];
        for (const reference of artifact.model.runtime_parity.probes) {
          const vector = await embedQuery(reference.query);
          const agreement = cosine(vector, reference.embedding);
          const encoded = await extractor.tokenizer(`query: ${reference.query}`, {truncation: true, max_length: 512, padding: true});
          const tokensMatch = JSON.stringify(Array.from(encoded.input_ids.data, Number)) === JSON.stringify(reference.token_ids);
          if (!tokensMatch || agreement < artifact.model.runtime_parity.minimum_cosine) throw new Error(`Browser encoder agreement ${agreement.toFixed(5)}; token IDs match: ${tokensMatch}. Required cosine: ${artifact.model.runtime_parity.minimum_cosine}. Live semantic search is disabled; inspect the saved evaluation instead.`);
          probeResults.push({cosine: agreement, tokenIdsMatch: tokensMatch});
        }
        // Keep live corpus/query vectors in one runtime. Native/WASM q8 outputs
        // from a matching checkpoint need not be numerically identical.
        browserVectors = [];
        for (const [index, passage] of artifact.passages.entries()) {
          if (index % 10 === 0) emit(id, 'progress', {status: `Encoding source passages on this device: ${index}/${artifact.passages.length}.`});
          browserVectors.push(await embed(passage.text, 'passage'));
        }
        const development = artifact.cases.filter(item => item.split === 'dev');
        const thresholdRows = {dense: [], hybrid: []};
        for (const [index, item] of development.entries()) {
          emit(id, 'progress', {status: `Checking development-only abstention: ${index+1}/${development.length}.`});
          const vector = await embedQuery(item.query);
          const dense = browserVectors.map(passage => cosine(vector, passage));
          const hybrid = reciprocalRankFusion(lexicalScores(item.query, artifact.lexical_index), dense);
          for (const [method, scores] of [['dense',dense],['hybrid',hybrid]]) thresholdRows[method].push({split:'dev',answerable:item.answerable,top_score:Math.max(...scores)});
        }
        browserThresholds = Object.fromEntries(Object.entries(thresholdRows).map(([method,rows]) => [method,selectThreshold(rows)]));
        emit(id, 'result', {model: MODEL, revision: REVISION, corpusSize: artifact.passages.length, probeCosine:Math.min(...probeResults.map(item=>item.cosine)),probeResults,vectorSource:'Passages and queries encoded in this browser runtime',thresholdSource:'Development questions re-encoded on this device; no test questions used',thresholds:browserThresholds});
      } else if (type === 'search') {
        if (!artifact || !extractor) throw new Error('Load the optional embedding model first.');
        if (typeof query !== 'string' || !query.trim() || query.length > 1000 || !['dense', 'hybrid'].includes(mode)) throw new Error('Invalid semantic query.');
        const start = performance.now();
        const vector = await embedQuery(query);
        const dense = browserVectors.map(passage => cosine(vector, passage));
        const scores = mode === 'dense' ? dense : reciprocalRankFusion(lexicalScores(query, artifact.lexical_index), dense);
        const ranking = rank(scores);
        const threshold = browserThresholds[mode];
        const abstained = ranking[0].score < threshold;
        const hits = abstained ? [] : ranking.slice(0, limit).map((item, position) => ({...artifact.passages[item.index], score: item.score, rank: position + 1}));
        emit(id, 'result', {hits, method: mode, abstained, threshold, top_score: ranking[0].score, query, elapsed_ms: performance.now() - start, scope: `Live local retrieval over ${artifact.passages.length} bounded public passages, re-encoded in this browser. Threshold selected from development questions on this device; saved native-CPU scores may differ. Scores are not probabilities. No generated answer.`});
      } else throw new Error('Unknown semantic operation.');
    } catch (error) {
      self.postMessage({id, error: String(error?.message || 'Local semantic search failed.').slice(0, 500)});
    } finally { busy = false; }
  };
}
