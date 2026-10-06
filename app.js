import { readFileWithProgress, inspectPack, convertPack, formatBytes } from './converter.js';
import { saveConversionJob, hasConversionJob, makeJobId } from './preview-storage.js';

const state = {
  direction: 'java-to-bedrock',
  source: { file: null, buffer: null, inspection: null },
  busy: false,
  latestResult: null,
  previewJobId: null,
};

const refs = {
  directionButtons: [...document.querySelectorAll('.direction-btn')],
  sourceIcon: document.querySelector('#source-edition-icon'),
  sourceTitle: document.querySelector('#source-edition-title'),
  sourceCopy: document.querySelector('#source-edition-copy'),
  sourceStatus: document.querySelector('#source-status'),
  sourceVersion: document.querySelector('#source-version'),
  targetVersionLabel: document.querySelector('#target-version-label'),
  input: document.querySelector('#source-file'),
  dropzone: document.querySelector('#source-dropzone'),
  dropzoneTitle: document.querySelector('#dropzone-title'),
  dropzoneSubtitle: document.querySelector('#dropzone-subtitle'),
  fileName: document.querySelector('#source-file-name'),
  progressWrap: document.querySelector('#source-progress-wrap'),
  progress: document.querySelector('#source-progress'),
  progressText: document.querySelector('#source-progress-text'),
  progressLabel: document.querySelector('#source-progress-label'),
  summary: document.querySelector('#source-summary'),
  routeSourceIcon: document.querySelector('#route-source-icon'),
  routeTargetIcon: document.querySelector('#route-target-icon'),
  routeSourceName: document.querySelector('#route-source-name'),
  routeTargetName: document.querySelector('#route-target-name'),
  convertBtn: document.querySelector('#convert-btn'),
  actionTitle: document.querySelector('#action-title'),
  actionSubtitle: document.querySelector('#action-subtitle'),
  experimentalUi: document.querySelector('#experimental-ui'),
  includeReport: document.querySelector('#include-report'),
  console: document.querySelector('#console'),
  clearConsole: document.querySelector('#clear-console'),
  output: document.querySelector('#conversion-output'),
  outputSummary: document.querySelector('#output-summary'),
  outputFileName: document.querySelector('#output-file-name'),
  outputFileMeta: document.querySelector('#output-file-meta'),
  outputFileIcon: document.querySelector('.output-file-icon'),
  outputMapped: document.querySelector('#output-mapped'),
  outputPassthrough: document.querySelector('#output-passthrough'),
  outputSkipped: document.querySelector('#output-skipped'),
  outputCustomItems: document.querySelector('#output-custom-items'),
  outputFonts: document.querySelector('#output-fonts'),
  outputPreviewable: document.querySelector('#output-previewable'),
  downloadOutput: document.querySelector('#download-output'),
  downloadGeyserMappings: document.querySelector('#download-geyser-mappings'),
  viewOutput: document.querySelector('#view-output'),
};

for (const button of refs.directionButtons) {
  button.addEventListener('click', () => {
    if (state.busy || button.dataset.direction === state.direction) return;
    state.direction = button.dataset.direction;
    refs.directionButtons.forEach(b => b.classList.toggle('active', b === button));
    resetSource();
    configureDirection();
    log('info', `Direction set to ${directionLabel()}.`);
  });
}

refs.dropzone.addEventListener('click', () => !state.busy && refs.input.click());
refs.dropzone.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && !state.busy) {
    event.preventDefault();
    refs.input.click();
  }
});
refs.input.addEventListener('change', () => {
  if (refs.input.files?.[0]) loadPack(refs.input.files[0]);
});

for (const eventName of ['dragenter', 'dragover']) {
  refs.dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    if (!state.busy) refs.dropzone.classList.add('dragover');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  refs.dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    refs.dropzone.classList.remove('dragover');
  });
}
refs.dropzone.addEventListener('drop', event => {
  if (state.busy) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) loadPack(file);
});

refs.clearConsole.addEventListener('click', () => {
  refs.console.innerHTML = '';
  log('info', 'Console cleared.');
});
refs.convertBtn.addEventListener('click', startConversion);
refs.downloadOutput.addEventListener('click', downloadLatestOutput);
refs.downloadGeyserMappings.addEventListener('click', downloadLatestGeyserMappings);
refs.viewOutput.addEventListener('click', () => {
  if (!state.previewJobId) return;
  location.href = `./preview.html?job=${encodeURIComponent(state.previewJobId)}`;
});

