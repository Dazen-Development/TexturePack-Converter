import { readFileWithProgress, inspectPack, convertPack, formatBytes } from './converter.js';

const state = {
  direction: 'java-to-bedrock',
  java: { file: null, buffer: null, inspection: null },
  bedrock: { file: null, buffer: null, inspection: null },
  busy: false,
};

const refs = {
  directionButtons: [...document.querySelectorAll('.direction-btn')],
  cards: { java: document.querySelector('[data-side="java"]'), bedrock: document.querySelector('[data-side="bedrock"]') },
  input: { java: document.querySelector('#java-file'), bedrock: document.querySelector('#bedrock-file') },
  dropzone: { java: document.querySelector('#java-dropzone'), bedrock: document.querySelector('#bedrock-dropzone') },
  fileName: { java: document.querySelector('#java-file-name'), bedrock: document.querySelector('#bedrock-file-name') },
  status: { java: document.querySelector('#java-status'), bedrock: document.querySelector('#bedrock-status') },
  summary: { java: document.querySelector('#java-summary'), bedrock: document.querySelector('#bedrock-summary') },
  progressWrap: { java: document.querySelector('#java-progress-wrap'), bedrock: document.querySelector('#bedrock-progress-wrap') },
  progress: { java: document.querySelector('#java-progress'), bedrock: document.querySelector('#bedrock-progress') },
  progressText: { java: document.querySelector('#java-progress-text'), bedrock: document.querySelector('#bedrock-progress-text') },
  progressLabel: { java: document.querySelector('#java-progress-label'), bedrock: document.querySelector('#bedrock-progress-label') },
  convertBtn: document.querySelector('#convert-btn'),
  actionTitle: document.querySelector('#action-title'),
  actionSubtitle: document.querySelector('#action-subtitle'),
  experimentalUi: document.querySelector('#experimental-ui'),
  includeReport: document.querySelector('#include-report'),
  console: document.querySelector('#console'),
  clearConsole: document.querySelector('#clear-console'),
};

for (const button of refs.directionButtons) {
  button.addEventListener('click', () => {
    state.direction = button.dataset.direction;
    refs.directionButtons.forEach(b => b.classList.toggle('active', b === button));
    updateUi();
    log('info', `Direction set to ${state.direction === 'java-to-bedrock' ? 'Java → Bedrock' : 'Bedrock → Java'}.`);
  });
}

for (const edition of ['java', 'bedrock']) setupDropzone(edition);
refs.clearConsole.addEventListener('click', () => { refs.console.innerHTML = ''; log('info', 'Console cleared.'); });
refs.convertBtn.addEventListener('click', startConversion);
updateUi();

function setupDropzone(edition) {
  const zone = refs.dropzone[edition];
  const input = refs.input[edition];
  zone.addEventListener('click', () => !state.busy && input.click());
  zone.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && !state.busy) { event.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => input.files?.[0] && loadPack(edition, input.files[0]));
  for (const eventName of ['dragenter', 'dragover']) zone.addEventListener(eventName, event => { event.preventDefault(); if (!state.busy) zone.classList.add('dragover'); });
  for (const eventName of ['dragleave', 'drop']) zone.addEventListener(eventName, event => { event.preventDefault(); zone.classList.remove('dragover'); });
  zone.addEventListener('drop', event => {
    if (state.busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) loadPack(edition, file);
  });
}

async function loadPack(edition, file) {
  const ext = file.name.toLowerCase().split('.').pop();
  const allowed = edition === 'java' ? ['zip'] : ['zip', 'mcpack'];
  if (!allowed.includes(ext)) {
    setStatus(edition, 'invalid', 'Invalid');
    refs.summary[edition].textContent = `Unsupported file type .${ext || 'unknown'}.`;
    log('error', `${file.name}: expected ${allowed.map(x => '.' + x).join(' or ')}.`);
    return;
  }

  state[edition] = { file, buffer: null, inspection: null };
  refs.fileName[edition].textContent = `${file.name} · ${formatBytes(file.size)}`;
  refs.progressWrap[edition].hidden = false;
  refs.progressLabel[edition].textContent = 'Reading local file…';
  setProgress(edition, 0);
  setStatus(edition, 'scanning', 'Scanning');
  refs.summary[edition].textContent = 'Reading archive and validating structure…';
  updateUi();
  log('info', `Scanning ${capitalize(edition)} pack: ${file.name} (${formatBytes(file.size)}).`);

  try {
    const buffer = await readFileWithProgress(file, pct => setProgress(edition, Math.min(pct * 0.72, 72)));
    refs.progressLabel[edition].textContent = 'Validating architecture…';
    setProgress(edition, 82);
    const inspection = await inspectPack(buffer, edition);
    setProgress(edition, 100);
    state[edition].buffer = buffer;
    state[edition].inspection = inspection;

    if (inspection.valid) {
      setStatus(edition, 'valid', 'Verified');
      refs.summary[edition].innerHTML = `<strong>Valid ${capitalize(edition)} pack.</strong> ${inspection.counts.files.toLocaleString()} files · ${inspection.counts.png.toLocaleString()} PNG textures${inspection.rootPrefix ? ` · wrapper folder detected` : ''}.`;
      log('success', `${capitalize(edition)} architecture verified: ${inspection.counts.files.toLocaleString()} files, ${inspection.counts.png.toLocaleString()} PNG textures.`);
      for (const warning of inspection.warnings) log('warn', warning);
      autoDirectionFor(edition);
    } else {
      setStatus(edition, 'invalid', 'Rejected');
      refs.summary[edition].textContent = inspection.error;
      log('error', `${file.name}: ${inspection.error}`);
    }
  } catch (error) {
    state[edition].inspection = null;
    setStatus(edition, 'invalid', 'Error');
    setProgress(edition, 0);
    refs.summary[edition].textContent = error.message || String(error);
    log('error', error.message || String(error));
  } finally {
    updateUi();
  }
}

