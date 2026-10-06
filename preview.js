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
  refs.title.textContent = javaToBedrock
    ? 'Java → Bedrock'
    : 'Bedrock → Java';
  refs.source.textContent =
    `${job.sourceName} · created ${new Date(job.createdAt).toLocaleString()}`;
  refs.sourceEdition.textContent = javaToBedrock
    ? 'Java source'
    : 'Bedrock source';
  refs.targetEdition.textContent = javaToBedrock
    ? 'Bedrock output'
    : 'Java output';

  const stats = job.stats || {};
  refs.converted.textContent = Number(
    (stats.mapped || 0) +
    (stats.passthrough || 0) +
    (stats.customItems || 0) +
    (stats.fontGlyphs || 0)
  ).toLocaleString();
  refs.mapped.textContent = Number(stats.mapped || 0).toLocaleString();
  refs.skipped.textContent = Number(stats.skipped || 0).toLocaleString();
  refs.previewed.textContent = Number(
    job.previewEntries?.length || 0
  ).toLocaleString();

  refs.footnote.textContent = job.previewTruncated
    ? `Generic image preview is capped at ${job.previewLimit.toLocaleString()} PNG entries for browser performance. Custom-item and font result rows are still added separately.`
    : 'For glyphs, U+PPSS maps to font/glyph_PP.png at hexadecimal slot SS. Click editable glyph rows to correct image placement before downloading.';

  refs.download.addEventListener('click', () => {
    if (!job.outputBlob) return;
    downloadBlob(
      job.outputBlob,
      job.outputFileName || 'converted-pack.zip'
    );
  });
}

function renderTabs() {
  const entries = job.previewEntries || [];
  const categoryCounts = new Map([['All', entries.length]]);

  for (const entry of entries) {
    categoryCounts.set(
      entry.category,
      (categoryCounts.get(entry.category) || 0) + 1
    );
  }

  const preferred = [
    'All',
    'Blocks',
    'Items',
    'Mobs',
    'Fonts',
    'GUI',
    'Environment',
    'Other Images',
  ];

  for (const category of preferred) {
    const count = categoryCounts.get(category);
    if (!count && category !== 'All') continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      'preview-tab' +
      (category === activeCategory ? ' active' : '');
    button.dataset.category = category;
    button.innerHTML = '<span></span><small></small>';
    button.children[0].textContent = category;
    button.children[1].textContent = String(count || 0);

    button.addEventListener('click', () => {
      activeCategory = category;
      refs.tabs
        .querySelectorAll('.preview-tab')
        .forEach(tab =>
          tab.classList.toggle(
            'active',
            tab.dataset.category === category
          )
        );
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
    const categoryMatch =
      activeCategory === 'All' ||
      entry.category === activeCategory;

    const metadata = entry.metadata || {};
    const haystack = [
      entry.name,
      entry.sourcePath,
      entry.targetPath,
      metadata.unicode,
      metadata.char,
      metadata.pageHex,
      metadata.slotHex,
      metadata.plugin,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return categoryMatch && (!query || haystack.includes(query));
  });

  refs.empty.hidden = entries.length > 0;

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    fragment.appendChild(
      entry.metadata?.atlasPage
        ? buildAtlasRow(entry)
        : buildRow(entry)
    );
  }

  refs.list.appendChild(fragment);
}

function buildRow(entry) {
  const row = document.createElement('article');
  row.className =
    'comparison-row' +
    (entry.editable ? ' editable-row' : '');

  if (entry.editable) {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute(
      'aria-label',
      `Edit ${entry.name} conversion`
    );

    const openEditor = () => {
      const entryId =
        entry.id ||
        `${entry.sourcePath}|${entry.targetPath || ''}`;
      location.href =
        `./editor.html?job=${encodeURIComponent(job.id)}` +
        `&entry=${encodeURIComponent(entryId)}`;
    };

    row.addEventListener('click', openEditor);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openEditor();
      }
    });
  }

  const info = document.createElement('div');
  info.className = 'comparison-info';

  const name = document.createElement('strong');
  name.textContent = entry.name;

  const category = document.createElement('span');
  category.textContent =
    entry.category +
    (entry.edited
      ? ' · Edited'
      : entry.editable
        ? ' · Click to edit'
        : '');

  const path = document.createElement('code');
  path.textContent = entry.sourcePath;

  info.append(name, category, path);

  if (entry.metadata?.codePoint) {
    info.appendChild(buildGlyphCharacter(entry.metadata));
  }

  const sourceBlob = entry.sourceBlob || entry.imageBlob;
  const targetBlob =
    entry.targetBlob ||
    (entry.targetPath ? sourceBlob : null);

  const source = sourceBlob
    ? buildTextureCell(
        sourceBlob,
        entry.sourcePath,
        'Source texture'
      )
    : buildMissingCell('Source preview unavailable');

  const arrow = document.createElement('div');
  arrow.className = 'comparison-arrow';
  arrow.textContent = '→';

  const target =
    entry.targetPath && targetBlob
      ? buildTextureCell(
          targetBlob,
          entry.targetPath,
          'Converted texture'
        )
      : buildMissingCell(
          entry.metadata?.suggested
            ? 'Character not assigned yet'
            : entry.reason || 'No compatible output'
        );

  const status = document.createElement('div');
  status.className =
    `comparison-status ${entry.status}`;

  const statusText =
    entry.status === 'skipped'
      ? 'Skipped'
      : entry.status === 'unresolved'
        ? entry.metadata?.suggested
          ? 'Suggested Mapping'
          : 'Needs Mapping'
        : entry.status === 'mapped'
          ? 'Mapped'
          : 'Compatible';

  status.innerHTML = '<strong></strong><span></span>';
  status.children[0].textContent = entry.edited
    ? `${statusText} · Edited`
    : statusText;
  status.children[1].textContent =
    entry.reason || entry.targetPath || '';

  row.append(info, source, arrow, target, status);

  if (entry.metadata?.configSuggestions) {
    row.appendChild(
      buildConfigurationSuggestions(
        entry.metadata.configSuggestions,
        entry.metadata
      )
    );
  }

  return row;
}