configureDirection();

async function loadPack(file) {
  const edition = sourceEdition();
  const ext = file.name.toLowerCase().split('.').pop();
  const allowed = edition === 'java' ? ['zip'] : ['zip', 'mcpack'];

  clearOutput();

  if (!allowed.includes(ext)) {
    setStatus('invalid', 'Invalid');
    refs.summary.textContent = `Unsupported file type .${ext || 'unknown'}. Expected ${allowed.map(x => '.' + x).join(' or ')}.`;
    log('error', `${file.name}: expected ${allowed.map(x => '.' + x).join(' or ')} for a ${capitalize(edition)} source pack.`);
    return;
  }

  state.source = { file, buffer: null, inspection: null };
  refs.fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
  refs.progressWrap.hidden = false;
  refs.progressLabel.textContent = 'Reading local file…';
  setProgress(0);
  setStatus('scanning', 'Scanning');
  refs.summary.textContent = 'Reading archive and validating its resource-pack architecture…';
  updateAction();
  log('info', `Scanning ${capitalize(edition)} source pack: ${file.name} (${formatBytes(file.size)}).`);

  try {
    const buffer = await readFileWithProgress(file, pct => setProgress(Math.min(pct * 0.72, 72)));
    refs.progressLabel.textContent = 'Validating architecture…';
    setProgress(82);

    const inspection = await inspectPack(buffer, edition);
    setProgress(100);
    state.source.buffer = buffer;
    state.source.inspection = inspection;

    if (inspection.valid) {
      setStatus('valid', 'Verified');
      const adapterLabel = inspection.adapter?.plugins?.length
        ? ` · detected ${inspection.adapter.plugins.join(' + ')} source architecture`
        : '';
      const customLabel = inspection.counts.customItems
        ? ` · ${inspection.counts.customItems.toLocaleString()} custom item config(s)`
        : '';
      const glyphLabel = inspection.counts.glyphHints
        ? ` · ${inspection.counts.glyphHints.toLocaleString()} glyph/font-image hint(s)`
        : '';
      refs.summary.innerHTML =
        `<strong>Valid ${capitalize(edition)} source.</strong> ` +
        `${inspection.counts.files.toLocaleString()} files · ` +
        `${inspection.counts.png.toLocaleString()} PNG textures` +
        `${inspection.rootPrefix ? ' · wrapper folder detected' : ''}` +
        adapterLabel + customLabel + glyphLabel + '.';

      log(
        'success',
        `${capitalize(edition)} architecture verified: ${inspection.counts.files.toLocaleString()} files, ${inspection.counts.png.toLocaleString()} PNG textures.`
      );
      for (const warning of inspection.warnings) log('warn', warning);
    } else {
      setStatus('invalid', 'Rejected');
      refs.summary.textContent = inspection.error;
      log('error', `${file.name}: ${inspection.error}`);
    }
  } catch (error) {
    state.source.inspection = null;
    setStatus('invalid', 'Error');
    setProgress(0);
    refs.summary.textContent = error.message || String(error);
    log('error', error.message || String(error));
  } finally {
    updateAction();
  }
}

async function startConversion() {
  if (state.busy || !state.source.inspection?.valid) return;

  state.busy = true;
  clearOutput();
  refs.convertBtn.classList.add('busy');
  refs.convertBtn.disabled = true;
  refs.convertBtn.querySelector('span:first-child').textContent = 'Converting…';
  refs.progressWrap.hidden = false;
  refs.progressLabel.textContent = 'Converting textures…';
  setProgress(0);

  try {
    const result = await convertPack({
      inspection: state.source.inspection,
      direction: state.direction,
      experimentalUi: refs.experimentalUi.checked,
      includeReport: refs.includeReport.checked,
      onLog: log,
      onProgress: setProgress,
    });

    state.latestResult = result;
    refs.progressLabel.textContent = 'Conversion complete';
    await preparePreviewJob(result);
    renderOutput(result);
    refs.output.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    refs.progressLabel.textContent = 'Conversion failed';
    log('error', error.message || String(error));
  } finally {
    state.busy = false;
    refs.convertBtn.classList.remove('busy');
    refs.convertBtn.querySelector('span:first-child').textContent = 'Convert Pack';
    updateAction();
  }
}

