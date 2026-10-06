import { getConversionJob } from './preview-storage.js';

const params = new URLSearchParams(location.search);
const jobId = params.get('job');

const refs = {
  loading: document.querySelector('#preview-loading'),
  missing: document.querySelector('#preview-missing'),
  content: document.querySelector('#preview-content'),
  title: document.querySelector('#preview-title'),
  source: document.querySelector('#preview-source'),
  download: document.querySelector('#preview-download'),
  converted: document.querySelector('#sum-converted'),
  mapped: document.querySelector('#sum-mapped'),
  skipped: document.querySelector('#sum-skipped'),
  previewed: document.querySelector('#sum-previewed'),
  tabs: document.querySelector('#category-tabs'),
  search: document.querySelector('#preview-search'),
  sourceEdition: document.querySelector('#source-edition-label'),
  targetEdition: document.querySelector('#target-edition-label'),
  list: document.querySelector('#comparison-list'),
  empty: document.querySelector('#comparison-empty'),
  footnote: document.querySelector('#preview-footnote'),
};

let job = null;
let activeCategory = 'All';
let query = '';
const objectUrls = new Set();

init();

async function init() {
  if (!jobId) return showMissing();
  try {
    job = await getConversionJob(jobId);
    if (!job) return showMissing();
    renderHeader();
    renderTabs();
    renderRows();
    refs.loading.hidden = true;
    refs.content.hidden = false;
  } catch (error) {
    console.error(error);
    showMissing();
  }
}

function showMissing() {
  refs.loading.hidden = true;
  refs.content.hidden = true;
  refs.missing.hidden = false;
}

function renderHeader() {
  const javaToBedrock = job.direction === 'java-to-bedrock';
  refs.title.textContent = javaToBedrock ? 'Java → Bedrock' : 'Bedrock → Java';
  refs.source.textContent = `${job.sourceName} · created ${new Date(job.createdAt).toLocaleString()}`;
  refs.sourceEdition.textContent = javaToBedrock ? 'Java source' : 'Bedrock source';
  refs.targetEdition.textContent = javaToBedrock ? 'Bedrock output' : 'Java output';

  const stats = job.stats || {};
  refs.converted.textContent = Number((stats.mapped || 0) + (stats.passthrough || 0)).toLocaleString();
  refs.mapped.textContent = Number(stats.mapped || 0).toLocaleString();
  refs.skipped.textContent = Number(stats.skipped || 0).toLocaleString();
  refs.previewed.textContent = Number(job.previewEntries?.length || 0).toLocaleString();

  refs.footnote.textContent = job.previewTruncated
    ? `Visual preview is capped at ${job.previewLimit.toLocaleString()} PNG entries for browser performance. The downloadable pack still contains every converted file.`
    : 'The comparison viewer shows previewable PNG textures found during this conversion. Unsupported or skipped PNGs are shown transparently when available.';

  refs.download.addEventListener('click', () => {
    if (!job.outputBlob) return;
    const url = URL.createObjectURL(job.outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = job.outputFileName || 'converted-pack.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function renderTabs() {
  const entries = job.previewEntries || [];
  const categoryCounts = new Map([['All', entries.length]]);
  for (const entry of entries) {
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) || 0) + 1);
  }

  const preferred = ['All', 'Blocks', 'Items', 'Mobs', 'Fonts', 'GUI', 'Environment', 'Other Images'];
  for (const category of preferred) {
    const count = categoryCounts.get(category);
    if (!count && category !== 'All') continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preview-tab' + (category === activeCategory ? ' active' : '');
    button.dataset.category = category;
    button.innerHTML = `<span></span><small></small>`;
    button.children[0].textContent = category;
    button.children[1].textContent = String(count || 0);
    button.addEventListener('click', () => {
      activeCategory = category;
      refs.tabs.querySelectorAll('.preview-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.category === category));
      renderRows();
    });
    refs.tabs.appendChild(button);
  }

  refs.search.addEventListener('input', () => {
    query = refs.search.value.trim().toLowerCase();
    renderRows();
  });
}

function renderRows() {
  cleanupUrls();
  refs.list.innerHTML = '';
  const entries = (job.previewEntries || []).filter(entry => {
    const categoryMatch = activeCategory === 'All' || entry.category === activeCategory;
    const haystack = `${entry.name} ${entry.sourcePath} ${entry.targetPath || ''}`.toLowerCase();
    return categoryMatch && (!query || haystack.includes(query));
  });

  refs.empty.hidden = entries.length > 0;

  const fragment = document.createDocumentFragment();
  for (const entry of entries) fragment.appendChild(buildRow(entry));
  refs.list.appendChild(fragment);
}

function buildRow(entry) {
  const row = document.createElement('article');
  row.className = 'comparison-row';

  const info = document.createElement('div');
  info.className = 'comparison-info';
  const name = document.createElement('strong');
  name.textContent = entry.name;
  const category = document.createElement('span');
  category.textContent = entry.category;
  const path = document.createElement('code');
  path.textContent = entry.sourcePath;
  info.append(name, category, path);

  const source = buildTextureCell(entry.imageBlob, entry.sourcePath, 'Source texture');
  const arrow = document.createElement('div');
  arrow.className = 'comparison-arrow';
  arrow.textContent = '→';

  const target = entry.targetPath
    ? buildTextureCell(entry.imageBlob, entry.targetPath, 'Converted texture')
    : buildMissingCell(entry.reason || 'No compatible output');

  const status = document.createElement('div');
  status.className = `comparison-status ${entry.status}`;
  const statusText = entry.status === 'skipped' ? 'Skipped' : entry.status === 'mapped' ? 'Mapped' : 'Compatible';
  status.innerHTML = `<strong></strong><span></span>`;
  status.children[0].textContent = statusText;
  status.children[1].textContent = entry.targetPath || entry.reason || '';

  row.append(info, source, arrow, target, status);
  return row;
}

function buildTextureCell(blob, path, alt) {
  const cell = document.createElement('div');
  cell.className = 'texture-cell';
  const stage = document.createElement('div');
  stage.className = 'texture-stage checkerboard';
  const img = document.createElement('img');
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  img.src = url;
  img.alt = alt;
  img.loading = 'lazy';
  stage.appendChild(img);

  const code = document.createElement('code');
  code.textContent = path;
  cell.append(stage, code);
  return cell;
}

function buildMissingCell(reason) {
  const cell = document.createElement('div');
  cell.className = 'texture-cell missing-texture';
  const stage = document.createElement('div');
  stage.className = 'texture-stage';
  stage.innerHTML = '<span>—</span>';
  const label = document.createElement('small');
  label.textContent = reason;
  cell.append(stage, label);
  return cell;
}

function cleanupUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

addEventListener('beforeunload', cleanupUrls);
