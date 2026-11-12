'use strict';

(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const main = $('#main');
  const state = {workspace: null, replay: false, config: {}, route: 'project', answer: null, search: [], busy: false, prediction: null, reviewSearch: '', apiWorkspace: null, sampleResults: {}, sampleErrors: {}, samplePending: null, studies: {status:'idle',review:null,retrieval:null,generation:null,errors:{}}, studyTab:'review', studyCohort:'test', studyQuestionSplit:'test', studyQuestionLanguage:'all', studyQuestionKind:'all', studyCaseId:'', studyRetrievalMethod:'lexical', studyGenerationSplit:'test', studyGenerationCaseId:'', studyGenerationMethod:'grounded_validated', semantic:{status:'idle',progress:'',error:null,query:'',mode:'dense',result:null,pending:false}, generation:{status:'idle',progress:'',error:null,query:'Why can accuracy be misleading for late delivery?',result:null,retrieval:null,pending:false}};
  let sampleRequestId = 0;
  let sampleWorker = null;
  let samplePayload = null;
  let semanticClient = null;
  let semanticRequestId = 0;
  let generationClient = null;
  let generationRequestId = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const number = (value, digits = 0) => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString('en-US', {maximumFractionDigits: digits}) : '—';
  const percent = value => Number.isFinite(Number(value)) && value !== null ? `${(Number(value) * 100).toFixed(1)}%` : '—';
  const labels = {project: 'Project overview', explore: 'Data exploration', models: 'Model evaluation', forecast: 'Time-series forecasting', segments: 'Segments & unusual profiles', reviews: 'Customer review analysis', knowledge: 'Document library', ask: 'Evidence reports', studies:'Research studies'};
  const paths = {
    explore: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="13" y="3" width="6" height="6" rx="1"/><rect x="3" y="13" width="6" height="6" rx="1"/><rect x="13" y="13" width="6" height="6" rx="1"/>',
    models: '<path d="m4 16 4-6 5 3 5-8"/><circle cx="4" cy="16" r="2"/><circle cx="8" cy="10" r="2"/><circle cx="13" cy="13" r="2"/><circle cx="18" cy="5" r="2"/>',
    forecast: '<path d="M3 3v16h16M5 14l4-5 4 3 6-7"/><path d="M15 5h4v4"/>',
    segments: '<circle cx="7" cy="7" r="3"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="4"/><circle cx="18" cy="17" r="1"/>',
    reviews: '<path d="M3 4h16v12H9l-5 4v-4H3zM7 8h8M7 12h5"/>',
    knowledge: '<path d="M5 3h9l4 4v13H5zM14 3v5h4M8 12h7M8 16h5"/>',
    ask: '<path d="M3 4h16v12H9l-5 4v-4H3zM7 8h8M7 12h5"/>',
    studies: '<path d="M4 3h14v17H4zM7 7h8M7 11h4M7 15l2 2 5-5"/>',
    project: '<path d="M4 18 18 4M7 4h11v11M4 5v13h13"/>',
    upload: '<path d="M11 15V3m-4 4 4-4 4 4M3 14v5h16v-5"/>',
    shield: '<path d="m11 2 8 3v6c0 5-8 9-8 9S3 16 3 11V5zM7 10l3 3 5-6"/>',
    database: '<ellipse cx="11" cy="5" rx="8" ry="3"/><path d="M3 5v12c0 4 16 4 16 0V5M3 11c0 4 16 4 16 0"/>',
  };
  const icon = name => `<svg viewBox="0 0 22 22" aria-hidden="true">${paths[name] || paths.explore}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(element => element.innerHTML = icon(element.dataset.icon));

  function toast(message, error = false) {
    const element = $('#toast');
    element.textContent = message; element.hidden = false; element.className = `toast${error ? ' error' : ''}`;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => element.hidden = true, 6000);
  }
  function source() { return state.workspace?.source || {kind: 'unknown', label: 'Source not specified'}; }
  function results() { return state.workspace?.results || {}; }
  function profile() { return state.workspace?.profile || {}; }
  function sourceKind() { return source().kind === 'synthetic' ? 'SYNTHETIC DEMONSTRATION' : source().kind === 'public' ? 'PUBLIC HISTORICAL DATA' : 'LOCAL DATASET'; }
  function button(action, title, primary = false, extra = '') { return `<button type="button" class="button${primary ? ' primary' : ''}" data-action="${action}" ${extra}>${esc(title)}</button>`; }
  function heading(eyebrow, title, description, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`; }
  function strip() { const p = profile(); return `<div class="workspace-strip"><span class="dataset-icon">${icon('database')}</span><div><div class="workspace-name">${esc(state.workspace?.name || 'Analysis workspace')}</div><div class="workspace-source">${esc(source().label)} · ${number(p.rows)} rows / ${number(p.columns ?? p.column_count)} columns</div></div><span class="source-badge">${esc(sourceKind())}</span></div>`; }
  function note(text) { return `<div class="provenance">${icon('shield')}<p>${esc(text)}</p></div>`; }
  function limits(items) { return (items || []).length ? `<details class="json-details"><summary>Assumptions and limitations (${items.length})</summary><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>` : ''; }
  function details(title, value) { return `<details class="json-details"><summary>${esc(title)}</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`; }
  function empty(title, text) { return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(text)}</div>`; }
  function metric(label, value, caption, glyph = 'explore') { return `<div class="metric"><div class="metric-top"><span>${esc(label)}</span><span class="metric-icon">${icon(glyph)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-bottom">${esc(caption)}</div></div>`; }
  function table(rows, columns = null, max = 15) {
    if (!rows?.length) return empty('No rows available', 'Load a dataset or run the relevant experiment.');
    const keys = columns || Object.keys(rows[0]);
    const cell = value => esc(typeof value === 'number' ? number(value, 3) : value !== null && typeof value === 'object' ? JSON.stringify(value) : value ?? '—');
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${keys.map(key => `<th scope="col">${esc(key.replaceAll('_', ' '))}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, max).map(row => `<tr>${keys.map(key => `<td${typeof row[key] === 'string' && row[key].length > 70 ? ' class="text-wrap"' : ''}>${cell(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function panel(title, subtitle, content, tag = '', footer = '') { return `<section class="panel"><div class="panel-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p class="panel-subtitle">${esc(subtitle)}</p>` : ''}</div>${tag ? `<span class="panel-tag">${esc(tag)}</span>` : ''}</div><div class="panel-body">${content}</div>${footer ? `<div class="panel-foot">${esc(footer)}</div>` : ''}</section>`; }
  function bars(rows, label = 'category', value = 'count') {
    if (!rows?.length) return empty('No distribution available', 'This dataset does not contain the selected fields.');
    const max = Math.max(1, ...rows.map(row => Number(row[value]) || 0));
    return `<div class="bars">${rows.slice(0, 8).map(row => `<div class="bar-row"><div class="bar-row-head"><span>${esc(row[label])}</span><strong>${number(row[value], value === 'importance' ? 3 : 0)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Number(row[value]) / max * 100)}%"></div></div></div>`).join('')}</div>`;
  }
  function lineChart(rows, series = [{key: 'count', label: 'Observed', color: '#167a6e'}], height = 215) {
    if (!rows?.length) return empty('No time series available', 'Provide a complete date column to explore changes over time.');
    const points = rows.filter(row => series.some(line => Number.isFinite(Number(row[line.key])) && row[line.key] !== null));
    if (!points.length) return empty('No numeric values', 'The series does not have numeric chart values.');
    const width = 700, left = 42, right = 18, top = 18, bottom = 30;
    const allValues = points.flatMap(row => series.map(line => row[line.key] === null || row[line.key] === undefined ? NaN : Number(row[line.key]))).filter(Number.isFinite);
    const min = Math.min(0, ...allValues), max = Math.max(1, ...allValues), range = max - min || 1;
    const x = index => left + index / Math.max(1, points.length - 1) * (width - left - right);
    const y = value => height - bottom - (value - min) / range * (height - top - bottom);
    const grid = Array.from({length: 5}, (_, i) => { const value = min + range * i / 4; return `<line class="grid-line" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/><text x="${left - 9}" y="${y(value) + 3}" text-anchor="end">${number(value, 0)}</text>`; }).join('');
    const lines = series.map(line => {
      let active = false;
      const d = points.map((row, i) => { const value = row[line.key]; if (value === null || value === undefined || !Number.isFinite(Number(value))) { active = false; return ''; } const command = active ? 'L' : 'M'; active = true; return `${command}${x(i).toFixed(1)},${y(Number(value)).toFixed(1)}`; }).join(' ');
      return `<path d="${d}" fill="none" stroke="${line.color}" stroke-width="${line.width || 2}" ${line.dashed ? 'stroke-dasharray="5 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');
    const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
    return `<div class="chart-container"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(series.map(line => line.label).join(' and '))} time series">${grid}${lines}${ticks.map(i => `<text x="${x(i)}" y="${height - 5}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${esc(String(points[i].date || i).slice(0, 10))}</text>`).join('')}</svg><div class="chart-caption">${series.map(line => `<span class="legend-item"><span class="legend-line" style="background:${line.color}"></span>${esc(line.label)}</span>`).join('')}</div></div>`;
  }
  function modelTable(result) {
    const models = result?.models || [];
    if (!models.length) return empty('No experiment recorded yet', state.replay ? 'This saved demonstration does not include this experiment.' : 'Run an experiment to compare fixed models against a simple baseline.');
    const metrics = [...new Set(models.flatMap(model => Object.keys(model.metrics || {})))];
    return table(models.map(model => Object.fromEntries([['model', model.name], ...metrics.map(key => [key, model.metrics[key] == null ? '—' : number(model.metrics[key], 4)])])), ['model', ...metrics]);
  }
  function taskResult(result) {
    if (!result) return '';
    const split = result.split || {};
    return `<div class="result-block" id="recorded-${esc(result.task)}" tabindex="-1">${panel(`${result.task === 'classification' ? 'Classification' : 'Regression'} comparison`, `Target: ${result.target} · ${split.method || 'Recorded split'}`, modelTable(result), 'FULL-DATA RECORDED METRICS')}
    <div class="grid-equal space-top">${panel('Inputs and validation', 'Inspect what the models were allowed to see.', `<dl class="stat-list"><div><dt>Training rows</dt><dd>${number(result.train_rows)}</dd></div><div><dt>Holdout rows</dt><dd>${number(result.test_rows)}</dd></div></dl><div class="stack-list">${(result.features || []).map(feature => `<span class="stack-chip">${esc(feature)}</span>`).join('')}</div>${details('Split and feature exclusions', {split, excluded_features: result.excluded_features, selection_method: result.selection_method})}${details('Model definitions', result.model_definitions || [])}`, 'TIME BOUNDARY')}${panel('Feature importance', 'Model associations, not evidence of physical causation.', bars(result.feature_importance || [], 'feature', 'importance'), 'PREDECLARED MODEL')}</div>${limits(result.limitations)}${details('Run provenance', result.provenance || {data_provenance: result.data_provenance})}${details('Holdout examples', result.predictions || [])}</div>`;
  }

  function explore() {
    const p = profile(), charts = p.charts || {}, columns = p.column_details || (Array.isArray(p.columns) ? p.columns : []);
    return heading('01 / Data exploration', 'Start with the evidence.', 'Inspect the shape, quality and provenance of your data before asking a model to learn from it.', `${button('load-olist', 'Open Olist example')}${button('reset-demo', state.replay ? 'Local training required' : 'Load synthetic demo', false, state.replay ? 'disabled' : '')}${button('upload-dataset', 'Upload CSV', true, state.replay ? 'disabled' : '')}`) + strip() +
      `<div class="metrics">${metric('Dataset rows', number(p.rows), 'Records in the active workspace', 'database')}${metric('Columns', number(typeof p.columns === 'number' ? p.columns : p.column_count), `${number(p.numerical?.length)} numeric / ${number(p.categorical?.length)} categorical`)}${metric('Missing cells', number(p.missing_cells), 'Missing values retained for inspection', 'shield')}${metric('Duplicate rows', number(p.duplicate_rows), 'Exact duplicates across all fields', 'models')}</div>` +
      `<div class="grid-two">${panel('Order activity', source().kind === 'public' ? 'Daily purchase counts in the delivered-order modeling cohort.' : 'Observed daily row counts in the dataset.', lineChart((charts.daily_orders || []).slice(-90)), 'LAST 90 RECORDED DAYS', 'Counts describe the supplied extract. They do not establish latent customer demand.')}${panel('Category mix', 'Top recorded categories.', bars(charts.categories), 'DATA DISTRIBUTION')}</div>` +
      `<div class="section-heading"><h2>A closer look at the records</h2><p>First ${Math.min(12, p.preview?.length || 0)} rows · scroll to inspect all fields</p></div><section class="panel">${table(p.preview, null, 12)}</section>` +
      details('Column quality report', columns) + details('Numerical summaries', p.summary || {}) + note(source().description || 'Confirm the provenance and permitted use of uploaded data.');
  }
  function sampleResult(task) {
    const pending = state.samplePending?.task === task;
    const result = state.sampleResults[task];
    const failure = state.sampleErrors[task];
    if (pending) return `<div class="sample-status" role="status"><span class="loader"></span><p>Loading the Olist sample and training three models in your browser…</p></div>`;
    if (failure) return `<div class="sample-error" role="alert">${esc(failure)} You can retry the comparison.</div>`;
    if (!result) return '';
    return `<section class="sample-result" id="sample-${task}" tabindex="-1"><div class="eyebrow">LIVE BROWSER SAMPLE RESULT</div><h3>${task === 'regression' ? 'Delivery-duration' : 'Late-delivery'} comparison complete</h3><p>${number(result.train_rows)} earlier training orders · ${number(result.test_rows)} later holdout orders · seed 42 · ${number(result.runtime_ms / 1000, 2)} seconds. ${task === 'regression' ? 'MAE and RMSE are in days.' : 'Precision and recall use late delivery as the positive class.'}</p>${modelTable(result)}${details('Sample split, algorithms and provenance', {split:result.split,model_definitions:result.model_definitions,provenance:result.provenance})}${limits(result.limitations)}</section>`;
  }
  function comparisonCard(task, title, description) {
    const target = results()[task]?.target || (task === 'classification' ? 'delivery_late' : 'delivery_days');
    const browserTraining = state.replay && source().kind === 'public';
    const unavailable = state.replay && !browserTraining;
    return `<section class="model-card"><div class="eyebrow">${task === 'classification' ? 'BINARY CLASSIFICATION' : 'REGRESSION'}</div><h2>${title}</h2><p>${description}</p>${browserTraining ? '<p class="sample-explainer">Train on 1,600 historical Olist orders and evaluate on 400 later orders, entirely in your browser. The full-data benchmark stays separate below.</p>' : unavailable ? '<p class="sample-explainer">This workspace contains recorded comparisons. Open the Olist example to train a small sample in your browser.</p>' : ''}<form data-form="train-${task}" class="model-controls"><div class="field"><label for="${task}-target">TARGET COLUMN${browserTraining ? ' · FIXED DEMO TARGET' : ''}</label><input id="${task}-target" name="target" value="${esc(target)}" required maxlength="128" ${state.replay ? 'readonly' : ''}></div>${unavailable ? button('view-comparison','View recorded comparison',true,`data-task="${task}"`) : `<button class="button primary" ${state.samplePending ? 'disabled' : ''}>${state.samplePending?.task === task ? 'Training sample…' : browserTraining ? 'Run sample comparison' : 'Run comparison'}</button>`}</form>${sampleResult(task)}</section>`;
  }
  function models() {
    return heading('02 / Model evaluation', 'Compare. Then explain.', 'Train a small browser experiment or inspect the recorded full-data study. Each result shows its own sample, validation split and algorithms.', button('export-results', 'Export results')) + strip() +
      `<div class="model-intro">${comparisonCard('classification','Predict an outcome','Compare a majority baseline, logistic regression and a random forest on a binary target.')}${comparisonCard('regression','Estimate a quantity','Compare a median baseline, ridge regression and a random forest on a numeric target.')}</div>` +
      inferencePanel() + (results().classification || results().regression ? taskResult(results().classification) + taskResult(results().regression) : panel('Your experiment results', '', empty('Ready when your data is', 'Run a comparison above. Metrics and model assumptions will appear here.'))) +
      note('The initial delivery workflow excludes known post-outcome fields. Column-name checks cannot prove that arbitrary uploaded data are free from leakage. Confirm the prediction-time availability of every input.');
  }
  function forecast() {
    const f = results().forecast;
    const form = state.replay ? `<p class="sample-explainer">This is a saved historical forecast. Full-series retraining runs in the local Python app.</p>${button('view-forecast','View recorded forecast',true)}` : `<form data-form="forecast" class="model-controls"><div class="field"><label for="forecast-date">DATE COLUMN</label><input id="forecast-date" name="date_column" value="${esc(f?.date_column || 'purchase_date')}" maxlength="128" required></div><button class="button primary">Run forecast</button></form>`;
    let html = heading('03 / Time series', 'Look ahead, with context.', source().kind === 'public' ? 'Historical all-status order counts, January 2017–August 2018. This series differs from the delivered-order modeling cohort.' : 'Forecast daily row counts using only earlier observations. Compare the learned model with a weekly seasonal baseline.') + strip() + panel('Forecast setup', 'At least 84 calendar days are required. Verify that the extract contains complete history.', form, '14-DAY OUTPUT');
    if (!f) return html + panel('Forecast results', '', empty('No forecast recorded', 'Run a forecast above to view the rolling one-day backtest and 14-day recursive projection.'));
    const joined = [...(f.history || []).slice(-35).map(row => ({date: row.date, observed: row.count})), ...(f.forecast || []).map(row => ({...row, observed: null}))];
    html += `<div class="space-top" id="recorded-forecast" tabindex="-1">${panel('Observed history and projection', 'Future values are model output, not observed orders.', lineChart(joined, [{key:'observed', label:'Observed', color:'#167a6e'}, {key:'predicted',label:'Recursive forecast',color:'#5b89a6',dashed:true}, {key:'lower',label:'Exploratory lower band',color:'#bbc8bd',width:1}, {key:'upper',label:'Exploratory upper band',color:'#bbc8bd',width:1}]), '14 DAYS', f.interval?.warning || '')}</div>`;
    html += `<div class="grid-equal space-top">${panel('Rolling one-day backtest', 'Recorded observations become available one day at a time.', lineChart(f.backtest, [{key:'actual',label:'Actual',color:'#167a6e'},{key:'predicted',label:'Ridge prediction',color:'#5b89a6'},{key:'seasonal_naive',label:'Weekly naive',color:'#bbab7d',dashed:true}]), '28-DAY HOLDOUT')}${panel('Baseline comparison', 'These metrics evaluate one-day predictions, not the full recursive horizon.', modelTable(f), 'MAE / RMSE')}</div>` + details('Forecast values and bands', f.forecast) + details('Validation and interval method', {split:f.split, interval:f.interval, model_definitions:f.model_definitions}) + limits(f.limitations);
    return html;
  }
  function segments() {
    const s = results().segments;
    let html = heading('04 / Unsupervised exploration', 'Find structure. Question outliers.', 'Explore recorded numeric profiles with K-means and Isolation Forest. Full-data clustering runs in the local app; these results remain available to inspect.', button(state.replay ? 'view-segments' : 'run-segments', state.replay ? 'View recorded profiles' : 'Analyze profiles', true)) + strip();
    if (!s) return html + panel('Profile analysis', '', empty('No analysis recorded', 'Analyze profiles to inspect clusters and unusual numeric records.'));
    html += `<div class="metrics" id="recorded-segments" tabindex="-1">${metric('Profiles analyzed', number(s.rows), 'Rows in the active dataset')}${metric('Clusters', number(s.cluster_count), 'Arbitrary K-means identifiers', 'segments')}${metric('Silhouette', number(s.silhouette, 3), 'Descriptive separation score', 'models')}${metric('Unusual profiles', number(s.anomaly_count), 'Isolation Forest flags', 'shield')}</div>`;
    html += `<div class="grid-equal">${panel('Cluster sizes', 'Cluster labels are identifiers, not business categories.', bars((s.clusters || []).map(row => ({category:`Cluster ${row.cluster}`,count:row.count}))), 'STANDARDIZED INPUTS')}${panel('Analysis inputs', 'Numeric inputs are median-imputed and standardized.', `<div class="stack-list">${(s.features || []).map(feature=>`<span class="stack-chip">${esc(feature)}</span>`).join('')}</div>${details('Cluster mean profiles', s.clusters || [])}${details('Algorithm and exclusions', {algorithm:s.algorithm,excluded_features:s.excluded_features})}`, 'EXPLORATORY')}</div>`;
    html += panel('Records to investigate', 'Highest unusualness scores; not labeled fraud or equipment faults.', table((s.anomalies || []).map(row => ({row:row.row,score:row.score,flagged:row.flagged,...row.values}))), 'TOP RECORDED SCORES') + limits(s.limitations);
    return html;
  }
  function documentCards(documents) {
    return `<div class="document-list">${documents.map(doc => `<article class="document"><div class="doc-icon">${icon('knowledge')}</div><div><h3>${esc(doc.title || doc.filename)}</h3><p>${esc(doc.description || doc.source || 'Local document')}</p><div class="document-meta"><span>${esc(doc.filename || doc.id)}</span><span>·</span><span>${number(doc.chunks)} passages</span></div>${doc.excerpts ? details('Preview source text', doc.excerpts) : ''}</div></article>`).join('')}</div>`;
  }
  function knowledge() {
    return heading('06 / Grounded retrieval', 'Keep the source in sight.', state.replay ? 'Search public review excerpts and supplied documentation with ranked keyword retrieval. Sources and passages remain visible.' : 'Search local documents with TF-IDF lexical retrieval. Sources and passages remain visible.', button('upload-knowledge', 'Add document', true, state.replay ? 'disabled' : '')) +
      `<form data-form="search" class="knowledge-search"><label class="sr-only" for="document-search">Search documents</label><input class="search-input" id="document-search" name="query" placeholder="Search for validation, source data, policy…" value="${esc(state.searchQuery || '')}" required minlength="2"><button class="button primary">Search documents</button></form>` +
      documentCards(state.workspace.documents || []) + (state.searchDone ? `<div class="section-heading"><h2>Retrieved passages</h2><p>${state.search.length} matches · ${state.replay ? 'ranked lexical matches' : 'TF-IDF lexical similarity'}</p></div><div class="search-results">${state.search.length ? state.search.map(hit => `<article class="search-result"><h3>${esc(hit.title)}</h3><p>${esc(hit.text)}</p><div class="search-result-meta">${esc(hit.section || '')} · ${esc(hit.source)}${hit.score !== undefined ? ` · score ${number(hit.score, 3)}` : ''}</div></article>`).join('') : empty('No supporting passage found', 'Try a more specific term or add a document that contains the information.')}</div>` : '') + note('The bundled operations policy is fictional example content. It is not a policy of the public dataset publisher or any real company. Retrieved text is treated as evidence, never as instructions to execute.');
  }
  function answerMarkup(response) {
    if (!response) return '';
    const calls = response.tool_calls || [], sources = response.sources || [];
    return `<div class="answer"><div class="answer-title"><span class="status-dot"></span>${response.mode === 'optional_llm' ? 'OPTIONAL MODEL SYNTHESIS' : 'EVIDENCE REPORT · NO LLM GENERATION'}</div><div class="answer-content">${esc(response.answer || 'No answer was returned.')}</div>${sources.length ? `<div class="evidence-list">${sources.map((item,i)=>`<div class="evidence-item"><strong>[${i+1}] ${esc(item.title || item.source || item.id)}</strong><br>${esc(item.section || '')} · ${item.url && /^https?:\/\//.test(item.url) ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.source || item.id)} ↗</a>` : esc(item.source || item.id)}</div>`).join('')}</div>` : ''}${details('Numerical and retrieval evidence',response.evidence || [])}${details('Tool trace',calls)}${details('Workflow',response.workflow || {})}${limits(response.limitations)}</div>`;
  }
  function ask() {
    const examples = state.workspace.examples || [];
    const suggestions = ['Summarize this Olist workspace', 'Compare the delivery model results', 'What do customer reviews say about delivery problems?', 'Show the historical order forecast'];
    return heading('07 / Ask DataPilot', 'An answer you can inspect.', 'Ask about the active dataset, recorded metrics, reviews or supplied documents. The browser builds deterministic reports from actual artifacts.', `${button('combined-report', 'Generate combined report', true)}${button('download-report', 'Download report')}`) +
      `<div class="ask-layout"><section class="panel"><form class="ask-form" data-form="ask"><label class="code-label" for="question">YOUR QUESTION</label><textarea id="question" name="question" maxlength="2000" minlength="2" required placeholder="What do the recorded model results show?">${esc(state.question || '')}</textarea><div class="ask-form-footer"><p>${state.replay ? 'Live browser evidence reports. No LLM or API key; full-data training uses the local app.' : 'No API key required. Model generation is optional and off by default.'}</p><button class="button primary">Inspect evidence <span aria-hidden="true">↗</span></button></div><div class="suggestions">${suggestions.slice(0,4).map((question,i)=>`<button type="button" class="suggestion" data-suggestion="${i}">${esc(question)}<span aria-hidden="true">↗</span></button>`).join('')}</div></form>${answerMarkup(state.answer)}</section><aside>${panel('The evidence path','What happens behind an answer.', [['01','Understand the question','Choose a supported read-only analysis route.'],['02','Read tools and sources','Use stored metrics, profile facts and retrieved passages.'],['03','Compose and validate','Keep source references visible and acknowledge missing evidence.']].map(([n,title,text])=>`<div class="method-step"><span class="method-number">${n}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join(''), 'BOUNDED WORKFLOW')}${note('A model association does not establish causality. Unsupported questions should produce a limitation, not an invented explanation.')}</aside></div>`;
  }
  function repoButton(className = 'button') {
    const url = state.config.github_url;
    return url && /^https:\/\/github\.com\//.test(url) ? `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>` : `<span class="tag neutral">Repository publication in progress</span>`;
  }

  const datasetUrl = 'https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce';
  function attribution() {
    if(source().kind !== 'public') return '';
    return `<div class="source-attribution"><strong>Public data, visible provenance.</strong> Olist Brazilian e-commerce · historical 2016–2018 records · <a href="${datasetUrl}" target="_blank" rel="noopener noreferrer">Dataset and attribution ↗</a> · CC BY-NC-SA 4.0. This is an independent portfolio demonstration, not an Olist service.</div>`;
  }
  function inferencePanel() {
    const bundle=state.workspace.browser_models;
    if(!bundle?.classification || !bundle?.regression) return '';
    const c=bundle.classification;
    const defaults={order_value:120,freight_value:20,promised_days:14,items_count:1};
    const names={order_value:'Order value (BRL)',freight_value:'Freight (BRL)',promised_days:'Promised days',items_count:'Number of items'};
    const inputs=(c.features||Object.keys(defaults)).map(name=>`<div class="field"><label for="predict-${esc(name)}">${esc(names[name]||name)}</label><input id="predict-${esc(name)}" type="number" name="${esc(name)}" min="0" step="${name==='items_count'?'1':'0.01'}" value="${esc(state.predictionInputs?.[name] ?? defaults[name] ?? 0)}" required></div>`).join('');
    let prediction='';
    if(state.prediction) prediction=`<div class="prediction-output"><div><span>Uncalibrated late-delivery score</span><strong>${number(state.prediction.probability,3)}</strong><small>Logistic regression · ${state.prediction.probability >= (c.threshold ?? .5) ? 'late flag' : 'on-time flag'} at threshold ${number(c.threshold ?? .5,2)}</small></div><div><span>Delivery-duration estimate</span><strong>${number(state.prediction.duration,2)} <small>days</small></strong><small>Ridge regression · historical model</small></div></div>${note(state.prediction.warning || 'This balanced classifier score is not a calibrated probability. These illustrative historical models were trained on delivered orders and do not represent canceled or undelivered orders.')}`;
    return `<section class="panel inference-panel"><div class="panel-head"><div><h2>Try an order prediction</h2><p class="panel-subtitle">Real trained linear models run in your browser. Inputs stay on your device.</p></div><span class="panel-tag">LIVE BROWSER INFERENCE</span></div><div class="panel-body"><form data-form="predict-order"><div class="prediction-fields">${inputs}</div><button class="button primary">Calculate prediction</button></form>${prediction}${details('Interactive model provenance',{classification:c.model||c.name||'Logistic regression',regression:bundle.regression.model||bundle.regression.name||'Ridge regression',cutoff:c.cutoff,metrics:c.metrics,limitations:c.limitations})}</div></section>`;
  }
  function linearPredict(model, values) {
    const coefficients=Array.isArray(model.coefficients?.[0])?model.coefficients[0]:model.coefficients;
    const intercept=Array.isArray(model.intercept)?model.intercept[0]:model.intercept;
    let result=Number(intercept||0);
    (model.features||[]).forEach((name,i)=>{
      let value=values[name] === null || values[name] === undefined || values[name] === '' ? NaN : Number(values[name]);
      if(!Number.isFinite(value)) value=Number(model.impute?.[i] ?? 0);
      result+=Number(coefficients?.[i]||0)*(value-Number(model.mean?.[i]||0))/Number(model.scale?.[i]||1);
    });
    if(!Number.isFinite(result)) throw new Error('The model artifact could not produce a finite result.');
    return result;
  }
  function predictOrder(values) {
    try {
      const bundle=state.workspace.browser_models;
      if(!bundle) throw new Error('No browser inference artifact is available for this workspace.');
      const cleaned={};
      for(const name of bundle.classification.features) {
        const value=Number(values[name]);
        if(!Number.isFinite(value)||value<0||(name==='items_count'&&(!Number.isInteger(value)||value<1))) throw new Error('Use nonnegative amounts and days, and a whole item count of at least one.');
        cleaned[name]=value;
      }
      const logit=linearPredict(bundle.classification,cleaned);
      const probability=logit>=0?1/(1+Math.exp(-logit)):Math.exp(logit)/(1+Math.exp(logit));
      const duration=linearPredict(bundle.regression,cleaned);
      const outside=(bundle.classification.features||[]).filter((name,i)=>{
        const range=bundle.classification.feature_ranges?.[name] || bundle.classification.feature_ranges?.[i];
        return range && (cleaned[name]<Number(range.min??range[0])||cleaned[name]>Number(range.max??range[1]));
      });
      state.predictionInputs=cleaned;
      state.prediction={probability,duration,warning:outside.length?`Outside recorded training ranges: ${outside.join(', ')}. Extrapolated estimates may be unreliable.`:duration<0?'The regression returned a negative duration. This is an invalid physical prediction and an example of model limitations.':null};
    } catch(error) { toast(error.message,true); }
  }
  function reviewAnalysis() { return state.workspace.review_analysis?.analysis || state.workspace.review_analysis || {}; }
  function reviewChunks() { return (state.workspace.knowledge_chunks||[]).filter(chunk=>/review/i.test(`${chunk.source} ${chunk.title}`)); }
  function reviews() {
    const a=reviewAnalysis();
    let html=heading('05 / Review analysis','Listen to the recorded feedback.','Compare rating-group classification and inspect recurring complaint keywords in Portuguese customer reviews. Ratings are proxies, not human sentiment labels.')+strip();
    if(!a.models?.length)return html+panel('Review analysis','',empty('No review experiment available','Open the public Olist workspace to inspect review text and measured classification results.'), '', '')+button('load-olist','Open Olist example',true);
    const themes=a.complaint_themes||[];
    html+=`<div class="metrics">${metric('Text reviews',number(a.labeled_rows??a.rows),'Nonempty reviews in this experiment','knowledge')}${metric('Rating groups',number(a.labels?.length||3),'Negative 1–2 / neutral 3 / positive 4–5','segments')}${metric('Training reviews',number(a.train_rows??a.split?.train_rows),'Earlier review period','models')}${metric('Holdout reviews',number(a.test_rows??a.split?.test_rows),'Later review period','shield')}</div>`;
    html+=`<div class="grid-equal">${panel('Rating-group model comparison','Vocabulary and model fit earlier reviews only.',modelTable(a),'HELD-OUT METRICS')}${panel('Recurring complaint keywords','Counts in low-rating text reviews; themes may overlap.',bars(themes.map(row=>({category:row.theme,count:row.count}))),'DESCRIPTIVE THEMES')}</div>`;
    const matrix=a.confusion_matrix||[];
    if(matrix.length)html+=panel('Confusion matrix','Rows are actual rating groups; columns are predicted groups.',table(matrix.map((row,i)=>Object.fromEntries([['actual',a.labels?.[i]||i],...row.map((value,j)=>[a.labels?.[j]||String(j),value])]))),'CLASSIFICATION ERRORS');
    html+=`<form data-form="review-search" class="knowledge-search"><label class="sr-only" for="review-search">Search review excerpts</label><input class="search-input" id="review-search" name="query" placeholder="Search entrega, atraso, qualidade…" value="${esc(state.reviewSearch)}"><button class="button primary">Search excerpts</button></form>`;
    const query=state.reviewSearch.trim();
    let chunks=query?rankedSearch(query,reviewChunks()):reviewChunks().slice(0,6);
    if(!chunks.length && !query) chunks=(a.examples||[]).slice(0,6).map((row,i)=>({id:i,title:`Rating ${row.rating} / ${row.label||row.group||''}`,text:row.text,source:'Olist review excerpt',section:'Published source sample'}));
    html+=searchMarkup(chunks)+details('Review experiment design',{split:a.split,labels:a.labels,method:a.method,theme_method:a.theme_method})+limits(a.limitations)+attribution();
    return html;
  }
  function normalizedTerms(value) {
    return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[\p{L}\p{N}]{2,}/gu)||[];
  }
  function rankedSearch(query,corpus=null,limit=6) {
    const chunks=corpus || state.workspace.knowledge_chunks || [];
    let terms=[...new Set(normalizedTerms(query))];
    const translations={delivery:['entrega','atraso'],late:['atraso','demora'],shipping:['frete','entrega'],quality:['qualidade','defeito'],refund:['reembolso','devolucao'],damaged:['quebrado','avariado'],reviews:['avaliacao','entrega']};
    terms=[...new Set(terms.flatMap(term=>[term,...(translations[term]||[])]))];
    const stop=new Set(['the','and','what','which','this','that','about','with','from','does','have','show','tell','can','you','customer','customers','say']);
    terms=terms.filter(term=>!stop.has(term));
    if(!terms.length)return [];
    const docs=chunks.map(chunk=>({chunk,tokens:normalizedTerms(`${chunk.title||''} ${chunk.section||''} ${chunk.text||''}`)}));
    const average=docs.reduce((sum,row)=>sum+row.tokens.length,0)/Math.max(1,docs.length);
    const frequencies=Object.fromEntries(terms.map(term=>[term,docs.filter(row=>row.tokens.includes(term)).length]));
    return docs.map(({chunk,tokens})=>{
      let score=0;
      for(const term of terms){const count=tokens.filter(token=>token===term).length;if(!count)continue;const idf=Math.log(1+(docs.length-frequencies[term]+.5)/(frequencies[term]+.5));score+=idf*count*2.2/(count+1.2*(.25+.75*tokens.length/Math.max(1,average)));}
      return {...chunk,score};
    }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
  }
  function searchMarkup(chunks) {
    if(!chunks?.length)return empty('No supporting excerpt found','Try a Portuguese source term such as entrega or a more specific method question.');
    return `<div class="search-results">${chunks.map((hit,i)=>`<article class="search-result"><h3>[${i+1}] ${esc(hit.title||'Source excerpt')}</h3><p>${esc(hit.text)}</p><div class="search-result-meta">${esc(hit.section||'')} · ${esc(hit.source||'')} ${hit.score!==undefined?`· lexical score ${number(hit.score,3)}`:''}</div></article>`).join('')}</div>`;
  }
  function metricReport(result,title) {
    if(!result?.models?.length)return `${title}: no experiment is available.`;
    return `${title} — target ${result.target||'rating group'}:\n${result.models.map(model=>`  ${model.name}: ${Object.entries(model.metrics||{}).map(([name,value])=>`${name}=${value===null?'unavailable':number(value,4)}`).join(', ')}`).join('\n')}`;
  }
  function browserAnswer(question) {
    const query=question.toLowerCase(),r=results(),p=profile(),a=reviewAnalysis();
    const combined=/combined|complete report|workspace report/.test(query);
    const evidence=[],calls=[],paragraphs=[];
    const include=(name,data,text)=>{paragraphs.push(text);evidence.push({tool:name,result:data});calls.push({name,arguments:{},execution:'browser read-only artifact tool'});};
    if(/cause|causal|prove|guarantee/.test(query)) {
      paragraphs.push('This observational workspace cannot establish causality or guarantee an individual delivery. Predictions, correlations and review keywords support hypotheses and further investigation.');
    } else {
      if(combined||/workspace|dataset|summary|summarize|how many|missing|data quality/.test(query))include('read_dataset_profile',{rows:p.rows,columns:p.columns,missing_cells:p.missing_cells,source:source()},`Workspace: ${source().label}. ${number(p.rows)} modeled rows, ${number(p.columns??p.column_count)} columns and ${number(p.missing_cells)} missing cells. ${source().description||''}`);
      if(combined||/model|classification|regression|accuracy|auc|precision|recall|baseline|duration/.test(query)){
        include('read_model_results',{classification:r.classification,regression:r.regression},metricReport(r.classification,'Late-delivery classification')+'\n\n'+metricReport(r.regression,'Delivery-duration regression'));
        paragraphs.push('These fixed-model comparisons do not imply that the most complex model wins. Read class balance, temporal split and baseline errors before interpreting a score.');
      }
      if(combined||/forecast|volume|next week|order count/.test(query)){
        const f=r.forecast;
        include('read_recorded_forecast',f?{split:f.split,models:f.models,forecast:f.forecast}:null,f?`${metricReport(f,'Historical order-count forecast')}\nRecorded projection starts ${f.forecast?.[0]?.date||'after the observed period'}: ${(f.forecast||[]).slice(0,7).map(row=>`${row.date}: ${number(row.predicted,1)} orders`).join('; ')}. These are historical projections following the recorded cutoff, not a forecast of current marketplace orders.`:'No forecast is present in this workspace.');
      }
      if(combined||/segment|cluster|outlier|anomal/.test(query))include('read_operational_profiles',r.segments?{clusters:r.segments.clusters,anomaly_count:r.segments.anomaly_count}:null,r.segments?`${number(r.segments.rows)} order profiles were grouped into ${number(r.segments.cluster_count)} exploratory clusters. Isolation Forest flagged ${number(r.segments.anomaly_count)} unusual profiles. These are not verified fraud or seller-quality labels.`:'No operational profile analysis is available.');
      if(combined||/review|complaint|sentiment|feedback/.test(query)){
        include('read_review_analysis',{models:a.models,themes:a.complaint_themes,labeled_rows:a.labeled_rows},a.models?.length?`${metricReport(a,'Review rating-group classification')}\nLow-rating keyword themes: ${(a.complaint_themes||[]).map(row=>`${row.theme}: ${number(row.count)}`).join('; ')}. Themes may overlap, and rating groups are proxies for sentiment.`:'No review experiment is available.');
      }
      if((combined||/sample|browser training/.test(query))&&Object.keys(state.sampleResults).length){
        include('read_live_browser_comparisons',state.sampleResults,'Live browser sample experiments — separate from the recorded full-data study:\n'+Object.values(state.sampleResults).map(result=>`${number(result.train_rows)} training / ${number(result.test_rows)} later holdout orders. ${metricReport(result,result.task+' sample comparison')}`).join('\n\n'));
      }
    }
    const complaintQuestion=/complaint|problem|negative review/.test(query);
    const corpus=complaintQuestion ? (state.workspace.knowledge_chunks||[]).filter(hit=>!String(hit.id||'').startsWith('review-')||hit.label==='negative') : null;
    const hits=rankedSearch(combined ? 'delivery delays entrega atraso dataset validation cohort' : question,corpus,4);
    if(hits.length){evidence.push(...hits);calls.push({name:'search_public_evidence',arguments:{query:question},method:'ranked lexical retrieval with documented English/Portuguese keyword expansion',result_count:hits.length});}
    if(!paragraphs.length && hits.length)paragraphs.push('Retrieved relevant source excerpts. The browser returns the evidence below; it does not generate an unsupported summary of documents.');
    if(!paragraphs.length)paragraphs.push('I could not find supporting evidence for that question. Ask about dataset quality, delivery-model metrics, the historical forecast, order profiles, review themes or indexed documentation.');
    if(hits.length)paragraphs.push('Source excerpts:\n'+hits.map((hit,i)=>`[${i+1}] ${hit.title} / ${hit.section||''}: ${hit.text}`).join('\n\n'));
    const sources=hits.map(hit=>({id:hit.id,title:hit.title,source:hit.source,section:hit.section,url:hit.source_url||hit.url||datasetUrl}));
    if(calls.some(call=>call.name.startsWith('read_'))) { sources.push({title:'Versioned Olist experiment artifacts',source:'olist-snapshot.json',section:'Saved evaluations and data provenance',url:'https://github.com/JASHD12/datapilot/blob/main/frontend/olist-snapshot.json'}); paragraphs.push(`Numerical artifact source: [${sources.length}] Versioned Olist experiment artifacts. The tool trace exposes the exact values used.`); }
    return {answer:paragraphs.join('\n\n'),mode:'deterministic',workflow:'Browser: route → read numerical artifacts → rank sources → compose evidence report',evidence,tool_calls:calls,sources,limitations:['This report is deterministic; it does not use an LLM or make provider calls.','Evaluation uses historical data and the supplied cohort. It does not establish current production performance.','Review keyword counts are descriptive and may overlap. Associations are not causal explanations.']};
  }
  function downloadReport() {
    const response=browserAnswer('Generate combined report');
    const markdown=`# DataPilot — ${source().kind === 'public' ? 'Olist' : 'current'} workspace report\n\n${response.answer}\n\n## Limitations\n\n${response.limitations.map(item=>'- '+item).join('\n')}\n\n## Source\n\n${datasetUrl}\nCC BY-NC-SA 4.0. Independent portfolio demonstration.\n`;
    const url=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=source().kind === 'public'?'datapilot-olist-report.md':'datapilot-workspace-report.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function loadOlist() {
    try{const response=await fetch('./olist-snapshot.json');if(!response.ok)throw new Error('The Olist artifact is unavailable. Build scripts/build_olist_demo.py first.');clearSampleExperiments();state.workspace=await response.json();state.replay=true;state.answer=null;state.prediction=null;state.search=[];markConnection();render();toast('Historical Olist workspace opened. Browser tools are live; evaluations are saved.');}catch(error){toast(error.message,true);}
  }

  function studyDoc(path, title) {
    return `<a class="button" href="https://github.com/JASHD12/datapilot/blob/main/${path}" target="_blank" rel="noopener noreferrer">${esc(title)} <span aria-hidden="true">↗</span></a>`;
  }
  function studyMetric(value) { return value === null || value === undefined ? '—' : number(value,4); }
  function studyLoading(kind) {
    if(state.studies.status==='loading')return `<div class="study-loading" role="status"><span class="loader"></span><p>Opening the versioned experiment…</p></div>`;
    return `<div class="study-unavailable" role="alert"><h2>This study could not be opened.</h2><p>${esc(state.studies.errors[kind]||'The experiment artifact is unavailable at this address.')}</p>${button('reload-studies','Retry loading studies',true)}</div>`;
  }
  function studyNotice(title, text) { return `<aside class="study-notice"><strong>${esc(title)}</strong><p>${esc(text)}</p></aside>`; }
  async function loadStudies() {
    if(state.studies.status==='loading')return;
    state.studies.status='loading';state.studies.errors={};
    const kinds=['review','retrieval','generation'];
    const outcomes=await Promise.allSettled(kinds.map(async kind=>{
      const response=await fetch(`./${kind}-study.json?v=0.4.0`);
      if(!response.ok)throw new Error('The experiment artifact could not be downloaded.');
      const data=await response.json();
      if(data.schema_version!==1)throw new Error('This experiment uses an unsupported artifact version.');
      return data;
    }));
    outcomes.forEach((outcome,index)=>{const kind=kinds[index];if(outcome.status==='fulfilled')state.studies[kind]=outcome.value;else state.studies.errors[kind]=outcome.reason?.message||'Loading failed.';});
    state.studies.status='ready';
    if(state.route==='studies')render();
  }
  function studyConfusion(matrix, labels) {
    if(!Array.isArray(matrix)||!matrix.length)return empty('No confusion matrix','This evaluation has no confusion counts.');
    const max=Math.max(1,...matrix.flat().map(Number).filter(Number.isFinite));
    return `<div class="table-wrap"><table class="data-table confusion-table"><caption>Actual groups in rows; predicted groups in columns. Cells show review counts.</caption><thead><tr><th scope="col">Actual / predicted</th>${labels.map(label=>`<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${matrix.map((row,i)=>`<tr><th scope="row">${esc(labels[i])}</th>${row.map(value=>`<td style="--cell-shade:${Math.min(1,Math.max(0,Number(value)/max)).toFixed(3)}">${number(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function reviewStudy() {
    const data=state.studies.review;
    if(!data)return studyLoading('review');
    const cohort=state.studyCohort==='novel_text_test'?'novel_text_test':'test';
    const evaluation=data.evaluations?.[cohort];
    const metrics=evaluation?.metrics||{},baseline=evaluation?.baseline_metrics||{},rawInterval=evaluation?.bootstrap_macro_f1;
    const interval=rawInterval?.available!==false&&Number.isFinite(rawInterval?.lower)&&Number.isFinite(rawInterval?.upper)?rawInterval:null;
    const difference=evaluation?.bootstrap_macro_f1_difference;
    const splits=['train','validation','test'].map(key=>({period:key,...data.split?.[key]}));
    const splitTable=table(splits.map(split=>({period:split.period,rows:split.rows,from:String(split.start||'—').slice(0,10),to:String(split.end||'—').slice(0,10),negative:split.class_counts?.negative,neutral:split.class_counts?.neutral,positive:split.class_counts?.positive})),['period','rows','from','to','negative','neutral','positive']);
    const rows=(data.candidates||[]).map(model=>({candidate:model.name,selected:model.id===data.selected_model?.id?'Yes':'',validation_macro_F1:studyMetric(model.validation?.macro_f1),validation_accuracy:studyMetric(model.validation?.accuracy)}));
    const perClass=(evaluation?.per_class||[]).map(row=>({rating_group:row.label,precision:studyMetric(row.precision),recall:studyMetric(row.recall),F1:studyMetric(row.f1),reviews:row.support}));
    return `<div class="study-intro"><div><div class="eyebrow">01 / TEXT CLASSIFICATION</div><h2>${esc(data.title||'Does the model generalize beyond familiar wording?')}</h2><p>${esc(data.question||'Audit rating-group classification on later reviews and on previously unseen normalized wording.')}</p></div><span class="tag">RECORDED EXPERIMENT</span></div>`+
      studyNotice('Retrospective study','The Olist data and earlier holdout results were already inspected. Candidate selection uses the validation period only; this later test is a retrospective diagnostic, not pristine unseen research evidence.')+
      panel('Choose the evaluation cohort','The same selected model is evaluated on both cohorts.',`<div class="study-controls"><div class="field"><label for="study-review-cohort">TEST COHORT</label><select id="study-review-cohort" data-study-control="studyCohort"><option value="test" ${cohort==='test'?'selected':''}>All later test reviews</option><option value="novel_text_test" ${cohort==='novel_text_test'?'selected':''}>Wording unseen in train and validation</option></select></div></div><p class="study-caption">${cohort==='test'?'Includes repeated wording, as found in the recorded dataset.':'Excludes test reviews whose normalized wording appeared in either earlier period. This is a subset diagnostic, not a new dataset.'}</p>`,'SAME MODEL / TWO COHORTS')+
      `<div class="study-metrics">${metric('Macro F1',studyMetric(metrics.macro_f1),'Equal weight for all three rating groups','reviews')}${metric('Majority macro F1',studyMetric(baseline.macro_f1),'Constant-class reference on this cohort','models')}${metric('Evaluation reviews',number(evaluation?.rows),'Rows in the selected later cohort','database')}${metric('Accuracy',percent(metrics.accuracy),'Read together with minority-class scores','shield')}</div>`+
      `<div class="grid-equal">${panel('Which groups does it miss?','Per-class results expose errors hidden by overall accuracy.',table(perClass,['rating_group','precision','recall','F1','reviews']),'CLASS-LEVEL ERRORS')}${panel('Where do mistakes go?','Inspect actual and predicted rating groups.',studyConfusion(evaluation?.confusion_matrix,data.labels||['negative','neutral','positive']),'CONFUSION MATRIX')}</div>`+
      (interval?studyNotice('Uncertainty from resampling review wording',`${number((interval.confidence??0.95)*100)}% bootstrap interval for macro F1: ${studyMetric(interval.lower)}–${studyMetric(interval.upper)}. Resampling unit: ${interval.unit||'normalized text groups'}; ${number(interval.replicates)} replicates. ${difference?.available!==false&&Number.isFinite(difference?.lower)&&Number.isFinite(difference?.upper)?` Paired macro-F1 difference versus the majority baseline: ${studyMetric(difference.lower)}–${studyMetric(difference.upper)}.`:''} This interval does not establish performance on another marketplace.`):'')+
      `<div class="grid-equal space-top">${panel('Model choice happens before the test','Predeclared feature representations compete on validation reviews.',table(rows,['candidate','selected','validation_macro_F1','validation_accuracy']),'VALIDATION ONLY')}${panel('Repeated wording audit','Counts describe overlap across the chronological boundary.',`<dl class="study-stat-list"><div><dt>Test reviews seen in earlier periods</dt><dd>${number(data.duplicates?.test_seen_before_rows)} <small>(${percent(data.duplicates?.test_seen_before_fraction)})</small></dd></div><div><dt>Validation reviews seen in training</dt><dd>${number(data.duplicates?.validation_seen_train_rows)}</dd></div><div><dt>Repeated rows within the test period</dt><dd>${number(data.duplicates?.within_test_repeated_rows)}</dd></div></dl><p class="study-caption">${esc(data.duplicates?.normalization||data.protocol?.normalization||'Read the experiment protocol for normalization rules.')}</p>`,'OVERLAP AUDIT')}</div>`+
      panel('Chronological experiment design','Vocabulary is fitted on training reviews; validation selects a candidate; test scores are reported afterward.',splitTable,'THREE TIME PERIODS')+
      panel('What the experiment tells us','Read the observed results alongside their scope.',`<ul class="study-findings">${(data.findings||[]).map(finding=>`<li>${esc(finding)}</li>`).join('')}</ul><p class="study-caption">Selected model: <strong>${esc(data.selected_model?.name||'Unavailable')}</strong>. ${esc(data.selected_model?.selection_reason||data.protocol?.selection_rule||'')}</p>`,'FAILURES INCLUDED')+
      details('Model definitions and reproducibility',{source:data.source,protocol:data.protocol,candidates:data.candidates?.map(({validation,...model})=>model),normalization:data.duplicates?.normalization})+limits(data.limitations)+
      `<div class="study-actions">${button('download-study-markdown','Download study report',true,'data-study="review"')}${button('download-study-json','Download results JSON',false,'data-study="review"')}${studyDoc('docs/REVIEW_STUDY.md','Reproduce the experiment')}</div>`;
  }
  function retrievalCases(data) {
    return (data.cases||[]).filter(item=>item.split===state.studyQuestionSplit&&(state.studyQuestionLanguage==='all'||item.language===state.studyQuestionLanguage)&&(state.studyQuestionKind==='all'||item.answerable===(state.studyQuestionKind==='answerable')));
  }
  function passageFor(data, hit) {
    return {...(data.passages||[]).find(item=>item.id===hit.id),...hit};
  }
  function retrievalHitMarkup(hits,data,caseItem=null) {
    if(!hits?.length)return empty('No passages returned','This method did not return a supporting passage.');
    return `<div class="search-results study-hits">${hits.map((raw,index)=>{const hit=passageFor(data,raw);const relevant=caseItem?.relevant_ids?.includes(hit.id);return `<article class="search-result"><div class="study-hit-heading"><h3>${index+1}. ${esc(hit.title||hit.id||'Source passage')}</h3>${caseItem?`<span class="tag ${relevant?'':'neutral'}">${relevant?'SEED RELEVANT':'NOT LABELED RELEVANT'}</span>`:''}</div><p>${esc(hit.text||'Passage text is unavailable in this artifact.')}</p><div class="search-result-meta">${esc(hit.source||'')} · ${esc(hit.section||hit.id||'')} · ranking score ${studyMetric(hit.score)}${hit.source_url&&/^https?:\/\//.test(hit.source_url)?` · <a href="${esc(hit.source_url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>`:''}</div></article>`;}).join('')}</div>`;
  }
  function retrievalMetrics(method, split) {
    const result=method?.[split]||{};
    const answerable=result.answerable||{};
    const abstention=result.abstention||{};
    return {method:method.label||method.id,recall_at_3:studyMetric(answerable.recall_at_3),MRR_at_3:studyMetric(answerable.mrr_at_3),nDCG_at_3:studyMetric(answerable.ndcg_at_3),unanswerable_abstention:studyMetric(abstention.unanswerable_abstain_rate??abstention.unanswerable_abstention_rate??abstention.unanswerable_rejection_rate??abstention.specificity),answerable_coverage:studyMetric(abstention.answerable_accept_rate??abstention.answerable_coverage)};
  }
  function liveSemanticPanel(data) {
    const live=state.semantic,loading=live.status==='loading',busy=loading||live.pending;
    const output=live.result;
    const status=loading?live.progress||'Downloading and opening the model…':live.pending?'Encoding the query and ranking passages…':live.status==='ready'?'Model ready. Query encoding runs in this browser.':'Model not downloaded for this session.';
    return panel('Try multilingual semantic search','Run a new query against the same versioned passage corpus.',`<p class="study-caption">${esc(data.model?.download_notice||'Optional first use downloads an open model of roughly 120 MB from Hugging Face. Encoding runs on your device; there is no paid model API. A slower connection or limited browser memory may prevent loading.')}</p><div class="study-actions">${button('load-semantic',live.status==='ready'?'Reload local model':loading?'Loading model…':'Load semantic model',true,busy?'disabled':'')}${busy?button('cancel-semantic','Cancel'):''}</div><p class="semantic-status" id="semantic-status" role="status">${esc(status)}</p>${live.error?`<p class="sample-error" role="alert">${esc(live.error)} You can retry loading. The recorded comparison and lexical workbench remain available.</p>`:''}<form data-form="semantic-search" class="semantic-form"><div class="field"><label for="semantic-query">YOUR QUERY · ENGLISH OR PORTUGUESE</label><input id="semantic-query" name="query" maxlength="500" minlength="2" required value="${esc(live.query)}" placeholder="How do the models avoid using future information?"></div><div class="semantic-form-bottom"><div class="field"><label for="semantic-method">RETRIEVAL METHOD</label><select id="semantic-method" name="mode"><option value="hybrid" ${live.mode==='hybrid'?'selected':''}>Hybrid: lexical + dense (experimental)</option><option value="dense" ${live.mode==='dense'?'selected':''}>Dense embeddings</option></select></div><button class="button primary" ${live.status!=='ready'||busy?'disabled':''}>Search passages</button></div></form>${live.modelInfo?details('Browser encoder verification',{passages:live.modelInfo.corpusSize,minimum_reference_cosine:live.modelInfo.probeCosine,probe_checks:live.modelInfo.probeResults,vector_source:live.modelInfo.vectorSource,threshold_source:live.modelInfo.thresholdSource,development_thresholds:live.modelInfo.thresholds,interpretation:'Three public tokenization/embedding checks verify compatibility. Live corpus and query vectors share this browser runtime; saved native-CPU scores may differ. This is not a retrieval-quality guarantee.'}):''}${output?`<div class="semantic-result" id="semantic-result" tabindex="-1"><div class="eyebrow">LIVE BROWSER RETRIEVAL</div><h3>${output.abstained?'Insufficient support at the development threshold':'Ranked source passages'}</h3><p class="study-caption">${esc(output.method||live.mode)} · ${number(output.elapsed_ms/1000,2)} seconds. ${output.abstained?'The query was rejected at the development-selected threshold; no passage is presented as supporting evidence.':'Scores rank passages; they are not probabilities of truth.'} No answer generation is performed.</p>${retrievalHitMarkup(output.hits,data)}${details('Retrieval decision',{method:output.method,abstained:output.abstained,threshold:output.threshold,top_score:output.top_score,scope:output.scope})}</div>`:''}`,'OPT-IN / ON YOUR DEVICE');
  }
  function retrievalStudy() {
    const data=state.studies.retrieval;
    if(!data)return studyLoading('retrieval');
    const cases=retrievalCases(data),selected=cases.find(item=>item.id===state.studyCaseId)||cases[0];
    const method=(data.methods||[]).find(item=>item.id===state.studyRetrievalMethod)||data.methods?.[0];
    const metrics=(data.methods||[]).map(item=>retrievalMetrics(item,state.studyQuestionSplit));
    const languages=[...new Set((data.cases||[]).map(item=>item.language))];
    const splitCount=(data.cases||[]).filter(item=>item.split===state.studyQuestionSplit).length;
    const result=selected?.results?.[method?.id];
    const hits=Array.isArray(result)?result:result?.hits||[];
    const model=data.model||{};
    return `<div class="study-intro"><div><div class="eyebrow">02 / MULTILINGUAL RETRIEVAL</div><h2>${esc(data.title||'Which retrieval method finds the supporting passage?')}</h2><p>${esc(data.scope||'Compare a lexical baseline, multilingual dense embeddings and hybrid retrieval on the same versioned corpus.')}</p></div><span class="tag">RECORDED EXPERIMENT</span></div>`+
      studyNotice('Seed relevance judgments, open to review',data.benchmark?.annotation_status||'These questions and passage judgments were authored with AI assistance. They have not been independently validated by a human reviewer.')+
      `<div class="study-actions">${button('reveal-semantic','Try browser semantic search',true)}<span class="study-caption">Optional model download; saved results below need no model.</span></div>`+
      `<div class="study-metrics">${metric('Indexed passages',number(typeof data.corpus?.chunks==='number'?data.corpus.chunks:data.passages?.length),'Same corpus for every method','knowledge')}${metric('Development questions',number(data.benchmark?.dev_questions),'Threshold selection uses this split','models')}${metric('Test questions',number(data.benchmark?.test_questions),'Reported separately from development','shield')}${metric('Embedding dimensions',number(model.dimensions),'Multilingual query and passage vectors','studies')}</div>`+
      panel('Compare on the same questions','Ranking quality is measured on answerable questions. Abstention is evaluated separately.',`<div class="study-controls"><div class="field"><label for="study-question-split">QUESTION SPLIT</label><select id="study-question-split" data-study-control="studyQuestionSplit"><option value="test" ${state.studyQuestionSplit==='test'?'selected':''}>Test questions</option><option value="dev" ${state.studyQuestionSplit==='dev'?'selected':''}>Development questions</option></select></div></div>${table(metrics,['method','recall_at_3','MRR_at_3','nDCG_at_3','unanswerable_abstention','answerable_coverage'])}<p class="study-caption">${number(splitCount)} questions in the selected split. Method thresholds are chosen on development questions only. A better ranking score does not establish that a generated answer is correct.</p><dl class="study-definitions"><div><dt>Recall@3</dt><dd>Fraction of labeled relevant passages found in the first three results.</dd></div><div><dt>MRR@3</dt><dd>Reciprocal rank of the first relevant passage, averaged across queries.</dd></div><div><dt>nDCG@3</dt><dd>Ranking quality that rewards placing relevant passages near the top.</dd></div><div><dt>Abstention / coverage</dt><dd>Rejection of unanswerable questions / acceptance of answerable questions.</dd></div></dl>`,'LEXICAL / DENSE / HYBRID')+
      panel('Inspect a benchmark question','Switch methods to see the actual ranked passages and seed relevance labels.',`<div class="study-controls"><div class="field"><label for="study-question-language">LANGUAGE</label><select id="study-question-language" data-study-control="studyQuestionLanguage"><option value="all" ${state.studyQuestionLanguage==='all'?'selected':''}>All languages</option>${languages.map(language=>`<option value="${esc(language)}" ${state.studyQuestionLanguage===language?'selected':''}>${esc(language)}</option>`).join('')}</select></div><div class="field"><label for="study-question-kind">QUESTION TYPE</label><select id="study-question-kind" data-study-control="studyQuestionKind"><option value="all" ${state.studyQuestionKind==='all'?'selected':''}>All questions</option><option value="answerable" ${state.studyQuestionKind==='answerable'?'selected':''}>Answerable</option><option value="unanswerable" ${state.studyQuestionKind==='unanswerable'?'selected':''}>Unanswerable</option></select></div><div class="field"><label for="study-retrieval-method">METHOD</label><select id="study-retrieval-method" data-study-control="studyRetrievalMethod">${(data.methods||[]).map(item=>`<option value="${esc(item.id)}" ${method?.id===item.id?'selected':''}>${esc(item.label||item.id)}</option>`).join('')}</select></div></div>${cases.length?`<div class="field study-question-field"><label for="study-case">BENCHMARK QUESTION</label><select id="study-case" data-study-control="studyCaseId">${cases.map(item=>`<option value="${esc(item.id)}" ${selected?.id===item.id?'selected':''}>${esc(item.query)}</option>`).join('')}</select></div><div class="study-question"><span class="tag ${selected.answerable?'':'amber'}">${selected.answerable?'ANSWERABLE SEED QUESTION':'UNANSWERABLE SEED QUESTION'}</span><h3>${esc(selected.query)}</h3><p>${esc(selected.language)} · ${esc(selected.split)} · ${number(selected.relevant_ids?.length)} labeled relevant passages</p></div>${result?`<p class="study-caption"><strong>Recorded decision: ${result.abstained?'abstained':'accepted'}.</strong> ${selected.answerable?(result.abstained?'An answerable seed question was rejected.':'Read the ranked passages to check whether evidence was found.'):(result.abstained?'The method rejected this unanswerable seed question.':'The method accepted a question labeled unanswerable: a seed false positive.')} ${esc(selected.judgment_note||'')}</p>`:''}${retrievalHitMarkup(hits,data,selected)}${details('Recorded query decision',result)}`:empty('No questions match these filters','Choose another language or question type.')}`,'QUESTION EXPLORER')+
      `<div id="semantic-search-panel" tabindex="-1">${liveSemanticPanel(data)}</div>`+details('Model and benchmark protocol',{model:{id:model.id,revision:model.revision,license:model.license,browser_id:model.browser_id,browser_revision:model.browser_revision,dtype:model.dtype,dimensions:model.dimensions},corpus:data.corpus,benchmark:data.benchmark,methods:data.methods?.map(item=>({id:item.id,label:item.label,parameters:item.parameters,threshold:item.threshold}))})+limits(data.limitations)+
      `<div class="study-actions">${button('download-study-markdown','Download study report',true,'data-study="retrieval"')}${button('download-study-json','Download results JSON',false,'data-study="retrieval"')}${studyDoc('docs/RETRIEVAL_STUDY.md','Reproduce the experiment')}</div>`;
  }
  function generationSourceLink(value) {
    try {
      const url=new URL(value);
      const allowed=(url.hostname==='github.com'&&url.pathname.startsWith('/JASHD12/datapilot/'))||(['www.kaggle.com','kaggle.com'].includes(url.hostname)&&url.pathname.startsWith('/datasets/olistbr/'));
      return url.protocol==='https:'&&allowed?url.href:null;
    } catch { return null; }
  }
  function generationContexts(data, run) {
    if(Array.isArray(run?.contexts))return run.contexts;
    return (run?.context_ids||[]).map((id,index)=>({...(data.passages||[]).find(item=>item.id===id),id,citation:`S${index+1}`}));
  }
  function generationEvidence(contexts, prefix) {
    if(!contexts?.length)return empty('No source excerpts supplied','The plain baseline receives only the question. A retrieval rejection also supplies no excerpts.');
    return `<div class="generation-evidence">${contexts.map((item,index)=>{const url=generationSourceLink(item.source_url);return `<article class="generation-source" id="${esc(prefix)}-${index+1}"><div class="generation-source-head"><span class="tag">${esc(item.citation||`S${index+1}`)}</span><h4>${esc(item.title||item.section||'Source excerpt')}</h4></div><p>${esc(item.text||'Excerpt text is not present in this artifact.')}</p><div class="search-result-meta">${esc(item.source||item.id||'')} · ${esc(item.section||'')}${url?` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Read source ↗</a>`:''}</div></article>`;}).join('')}</div>`;
  }
  function generationOutput(run, title, raw=false) {
    const value=raw?run?.raw_answer:run?.answer;
    return `<section class="generation-answer"><div class="eyebrow">${esc(title)}</div><div class="generation-answer-text">${esc(typeof value==='string'&&value.length?value:'No answer text was recorded.')}</div></section>`;
  }
  function generationMetricRows(data) {
    return (data.methods||[]).map(method=>{
      const result=method.splits?.[state.studyGenerationSplit]||{};
      return {method:method.title||method.id,questions:result.count,served_refusal_rate:studyMetric(result.served_refusal_rate),unanswerable_refusal_rate:studyMetric(result.unanswerable_abstain_rate),answerable_coverage:studyMetric(result.answerable_answer_rate),raw_invalid_citation_rate:studyMetric(result.invalid_citation_rate),raw_uncited_sentence_rate:studyMetric(result.uncited_sentence_response_rate),median_generation_ms:studyMetric(result.timings?.generation_ms?.median)};
    });
  }
  function liveGenerationPanel(data) {
    const live=state.generation,loading=live.status==='loading',busy=loading||live.pending;
    const ready=live.status==='ready',output=live.result;
    const status=loading?live.progress||'Checking the live service…':live.pending?live.progress||'Cloudflare is retrieving sources and generating an answer…':ready?'Live demo connected. Generate a question to call the hosted model.':live.progress||'Connect to check whether the live demo is available.';
    return panel('Try a new grounded answer','Generate from the same public source library, then inspect what the checks accept or block.',`<p class="study-caption">${esc(data.model?.display_name||data.model?.id||'The language model')} runs on <strong>Cloudflare Workers AI</strong>. Clicking <strong>Generate with sources</strong> sends your question to Cloudflare for processing with the public demonstration passages. Use questions about this sample; do not enter personal or confidential information. The shared free daily allowance can run out. Saved results remain readable when live generation is unavailable.</p><div class="study-actions">${button('load-generation',ready?'Check connection again':loading?'Checking connection…':'Connect to live demo',true,busy?'disabled':'')}${busy?button('cancel-generation','Stop waiting'):''}</div><p class="semantic-status" id="generation-status" role="status">${esc(status)}</p>${live.error?`<p class="sample-error" role="alert">${esc(live.error)} Reconnect to retry when the service is available. A service error is not a model refusal. Saved results remain available.</p>`:''}<form data-form="grounded-generation" class="generation-form"><div class="field"><label for="generation-query">QUESTION · ENGLISH · PUBLIC DEMONSTRATION</label><textarea id="generation-query" name="question" minlength="2" maxlength="1000" required ${busy?'disabled':''} placeholder="Why can accuracy be misleading for late delivery?">${esc(live.query)}</textarea></div><div class="generation-form-bottom"><p class="study-caption">Answers are experimental. Citation-format checks do not verify the truth of a claim.</p><button class="button primary" ${!ready||busy?'disabled':''}>Generate with sources</button></div><div class="generation-suggestions"><button type="button" data-action="generation-example" data-example="supported" ${busy?'disabled':''}>Try a supported question ↗</button><button type="button" data-action="generation-example" data-example="unsupported" ${busy?'disabled':''}>Try an unsupported question ↗</button></div></form>${output?`<div class="semantic-result" id="generation-result" tabindex="-1"><div class="study-hit-heading"><div><div class="eyebrow">LIVE HOSTED GENERATION</div><h3>${output.status==='accepted'?'Passed citation-format checks':output.status==='abstained'?'Model reported insufficient evidence':'Generated draft withheld'}</h3></div><span class="tag ${output.status==='accepted'?'':'amber'}">${esc(output.status||'UNKNOWN')}</span></div><p class="study-caption">Hosted generation call: ${number(output.timings?.generation_ms/1000,2)} s · server processing: ${number(output.timings?.total_ms/1000,2)} s. ${live.retrieval?`Retrieval: ${number(live.retrieval.retrieval_ms,2)} ms. ${live.retrieval.abstained?'Retrieval supplied no excerpts because the question was below its threshold.':''}`:''} This live run is separate from the saved evaluation.</p>${generationOutput(output,'ANSWER SHOWN TO THE VISITOR')}${details('Raw model output — unverified draft',output.raw_answer)}${details('Citation-format checks — not factual verification',output.checks)}${generationEvidence(output.contexts||[],'generation-live-source')}${details('Model, timing and retrieval record',{model:output.model,prompt_version:output.prompt_version,service:live.modelInfo,timings:output.timings,usage:output.usage,completion:output.completion,retrieval:live.retrieval})}<div class="study-actions">${button('download-live-generation','Download this run JSON')}</div></div>`:''}`,'OPT-IN / CLOUDFLARE HOSTED');
  }
  function generationStudy() {
    const data=state.studies.generation;
    if(!data)return studyLoading('generation');
    const cases=(data.cases||[]).filter(item=>item.split===state.studyGenerationSplit);
    const selected=cases.find(item=>item.id===state.studyGenerationCaseId)||cases[0];
    const method=(data.methods||[]).find(item=>item.id===state.studyGenerationMethod)||data.methods?.[0];
    const run=selected?.runs?.find(item=>item.variant===method?.id||item.method===method?.id);
    const reviewed=data.benchmark?.human_review||{};
    const humanComplete=reviewed.status==='human_review_complete'&&reviewed.metrics!==null&&reviewed.questions_reviewed===reviewed.questions_required&&reviewed.answers_reviewed===reviewed.answers_required;
    const questionsReviewed=reviewed.question_status==='human_questions_reviewed';
    const reviewText=humanComplete?'A completed human review is recorded in this versioned artifact. Inspect its reviewer and fingerprints in the protocol.':questionsReviewed?'The question labels have completed human review, but answer-level review is incomplete. The numerical checks below measure formatting and abstention; they do not establish factual support or answer quality.':'The seed questions and expected facts were authored with AI assistance. Human review is pending. The numerical checks below measure formatting and abstention; they do not establish factual support or answer quality.';
    return `<div class="study-intro"><div><div class="eyebrow">03 / GROUNDED LANGUAGE GENERATION</div><h2>${esc(data.title||'Does source evidence make a generated answer safer?')}</h2><p>${esc(data.scope||'Compare an actual language-model baseline with source-grounded generation and a structural citation gate.')}</p></div><span class="tag">SAVED ACTUAL MODEL RUNS</span></div>`+
      studyNotice(humanComplete?'Human review recorded':questionsReviewed?'Human answer review pending':'Human review pending',reviewText)+
      `<div class="study-actions">${button('reveal-generation','Try live generation',true)}${studyDoc('docs/GENERATION_REVIEW.md','Review the evaluation questions')}</div>`+
      `<div class="study-metrics">${metric('Language model',data.model?.display_name||data.model?.id||'Recorded model','Pretrained model; no fine-tuning','models')}${metric('Development questions',number(data.benchmark?.dev_questions),'Exploratory seed suite','studies')}${metric('Test questions',number(data.benchmark?.test_questions),'Reported separately','shield')}${metric('Human answer quality',humanComplete?'Review recorded':'Not measured','Never inferred from citation format','knowledge')}</div>`+
      panel('Compare the same model and questions','The validated method applies a gate to the grounded draft; it does not generate a second answer.',`<div class="study-controls"><div class="field"><label for="generation-split">QUESTION SPLIT</label><select id="generation-split" data-study-control="studyGenerationSplit"><option value="test" ${state.studyGenerationSplit==='test'?'selected':''}>Test questions</option><option value="dev" ${state.studyGenerationSplit==='dev'?'selected':''}>Development questions</option></select></div></div>${table(generationMetricRows(data),['method','questions','served_refusal_rate','unanswerable_refusal_rate','answerable_coverage','raw_invalid_citation_rate','raw_uncited_sentence_rate','median_generation_ms'])}<p class="study-caption">Rates range from 0 to 1. Refusal counts use the exact INSUFFICIENT_EVIDENCE marker or a validation block; natural-language refusals in the plain baseline are not semantically scored. ${questionsReviewed?'Question answerability labels and source matches were reviewed by the project owner; generated answers still require their own review.':'Question answerability labels are provisional until human review.'} Service failures are reported separately and excluded from answer-quality rates. Citation-error columns inspect raw drafts: withholding a draft changes served refusals, not the original errors. Median generation time covers this split's recorded runs; postprocessing reuses the grounded generation.</p><dl class="study-definitions"><div><dt>Plain baseline</dt><dd>The question alone, with no retrieved evidence.</dd></div><div><dt>Grounded generation</dt><dd>Retrieved excerpts plus instructions to cite sources and abstain when evidence is insufficient.</dd></div><div><dt>Grounded + validation</dt><dd>The same draft checked for source IDs and uncited sentences. Failed drafts are withheld.</dd></div><div><dt>Human factual review</dt><dd>A person must judge whether claims are supported and citations point to the right evidence. Formatting cannot establish this.</dd></div></dl>`,'MODEL OUTPUT / SERVED OUTPUT')+
      panel('Inspect a recorded answer','Read the raw output alongside the answer that this method would show.',`<div class="study-controls"><div class="field"><label for="generation-method">METHOD</label><select id="generation-method" data-study-control="studyGenerationMethod">${(data.methods||[]).map(item=>`<option value="${esc(item.id)}" ${method?.id===item.id?'selected':''}>${esc(item.title||item.id)}</option>`).join('')}</select></div></div>${cases.length?`<div class="field study-question-field"><label for="generation-case">EVALUATION QUESTION</label><select id="generation-case" data-study-control="studyGenerationCaseId">${cases.map(item=>`<option value="${esc(item.id)}" ${selected?.id===item.id?'selected':''}>${esc(item.question)}</option>`).join('')}</select></div><div class="study-question"><span class="tag ${selected.answerable?'':'amber'}">${questionsReviewed?(selected.answerable?'ANSWERABLE · LABEL REVIEWED':'UNANSWERABLE · LABEL REVIEWED'):(selected.answerable?'PROVISIONALLY ANSWERABLE':'PROVISIONALLY UNANSWERABLE')}</span><h3>${esc(selected.question)}</h3><p>${esc(selected.split)} · ${esc(selected.category)} · ${questionsReviewed?'Question and source matches reviewed by project owner':esc(selected.annotation_status||'pending_human_review')}</p></div>${run?`<p class="study-caption"><strong>Recorded decision: ${esc(run.status||'unvalidated')}.</strong> Generation ${number(run.timings?.generation_ms/1000,2)} s · total ${number(run.timings?.total_ms/1000,2)} s. ${run.reuse_of?'This method reuses the grounded draft; it is not another model call.':''}</p><div class="generation-answers">${generationOutput(run,'RAW MODEL OUTPUT — UNVERIFIED',true)}${generationOutput(run,'ANSWER THIS METHOD SHOWS')}</div>${details('Recorded citation-format checks',run.checks)}${generationEvidence(generationContexts(data,run),'generation-saved-source')}${details('Expected facts and review status',{expected_facts:selected.expected_facts,relevant_passage_ids:selected.relevant_passage_ids,question_review:reviewed,answer_review:selected.review??null,interpretation:questionsReviewed?'The project owner reviewed question labels and source matches. This does not establish the quality or factual support of generated answers.':'Expected facts are AI-authored seed labels pending human review. They are not an automatic correctness score.'})}`:empty('No model output recorded','Reproduce the study to generate this run.')}`:empty('No questions in this split','Choose another question split.')}`,'RECORDED ANSWER EXPLORER')+
      `<div id="generation-live-panel" tabindex="-1">${liveGenerationPanel(data)}</div>`+
      details('Model, generation and review protocol',{model:data.model,run_metadata:data.run_metadata,corpus:data.corpus,benchmark:data.benchmark,methods:data.methods?.map(item=>({id:item.id,title:item.title,parameters:item.parameters,counts:item.counts,timings:item.timings}))})+limits(data.limitations)+
      `<div class="study-actions">${button('download-study-markdown','Download study report',true,'data-study="generation"')}${button('download-study-json','Download results JSON',false,'data-study="generation"')}${studyDoc('docs/GENERATION_STUDY.md','Reproduce the experiment')}</div>`;
  }
  function studies() {
    return heading('08 / Research studies','Put the result under scrutiny.','Inspect classification errors, multilingual retrieval and actual grounded language generation. Each study exposes the protocol as well as the result.',studyDoc('docs/WALKTHROUGH.md','Technical walkthrough'))+
      `<div class="study-tabs" role="group" aria-label="Choose a research study"><button class="study-tab ${state.studyTab==='review'?'active':''}" data-action="study-tab" data-tab="review" aria-pressed="${state.studyTab==='review'}">01 <span>Review classification</span></button><button class="study-tab ${state.studyTab==='retrieval'?'active':''}" data-action="study-tab" data-tab="retrieval" aria-pressed="${state.studyTab==='retrieval'}">02 <span>Multilingual retrieval</span></button><button class="study-tab ${state.studyTab==='generation'?'active':''}" data-action="study-tab" data-tab="generation" aria-pressed="${state.studyTab==='generation'}">03 <span>Grounded generation</span></button></div><div class="study-content" id="study-content">${state.studyTab==='generation'?generationStudy():state.studyTab==='retrieval'?retrievalStudy():reviewStudy()}</div>`;
  }
  function studyExport(kind) {
    const data=state.studies[kind];
    if(!data)throw new Error('Open the study before downloading its results.');
    if(kind==='review'||kind==='generation')return data;
    const {passage_embeddings,lexical_index,...result}=data;
    const {probe,...model}=result.model||{};
    return {...result,model,embedding_artifact:'retrieval-study.json (vectors omitted from this results download)'};
  }
  function generationStudyMarkdown(data) {
    const textBlock=value=>String(value??'No text recorded.').split('\n').map(line=>'    '+line).join('\n');
    const review=data.benchmark?.human_review||{};
    const questionsReviewed=review.question_status==='human_questions_reviewed';
    return `# ${data.title}\n\n${data.scope}\n\nQuestion review: ${questionsReviewed?'Project owner reviewed the question labels and source matches':'Pending human review'}. Generated-answer review: ${review.status==='human_review_complete'?'Complete; inspect the versioned review record':'Pending; factual answer quality has not been measured'}. Citation-format checks do not establish factual support.\n\n## Model\n\n${JSON.stringify(data.model,null,2)}\n\n## Recorded comparison\n\n${(data.methods||[]).map(method=>`### ${method.title||method.id}\n\n${JSON.stringify({splits:method.splits,timings:method.timings},null,2)}`).join('\n\n')}\n\n## Recorded answers\n\n${(data.cases||[]).map(item=>`### ${item.id} / ${item.split}\n\n${item.question}\n\n${questionsReviewed?'Reviewed question label':'Provisional question label'}: ${item.answerable?'answerable':'unanswerable'}. Question review: ${questionsReviewed?'Project owner review recorded':'pending'}. Generated-answer review: ${item.review?'see JSON review record':'pending'}.\n\n${(item.runs||[]).map(run=>`**${run.variant} / ${run.status}**\n\nRaw model output:\n\n${textBlock(run.raw_answer)}\n\nServed answer:\n\n${textBlock(run.answer)}\n\nChecks: ${JSON.stringify(run.checks)}\n\nTimings: ${JSON.stringify(run.timings)}\n\nContext IDs: ${(run.context_ids||run.contexts?.map(context=>context.id)||[]).join(', ')}`).join('\n\n')}`).join('\n\n')}\n\n## Limitations\n\n${(data.limitations||[]).map(item=>'- '+item).join('\n')}\n\nReview instructions: https://github.com/JASHD12/datapilot/blob/main/docs/GENERATION_REVIEW.md\n\nReproduction: https://github.com/JASHD12/datapilot/blob/main/docs/GENERATION_STUDY.md\n`;
  }
  function downloadStudy(kind, format) {
    try {
      const data=studyExport(kind);
      const body=format==='json'?JSON.stringify(data,null,2):kind==='generation'?generationStudyMarkdown(data):kind==='review'?`# ${data.title}\n\n${data.question}\n\n## Protocol\n\nRetrospective chronological study. Candidate selection uses validation only. Test results were already inspected in earlier work; this is not pristine unseen research evidence.\n\nSelected model: ${data.selected_model?.name}\n\n## Results\n\n${Object.entries(data.evaluations||{}).map(([cohort,result])=>`### ${cohort}\n\nReviews: ${result.rows}\nMacro F1: ${result.metrics?.macro_f1}\nMajority macro F1: ${result.baseline_metrics?.macro_f1}\nAccuracy: ${result.metrics?.accuracy}`).join('\n\n')}\n\n## Findings\n\n${(data.findings||[]).map(item=>'- '+item).join('\n')}\n\n## Limitations\n\n${(data.limitations||[]).map(item=>'- '+item).join('\n')}\n\nSource: ${data.source?.source_url||datasetUrl}\n\nFull experiment: https://github.com/JASHD12/datapilot/blob/main/docs/REVIEW_STUDY.md\n`:`# ${data.title}\n\n${data.scope}\n\n${data.benchmark?.annotation_status}\n\n## Retrieval comparison\n\n${(data.methods||[]).map(method=>`### ${method.label||method.id}\n\n${['dev','test'].map(split=>`${split}: ${JSON.stringify(retrievalMetrics(method,split))}`).join('\n\n')}`).join('\n\n')}\n\n## Limitations\n\n${(data.limitations||[]).map(item=>'- '+item).join('\n')}\n\nFull experiment: https://github.com/JASHD12/datapilot/blob/main/docs/RETRIEVAL_STUDY.md\n`;
      const url=URL.createObjectURL(new Blob([body],{type:format==='json'?'application/json':'text/markdown;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`datapilot-${kind}-study.${format==='json'?'json':'md'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) {toast(error.message,true);}
  }
  function semanticProgress(value) {
    if(typeof value==='string')return value;
    const status=value?.status||'Loading model';
    return `${status}${value?.file?' · '+String(value.file).split('/').pop():''}${Number.isFinite(value?.progress)?' · '+Math.round(value.progress)+'%':''}`;
  }
  function updateSemanticProgress(value, requestId) {
    if(requestId!==semanticRequestId)return;
    state.semantic.progress=semanticProgress(value);
    const status=$('#semantic-status');if(status)status.textContent=state.semantic.progress;
  }
  async function loadSemantic() {
    if(state.semantic.status==='loading'||state.semantic.pending)return;
    const id=++semanticRequestId;
    semanticClient?.cancel();semanticClient=null;
    state.semantic={...state.semantic,status:'loading',progress:'Opening the optional browser encoder…',error:null,result:null,modelInfo:null};render();
    let timer;
    try {
      const module=await import('./semantic-search.js?v=0.3.0');
      if(id!==semanticRequestId)return;
      semanticClient=new module.SemanticSearch(new URL('./retrieval-study.json?v=0.3.0',document.baseURI).href);
      const info=await Promise.race([semanticClient.load(progress=>updateSemanticProgress(progress,id)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Model loading exceeded the three-minute browser limit.')),180000);})]);
      if(id!==semanticRequestId)return;
      state.semantic.status='ready';state.semantic.progress='Model ready. Query encoding runs in this browser.';state.semantic.modelInfo=info;
      toast('Semantic model ready. You can now search the passage corpus.');
    } catch(error) {
      if(id===semanticRequestId){semanticClient?.cancel();state.semantic.status='error';state.semantic.error=error.message||'The browser model could not be opened.';}
    } finally {
      clearTimeout(timer);
      if(id===semanticRequestId&&state.route==='studies'&&state.studyTab==='retrieval')render();
    }
  }
  function cancelSemantic() {
    semanticRequestId+=1;semanticClient?.cancel();semanticClient=null;
    state.semantic={...state.semantic,status:'idle',pending:false,progress:'Model operation canceled.',error:null,modelInfo:null};
    render();toast('Semantic operation canceled. Recorded study results are still available.');
  }
  async function runSemanticSearch(data) {
    if(state.semantic.status!=='ready'||!semanticClient)return toast('Load the semantic model before searching.');
    if(state.semantic.pending)return;
    const query=String(data.query||'').trim(),mode=data.mode==='dense'?'dense':'hybrid';
    if(query.length<2||query.length>500)return toast('Enter a query between 2 and 500 characters.',true);
    const id=++semanticRequestId;
    state.semantic={...state.semantic,query,mode,pending:true,error:null,result:null};render();
    let timer;
    try {
      const result=await Promise.race([semanticClient.search(query,{mode,limit:4,onProgress:progress=>updateSemanticProgress(progress,id)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The query exceeded the one-minute browser limit.')),60000);})]);
      if(id!==semanticRequestId)return;
      state.semantic.result=result;
    } catch(error) {
      if(id===semanticRequestId){semanticClient?.cancel();semanticClient=null;state.semantic.status='error';state.semantic.error=error.message||'The query could not be processed.';}
    } finally {
      clearTimeout(timer);
      if(id===semanticRequestId){state.semantic.pending=false;if(state.route==='studies'&&state.studyTab==='retrieval'){render();if(state.semantic.result)revealResult('semantic-result');}}
    }
  }

  function updateGenerationProgress(value, requestId) {
    if(requestId!==generationRequestId)return;
    state.generation.progress=semanticProgress(value);
    const status=$('#generation-status');if(status)status.textContent=state.generation.progress;
  }
  async function loadGeneration() {
    if(state.generation.status==='loading'||state.generation.pending)return;
    const id=++generationRequestId;
    generationClient?.dispose();generationClient=null;
    state.generation={...state.generation,status:'loading',progress:'Checking the live service…',error:null,result:null,retrieval:null,modelInfo:null};render();
    let timer;
    try {
      const module=await import('./generation.js?v=0.4.0');
      if(id!==generationRequestId)return;
      generationClient=new module.GenerationClient();
      const info=await Promise.race([generationClient.load(progress=>updateGenerationProgress(progress,id)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The service check exceeded 15 seconds.')),15000);})]);
      if(id!==generationRequestId)return;
      state.generation={...state.generation,status:'ready',progress:'Live demo connected. Generating sends your question to Cloudflare.',modelInfo:info};
      toast('Live demo connected. Try a question about the public sources.');
    } catch(error) {
      if(id===generationRequestId){generationClient?.cancel();generationClient=null;state.generation={...state.generation,status:'error',error:error.message||'The live service could not be reached.',pending:false,result:null,retrieval:null};}
    } finally {
      clearTimeout(timer);
      if(id===generationRequestId&&state.route==='studies'&&state.studyTab==='generation')render();
    }
  }
  function cancelGeneration(shouldRender=true) {
    generationRequestId+=1;generationClient?.cancel();generationClient=null;
    state.generation={...state.generation,status:'idle',pending:false,progress:'Stopped waiting. A request already sent may still finish on Cloudflare. Reconnect to try again.',error:null,result:null,retrieval:null,modelInfo:null};
    if(shouldRender)render();
  }
  async function runGeneration(data) {
    if(state.generation.status!=='ready'||!generationClient)return toast('Connect to the live demo before generating an answer.');
    if(state.generation.pending)return;
    const question=String(data.question||'').trim();
    if(question.length<2||question.length>1000)return toast('Enter a question between 2 and 1,000 characters.',true);
    const id=++generationRequestId;
    state.generation={...state.generation,query:question,pending:true,progress:'Sending the question to Cloudflare for retrieval and generation…',error:null,result:null,retrieval:null};render();
    let timer;
    try {
      const result=await Promise.race([generationClient.generate(question,[],'grounded',progress=>updateGenerationProgress(progress,id)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('No answer arrived within one minute. The remote request may still finish.')),60000);})]);
      if(id!==generationRequestId)return;
      state.generation.result=result;
      state.generation.retrieval=result.retrieval||null;
    } catch(error) {
      if(id===generationRequestId){generationClient?.cancel();generationClient=null;state.generation={...state.generation,status:'error',error:error.message||'The answer could not be generated.',result:null};}
    } finally {
      clearTimeout(timer);
      if(id===generationRequestId){state.generation.pending=false;if(state.route==='studies'&&state.studyTab==='generation'){render();if(state.generation.result)revealResult('generation-result');}}
    }
  }
  function downloadLiveGeneration() {
    if(!state.generation.result)return;
    const body={question:state.generation.query,run:state.generation.result,retrieval:state.generation.retrieval,review:null,annotation_status:'not_human_reviewed',scope:'A live Cloudflare-hosted run, separate from the saved evaluation. Citation-format checks do not establish factual support.'};
    const url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='datapilot-live-generation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function project() {
    const rows = profile().charts?.daily_orders || [];
    const capabilities = [
      ['explore','Data exploration','Schema, missingness, preview and distributions. Establish the dataset before interpreting a result.',['pandas','SQL-ready schema'],'IMPLEMENTED'],
      ['models','Model comparisons','Classification and regression with fixed baselines, temporal evaluation and visible feature exclusions.',['scikit-learn','FastAPI'],'IMPLEMENTED'],
      ['forecast','Time-series analysis','Lag-based forecasting, a seasonal baseline and an inspectable rolling backtest.',['Ridge','Temporal holdout'],'IMPLEMENTED'],
      ['segments','Operational profiles','K-means segmentation and Isolation Forest scores, labeled as exploratory findings.',['K-means','Isolation Forest'],'IMPLEMENTED'],
      ['knowledge','Source-aware retrieval','Compare lexical, multilingual dense and hybrid passage retrieval with a versioned evaluation protocol.',['TF-IDF','Multilingual embeddings','Hybrid RRF'],'IMPLEMENTED'],
      ['reviews','Customer review analysis','Portuguese review rating-group classification, recurring complaint keywords and source-linked excerpts.',['TF-IDF','Logistic regression'],state.workspace.review_analysis ? 'IMPLEMENTED' : 'ROADMAP'],
      ['studies','Research studies','Inspect classification robustness, retrieval judgments and actual grounded generation, with downloadable failures and timing records.',['Error analysis','LLM evaluation'],'IMPLEMENTED'],
      ['ask','Further AI experiments','Independent retrieval judgments, neural reranking, transformer fine-tuning and broader evaluation datasets.',['Human review','Neural models'],'ROADMAP'],
    ];
    return `<div class="project-page">${heading('A project by Jashdeep Singh','DataPilot','A reusable AI, machine learning and data science workbench. One project, built around inspectable results.')}
    <section class="project-hero"><div class="hero-copy"><div class="eyebrow">DATA / MODELS / EVIDENCE</div><h1>From raw records<br>to <em>inspectable insights.</em></h1><p>Explore data, compare predictive models and investigate questions through numerical tools and cited documents. See the result and the evidence behind it.</p><div class="hero-actions"><a href="#explore" class="button primary large">Open the workbench <span aria-hidden="true">↗</span></a>${repoButton('button large')}</div><p class="hero-note">${state.replay ? source().kind === 'public' ? 'PUBLIC OLIST WORKSPACE · HISTORICAL DATA / LIVE BROWSER TOOLS' : 'SYNTHETIC REPLAY · LOCALLY COMPUTED RESULTS' : 'LOCAL APPLICATION · UPLOAD AND TRAIN'}</p></div><div class="hero-instrument"><div class="instrument-top"><span><span class="status-dot"></span>ACTIVE DATASET</span><span>DATAPILOT / 01</span></div><div class="instrument-number"><strong>${number(profile().rows)}</strong><span>RECORDED ROWS</span></div>${lineChart(rows.slice(-45),undefined,170)}<div class="instrument-foot"><span>${esc(source().label)}</span><span>PROVENANCE VISIBLE</span></div></div></section>
    <div class="project-meta"><div><span>PROJECT TYPE</span><strong>AI / ML / Data Science</strong></div><div><span>DELIVERY</span><strong>Python API + browser workbench</strong></div><div><span>STATUS</span><strong>Versioned experiments + live tools</strong></div></div>
    <div class="project-intro"><h2>Broad capabilities.<br>A concrete workflow.</h2><p>The same workspace connects data quality, predictive modeling, forecasting and documentary evidence. A real Olist workspace connects delivery models, order forecasting, operational profiles and customer reviews. Configurable uploads let the local application work with other compatible datasets. Claims are tied to their data source and evaluation setup.</p></div>
    <div class="capability-grid">${capabilities.map(([glyph,title,text,tags,status])=>`<article class="capability"><div class="capability-top"><span class="capability-icon">${icon(glyph)}</span><span class="tag ${status==='ROADMAP'?'amber':''}">${status}</span></div><h3>${title}</h3><p>${text}</p><div class="stack-list">${tags.map(tag=>`<span class="stack-chip">${tag}</span>`).join('')}</div></article>`).join('')}</div>
    <section class="panel architecture"><div class="section-heading" style="margin-top:0"><h2>The system, at a glance</h2><span class="panel-tag">REPRODUCIBLE BY DESIGN</span></div><div class="architecture-flow">${[['01','Data & documents','Validated CSVs and a versioned source library'],['02','Analysis & models','Profiles, fixed comparisons and temporal backtests'],['03','Tools & evidence','Stored metrics, source retrieval and bounded routing'],['04','The workbench','A visible result, assumptions and an audit trail']].map(([n,title,text],i)=>`${i?'<span class="architecture-arrow" aria-hidden="true">→</span>':''}<div class="architecture-node"><span>${n}</span><strong>${title}</strong><small>${text}</small></div>`).join('')}</div><div class="architecture-footer">Full-data evaluation is saved. Small sample comparisons train in your browser, alongside predictions, search and reports. Full-data training and uploads use the local application. No provider key is embedded.</div></section>
    <div class="grid-equal space-top">${panel('What makes the work inspectable','Implementation choices that matter in a review.',`<ul class="detail-list"><li><span>Metrics</span><strong>Computed, never decorative</strong></li><li><span>Validation</span><strong>Time boundaries and baseline comparisons</strong></li><li><span>Evidence</span><strong>Tool outputs and cited passages</strong></li><li><span>Limits</span><strong>Visible alongside the results</strong></li></ul>`,'ENGINEERING CHOICES')}${panel('Next research questions','Planned work, not completed claims.',`<ol class="roadmap"><li><span>01</span><div><h3>Independent relevance review</h3><p>Have a reviewer check the seed questions and passage judgments, then evaluate a new question set.</p></div></li><li><span>02</span><div><h3>Model generalization</h3><p>Evaluate additional real datasets and predictive tasks with suitable labels.</p></div></li><li><span>03</span><div><h3>Multimodal evidence</h3><p>Add document extraction and evaluate field-level correctness.</p></div></li></ol>`,'ROADMAP')}</div>
    <section class="study-project-callout"><div><div class="eyebrow">GO DEEPER / THREE REPRODUCIBLE STUDIES</div><h2>Challenge the score.</h2><p>Does a review classifier work on unfamiliar wording? Does retrieval find evidence? Can a language model cite its sources and abstain? Inspect the protocol, failures and measured results.</p></div><div class="study-actions"><a class="button primary" href="#studies">Open research studies <span aria-hidden="true">↗</span></a>${studyDoc('docs/WALKTHROUGH.md','Technical walkthrough')}</div></section>
    ${attribution()}${note(source().description || 'Results describe only the active dataset. The versioned studies document historical experiments and their limitations.')}
    <section class="project-final"><div><h2>Inspect the project yourself.</h2><p>Follow a dataset from its source through a model comparison to an evidence report.</p></div><a class="button large" href="#models">Explore the results <span aria-hidden="true">↗</span></a></section></div>`;
  }

  function render() {
    if (!state.workspace) return;
    const candidate = location.hash.slice(1) || 'project';
    state.route = Object.hasOwn(labels,candidate) ? candidate : 'project';
    $('#breadcrumb-title').textContent = labels[state.route];
    document.querySelectorAll('[data-route]').forEach(link => { link.classList.toggle('active',link.dataset.route===state.route); link.setAttribute('aria-current',link.dataset.route===state.route?'page':'false'); });
    main.innerHTML = ({project,explore,models,forecast,segments,reviews,knowledge,ask,studies})[state.route]();
    document.querySelectorAll('[data-suggestion]').forEach(element => element.addEventListener('click', () => { const suggestions=['Summarize this Olist workspace','Compare the delivery model results','What do customer reviews say about delivery problems?','Show the historical order forecast']; const question=suggestions[Number(element.dataset.suggestion)]; $('#question').value=question; state.question=question; $('#question').focus(); }));
    if(state.route==='studies'&&state.studies.status==='idle')loadStudies();
  }
  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('The Python API is unavailable at this address.');
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'The request could not be completed. Check the input and try again.');
    return payload;
  }
  async function post(path, data = {}) { return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
  function markConnection() {
    const indicator=$('#connection-indicator'); indicator.className=`connection${state.replay?' replay':''}`;
    indicator.innerHTML=`<span class="status-dot"></span>${state.replay ? source().kind === 'public' ? 'Public Olist demo' : 'Synthetic replay' : 'Local API connected'}`;
    $('#replay-banner').hidden=!state.replay; if(state.replay) $('#replay-banner').innerHTML=`<span class="replay-mark">i</span><span><strong>${source().kind === 'public' ? 'Public Olist workspace' : 'Synthetic demonstration'}</strong> — live sample training, predictions, search and reports. Full-data evaluations are saved; uploads and full-data training use the local app.</span><a href="#project">How it works ↗</a>`;
  }
  function revealResult(id) {
    const element=document.getElementById(id);
    if(!element)return;
    element.focus({preventScroll:true});
    element.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function clearSampleExperiments() {
    sampleRequestId+=1;
    sampleWorker?.terminate(); sampleWorker=null;
    state.samplePending=null; state.sampleResults={}; state.sampleErrors={};
  }
  async function runSampleComparison(task, target) {
    if(state.samplePending)return;
    const id=++sampleRequestId, workspaceHash=state.workspace.dataset_hash;
    state.samplePending={id,task}; state.sampleErrors[task]=null;
    render();
    let worker, timer;
    try {
      if(typeof Worker==='undefined')throw new Error('This browser does not support background model training. Use a current browser.');
      if(!samplePayload){
        const response=await fetch('./olist-training-sample.json',{cache:'no-cache'});
        if(!response.ok)throw new Error('The training sample could not be downloaded.');
        samplePayload=await response.json();
      }
      if(id!==sampleRequestId||state.workspace.dataset_hash!==workspaceHash)return;
      const dataset=samplePayload.tasks?.[task];
      if(!dataset||dataset.target!==target)throw new Error('The public sample supports only its fixed delivery targets.');
      if(samplePayload.source?.archive_sha256!==source().archive_sha256)throw new Error('The sample does not match this workspace source.');
      worker=new Worker(new URL('./browser-training.js?v=0.3.0',document.baseURI));
      sampleWorker=worker;
      const result=await new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(new Error('Training exceeded the 30-second demo limit.')),30000);
        worker.onerror=()=>reject(new Error('The browser training worker could not run.'));
        worker.onmessageerror=()=>reject(new Error('The training result could not be read.'));
        worker.onmessage=event=>{
          const message=event.data;
          if(message?.id!==id)return;
          if(message.error)reject(new Error(message.error));
          else if(message.result)resolve(message.result);
        };
        worker.postMessage({id,task,target,dataset,seed:42});
      });
      if(id!==sampleRequestId||state.workspace.dataset_hash!==workspaceHash)return;
      result.split=dataset.split;
      result.limitations=[...(result.limitations||[]),...(dataset.limitations||[])];
      result.provenance={execution:'Live training in a browser Web Worker',source:samplePayload.source,
        sample_sha256:dataset.sample_sha256,seed:42,recorded_at:new Date().toISOString()};
      state.sampleResults[task]=result;
      toast('Sample comparison complete. The full-data benchmark is unchanged.');
    } catch(error) {
      if(id===sampleRequestId)state.sampleErrors[task]=error.message;
    } finally {
      clearTimeout(timer); worker?.terminate();
      if(id===sampleRequestId){
        sampleWorker=null; state.samplePending=null;
        if(state.route==='models'){
          render();
          if(state.sampleResults[task])revealResult('sample-'+task);
        }
      }
    }
  }
  async function mutate(operation, message) {
    if (state.replay) return toast('This is a saved replay. Run DataPilot locally to upload data or train models.');
    if (state.busy) return;
    state.busy=true;
    document.querySelectorAll('button').forEach(button=>button.disabled=true);
    toast('Working locally. The result will appear when the operation completes.');
    try { await operation(); clearSampleExperiments(); state.workspace=await api('/api/workspace'); state.answer=null; render(); toast(message); }
    catch(error) { toast(error.message,true); render(); }
    finally { state.busy=false; }
  }
  document.addEventListener('click', event => {
    const target=event.target.closest('[data-action]'); if(!target)return;
    const action=target.dataset.action;
    if(action==='study-tab') { const next=['review','retrieval','generation'].includes(target.dataset.tab)?target.dataset.tab:'review';if(next!=='generation'&&(state.generation.pending||state.generation.status==='loading'))cancelGeneration(false);state.studyTab=next;render();document.querySelector(`[data-action="study-tab"][data-tab="${state.studyTab}"]`)?.focus();return; }
    if(action==='reload-studies') { state.studies.status='idle';render();return; }
    if(action==='download-study-markdown'||action==='download-study-json') { downloadStudy(['review','retrieval','generation'].includes(target.dataset.study)?target.dataset.study:'review',action.endsWith('json')?'json':'markdown');return; }
    if(action==='load-generation') { loadGeneration();return; }
    if(action==='cancel-generation') { cancelGeneration();return; }
    if(action==='reveal-generation') { revealResult('generation-live-panel');return; }
    if(action==='download-live-generation') { downloadLiveGeneration();return; }
    if(action==='generation-example') { if(state.generation.pending||state.generation.status==='loading')return;state.generation={...state.generation,query:target.dataset.example==='unsupported'?"What is Olist's current refund policy?":'What does mean absolute error measure?',result:null,retrieval:null};render();$('#generation-query')?.focus();return; }
    if(action==='load-semantic') { loadSemantic();return; }
    if(action==='reveal-semantic') { revealResult('semantic-search-panel');return; }
    if(action==='cancel-semantic') { cancelSemantic();return; }
    if(action==='upload-dataset'||action==='upload-knowledge') { if(state.replay)return toast('Uploads run in the local Python application. See the project README for setup.'); $(action==='upload-dataset'?'#dataset-file':'#knowledge-file').click(); }
    if(action==='load-olist') { loadOlist(); return; }
    if(action==='view-comparison') { revealResult('recorded-'+target.dataset.task); return; }
    if(action==='view-forecast') { revealResult('recorded-forecast'); return; }
    if(action==='view-segments') { revealResult('recorded-segments'); return; }
    if(action==='combined-report') { state.answer=browserAnswer('Generate combined report'); state.question='Generate combined report'; render(); return; }
    if(action==='download-report') { downloadReport(); return; }
    if(action==='reset-demo') mutate(()=>post('/api/datasets/demo'),'Synthetic demonstration loaded.');
    if(action==='run-segments') mutate(()=>post('/api/segments'),'Profile analysis completed.');
    if(action==='export-results') { const blob=new Blob([JSON.stringify({source:source(),dataset_hash:state.workspace.dataset_hash,recorded_full_data_results:results(),live_browser_sample_results:state.sampleResults},null,2)],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='datapilot-results.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000); }
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-form]'); if(!form)return; event.preventDefault();
    const kind=form.dataset.form, data=Object.fromEntries(new FormData(form));
    if(kind==='grounded-generation')return runGeneration(data);
    if(kind==='semantic-search')return runSemanticSearch(data);
    if(kind==='predict-order') { predictOrder(data); render(); return; }
    if(kind==='review-search') { state.reviewSearch=data.query; render(); return; }
    if(kind.startsWith('train-')) {
      const task=kind.slice(6);
      if(state.replay&&source().kind==='public')return runSampleComparison(task,data.target);
      return mutate(()=>post('/api/models/train',{task,target:data.target}),'Model comparison completed.');
    }
    if(kind==='forecast')return mutate(()=>post('/api/forecast',data),'Forecast completed.');
    if(kind==='search') {
      state.searchQuery=data.query; state.searchDone=true;
      try { if(state.replay) { state.search=rankedSearch(data.query); } else state.search=(await post('/api/knowledge/search',{query:data.query})).results || []; render(); }
      catch(error){toast(error.message,true);} return;
    }
    if(kind==='ask') {
      state.question=data.question;
      const submit=$('button[type="submit"],button:not([type])',form); if(submit)submit.disabled=true;
      try { if(state.replay) { state.answer=browserAnswer(data.question); } else state.answer=await post('/api/assistant',{question:data.question}); render(); }
      catch(error){toast(error.message,true);if(submit)submit.disabled=false;}
    }
  });
  document.addEventListener('change',event=>{
    const target=event.target.closest('[data-study-control]');if(!target)return;
    const key=target.dataset.studyControl;
    if(!['studyCohort','studyQuestionSplit','studyQuestionLanguage','studyQuestionKind','studyCaseId','studyRetrievalMethod','studyGenerationSplit','studyGenerationCaseId','studyGenerationMethod'].includes(key))return;
    state[key]=target.value;
    if(['studyQuestionSplit','studyQuestionLanguage','studyQuestionKind'].includes(key))state.studyCaseId='';
    if(key==='studyGenerationSplit')state.studyGenerationCaseId='';
    const id=target.id;render();document.getElementById(id)?.focus({preventScroll:true});
  });
  for(const [id,path,label] of [['dataset-file','/api/datasets/upload','Dataset uploaded.'],['knowledge-file','/api/knowledge/upload','Document added.']]) $( `#${id}`).addEventListener('change',event=>{
    const file=event.target.files[0]; if(!file)return; const body=new FormData();body.append('file',file);
    mutate(()=>api(path,{method:'POST',body}),label);event.target.value='';
  });
  document.addEventListener('input',event=>{if(event.target.id==='generation-query'&&!state.generation.pending&&state.generation.status!=='loading')state.generation.query=event.target.value;});
  window.addEventListener('hashchange',()=>{if(location.hash!=='#studies'&&(state.generation.pending||state.generation.status==='loading'))cancelGeneration(false);render();window.scrollTo({top:0,behavior:'auto'});});
  async function initialize() {
    try { const configResponse=await fetch('./site-config.json');if(configResponse.ok)state.config=await configResponse.json(); }catch{}
    try { state.workspace=await api('/api/workspace'); state.apiWorkspace=state.workspace; }
    catch { try { let snapshot=await fetch('./olist-snapshot.json');if(!snapshot.ok)snapshot=await fetch('./demo-snapshot.json');if(!snapshot.ok)throw new Error('Snapshot not found');state.workspace=await snapshot.json();state.replay=true; }catch { $('#connection-indicator').className='connection offline';$('#connection-indicator').textContent='Not connected';main.innerHTML='<div class="error-page"><div class="eyebrow">WORKSPACE UNAVAILABLE</div><h1>Start the local application.</h1><p>The Python API and saved demonstration are unavailable at this address. From the project directory, install the dependencies and run <code>datapilot serve</code>.</p><p>To prepare a demonstration, run <code>python scripts/build_olist_demo.py --help</code>.</p><button class="button primary" onclick="location.reload()">Try again</button></div>';return; } }
    markConnection();render();
  }
  initialize();
})();