async function preparePreviewJob(result) {
  const jobId = makeJobId();
  const job = {
    id: jobId,
    createdAt: Date.now(),
    direction: state.direction,
    sourceName: state.source.file?.name || 'Source resource pack',
    outputFileName: result.fileName,
    outputBlob: result.blob,
    stats: result.stats,
    previewEntries: result.previewEntries,
    previewTruncated: result.previewTruncated,
    previewLimit: result.previewLimit,
    artifacts: result.artifacts || {},
  };

  try {
    await saveConversionJob(job);

    const verified = await hasConversionJob(jobId);
    if (!verified) {
      throw new Error(
        'The browser reported a successful preview save, but the job could not be verified.'
      );
    }

    state.previewJobId = jobId;
    refs.viewOutput.disabled = false;
    log(
      'success',
      'Visual conversion preview saved and verified locally on this device.'
    );
  } catch (error) {
    state.previewJobId = null;
    refs.viewOutput.disabled = true;
    log(
      'warn',
      `Pack converted, but the browser could not save a reliable visual preview: ${error.message || error}`
    );
  }
}

function renderOutput(result) {
  const converted = result.stats.mapped + result.stats.passthrough;

  refs.output.hidden = false;
  refs.outputFileName.textContent = result.fileName;
  refs.outputFileMeta.textContent =
    `${converted.toLocaleString()} files written · ${formatBytes(result.blob.size)} output`;
  refs.outputFileIcon.textContent = state.direction === 'java-to-bedrock' ? 'MCPACK' : 'ZIP';
  refs.outputMapped.textContent = result.stats.mapped.toLocaleString();
  refs.outputPassthrough.textContent = result.stats.passthrough.toLocaleString();
  refs.outputSkipped.textContent = result.stats.skipped.toLocaleString();
  refs.outputCustomItems.textContent = Number(result.stats.customItems || 0).toLocaleString();
  refs.outputFonts.textContent = Number(result.stats.fontGlyphs || 0).toLocaleString();
  refs.outputPreviewable.textContent = result.previewEntries.length.toLocaleString();

  const geyserBlob = result.artifacts?.geyserMappingsBlob;
  refs.downloadGeyserMappings.hidden = !geyserBlob;

  const moduleSummary = [
    result.stats.customItems ? `${result.stats.customItems} custom item(s)` : null,
    result.stats.fontGlyphs ? `${result.stats.fontGlyphs} font glyph(s)` : null,
    result.artifacts?.autoAssignedFonts ? `${result.artifacts.autoAssignedFonts} auto-assigned font mapping(s)` : null,
    result.artifacts?.threeDFallbacks ? `${result.artifacts.threeDFallbacks} 3D item icon fallback(s)` : null,
    result.artifacts?.unresolvedCustomItems?.length ? `${result.artifacts.unresolvedCustomItems.length} item mapping(s) need review` : null,
  ].filter(Boolean).join(' · ');

  refs.outputSummary.textContent = result.previewTruncated
    ? `Conversion finished. Generic image preview was capped for browser performance. ${moduleSummary}`
    : `Conversion finished. Download the archive or open the visual comparison/editor.${moduleSummary ? ' ' + moduleSummary + '.' : ''}`;

  refs.actionSubtitle.textContent =
    `${converted.toLocaleString()} files written · ${result.stats.skipped.toLocaleString()} skipped · result ready below.`;
}

function downloadLatestOutput() {
  const result = state.latestResult;
  if (!result?.blob) return;

  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log('success', `Download started: ${result.fileName}`);
}

function downloadLatestGeyserMappings() {
  const result = state.latestResult;
  const blob = result?.artifacts?.geyserMappingsBlob;
  if (!blob) return;

  const fileName = result.artifacts.geyserMappingsFileName || 'dazen-geyser-custom-mappings.json';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log('success', `Geyser mapping download started: ${fileName}`);
}