function autoDirectionFor(edition) {
  const desired = edition === 'java' ? 'java-to-bedrock' : 'bedrock-to-java';
  if (state.direction === desired) return;
  state.direction = desired;
  refs.directionButtons.forEach(b => b.classList.toggle('active', b.dataset.direction === desired));
  log('info', `Direction automatically switched to ${edition === 'java' ? 'Java → Bedrock' : 'Bedrock → Java'} for the verified source.`);
}

async function startConversion() {
  if (state.busy) return;
  const source = state.direction === 'java-to-bedrock' ? 'java' : 'bedrock';
  const inspection = state[source].inspection;
  if (!inspection?.valid) return;

  state.busy = true;
  refs.convertBtn.classList.add('busy');
  refs.convertBtn.disabled = true;
  refs.convertBtn.querySelector('span:first-child').textContent = 'Converting…';
  refs.progressWrap[source].hidden = false;
  refs.progressLabel[source].textContent = 'Converting textures…';
  setProgress(source, 0);

  try {
    const result = await convertPack({
      inspection,
      direction: state.direction,
      experimentalUi: refs.experimentalUi.checked,
      includeReport: refs.includeReport.checked,
      onLog: log,
      onProgress: pct => setProgress(source, pct),
    });
    downloadBlob(result.blob, result.fileName);
    refs.progressLabel[source].textContent = 'Conversion complete';
    refs.actionSubtitle.textContent = `${result.stats.mapped + result.stats.passthrough} files written · ${result.stats.skipped} skipped · download started.`;
    log('success', `Download started: ${result.fileName}`);
  } catch (error) {
    refs.progressLabel[source].textContent = 'Conversion failed';
    log('error', error.message || String(error));
  } finally {
    state.busy = false;
    refs.convertBtn.classList.remove('busy');
    refs.convertBtn.querySelector('span:first-child').textContent = 'Convert Pack';
    updateUi();
  }
}

function updateUi() {
  const source = state.direction === 'java-to-bedrock' ? 'java' : 'bedrock';
  const target = source === 'java' ? 'bedrock' : 'java';
  refs.cards.java.classList.toggle('source-active', source === 'java');
  refs.cards.bedrock.classList.toggle('source-active', source === 'bedrock');
  refs.cards.java.classList.toggle('target-dim', target === 'java');
  refs.cards.bedrock.classList.toggle('target-dim', target === 'bedrock');

  const title = state.direction === 'java-to-bedrock' ? 'Java → Bedrock' : 'Bedrock → Java';
  refs.actionTitle.textContent = title;
  const valid = !!state[source].inspection?.valid;
  if (!state.busy) {
    refs.convertBtn.disabled = !valid;
    refs.actionSubtitle.textContent = valid
      ? `Verified ${capitalize(source)} source ready. The target pack will be built locally in your browser.`
      : `Add a valid ${capitalize(source)} ${source === 'java' ? '26.2.x' : '1.26.50'} pack to begin.`;
  }
}

function setStatus(edition, kind, text) {
  refs.status[edition].className = `status-badge ${kind}`;
  refs.status[edition].textContent = text;
}
function setProgress(edition, pct) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  refs.progress[edition].style.width = `${value}%`;
  refs.progressText[edition].textContent = `${value}%`;
}
function log(level, message) {
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const levelLabel = { info: 'INFO', success: 'OK', warn: 'WARN', error: 'ERROR', muted: 'NOTE' }[level] || 'INFO';
  line.innerHTML = `<span class="log-time"></span><span class="log-level"></span><span></span>`;
  line.children[0].textContent = time;
  line.children[1].textContent = levelLabel;
  line.children[2].textContent = message;
  refs.console.appendChild(line);
  refs.console.scrollTop = refs.console.scrollHeight;
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
function capitalize(value) { return value[0].toUpperCase() + value.slice(1); }
