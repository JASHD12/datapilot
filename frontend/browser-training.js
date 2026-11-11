/* DataPilot's bounded, genuine browser-training worker. No network or runtime dependency. */
'use strict';

const LIMITS = Object.freeze({train: 2000, test: 1000, features: 12, trees: 24, depth: 6, leaf: 6, splits: 12});

function validateDataset(message) {
  if (!message || !['classification', 'regression'].includes(message.task)) throw new Error('Choose classification or regression.');
  const dataset = message.dataset;
  if (!dataset || !Array.isArray(dataset.features) || !dataset.features.length || dataset.features.length > LIMITS.features) throw new Error('The sample must contain 1–12 numeric features.');
  const names = dataset.features;
  if (names.some(name => typeof name !== 'string' || !name.trim()) || new Set(names).size !== names.length) throw new Error('Feature names must be nonempty and unique.');
  if (typeof message.target !== 'string' || names.includes(message.target)) throw new Error('The prediction target must be separate from the input features.');
  for (const [key, maximum, minimum] of [['train', LIMITS.train, 20], ['test', LIMITS.test, 5]]) {
    const split = dataset[key];
    if (!split || !Array.isArray(split.x) || !Array.isArray(split.y) || split.x.length !== split.y.length || split.x.length < minimum || split.x.length > maximum) throw new Error(`The ${key} sample needs ${minimum}–${maximum} matching input and target rows.`);
    for (const row of split.x) {
      if (!Array.isArray(row) || row.length !== names.length) throw new Error('Each input row must match the declared feature columns.');
      if (row.some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12))) throw new Error('Input values must be finite numeric values or null, within the supported range.');
    }
    if (split.y.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12)) throw new Error('Targets must be complete, finite numeric values.');
    if (message.task === 'classification' && split.y.some(value => value !== 0 && value !== 1)) throw new Error('The browser classifier requires binary targets encoded as 0 and 1.');
  }
  if (message.task === 'classification' && new Set(dataset.train.y).size !== 2) throw new Error('The training sample must contain both classes.');
  return dataset;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fitPreprocessing(rows) {
  const features = rows[0].length, impute = [], mean = [], scale = [];
  for (let j = 0; j < features; j++) {
    impute[j] = median(rows.map(row => row[j]).filter(value => value !== null));
    const values = rows.map(row => row[j] === null ? impute[j] : row[j]);
    mean[j] = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean[j]) ** 2, 0) / values.length;
    scale[j] = Math.sqrt(variance) || 1;
  }
  return {impute, mean, scale, fitted_on: 'training sample only'};
}

function transform(rows, preprocessing) {
  return rows.map(row => row.map((value, j) => ((value === null ? preprocessing.impute[j] : value) - preprocessing.mean[j]) / preprocessing.scale[j]));
}

function seededRandom(seed) {
  let state = Number.isInteger(seed) ? seed >>> 0 : 42;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function solve(matrix, vector) {
  const n = vector.length, a = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-12) throw new Error('The ridge system could not be solved.');
    [a[pivot], a[column]] = [a[column], a[pivot]];
    const divisor = a[column][column];
    for (let j = column; j <= n; j++) a[column][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let j = column; j <= n; j++) a[row][j] -= factor * a[column][j];
    }
  }
  return a.map(row => row[n]);
}

function ridgeFit(x, y) {
  const d = x[0].length, meanY = y.reduce((sum, value) => sum + value, 0) / y.length;
  const gram = Array.from({length: d}, () => Array(d).fill(0)), rhs = Array(d).fill(0);
  for (let i = 0; i < x.length; i++) for (let j = 0; j < d; j++) {
    rhs[j] += x[i][j] * (y[i] - meanY);
    for (let k = 0; k < d; k++) gram[j][k] += x[i][j] * x[i][k];
  }
  for (let j = 0; j < d; j++) gram[j][j] += 10;
  return {coefficients: solve(gram, rhs), intercept: meanY};
}