function buildGlyphCharacter(metadata) {
  const wrapper = document.createElement('div');
  wrapper.className =
    'glyph-character-line' +
    (metadata.suggested ? ' suggested' : '');

  const char = document.createElement('span');
  char.className = 'glyph-character-preview';
  char.textContent = metadata.char;

  const labels = document.createElement('span');
  labels.className = 'glyph-character-labels';

  const unicode = document.createElement('strong');
  unicode.textContent =
    metadata.unicode ||
    `U+${Number(metadata.codePoint)
      .toString(16)
      .toUpperCase()
      .padStart(4, '0')}`;

  const mapping = document.createElement('small');
  mapping.textContent =
    metadata.pageHex && metadata.slotHex
      ? `glyph_${metadata.pageHex}.png · slot ${metadata.slotHex}`
      : 'Java glyph character';

  labels.append(unicode, mapping);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'copy-chip';
  copy.textContent = 'Copy';
  copy.title = 'Copy the actual glyph character';
  copy.addEventListener('click', async event => {
    event.stopPropagation();
    await copyText(metadata.char);
    copy.textContent = 'Copied';
    setTimeout(() => {
      copy.textContent = 'Copy';
    }, 1200);
  });

  wrapper.append(char, labels, copy);
  wrapper.addEventListener('click', event =>
    event.stopPropagation()
  );

  return wrapper;
}

