/** Python/browser retrieval agreement without any network or model download. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../frontend/semantic-search.js', import.meta.url), 'utf8');
const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const artifact = JSON.parse(readFileSync(new URL('../frontend/retrieval-study.json', import.meta.url), 'utf8'));
module.validateArtifact(artifact);
for (const item of artifact.cases) {
  const scores = module.lexicalScores(item.query, artifact.lexical_index);
  const ranked = module.rank(scores).slice(0, 3);
  assert.deepEqual(ranked.map(row => artifact.passages[row.index].id), item.results.lexical.hits.map(row => row.id), item.id);
  ranked.forEach((row, index) => assert.ok(Math.abs(row.score - item.results.lexical.hits[index].score) < 1e-7, item.id));
}
assert.deepEqual(module.tokens('NÃO recebi!'), ['nao', 'recebi']);
assert.equal(module.cosine([1, 0], [0, 1]), 0);
assert.throws(() => module.cosine([0, 0], [0, 1]));
const corrupted = structuredClone(artifact);
corrupted.passage_embeddings[0][0] = NaN;
assert.throws(() => module.validateArtifact(corrupted));
const fused = module.reciprocalRankFusion([0, 0], [.2, .5]);
assert.equal(fused[1], 1 / 61);
assert.equal(fused[0], 1 / 62);
for (const method of artifact.methods) {
  const rows = artifact.cases.filter(item=>item.split==='dev').map(item=>({split:'dev',answerable:item.answerable,top_score:item.results[method.id].hits[0].score}));
  assert.ok(Math.abs(module.selectThreshold(rows)-method.threshold)<1e-12, `${method.id}: Python/browser development-only selection differs`);
}
assert.throws(()=>module.selectThreshold([{split:'test',answerable:true,top_score:.9}]));
assert.throws(()=>module.selectThreshold([{split:'dev',answerable:true,top_score:.9}]));
const noProtocol = structuredClone(artifact);
delete noProtocol.model.runtime_parity;
assert.throws(()=>module.validateArtifact(noProtocol));
console.log(`${artifact.cases.length} Python/browser lexical rankings, scores and development thresholds agree; embedding validation and RRF checks passed.`);