function sigmoid(value) {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

function logisticFit(x, y) {
  const d = x[0].length, coefficients = Array(d).fill(0), positives = y.reduce((sum, value) => sum + value, 0);
  const weights = [y.length / (2 * (y.length - positives)), y.length / (2 * positives)];
  let intercept = 0;
  for (let epoch = 0; epoch < 300; epoch++) {
    const gradient = Array(d).fill(0);
    let interceptGradient = 0;
    for (let i = 0; i < x.length; i++) {
      let score = intercept;
      for (let j = 0; j < d; j++) score += x[i][j] * coefficients[j];
      const error = (sigmoid(score) - y[i]) * weights[y[i]];
      interceptGradient += error;
      for (let j = 0; j < d; j++) gradient[j] += error * x[i][j];
    }
    intercept -= 0.1 * interceptGradient / x.length;
    for (let j = 0; j < d; j++) coefficients[j] -= 0.1 * (gradient[j] / x.length + 0.01 * coefficients[j]);
  }
  return {coefficients, intercept};
}

function linearPrediction(model, row) {
  return model.intercept + row.reduce((sum, value, j) => sum + value * model.coefficients[j], 0);
}

function forestFit(x, y, classification, random) {
  const d = x[0].length, importance = Array(d).fill(0);
  function build(indices, depth) {
    const n = indices.length, sum = indices.reduce((total, i) => total + y[i], 0);
    const squares = indices.reduce((total, i) => total + y[i] ** 2, 0);
    const parentLoss = Math.max(0, squares - sum * sum / n) * (classification ? 2 : 1);
    const leaf = {value: sum / n};
    if (depth >= LIMITS.depth || n < 2 * LIMITS.leaf || parentLoss < 1e-10) return leaf;
    const featurePool = Array.from({length: d}, (_, i) => i);
    for (let i = d - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [featurePool[i], featurePool[j]] = [featurePool[j], featurePool[i]];
    }
    let best = null, bestLoss = parentLoss;
    for (const feature of featurePool.slice(0, Math.max(1, Math.floor(Math.sqrt(d))))) {
      const sorted = [...indices].sort((a, b) => x[a][feature] - x[b][feature]);
      const unique = [];
      for (const index of sorted) if (!unique.length || x[index][feature] !== unique[unique.length - 1]) unique.push(x[index][feature]);
      if (unique.length < 2) continue;
      const positions = new Set();
      for (let k = 1; k <= Math.min(LIMITS.splits, unique.length - 1); k++) positions.add(Math.max(1, Math.min(unique.length - 1, Math.floor(k * unique.length / (Math.min(LIMITS.splits, unique.length - 1) + 1)))));
      const thresholds = [...positions].sort((a, b) => a - b).map(position => unique[position - 1] + (unique[position] - unique[position - 1]) / 2);
      let leftCount = 0, leftSum = 0, leftSquares = 0;
      for (const threshold of thresholds) {
        while (leftCount < n && x[sorted[leftCount]][feature] <= threshold) {
          const value = y[sorted[leftCount]];
          leftCount++; leftSum += value; leftSquares += value * value;
        }
        const rightCount = n - leftCount;
        if (leftCount < LIMITS.leaf || rightCount < LIMITS.leaf) continue;
        const rightSum = sum - leftSum;
        const loss = Math.max(0, leftSquares - leftSum * leftSum / leftCount + squares - leftSquares - rightSum * rightSum / rightCount) * (classification ? 2 : 1);
        if (loss < bestLoss - 1e-10) { bestLoss = loss; best = {feature, threshold}; }
      }
    }
    if (!best) return leaf;
    const left = [], right = [];
    for (const index of indices) (x[index][best.feature] <= best.threshold ? left : right).push(index);
    importance[best.feature] += parentLoss - bestLoss;
    return {feature: best.feature, threshold: best.threshold, left: build(left, depth + 1), right: build(right, depth + 1)};
  }
  const trees = Array.from({length: LIMITS.trees}, () => build(Array.from({length: x.length}, () => Math.floor(random() * x.length)), 0));
  return {trees, importance};
}

function forestPrediction(forest, row) {
  let sum = 0;
  for (const tree of forest.trees) {
    let node = tree;
    while (node.feature !== undefined) node = row[node.feature] <= node.threshold ? node.left : node.right;
    sum += node.value;
  }
  return sum / forest.trees.length;
}

function auc(actual, scores) {
  const positive = actual.reduce((sum, value) => sum + value, 0), negative = actual.length - positive;
  if (!positive || !negative) return null;
  const ordered = scores.map((score, index) => ({score, label: actual[index]})).sort((a, b) => a.score - b.score);
  let positiveRanks = 0;
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].score === ordered[start].score) end++;
    const averageRank = (start + 1 + end) / 2;
    for (let i = start; i < end; i++) if (ordered[i].label === 1) positiveRanks += averageRank;
    start = end;
  }
  return (positiveRanks - positive * (positive + 1) / 2) / (positive * negative);
}