function buildConfigurationSuggestions(snippets, metadata) {
  const details = document.createElement('details');
  details.className = 'glyph-config-suggestions';
  details.addEventListener('click', event =>
    event.stopPropagation()
  );

  const summary = document.createElement('summary');
  summary.textContent =
    `How to assign ${metadata.unicode || 'this character'} in Java / ItemsAdder / Nexo / Oraxen`;
  details.appendChild(summary);

  const intro = document.createElement('p');
  intro.textContent =
    'This image exists but has no explicit Java character mapping. The converter only suggests a free private-use character; it does not silently assign one to the source plugin config.';
  details.appendChild(intro);

  const names = [
    ['javaJson', 'Java font JSON provider'],
    ['itemsAdder', 'ItemsAdder font_images'],
    ['nexo', 'Nexo glyph'],
    ['oraxen', 'Oraxen glyph'],
  ];

  for (const [key, label] of names) {
    if (!snippets[key]) continue;

    const block = document.createElement('section');
    block.className = 'config-snippet';

    const head = document.createElement('div');
    head.className = 'config-snippet-head';

    const title = document.createElement('strong');
    title.textContent = label;

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-chip';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async event => {
      event.stopPropagation();
      await copyText(snippets[key]);
      copy.textContent = 'Copied';
      setTimeout(() => {
        copy.textContent = 'Copy';
      }, 1200);
    });

    head.append(title, copy);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = snippets[key];
    pre.appendChild(code);

    block.append(head, pre);
    details.appendChild(block);
  }

  return details;
}

function buildAtlasRow(entry) {
  const article = document.createElement('article');
  article.className = 'glyph-atlas-row';

  const meta = entry.metadata || {};
  const head = document.createElement('div');
  head.className = 'glyph-atlas-head';

  const text = document.createElement('div');
  const kicker = document.createElement('span');
  kicker.className = 'source-label';
  kicker.textContent =
    meta.sourceAtlas
      ? 'Bedrock glyph source'
      : 'Generated Bedrock glyph page';

  const title = document.createElement('strong');
  title.textContent = entry.name;

  const description = document.createElement('p');
  description.textContent =
    `${meta.rangeStart || ''}–${meta.rangeEnd || ''} · ` +
    `16×16 cells · ${meta.cellSize || '?'}px per cell · ` +
    `${meta.atlasSize || '?'}×${meta.atlasSize || '?'}px atlas`;

  text.append(kicker, title, description);

  const path = document.createElement('code');
  path.textContent =
    meta.sourceAtlas
      ? entry.sourcePath
      : entry.targetPath;

  head.append(text, path);

  const blob =
    entry.targetBlob ||
    entry.sourceBlob;

  const stage = document.createElement('div');
  stage.className = 'glyph-atlas-stage checkerboard';

  if (blob) {
    const img = document.createElement('img');
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    img.src = url;
    img.alt = `Glyph page ${meta.pageHex || ''}`;
    img.loading = 'lazy';
    stage.appendChild(img);
  }

  const overlay = document.createElement('div');
  overlay.className = 'glyph-atlas-grid';

  const used = new Set(meta.usedSlots || []);

  for (let slot = 0; slot < 256; slot++) {
    const cell = document.createElement('span');
    cell.className =
      'glyph-atlas-cell' +
      (used.has(slot) ? ' used' : '');
    cell.textContent =
      slot
        .toString(16)
        .toUpperCase()
        .padStart(2, '0');
    cell.title =
      `U+${meta.pageHex || '??'}${slot
        .toString(16)
        .toUpperCase()
        .padStart(2, '0')}`;
    overlay.appendChild(cell);
  }

  stage.appendChild(overlay);

  const note = document.createElement('p');
  note.className = 'glyph-atlas-note';
  note.textContent =
    entry.reason ||
    'Hex labels show the exact Bedrock cell position.';

  article.append(head, stage, note);
  return article;
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

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(String(value));
    return;
  }

  const input = document.createElement('textarea');
  input.value = String(value);
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cleanupUrls() {
  for (const url of objectUrls) {
    URL.revokeObjectURL(url);
  }
  objectUrls.clear();
}

addEventListener('beforeunload', cleanupUrls);
