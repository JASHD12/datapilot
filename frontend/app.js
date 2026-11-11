'use strict';

(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const main = $('#main');
  const state = {workspace: null, replay: false, config: {}, route: 'project', answer: null, search: [], busy: false, prediction: null, reviewSearch: '', apiWorkspace: null};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const number = (value, digits = 0) => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString('en-US', {maximumFractionDigits: digits}) : '—';
  const percent = value => Number.isFinite(Number(value)) && value !== null ? `${(Number(value) * 100).toFixed(1)}%` : '—';
  const labels = {project: 'Project overview', explore: 'Data exploration', models: 'Model evaluation', forecast: 'Time-series forecasting', segments: 'Segments & unusual profiles', reviews: 'Customer review analysis', knowledge: 'Document library', ask: 'Evidence reports'};
  const paths = {
    explore: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="13" y="3" width="6" height="6" rx="1"/><rect x="3" y="13" width="6" height="6" rx="1"/><rect x="13" y="13" width="6" height="6" rx="1"/>',
    models: '<path d="m4 16 4-6 5 3 5-8"/><circle cx="4" cy="16" r="2"/><circle cx="8" cy="10" r="2"/><circle cx="13" cy="13" r="2"/><circle cx="18" cy="5" r="2"/>',
    forecast: '<path d="M3 3v16h16M5 14l4-5 4 3 6-7"/><path d="M15 5h4v4"/>',
    segments: '<circle cx="7" cy="7" r="3"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="4"/><circle cx="18" cy="17" r="1"/>',
    reviews: '<path d="M3 4h16v12H9l-5 4v-4H3zM7 8h8M7 12h5"/>',
    knowledge: '<path d="M5 3h9l4 4v13H5zM14 3v5h4M8 12h7M8 16h5"/>',
    ask: '<path d="M3 4h16v12H9l-5 4v-4H3zM7 8h8M7 12h5"/>',
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
    return `<div class="result-block">${panel(`${result.task === 'classification' ? 'Classification' : 'Regression'} comparison`, `Target: ${result.target} · ${split.method || 'Recorded split'}`, modelTable(result), 'RECORDED METRICS')}
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
  function models() {
    return heading('02 / Model evaluation', 'Compare. Then explain.', 'Evaluate fixed model families against simple baselines. Inspect the prediction target, inputs and holdout before interpreting a score.', button('export-results', 'Export results')) + strip() +
      `<div class="model-intro"><section class="model-card"><div class="eyebrow">BINARY CLASSIFICATION</div><h2>Predict an outcome</h2><p>Compare a majority baseline, logistic regression and a random forest on a binary target.</p><form data-form="train-classification" class="model-controls"><div class="field"><label for="classification-target">TARGET COLUMN</label><input id="classification-target" name="target" value="${esc(results().classification?.target || 'delivery_late')}" required maxlength="128"></div><button class="button primary" ${state.replay ? 'disabled' : ''}>Run comparison</button></form></section><section class="model-card"><div class="eyebrow">REGRESSION</div><h2>Estimate a quantity</h2><p>Compare a median baseline, ridge regression and a random forest on a numeric target.</p><form data-form="train-regression" class="model-controls"><div class="field"><label for="regression-target">TARGET COLUMN</label><input id="regression-target" name="target" value="${esc(results().regression?.target || 'delivery_days')}" required maxlength="128"></div><button class="button primary" ${state.replay ? 'disabled' : ''}>Run comparison</button></form></section></div>` +
      inferencePanel() + (results().classification || results().regression ? taskResult(results().classification) + taskResult(results().regression) : panel('Your experiment results', '', empty('Ready when your data is', 'Run a comparison above. Metrics and model assumptions will appear here.'))) +
      note('The initial delivery workflow excludes known post-outcome fields. Column-name checks cannot prove that arbitrary uploaded data are free from leakage. Confirm the prediction-time availability of every input.');
  }
  function forecast() {
    const f = results().forecast;
    const form = `<form data-form="forecast" class="model-controls"><div class="field"><label for="forecast-date">DATE COLUMN</label><input id="forecast-date" name="date_column" value="${esc(f?.date_column || 'purchase_date')}" maxlength="128" required></div><button class="button primary" ${state.replay ? 'disabled' : ''}>Run forecast</button></form>`;
    let html = heading('03 / Time series', 'Look ahead, with context.', source().kind === 'public' ? 'Historical all-status order counts, January 2017–August 2018. This series differs from the delivered-order modeling cohort.' : 'Forecast daily row counts using only earlier observations. Compare the learned model with a weekly seasonal baseline.') + strip() + panel('Forecast setup', 'At least 84 calendar days are required. Verify that the extract contains complete history.', form, '14-DAY OUTPUT');
    if (!f) return html + panel('Forecast results', '', empty('No forecast recorded', 'Run a forecast above to view the rolling one-day backtest and 14-day recursive projection.'));
    const joined = [...(f.history || []).slice(-35).map(row => ({date: row.date, observed: row.count})), ...(f.forecast || []).map(row => ({...row, observed: null}))];
    html += `<div class="space-top">${panel('Observed history and projection', 'Future values are model output, not observed orders.', lineChart(joined, [{key:'observed', label:'Observed', color:'#167a6e'}, {key:'predicted',label:'Recursive forecast',color:'#5b89a6',dashed:true}, {key:'lower',label:'Exploratory lower band',color:'#bbc8bd',width:1}, {key:'upper',label:'Exploratory upper band',color:'#bbc8bd',width:1}]), '14 DAYS', f.interval?.warning || '')}</div>`;
    html += `<div class="grid-equal space-top">${panel('Rolling one-day backtest', 'Recorded observations become available one day at a time.', lineChart(f.backtest, [{key:'actual',label:'Actual',color:'#167a6e'},{key:'predicted',label:'Ridge prediction',color:'#5b89a6'},{key:'seasonal_naive',label:'Weekly naive',color:'#bbab7d',dashed:true}]), '28-DAY HOLDOUT')}${panel('Baseline comparison', 'These metrics evaluate one-day predictions, not the full recursive horizon.', modelTable(f), 'MAE / RMSE')}</div>` + details('Forecast values and bands', f.forecast) + details('Validation and interval method', {split:f.split, interval:f.interval, model_definitions:f.model_definitions}) + limits(f.limitations);
    return html;
  }
  function segments() {
    const s = results().segments;
    let html = heading('04 / Unsupervised exploration', 'Find structure. Question outliers.', 'Explore numeric operational profiles with K-means and Isolation Forest. An unusual record is a reason to investigate, not a verified incident.', button('run-segments', 'Analyze profiles', true, state.replay ? 'disabled' : '')) + strip();
    if (!s) return html + panel('Profile analysis', '', empty('No analysis recorded', 'Analyze profiles to inspect clusters and unusual numeric records.'));
    html += `<div class="metrics">${metric('Profiles analyzed', number(s.rows), 'Rows in the active dataset')}${metric('Clusters', number(s.cluster_count), 'Arbitrary K-means identifiers', 'segments')}${metric('Silhouette', number(s.silhouette, 3), 'Descriptive separation score', 'models')}${metric('Unusual profiles', number(s.anomaly_count), 'Isolation Forest flags', 'shield')}</div>`;
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
      `<div class="ask-layout"><section class="panel"><form class="ask-form" data-form="ask"><label class="code-label" for="question">YOUR QUESTION</label><textarea id="question" name="question" maxlength="2000" minlength="2" required placeholder="What do the recorded model results show?">${esc(state.question || '')}</textarea><div class="ask-form-footer"><p>${state.replay ? 'Live browser evidence reports. No LLM or API key; training remains local.' : 'No API key required. Model generation is optional and off by default.'}</p><button class="button primary">Inspect evidence <span aria-hidden="true">↗</span></button></div><div class="suggestions">${suggestions.slice(0,4).map((question,i)=>`<button type="button" class="suggestion" data-suggestion="${i}">${esc(question)}<span aria-hidden="true">↗</span></button>`).join('')}</div></form>${answerMarkup(state.answer)}</section><aside>${panel('The evidence path','What happens behind an answer.', [['01','Understand the question','Choose a supported read-only analysis route.'],['02','Read tools and sources','Use stored metrics, profile facts and retrieved passages.'],['03','Compose and validate','Keep source references visible and acknowledge missing evidence.']].map(([n,title,text])=>`<div class="method-step"><span class="method-number">${n}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join(''), 'BOUNDED WORKFLOW')}${note('A model association does not establish causality. Unsupported questions should produce a limitation, not an invented explanation.')}</aside></div>`;
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
    try{const response=await fetch('./olist-snapshot.json');if(!response.ok)throw new Error('The Olist artifact is unavailable. Build scripts/build_olist_demo.py first.');state.workspace=await response.json();state.replay=true;state.answer=null;state.prediction=null;state.search=[];markConnection();render();toast('Historical Olist workspace opened. Browser tools are live; evaluations are saved.');}catch(error){toast(error.message,true);}
  }
  function project() {
    const rows = profile().charts?.daily_orders || [];
    const capabilities = [
      ['explore','Data exploration','Schema, missingness, preview and distributions. Establish the dataset before interpreting a result.',['pandas','SQL-ready schema'],'IMPLEMENTED'],
      ['models','Model comparisons','Classification and regression with fixed baselines, temporal evaluation and visible feature exclusions.',['scikit-learn','FastAPI'],'IMPLEMENTED'],
      ['forecast','Time-series analysis','Lag-based forecasting, a seasonal baseline and an inspectable rolling backtest.',['Ridge','Temporal holdout'],'IMPLEMENTED'],
      ['segments','Operational profiles','K-means segmentation and Isolation Forest scores, labeled as exploratory findings.',['K-means','Isolation Forest'],'IMPLEMENTED'],
      ['knowledge','Source-aware retrieval','Local lexical retrieval with document passages and an optional bounded LangGraph workflow.',['TF-IDF','LangGraph optional'],'IMPLEMENTED'],
      ['reviews','Customer review analysis','Portuguese review rating-group classification, recurring complaint keywords and source-linked excerpts.',['TF-IDF','Logistic regression'],state.workspace.review_analysis ? 'IMPLEMENTED' : 'ROADMAP'],
      ['ask','Evaluated AI extensions','Dense retrieval, reranking, transformer fine-tuning and broader evaluation datasets.',['Embeddings','PyTorch'],'ROADMAP'],
    ];
    return `<div class="project-page">${heading('A project by Jashdeep Singh','DataPilot','A reusable AI, machine learning and data science workbench. One project, built around inspectable results.')}
    <section class="project-hero"><div class="hero-copy"><div class="eyebrow">DATA / MODELS / EVIDENCE</div><h1>From raw records<br>to <em>inspectable insights.</em></h1><p>Explore data, compare predictive models and investigate questions through numerical tools and cited documents. See the result and the evidence behind it.</p><div class="hero-actions"><a href="#explore" class="button primary large">Open the workbench <span aria-hidden="true">↗</span></a>${repoButton('button large')}</div><p class="hero-note">${state.replay ? source().kind === 'public' ? 'PUBLIC OLIST WORKSPACE · HISTORICAL DATA / LIVE BROWSER TOOLS' : 'SYNTHETIC REPLAY · LOCALLY COMPUTED RESULTS' : 'LOCAL APPLICATION · UPLOAD AND TRAIN'}</p></div><div class="hero-instrument"><div class="instrument-top"><span><span class="status-dot"></span>ACTIVE DATASET</span><span>DATAPILOT / 01</span></div><div class="instrument-number"><strong>${number(profile().rows)}</strong><span>RECORDED ROWS</span></div>${lineChart(rows.slice(-45),undefined,170)}<div class="instrument-foot"><span>${esc(source().label)}</span><span>PROVENANCE VISIBLE</span></div></div></section>
    <div class="project-meta"><div><span>PROJECT TYPE</span><strong>AI / ML / Data Science</strong></div><div><span>DELIVERY</span><strong>Python API + browser workbench</strong></div><div><span>STATUS</span><strong>Initial working implementation</strong></div></div>
    <div class="project-intro"><h2>Broad capabilities.<br>A concrete workflow.</h2><p>The same workspace connects data quality, predictive modeling, forecasting and documentary evidence. A real Olist workspace connects delivery models, order forecasting, operational profiles and customer reviews. Configurable uploads let the local application work with other compatible datasets. Claims are tied to their data source and evaluation setup.</p></div>
    <div class="capability-grid">${capabilities.map(([glyph,title,text,tags,status])=>`<article class="capability"><div class="capability-top"><span class="capability-icon">${icon(glyph)}</span><span class="tag ${status==='ROADMAP'?'amber':''}">${status}</span></div><h3>${title}</h3><p>${text}</p><div class="stack-list">${tags.map(tag=>`<span class="stack-chip">${tag}</span>`).join('')}</div></article>`).join('')}</div>
    <section class="panel architecture"><div class="section-heading" style="margin-top:0"><h2>The system, at a glance</h2><span class="panel-tag">REPRODUCIBLE BY DESIGN</span></div><div class="architecture-flow">${[['01','Data & documents','Validated CSVs and a versioned source library'],['02','Analysis & models','Profiles, fixed comparisons and temporal backtests'],['03','Tools & evidence','Stored metrics, source retrieval and bounded routing'],['04','The workbench','A visible result, assumptions and an audit trail']].map(([n,title,text],i)=>`${i?'<span class="architecture-arrow" aria-hidden="true">→</span>':''}<div class="architecture-node"><span>${n}</span><strong>${title}</strong><small>${text}</small></div>`).join('')}</div><div class="architecture-footer">Evaluation is saved; predictions, search and evidence reports run in your browser. Training and uploads run in the local application. No provider key is embedded.</div></section>
    <div class="grid-equal space-top">${panel('What makes the work inspectable','Implementation choices that matter in a review.',`<ul class="detail-list"><li><span>Metrics</span><strong>Computed, never decorative</strong></li><li><span>Validation</span><strong>Time boundaries and baseline comparisons</strong></li><li><span>Evidence</span><strong>Tool outputs and cited passages</strong></li><li><span>Limits</span><strong>Visible alongside the results</strong></li></ul>`,'ENGINEERING CHOICES')}${panel('Next research questions','Planned work, not completed claims.',`<ol class="roadmap"><li><span>01</span><div><h3>Retrieval quality</h3><p>Compare lexical, dense and hybrid retrieval on a checked question set.</p></div></li><li><span>02</span><div><h3>Model generalization</h3><p>Evaluate additional real datasets and predictive tasks with suitable labels.</p></div></li><li><span>03</span><div><h3>Multimodal evidence</h3><p>Add document extraction and evaluate field-level correctness.</p></div></li></ol>`,'ROADMAP')}</div>
    ${attribution()}${note(source().description || 'Results describe only the active dataset. The project is an initial implementation, not a claim of production business impact.')}
    <section class="project-final"><div><h2>Inspect the project yourself.</h2><p>Follow a dataset from its source through a model comparison to an evidence report.</p></div><a class="button large" href="#models">Explore the results <span aria-hidden="true">↗</span></a></section></div>`;
  }

  function render() {
    if (!state.workspace) return;
    const candidate = location.hash.slice(1) || 'project';
    state.route = Object.hasOwn(labels,candidate) ? candidate : 'project';
    $('#breadcrumb-title').textContent = labels[state.route];
    document.querySelectorAll('[data-route]').forEach(link => { link.classList.toggle('active',link.dataset.route===state.route); link.setAttribute('aria-current',link.dataset.route===state.route?'page':'false'); });
    main.innerHTML = ({project,explore,models,forecast,segments,reviews,knowledge,ask})[state.route]();
    document.querySelectorAll('[data-suggestion]').forEach(element => element.addEventListener('click', () => { const suggestions=['Summarize this Olist workspace','Compare the delivery model results','What do customer reviews say about delivery problems?','Show the historical order forecast']; const question=suggestions[Number(element.dataset.suggestion)]; $('#question').value=question; state.question=question; $('#question').focus(); }));
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
    $('#replay-banner').hidden=!state.replay; if(state.replay) $('#replay-banner').innerHTML=`<span class="replay-mark">i</span><span><strong>${source().kind === 'public' ? 'Public Olist workspace' : 'Synthetic demonstration'}</strong> — saved evaluation · live browser predictions, search and evidence reports. Uploads and training require the local app.</span><a href="#project">How it works ↗</a>`;
  }
  async function mutate(operation, message) {
    if (state.replay) return toast('This is a saved replay. Run DataPilot locally to upload data or train models.');
    if (state.busy) return;
    state.busy=true;
    document.querySelectorAll('button').forEach(button=>button.disabled=true);
    toast('Working locally. The result will appear when the operation completes.');
    try { await operation(); state.workspace=await api('/api/workspace'); state.answer=null; render(); toast(message); }
    catch(error) { toast(error.message,true); render(); }
    finally { state.busy=false; }
  }
  document.addEventListener('click', event => {
    const target=event.target.closest('[data-action]'); if(!target)return;
    const action=target.dataset.action;
    if(action==='upload-dataset'||action==='upload-knowledge') { if(state.replay)return toast('Uploads run in the local Python application. See the project README for setup.'); $(action==='upload-dataset'?'#dataset-file':'#knowledge-file').click(); }
    if(action==='load-olist') { loadOlist(); return; }
    if(action==='combined-report') { state.answer=browserAnswer('Generate combined report'); state.question='Generate combined report'; render(); return; }
    if(action==='download-report') { downloadReport(); return; }
    if(action==='reset-demo') mutate(()=>post('/api/datasets/demo'),'Synthetic demonstration loaded.');
    if(action==='run-segments') mutate(()=>post('/api/segments'),'Profile analysis completed.');
    if(action==='export-results') { const blob=new Blob([JSON.stringify({source:source(),dataset_hash:state.workspace.dataset_hash,results:results()},null,2)],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='datapilot-results.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000); }
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-form]'); if(!form)return; event.preventDefault();
    const kind=form.dataset.form, data=Object.fromEntries(new FormData(form));
    if(kind==='predict-order') { predictOrder(data); render(); return; }
    if(kind==='review-search') { state.reviewSearch=data.query; render(); return; }
    if(kind.startsWith('train-')) return mutate(()=>post('/api/models/train',{task:kind.slice(6),target:data.target}),'Model comparison completed.');
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
  for(const [id,path,label] of [['dataset-file','/api/datasets/upload','Dataset uploaded.'],['knowledge-file','/api/knowledge/upload','Document added.']]) $( `#${id}`).addEventListener('change',event=>{
    const file=event.target.files[0]; if(!file)return; const body=new FormData();body.append('file',file);
    mutate(()=>api(path,{method:'POST',body}),label);event.target.value='';
  });
  window.addEventListener('hashchange',()=>{render();window.scrollTo({top:0,behavior:'auto'});});
  async function initialize() {
    try { const configResponse=await fetch('./site-config.json');if(configResponse.ok)state.config=await configResponse.json(); }catch{}
    try { state.workspace=await api('/api/workspace'); state.apiWorkspace=state.workspace; }
    catch { try { let snapshot=await fetch('./olist-snapshot.json');if(!snapshot.ok)snapshot=await fetch('./demo-snapshot.json');if(!snapshot.ok)throw new Error('Snapshot not found');state.workspace=await snapshot.json();state.replay=true; }catch { $('#connection-indicator').className='connection offline';$('#connection-indicator').textContent='Not connected';main.innerHTML='<div class="error-page"><div class="eyebrow">WORKSPACE UNAVAILABLE</div><h1>Start the local application.</h1><p>The Python API and saved demonstration are unavailable at this address. From the project directory, install the dependencies and run <code>datapilot serve</code>.</p><p>To prepare a demonstration, run <code>python scripts/build_olist_demo.py --help</code>.</p><button class="button primary" onclick="location.reload()">Try again</button></div>';return; } }
    markConnection();render();
  }
  initialize();
})();