function classificationMetrics(actual, predicted, scores) {
  let truePositive = 0, falsePositive = 0, falseNegative = 0, correct = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === predicted[i]) correct++;
    if (predicted[i] === 1 && actual[i] === 1) truePositive++;
    if (predicted[i] === 1 && actual[i] === 0) falsePositive++;
    if (predicted[i] === 0 && actual[i] === 1) falseNegative++;
  }
  const precision = truePositive / (truePositive + falsePositive) || 0, recall = truePositive / (truePositive + falseNegative) || 0;
  return {accuracy: correct / actual.length, precision, recall, f1: 2 * precision * recall / (precision + recall) || 0, roc_auc: auc(actual, scores)};
}

function regressionMetrics(actual, predicted) {
  const mean = actual.reduce((sum, value) => sum + value, 0) / actual.length;
  let absolute = 0, squared = 0, total = 0;
  for (let i = 0; i < actual.length; i++) { absolute += Math.abs(actual[i] - predicted[i]); squared += (actual[i] - predicted[i]) ** 2; total += (actual[i] - mean) ** 2; }
  return {mae: absolute / actual.length, rmse: Math.sqrt(squared / actual.length), r2: total > 0 ? 1 - squared / total : null};
}

function runComparison(message) {
  const started = performance.now(), dataset = validateDataset(message), classification = message.task === 'classification';
  const preprocessing = fitPreprocessing(dataset.train.x), x = transform(dataset.train.x, preprocessing), testX = transform(dataset.test.x, preprocessing);
  const y = dataset.train.y, actual = dataset.test.y, models = [], random = seededRandom(message.seed ?? 42);
  const baselineValue = classification ? (y.reduce((sum, value) => sum + value, 0) > y.length / 2 ? 1 : 0) : median(y);
  const baselinePredictions = actual.map(() => baselineValue);
  models.push({name: classification ? 'Majority baseline' : 'Median baseline', metrics: classification ? classificationMetrics(actual, baselinePredictions, baselinePredictions) : regressionMetrics(actual, baselinePredictions)});
  const linear = classification ? logisticFit(x, y) : ridgeFit(x, y);
  const linearScores = testX.map(row => classification ? sigmoid(linearPrediction(linear, row)) : linearPrediction(linear, row));
  models.push({name: classification ? 'Logistic regression' : 'Ridge regression', metrics: classification ? classificationMetrics(actual, linearScores.map(score => score >= 0.5 ? 1 : 0), linearScores) : regressionMetrics(actual, linearScores)});
  const forest = forestFit(x, y, classification, random), forestScores = testX.map(row => forestPrediction(forest, row));
  models.push({name: 'Random forest', metrics: classification ? classificationMetrics(actual, forestScores.map(score => score >= 0.5 ? 1 : 0), forestScores) : regressionMetrics(actual, forestScores)});
  const importanceTotal = forest.importance.reduce((sum, value) => sum + value, 0) || 1;
  return {
    task: message.task, target: message.target, features: [...dataset.features], train_rows: y.length, test_rows: actual.length,
    models, selected_model: 'Random forest', selection_method: 'Fixed illustrative model; the held-out metrics do not select or tune it.',
    sample_note: 'New models were trained in this browser on the bounded public demonstration sample. These are not the full-cohort benchmark results.',
    split: {...(dataset.split && typeof dataset.split === 'object' ? dataset.split : {}), method: dataset.split?.method || 'Predefined sampled holdout', preprocessing: 'Median imputation and scaling fit on training sample only.'},
    preprocessing, model_definitions: [
      {name: classification ? 'Majority baseline' : 'Median baseline', estimator: classification ? 'Most frequent training class' : 'Training-target median', parameters: {}},
      {name: classification ? 'Logistic regression' : 'Ridge regression', estimator: classification ? 'Full-batch gradient descent' : 'Centered regularized least squares', parameters: classification ? {epochs: 300, learning_rate: 0.1, l2: 0.01, class_weight: 'balanced', threshold: 0.5} : {alpha: 10, intercept_penalized: false}},
      {name: 'Random forest', estimator: classification ? 'Bootstrap classification trees; Gini splits' : 'Bootstrap regression trees; squared-error splits', parameters: {n_estimators: LIMITS.trees, max_depth: LIMITS.depth, min_samples_leaf: LIMITS.leaf, max_features: 'floor(sqrt(features))', candidate_splits_per_feature: LIMITS.splits, class_weight: 'none', random_seed: Number.isInteger(message.seed) ? message.seed : 42}},
    ],
    feature_importance: dataset.features.map((feature, i) => ({feature, importance: forest.importance[i] / importanceTotal})).sort((a, b) => b.importance - a.importance),
    predictions: actual.slice(0, 10).map((value, i) => ({row: i, actual: value, predicted: classification ? (forestScores[i] >= 0.5 ? 1 : 0) : forestScores[i]})),
    runtime_ms: Math.round((performance.now() - started) * 100) / 100,
    provenance: {execution: 'Web Worker on the visitor device', source: dataset.source || null, sample_sha256: dataset.sample_sha256 || null, seed: Number.isInteger(message.seed) ? message.seed : 42},
    ...(classification ? {classes: [0, 1], positive_class: 1, threshold: 0.5,
      class_counts: {train: {negative: y.filter(value => value === 0).length, positive: y.filter(value => value === 1).length},
                     test: {negative: actual.filter(value => value === 0).length, positive: actual.filter(value => value === 1).length}}} : {}),
    limitations: [
      'This bounded sample is for an interactive historical experiment; it does not establish current business performance.',
      'Browser implementations and parameters differ from the full Python benchmark. Compare metrics only within the same experiment.',
      'Feature availability and label-time cutoffs depend on the prepared sample metadata; arbitrary data are not accepted here.',
      classification ? 'Late orders may be rare. Read precision, recall and F1 alongside accuracy; scores are not calibrated probabilities.' : 'The learned regressor may underperform the median baseline; this experiment does not guarantee an improvement.',
      'Repeated viewing of the same holdout is exploratory; it must not be used to tune a model and then claim an untouched final test.',
      ...(classification ? [`The holdout contains ${actual.filter(value => value === 1).length} positive cases out of ${actual.length}; rare-class metrics can be unstable.`] : []),
      ...(Array.isArray(dataset.limitations) ? dataset.limitations.filter(value => typeof value === 'string').slice(0, 8) : []),
    ],
  };
}

self.onmessage = event => {
  const id = event.data?.id;
  try { self.postMessage({id, result: runComparison(event.data)}); }
  catch (error) { self.postMessage({id, error: error instanceof Error ? error.message : 'The sample comparison could not be completed.'}); }
};