function configureDirection() {
  const javaToBedrock = state.direction === 'java-to-bedrock';
  const source = javaToBedrock ? 'java' : 'bedrock';

  refs.sourceIcon.className = `edition-icon ${javaToBedrock ? 'java-icon' : 'bedrock-icon'}`;
  refs.sourceIcon.textContent = javaToBedrock ? 'J' : 'B';
  refs.sourceTitle.textContent = javaToBedrock ? 'Java Edition' : 'Bedrock Edition';
  refs.sourceCopy.textContent = javaToBedrock
    ? 'Upload a Java 26.2.x resource pack (.zip)'
    : 'Upload a Bedrock 1.26.50 resource pack (.mcpack or .zip)';

  refs.sourceVersion.innerHTML = javaToBedrock
    ? '<option value="26.2.x">Java 26.2.x</option>'
    : '<option value="1.26.50">Bedrock 1.26.50</option>';

  refs.targetVersionLabel.textContent = javaToBedrock ? 'Bedrock 1.26.50' : 'Java 26.2.x';
  refs.input.accept = javaToBedrock ? '.zip,application/zip' : '.zip,.mcpack,application/zip';
  refs.dropzoneTitle.textContent = javaToBedrock ? 'Drop Java pack here' : 'Drop Bedrock pack here';
  refs.dropzoneSubtitle.textContent = javaToBedrock
    ? 'or click to choose a .zip'
    : 'or click to choose .mcpack / .zip';

  refs.routeSourceIcon.className = `route-icon ${javaToBedrock ? 'java-icon' : 'bedrock-icon'}`;
  refs.routeTargetIcon.className = `route-icon ${javaToBedrock ? 'bedrock-icon' : 'java-icon'}`;
  refs.routeSourceIcon.textContent = javaToBedrock ? 'J' : 'B';
  refs.routeTargetIcon.textContent = javaToBedrock ? 'B' : 'J';
  refs.routeSourceName.textContent = javaToBedrock ? 'Java 26.2.x' : 'Bedrock 1.26.50';
  refs.routeTargetName.textContent = javaToBedrock ? 'Bedrock 1.26.50' : 'Java 26.2.x';

  refs.actionTitle.textContent = directionLabel();
  refs.summary.innerHTML = javaToBedrock
    ? 'Upload a Java pack to scan <code>pack.mcmeta</code> and <code>assets/minecraft/</code>.'
    : 'Upload a Bedrock pack to scan <code>manifest.json</code> and <code>textures/</code>.';

  setStatus('idle', 'Waiting');
  updateAction();
}

function resetSource() {
  state.source = { file: null, buffer: null, inspection: null };
  refs.input.value = '';
  refs.fileName.textContent = 'No file selected';
  refs.progressWrap.hidden = true;
  setProgress(0);
  clearOutput();
}

function clearOutput() {
  state.latestResult = null;
  state.previewJobId = null;
  refs.output.hidden = true;
  refs.viewOutput.disabled = false;
  refs.downloadGeyserMappings.hidden = true;
}

function updateAction() {
  const valid = !!state.source.inspection?.valid;
  if (!state.busy) {
    refs.convertBtn.disabled = !valid;
    refs.actionSubtitle.textContent = valid
      ? `Verified ${capitalize(sourceEdition())} source ready. Conversion will run locally in this browser.`
      : `Add a valid ${capitalize(sourceEdition())} ${sourceEdition() === 'java' ? '26.2.x' : '1.26.50'} pack to begin.`;
  }
}

function sourceEdition() {
  return state.direction === 'java-to-bedrock' ? 'java' : 'bedrock';
}

function directionLabel() {
  return state.direction === 'java-to-bedrock' ? 'Java → Bedrock' : 'Bedrock → Java';
}

function setStatus(kind, text) {
  refs.sourceStatus.className = `status-badge ${kind}`;
  refs.sourceStatus.textContent = text;
}

function setProgress(pct) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  refs.progress.style.width = `${value}%`;
  refs.progressText.textContent = `${value}%`;
}

function log(level, message) {
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const levelLabel = {
    info: 'INFO',
    success: 'OK',
    warn: 'WARN',
    error: 'ERROR',
    muted: 'NOTE',
  }[level] || 'INFO';

  line.innerHTML = '<span class="log-time"></span><span class="log-level"></span><span></span>';
  line.children[0].textContent = time;
  line.children[1].textContent = levelLabel;
  line.children[2].textContent = message;
  refs.console.appendChild(line);
  refs.console.scrollTop = refs.console.scrollHeight;
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}
