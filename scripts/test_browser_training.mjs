// Output-level worker tests. Run with Node; no DOM, browser, network or package dependency.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';

const workerPath = new URL('../frontend/browser-training.js', import.meta.url);
const source = readFileSync(workerPath, 'utf8');
function run(message) {
  let output;
  const context = vm.createContext({self: {postMessage(value) { output = JSON.parse(JSON.stringify(value)); }}, performance});
  vm.runInContext(source, context, {filename: 'browser-training.js'});
  context.self.onmessage({data: message});
  assert.equal(output.id, message.id);
  return output;
}
function regressionSample() {
  return {id: 'regression-test', task: 'regression', target: 'delivery_days', seed: 42, dataset: {
    features: ['input'], train: {x: Array.from({length: 40}, (_, i) => [i]), y: Array.from({length: 40}, (_, i) => 2 * i + 3)},
    test: {x: Array.from({length: 10}, (_, i) => [40 + i]), y: Array.from({length: 10}, (_, i) => 2 * (40 + i) + 3)},
    split: {method: 'chronological sample', cutoff: 'declared fixture cutoff'},
  }};
}
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

const regression = regressionSample(), before = JSON.stringify(regression), output = run(regression);
assert.ok(!output.error, output.error);
assert.equal(JSON.stringify(regression), before, 'Input rows must not be mutated.');
assert.equal(output.result.models.length, 3);
const ridge = output.result.models.find(model => model.name === 'Ridge regression');
// This independent one-variable fixture has meanX19.5 and y=2x+3. Ridge alpha10
// shrinks the standardized slope by40/(40+10), producing holdout errors8.2..11.8.
close(ridge.metrics.mae, 10);
close(ridge.metrics.rmse, Math.sqrt(101.32));
close(output.result.models[0].metrics.mae, 50);
close(output.result.preprocessing.mean[0], 19.5);
assert.equal(output.result.split.method, 'chronological sample');
assert.equal(output.result.model_definitions[2].parameters.n_estimators, 24);
assert.ok(output.result.runtime_ms >= 0);

const alteredTest = regressionSample();
alteredTest.dataset.test.x = alteredTest.dataset.test.x.map(() => [1e6]);
const altered = run(alteredTest).result;
assert.deepEqual(altered.preprocessing, output.result.preprocessing, 'Holdout values must not influence preprocessing.');
assert.deepEqual(run(regression).result.models, output.result.models, 'Seeded forests and fixed linear fits must be deterministic.');
const alteredLabels = regressionSample();
alteredLabels.dataset.test.y = alteredLabels.dataset.test.y.map(value => value + 1000);
const labelsResult = run(alteredLabels).result;
assert.deepEqual(labelsResult.predictions.map(row => row.predicted), output.result.predictions.map(row => row.predicted), 'Holdout target labels must not affect the trained forest predictions.');
assert.deepEqual(labelsResult.feature_importance, output.result.feature_importance, 'Holdout target labels must not affect learned feature importance.');

const classification = {id: 'classification-test', task: 'classification', target: 'delivery_late', seed: 42, dataset: {
  features: ['input'], train: {x: Array.from({length: 80}, (_, i) => [i]), y: Array.from({length: 80}, (_, i) => i >= 40 ? 1 : 0)},
  test: {x: [[10], [20], [30], [50], [60], [70]], y: [0, 0, 0, 1, 1, 1]},
}};
const classified = run(classification);
assert.ok(!classified.error, classified.error);
close(classified.result.models[0].metrics.roc_auc, 0.5);
close(classified.result.models[0].metrics.accuracy, 0.5);
for (const model of classified.result.models.slice(1)) {
  close(model.metrics.accuracy, 1);
  close(model.metrics.f1, 1);
  close(model.metrics.roc_auc, 1);
}

const constant = structuredClone(classification);
constant.dataset.train.x = constant.dataset.train.x.map(() => [null]);
constant.dataset.test.x = constant.dataset.test.x.map(() => [null]);
const constantResult = run(constant).result;
assert.deepEqual(constantResult.preprocessing.impute, [0]);
assert.deepEqual(constantResult.preprocessing.scale, [1]);
for (const model of constantResult.models) close(model.metrics.roc_auc, 0.5);

const missing = regressionSample();
missing.dataset.train.x[0][0] = null;
missing.dataset.test.x[0][0] = null;
const missingResult = run(missing);
assert.ok(!missingResult.error, missingResult.error);
assert.ok(missingResult.result.models.every(model => Object.values(model.metrics).every(value => value === null || Number.isFinite(value))));

for (const invalid of [
  {...regressionSample(), task: 'unsupported'},
  {...regressionSample(), target: 'input'},
  {...regressionSample(), dataset: {...regressionSample().dataset, features: ['duplicate', 'duplicate']}},
]) assert.equal(typeof run(invalid).error, 'string');
const absentClass = structuredClone(classification);
absentClass.dataset.train.y.fill(0);
assert.match(run(absentClass).error, /both classes/);
const invalidTarget = regressionSample();
invalidTarget.dataset.train.y[0] = Infinity;
assert.match(run(invalidTarget).error, /finite numeric/);
const oversized = regressionSample();
oversized.dataset.train.x = Array.from({length: 2001}, () => [1]);
oversized.dataset.train.y = Array(2001).fill(1);
assert.match(run(oversized).error, /20–2000/);

console.log('Browser worker checks passed: real ridge reference, baselines, classification, AUC ties, determinism, missing values, train-only preprocessing and bounded validation.');
