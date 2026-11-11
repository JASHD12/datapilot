'use strict';

(() => {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const main = $('#main');
  const state = {workspace: null, replay: false, config: {}, route: 'project', answer: null, search: [], busy: false};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const number = (value, digits = 0) => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString('en-US', {maximumFractionDigits: digits}) : '—';
  const percent = value => Number.isFinite(Number(value)) && value !== null ? `${(Number(value) * 100).toFixed(1)}%` : '—';
  const labels = {project: 'Project overview', explore: 'Data exploration', models: 'Model evaluation', forecast: 'Time-series forecasting', segments: 'Segments & unusual profiles', knowledge: 'Document library', ask: 'Evidence reports'};
  const paths = {
    explore: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="13" y="3" width="6" height="6" rx="1"/><rect x="3" y="13" width="6" height="6" rx="1"/><rect x="13" y="13" width="6" height="6" rx="1"/>',
    models: '<path d="m4 16 4-6 5 3 5-8"/><circle cx="4" cy="16" r="2"/><circle cx="8" cy="10" r="2"/><circle cx="13" cy="13" r="2"/><circle cx="18" cy="5" r="2"/>',
    forecast: '<path d="M3 3v16h16M5 14l4-5 4 3 6-7"/><path d="M15 5h4v4"/>',
    segments: '<circle cx="7" cy="7" r="3"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="4"/><circle cx="18" cy="17" r="1"/>',
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
    const cell = value => esc(value !== null && typeof value === 'object' ? JSON.stringify(value) : value ?? '—');
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
    return heading('01 / Data exploration', 'Start with the evidence.', 'Inspect the shape, quality and provenance of your data before asking a model to learn from it.', `${button('reset-demo', 'Load synthetic demo')}${button('upload-dataset', 'Upload CSV', true)}`) + strip() +
      `<div class="metrics">${metric('Dataset rows', number(p.rows), 'Records in the active workspace', 'database')}${metric('Columns', number(typeof p.columns === 'number' ? p.columns : p.column_count), `${number(p.numerical?.length)} numeric / ${number(p.categorical?.length)} categorical`)}${metric('Missing cells', number(p.missing_cells), 'Missing values retained for inspection', 'shield')}${metric('Duplicate rows', number(p.duplicate_rows), 'Exact duplicates across all fields', 'models')}</div>` +
      `<div class="grid-two">${panel('Order activity', 'Observed daily row counts in the dataset.', lineChart((charts.daily_orders || []).slice(-90)), 'LAST 90 RECORDED DAYS', 'Counts describe the supplied extract. They do not establish latent customer demand.')}${panel('Category mix', 'Top recorded categories.', bars(charts.categories), 'DATA DISTRIBUTION')}</div>` +
      `<div class="section-heading"><h2>A closer look at the records</h2><p>First ${Math.min(12, p.preview?.length || 0)} rows · scroll to inspect all fields</p></div><section class="panel">${table(p.preview, null, 12)}</section>` +
      details('Column quality report', columns) + details('Numerical summaries', p.summary || {}) + note(source().description || 'Confirm the provenance and permitted use of uploaded data.');
  }
  function models() {
    return heading('02 / Model evaluation', 'Compare. Then explain.', 'Evaluate fixed model families against simple baselines. Inspect the prediction target, inputs and holdout before interpreting a score.', button('export-results', 'Export results')) + strip() +
      `<div class="model-intro"><section class="model-card"><div class="eyebrow">BINARY CLASSIFICATION</div><h2>Predict an outcome</h2><p>Compare a majority baseline, logistic regression and a random forest on a binary target.</p><form data-form="train-classification" class="model-controls"><div class="field"><label for="classification-target">TARGET COLUMN</label><input id="classification-target" name="target" value="${esc(results().classification?.target || 'delivery_late')}" required maxlength="128"></div><button class="button primary" ${state.replay ? 'disabled' : ''}>Run comparison</button></form></section><section class="model-card"><div class="eyebrow">REGRESSION</div><h2>Estimate a quantity</h2><p>Compare a median baseline, ridge regression and a random forest on a numeric target.</p><form data-form="train-regression" class="model-controls"><div class="field"><label for="regression-target">TARGET COLUMN</label><input id="regression-target" name="target" value="${esc(results().regression?.target || 'delivery_days')}" required maxlength="128"></div><button class="button primary" ${state.replay ? 'disabled' : ''}>Run comparison</button></form></section></div>` +
      (results().classification || results().regression ? taskResult(results().classification) + taskResult(results().regression) : panel('Your experiment results', '', empty('Ready when your data is', 'Run a comparison above. Metrics and model assumptions will appear here.'))) +
      note('The initial delivery workflow excludes known post-outcome fields. Column-name checks cannot prove that arbitrary uploaded data are free from leakage. Confirm the prediction-time availability of every input.');
  }
  function forecast() {
    const f = results().forecast;
    const form = `<form data-form="forecast" class="model-controls"><div class="field"><label for="forecast-date">DATE COLUMN</label><input id="forecast-date" name="date_column" value="${esc(f?.date_column || 'purchase_date')}" maxlength="128" required></div><button class="button primary" ${state.replay ? 'disabled' : ''}>Run forecast</button></form>`;
    let html = heading('03 / Time series', 'Look ahead, with context.', 'Forecast daily row counts using only earlier observations. Compare the learned model with a weekly seasonal baseline.') + strip() + panel('Forecast setup', 'At least 84 calendar days are required. Verify that the extract contains complete history.', form, '14-DAY OUTPUT');
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
    return heading('05 / Grounded retrieval', 'Keep the source in sight.', 'Search supplied documents with a local TF-IDF lexical baseline. Sources and passages remain visible. Dense embeddings and reranking are planned extensions.', button('upload-knowledge', 'Add document', true)) +
      `<form data-form="search" class="knowledge-search"><label class="sr-only" for="document-search">Search documents</label><input class="search-input" id="document-search" name="query" placeholder="Search for validation, source data, policy…" value="${esc(state.searchQuery || '')}" required minlength="2"><button class="button primary">Search documents</button></form>` +
      documentCards(state.workspace.documents || []) + (state.searchDone ? `<div class="section-heading"><h2>Retrieved passages</h2><p>${state.search.length} matches · ${state.replay ? 'saved excerpts / keyword matching' : 'TF-IDF lexical similarity'}</p></div><div class="search-results">${state.search.length ? state.search.map(hit => `<article class="search-result"><h3>${esc(hit.title)}</h3><p>${esc(hit.text)}</p><div class="search-result-meta">${esc(hit.section || '')} · ${esc(hit.source)}${hit.score !== undefined ? ` · score ${number(hit.score, 3)}` : ''}</div></article>`).join('') : empty('No supporting passage found', 'Try a more specific term or add a document that contains the information.')}</div>` : '') + note('The bundled operations policy is fictional example content. It is not a policy of the public dataset publisher or any real company. Retrieved text is treated as evidence, never as instructions to execute.');
  }
  function answerMarkup(response) {
    if (!response) return '';
    const calls = response.tool_calls || [], sources = response.sources || [];
    return `<div class="answer"><div class="answer-title"><span class="status-dot"></span>${response.mode === 'optional_llm' ? 'OPTIONAL MODEL SYNTHESIS' : 'EVIDENCE REPORT · NO LLM GENERATION'}</div><div class="answer-content">${esc(response.answer || 'No answer was returned.')}</div>${sources.length ? `<div class="evidence-list">${sources.map((item,i)=>`<div class="evidence-item"><strong>[${i+1}] ${esc(item.title || item.source || item.id)}</strong><br>${esc(item.section || '')} · ${esc(item.source || item.id)}</div>`).join('')}</div>` : ''}${details('Numerical and retrieval evidence',response.evidence || [])}${details('Tool trace',calls)}${details('Workflow',response.workflow || {})}${limits(response.limitations)}</div>`;
  }
  function ask() {
    const examples = state.workspace.examples || [];
    const suggestions = examples.length ? examples.map(example => example.question) : ['Summarize the dataset and missing values.', 'Show the recorded classification model metrics.', 'What are the limitations of this demonstration?'];
    return heading('06 / Ask DataPilot', 'An answer you can inspect.', 'Ask about the active dataset, recorded metrics or supplied documents. The default workflow uses read-only tools and deterministic evidence reports.') +
      `<div class="ask-layout"><section class="panel"><form class="ask-form" data-form="ask"><label class="code-label" for="question">YOUR QUESTION</label><textarea id="question" name="question" maxlength="2000" minlength="2" required placeholder="What do the recorded model results show?">${esc(state.question || '')}</textarea><div class="ask-form-footer"><p>${state.replay ? 'Saved demonstration answers only. Run locally for new questions.' : 'No API key required. Model generation is optional and off by default.'}</p><button class="button primary">Inspect evidence <span aria-hidden="true">↗</span></button></div><div class="suggestions">${suggestions.slice(0,4).map((question,i)=>`<button type="button" class="suggestion" data-suggestion="${i}">${esc(question)}<span aria-hidden="true">↗</span></button>`).join('')}</div></form>${answerMarkup(state.answer)}</section><aside>${panel('The evidence path','What happens behind an answer.', [['01','Understand the question','Choose a supported read-only analysis route.'],['02','Read tools and sources','Use stored metrics, profile facts and retrieved passages.'],['03','Compose and validate','Keep source references visible and acknowledge missing evidence.']].map(([n,title,text])=>`<div class="method-step"><span class="method-number">${n}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join(''), 'BOUNDED WORKFLOW')}${note('A model association does not establish causality. Unsupported questions should produce a limitation, not an invented explanation.')}</aside></div>`;
  }
  function repoButton(className = 'button') {
    const url = state.config.github_url;
    return url && /^https:\/\/github\.com\//.test(url) ? `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>` : `<span class="tag neutral">Repository publication in progress</span>`;
  }
  function project() {
    const rows = profile().charts?.daily_orders || [];
    const capabilities = [
      ['explore','Data exploration','Schema, missingness, preview and distributions. Establish the dataset before interpreting a result.',['pandas','SQL-ready schema'],'IMPLEMENTED'],
      ['models','Model comparisons','Classification and regression with fixed baselines, temporal evaluation and visible feature exclusions.',['scikit-learn','FastAPI'],'IMPLEMENTED'],
      ['forecast','Time-series analysis','Lag-based forecasting, a seasonal baseline and an inspectable rolling backtest.',['Ridge','Temporal holdout'],'IMPLEMENTED'],
      ['segments','Operational profiles','K-means segmentation and Isolation Forest scores, labeled as exploratory findings.',['K-means','Isolation Forest'],'IMPLEMENTED'],
      ['knowledge','Source-aware retrieval','Local lexical retrieval with document passages and an optional bounded LangGraph workflow.',['TF-IDF','LangGraph optional'],'IMPLEMENTED'],
      ['ask','Evaluated AI extensions','Dense retrieval, reranking, transformer fine-tuning and broader evaluation datasets.',['Embeddings','PyTorch'],'ROADMAP'],
    ];
    return `<div class="project-page">${heading('A project by Jashdeep Singh','DataPilot','A reusable AI, machine learning and data science workbench. One project, built around inspectable results.')}
    <section class="project-hero"><div class="hero-copy"><div class="eyebrow">DATA / MODELS / EVIDENCE</div><h1>From raw records<br>to <em>inspectable insights.</em></h1><p>Explore data, compare predictive models and investigate questions through numerical tools and cited documents. See the result and the evidence behind it.</p><div class="hero-actions"><a href="#explore" class="button primary large">Open the workbench <span aria-hidden="true">↗</span></a>${repoButton('button large')}</div><p class="hero-note">${state.replay ? 'HOSTED REPLAY · LOCALLY COMPUTED RESULTS' : 'LOCAL APPLICATION · UPLOAD AND TRAIN'}</p></div><div class="hero-instrument"><div class="instrument-top"><span><span class="status-dot"></span>ACTIVE DATASET</span><span>DATAPILOT / 01</span></div><div class="instrument-number"><strong>${number(profile().rows)}</strong><span>RECORDED ROWS</span></div>${lineChart(rows.slice(-45),undefined,170)}<div class="instrument-foot"><span>${esc(source().label)}</span><span>PROVENANCE VISIBLE</span></div></div></section>
    <div class="project-meta"><div><span>PROJECT TYPE</span><strong>AI / ML / Data Science</strong></div><div><span>DELIVERY</span><strong>Python API + browser workbench</strong></div><div><span>STATUS</span><strong>Initial working implementation</strong></div></div>
    <div class="project-intro"><h2>Broad capabilities.<br>A concrete workflow.</h2><p>The same workspace connects data quality, predictive modeling, forecasting and documentary evidence. A demonstration dataset makes the system inspectable; configurable uploads let the local application work with other compatible datasets. Claims are tied to their data source and evaluation setup.</p></div>
    <div class="capability-grid">${capabilities.map(([glyph,title,text,tags,status])=>`<article class="capability"><div class="capability-top"><span class="capability-icon">${icon(glyph)}</span><span class="tag ${status==='ROADMAP'?'amber':''}">${status}</span></div><h3>${title}</h3><p>${text}</p><div class="stack-list">${tags.map(tag=>`<span class="stack-chip">${tag}</span>`).join('')}</div></article>`).join('')}</div>
    <section class="panel architecture"><div class="section-heading" style="margin-top:0"><h2>The system, at a glance</h2><span class="panel-tag">REPRODUCIBLE BY DESIGN</span></div><div class="architecture-flow">${[['01','Data & documents','Validated CSVs and a versioned source library'],['02','Analysis & models','Profiles, fixed comparisons and temporal backtests'],['03','Tools & evidence','Stored metrics, source retrieval and bounded routing'],['04','The workbench','A visible result, assumptions and an audit trail']].map(([n,title,text],i)=>`${i?'<span class="architecture-arrow" aria-hidden="true">→</span>':''}<div class="architecture-node"><span>${n}</span><strong>${title}</strong><small>${text}</small></div>`).join('')}</div><div class="architecture-footer">Public hosting serves saved results. Training and uploads run in the local application. No model-provider key is embedded in the browser.</div></section>
    <div class="grid-equal space-top">${panel('What makes the work inspectable','Implementation choices that matter in a review.',`<ul class="detail-list"><li><span>Metrics</span><strong>Computed, never decorative</strong></li><li><span>Validation</span><strong>Time boundaries and baseline comparisons</strong></li><li><span>Evidence</span><strong>Tool outputs and cited passages</strong></li><li><span>Limits</span><strong>Visible alongside the results</strong></li></ul>`,'ENGINEERING CHOICES')}${panel('Next research questions','Planned work, not completed claims.',`<ol class="roadmap"><li><span>01</span><div><h3>Retrieval quality</h3><p>Compare lexical, dense and hybrid retrieval on a checked question set.</p></div></li><li><span>02</span><div><h3>Model generalization</h3><p>Evaluate additional real datasets and predictive tasks with suitable labels.</p></div></li><li><span>03</span><div><h3>Multimodal evidence</h3><p>Add document extraction and evaluate field-level correctness.</p></div></li></ol>`,'ROADMAP')}</div>
    ${note(source().description || 'Results describe only the active dataset. The project is an initial implementation, not a claim of production business impact.')}
    <section class="project-final"><div><h2>Inspect the project yourself.</h2><p>Follow a dataset from its source through a model comparison to an evidence report.</p></div><a class="button large" href="#models">Explore the results <span aria-hidden="true">↗</span></a></section></div>`;
  }

  function render() {
    if (!state.workspace) return;
    const candidate = location.hash.slice(1) || 'project';
    state.route = Object.hasOwn(labels,candidate) ? candidate : 'project';
    $('#breadcrumb-title').textContent = labels[state.route];
    document.querySelectorAll('[data-route]').forEach(link => { link.classList.toggle('active',link.dataset.route===state.route); link.setAttribute('aria-current',link.dataset.route===state.route?'page':'false'); });
    main.innerHTML = ({project,explore,models,forecast,segments,knowledge,ask})[state.route]();
    document.querySelectorAll('[data-suggestion]').forEach(element => element.addEventListener('click', () => { const examples=state.workspace.examples || []; const defaults=['Summarize the dataset and missing values.','Show the recorded classification model metrics.','What are the limitations of this demonstration?']; const question=examples[Number(element.dataset.suggestion)]?.question || defaults[Number(element.dataset.suggestion)]; $('#question').value=question; state.question=question; $('#question').focus(); }));
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
    indicator.innerHTML=`<span class="status-dot"></span>${state.replay?'Saved replay':'Local API connected'}`;
    $('#replay-banner').hidden=!state.replay;
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
    if(action==='reset-demo') mutate(()=>post('/api/datasets/demo'),'Synthetic demonstration loaded.');
    if(action==='run-segments') mutate(()=>post('/api/segments'),'Profile analysis completed.');
    if(action==='export-results') { const blob=new Blob([JSON.stringify({source:source(),dataset_hash:state.workspace.dataset_hash,results:results()},null,2)],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='datapilot-results.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000); }
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-form]'); if(!form)return; event.preventDefault();
    const kind=form.dataset.form, data=Object.fromEntries(new FormData(form));
    if(kind.startsWith('train-')) return mutate(()=>post('/api/models/train',{task:kind.slice(6),target:data.target}),'Model comparison completed.');
    if(kind==='forecast')return mutate(()=>post('/api/forecast',data),'Forecast completed.');
    if(kind==='search') {
      state.searchQuery=data.query; state.searchDone=true;
      try { if(state.replay) { const terms=data.query.toLowerCase().split(/\W+/).filter(word=>word.length>2); state.search=(state.workspace.knowledge_chunks || (state.workspace.documents||[]).flatMap(doc=>(doc.excerpts||[]).map((excerpt,i)=>({id:`${doc.id}-${i}`,title:doc.title,source:doc.source,text:typeof excerpt==='string'?excerpt:excerpt.text||JSON.stringify(excerpt),section:'Saved source excerpt'})))).filter(hit=>terms.some(term=>String(hit.text).toLowerCase().includes(term))).slice(0,6); } else state.search=(await post('/api/knowledge/search',{query:data.query})).results || []; render(); }
      catch(error){toast(error.message,true);} return;
    }
    if(kind==='ask') {
      state.question=data.question;
      const submit=$('button[type="submit"],button:not([type])',form); if(submit)submit.disabled=true;
      try { if(state.replay) { const saved=(state.workspace.examples||[]).find(example=>example.question.trim().toLowerCase()===data.question.trim().toLowerCase()); if(!saved) throw new Error('This replay includes only the saved example questions below. Run locally to ask a new question.'); state.answer=saved.response || saved.answer; } else state.answer=await post('/api/assistant',{question:data.question}); render(); }
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
    try { state.workspace=await api('/api/workspace'); }
    catch { try { const snapshot=await fetch('./demo-snapshot.json');if(!snapshot.ok)throw new Error('Snapshot not found');state.workspace=await snapshot.json();state.replay=true; }catch { $('#connection-indicator').className='connection offline';$('#connection-indicator').textContent='Not connected';main.innerHTML='<div class="error-page"><div class="eyebrow">WORKSPACE UNAVAILABLE</div><h1>Start the local application.</h1><p>The Python API and saved demonstration are unavailable at this address. From the project directory, install the dependencies and run <code>datapilot serve</code>.</p><p>To prepare a hosted replay, run <code>python scripts/build_demo.py</code>.</p><button class="button primary" onclick="location.reload()">Try again</button></div>';return; } }
    markConnection();render();
  }
  initialize();
})();
