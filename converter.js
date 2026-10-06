import { JAVA_TO_BEDROCK_RENAMES, BEDROCK_TO_JAVA_RENAMES } from './mappings.js';
import { detectJavaPluginBundle, actualPathFor } from './plugin-adapters.js';
import { convertJavaCustomItems, convertBedrockCustomItems } from './custom-items.js';
import { convertJavaFontsToBedrock, convertBedrockFontsToJava } from './font-converter.js';

const LIMITS = {
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 40000,
  previewImages: 600,
};

const SUPPORTED = {
  java: { id: '26.2.x', minFormat: [88, 0], maxFormat: [214748364, 0] },
  bedrock: { id: '1.26.50', minEngineVersion: [1, 26, 50] },
};

export async function readFileWithProgress(file, onProgress = () => {}) {
  if (file.size > LIMITS.maxArchiveBytes) {
    throw new Error(`Archive is too large for this browser build (${formatBytes(file.size)}). Limit: ${formatBytes(LIMITS.maxArchiveBytes)}.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read archive.'));
    reader.onload = () => {
      onProgress(100);
      resolve(reader.result);
    };
    reader.readAsArrayBuffer(file);
  });
}

export async function inspectPack(arrayBuffer, expectedEdition) {
  if (!window.JSZip) throw new Error('ZIP engine did not load. Check your internet connection and reload the page.');
  const zip = await window.JSZip.loadAsync(arrayBuffer, { createFolders: true });
  const rawNames = Object.keys(zip.files).filter(name => !zip.files[name].dir);

  if (rawNames.length > LIMITS.maxEntries) {
    throw new Error(`Archive contains ${rawNames.length.toLocaleString()} files; the safety limit is ${LIMITS.maxEntries.toLocaleString()}.`);
  }
  if (rawNames.some(isUnsafePath)) throw new Error('Archive contains unsafe relative paths and was rejected.');

  const javaRoot = findRootFor(rawNames, 'pack.mcmeta');
  const bedrockRoot = findRootFor(rawNames, 'manifest.json');
  let detectedEdition = javaRoot !== null ? 'java' : bedrockRoot !== null ? 'bedrock' : null;
  let rootPrefix = detectedEdition === 'java' ? javaRoot : detectedEdition === 'bedrock' ? bedrockRoot : '';
  let adapter = null;
  let pathMap = null;
  let names = null;

  // A vendor/source bundle from ItemsAdder, Nexo or Oraxen may not contain a
  // root pack.mcmeta yet. Normalize its resource files into a virtual Java
  // assets/... tree so the normal converter can process it.
  if (!detectedEdition && expectedEdition === 'java') {
    adapter = await detectJavaPluginBundle(zip, rawNames);
    if (adapter?.names?.length) {
      detectedEdition = 'java';
      rootPrefix = '';
      pathMap = adapter.pathMap;
      names = adapter.names;
    }
  }

  if (!detectedEdition) {
    return invalidInspection(
      zip,
      expectedEdition,
      'Could not find a standard pack root or a supported ItemsAdder/Nexo/Oraxen source-pack structure.'
    );
  }

  if (detectedEdition !== expectedEdition) {
    return invalidInspection(
      zip,
      expectedEdition,
      `This looks like a ${capitalize(detectedEdition)} pack, not a ${capitalize(expectedEdition)} pack.`,
      detectedEdition,
      rootPrefix
    );
  }

  names ||= normalizedNames(rawNames, rootPrefix);
  const warnings = [...(adapter?.warnings || [])];
  let metadata = null;

  if (expectedEdition === 'java') {
    if (!names.some(n => n.startsWith('assets/'))) {
      return invalidInspection(
        zip,
        expectedEdition,
        'No Java assets were found in the selected pack or plugin source bundle.',
        detectedEdition,
        rootPrefix
      );
    }

    if (adapter) {
      metadata = {
        pack: {
          description: `Detected ${adapter.plugins.join(', ')} source bundle`,
        },
      };
      warnings.push(
        `Source-bundle mode enabled for ${adapter.plugins.join(', ')}; generated server-side IDs that are absent from YAML will be marked unresolved instead of guessed.`
      );
    } else {
      try {
        metadata = JSON.parse(await zip.file(rootPrefix + 'pack.mcmeta').async('string'));
      } catch {
        return invalidInspection(zip, expectedEdition, 'pack.mcmeta is not valid JSON.', detectedEdition, rootPrefix);
      }

      const min = metadata?.pack?.min_format;
      if (Array.isArray(min) && Number(min[0]) !== SUPPORTED.java.minFormat[0]) {
        warnings.push(
          `pack.mcmeta reports min_format ${JSON.stringify(min)}; this converter is tuned for Java ${SUPPORTED.java.id}.`
        );
      }
      if (!metadata?.pack) warnings.push('pack.mcmeta does not contain a standard pack object.');
    }
  } else {
    if (!names.some(n => n.startsWith('textures/'))) {
      return invalidInspection(
        zip,
        expectedEdition,
        'manifest.json was found, but textures/ is missing.',
        detectedEdition,
        rootPrefix
      );
    }

    try {
      metadata = JSON.parse(await zip.file(rootPrefix + 'manifest.json').async('string'));
    } catch {
      return invalidInspection(zip, expectedEdition, 'manifest.json is not valid JSON.', detectedEdition, rootPrefix);
    }

    if (metadata?.format_version !== 2) {
      warnings.push(`manifest.json format_version is ${metadata?.format_version ?? 'missing'}; version 2 is expected.`);
    }
    const hasResourcesModule =
      Array.isArray(metadata?.modules) && metadata.modules.some(m => m?.type === 'resources');
    if (!hasResourcesModule) warnings.push('No resources module was found in manifest.json.');

    const min = metadata?.header?.min_engine_version;
    if (Array.isArray(min) && min.join('.') !== SUPPORTED.bedrock.minEngineVersion.join('.')) {
      warnings.push(
        `Pack targets Bedrock ${min.join('.')}; mapping data is tuned for ${SUPPORTED.bedrock.id}.`
      );
    }
  }

  const pngCount = names.filter(n => n.toLowerCase().endsWith('.png')).length;
  const tgaCount = names.filter(n => n.toLowerCase().endsWith('.tga')).length;
  const metaCount = names.filter(n => n.toLowerCase().endsWith('.mcmeta')).length;

  return {
    valid: true,
    expectedEdition,
    detectedEdition,
    rootPrefix,
    zip,
    metadata,
    names,
    warnings,
    adapter,
    pathMap,
    counts: {
      files: names.length,
      png: pngCount,
      tga: tgaCount,
      mcmeta: metaCount,
      customItems: adapter?.itemHints?.length || 0,
      glyphHints: adapter?.glyphHints?.length || 0,
    },
  };
}

export async function convertPack({
  inspection,
  direction,
  experimentalUi = false,
  includeReport = true,
  onLog = () => {},
  onProgress = () => {},
}) {
  if (!inspection?.valid) throw new Error('A valid scanned source pack is required.');

  const sourceEdition = direction === 'java-to-bedrock' ? 'java' : 'bedrock';
  if (inspection.detectedEdition !== sourceEdition) {
    throw new Error(`Direction expects a ${capitalize(sourceEdition)} source pack.`);
  }

  const output = new window.JSZip();
  const names = inspection.names;
  const stats = {
    discovered: names.length,
    mapped: 0,
    passthrough: 0,
    skipped: 0,
    collisions: 0,
    customItems: 0,
    fontGlyphs: 0,
  };
  const skipped = [];
  const mappings = [];
  const occupied = new Set();
  const genericPreviewEntries = [];
  let previewTruncated = false;
  const total = Math.max(names.length, 1);

  onLog(
    'info',
    `Starting ${direction === 'java-to-bedrock' ? 'Java → Bedrock' : 'Bedrock → Java'} conversion.`
  );
  onLog(
    'info',
    `Source contains ${names.length.toLocaleString()} files (${inspection.counts.png.toLocaleString()} PNG textures).`
  );

  if (inspection.adapter) {
    onLog(
      'info',
      `Plugin source architecture detected: ${inspection.adapter.plugins.join(', ')} · ${inspection.adapter.itemHints.length} item config(s) · ${inspection.adapter.glyphHints.length} font image/glyph hint(s).`
    );
  }

  for (let i = 0; i < names.length; i++) {
    const sourcePath = names[i];
    const sourceFile = inspection.zip.file(actualPathFor(inspection, sourcePath));
    if (!sourceFile) continue;

    const decision =
      direction === 'java-to-bedrock'
        ? mapJavaToBedrock(sourcePath, experimentalUi)
        : mapBedrockToJava(sourcePath, experimentalUi);

    const isPng = sourcePath.toLowerCase().endsWith('.png');

    if (!decision?.target) {
      stats.skipped++;
      if (skipped.length < 200) {
        skipped.push(`${sourcePath} — ${decision?.reason || 'unsupported'}`);
      }

      if (isPng) {
        if (genericPreviewEntries.length < LIMITS.previewImages) {
          const bytes = await sourceFile.async('uint8array');
          genericPreviewEntries.push(
            makePreviewEntry({
              sourcePath,
              targetPath: null,
              status: 'skipped',
              reason: decision?.reason || 'Unsupported',
              bytes,
            })
          );
        } else {
          previewTruncated = true;
        }
      }

      if (i % 100 === 0) onProgress(Math.round(((i + 1) / total) * 65));
      continue;
    }

    const target = sanitizeTargetPath(decision.target);
    if (!target) {
      stats.skipped++;
      if (skipped.length < 200) skipped.push(`${sourcePath} — unsafe target path`);
      continue;
    }

    if (occupied.has(target)) {
      stats.collisions++;
      stats.skipped++;
      if (skipped.length < 200) {
        skipped.push(`${sourcePath} — target collision at ${target}`);
      }
      continue;
    }

    occupied.add(target);
    const bytes = await sourceFile.async('uint8array');
    output.file(target, bytes, { binary: true });

    if (decision.mapped) stats.mapped++;
    else stats.passthrough++;

    if (mappings.length < 250) {
      mappings.push(
        `${sourcePath} -> ${target}${decision.mapped ? ' [mapped]' : ''}`
      );
    }

    if (isPng) {
      if (genericPreviewEntries.length < LIMITS.previewImages) {
        genericPreviewEntries.push(
          makePreviewEntry({
            sourcePath,
            targetPath: target,
            status: decision.mapped ? 'mapped' : 'passthrough',
            reason: '',
            bytes,
          })
        );
      } else {
        previewTruncated = true;
      }
    }

    if (i % 80 === 0) onProgress(Math.round(((i + 1) / total) * 65));
  }

  onProgress(68);
  let customItemsResult;
  let fontsResult;

  if (direction === 'java-to-bedrock') {
    customItemsResult = await convertJavaCustomItems({ inspection, output, onLog });
    onProgress(74);
    fontsResult = await convertJavaFontsToBedrock({ inspection, output, onLog });
    output.file('manifest.json', JSON.stringify(createBedrockManifest(), null, 2));
  } else {
    customItemsResult = await convertBedrockCustomItems({ inspection, output, onLog });
    onProgress(74);
    fontsResult = await convertBedrockFontsToJava({ inspection, output, onLog });
    output.file('pack.mcmeta', JSON.stringify(createJavaMcmeta(), null, 2));
  }

  stats.customItems = Number(customItemsResult?.converted || 0);
  stats.fontGlyphs = Number(fontsResult?.converted || 0);

  const enhancedPreview = [
    ...(customItemsResult?.previewEntries || []),
    ...(fontsResult?.previewEntries || []),
  ];

  const enhancedSourcePaths = new Set(
    enhancedPreview
      .map(entry => entry.sourcePath)
      .filter(Boolean)
  );

  // Generic path conversion runs before the specialized item/font modules.
  // If a specialized module successfully handles a PNG that generic mapping
  // originally marked as skipped, it is NOT a real skip and must not remain
  // in the final stats/report.
  const rescuedGenericPaths = new Set(
    genericPreviewEntries
      .filter(
        entry =>
          entry.status === 'skipped' &&
          enhancedSourcePaths.has(entry.sourcePath)
      )
      .map(entry => entry.sourcePath)
  );

  if (rescuedGenericPaths.size) {
    stats.skipped = Math.max(
      0,
      stats.skipped - rescuedGenericPaths.size
    );

    for (let i = skipped.length - 1; i >= 0; i--) {
      const sourcePath =
        skipped[i].split(' — ')[0];
      if (rescuedGenericPaths.has(sourcePath)) {
        skipped.splice(i, 1);
      }
    }

    onLog(
      'info',
      `Specialized item/font mapping resolved ${rescuedGenericPaths.size} file(s) that generic path mapping initially marked as having no target.`
    );
  }

  const previewEntries = [
    ...enhancedPreview,
    ...genericPreviewEntries.filter(
      entry => !enhancedSourcePaths.has(entry.sourcePath)
    ),
  ];

  if (includeReport) {
    output.file(
      'dazen-conversion-report.txt',
      createReport({
        direction,
        stats,
        skipped,
        mappings,
        warnings: inspection.warnings,
      })
    );
  }

  onProgress(80);
  onLog(
    'info',
    `Packaging output: ${stats.mapped} version-mapped files, ${stats.passthrough} compatible passthrough files, ${stats.customItems} custom item conversions, ${stats.fontGlyphs} font glyph conversions.`
  );

  if (stats.skipped) {
    onLog(
      'warn',
      `${stats.skipped} generic files were skipped where no safe target mapping exists. Custom-item/font modules may still have handled some of those resources separately.`
    );
  }
  if (stats.collisions) {
    onLog('warn', `${stats.collisions} target-path collisions were prevented.`);
  }

  const blob = await output.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      streamFiles: true,
    },
    meta => onProgress(80 + Math.round(meta.percent * 0.20))
  );

  onProgress(100);

  const extension = direction === 'java-to-bedrock' ? 'mcpack' : 'zip';
  const editionLabel =
    direction === 'java-to-bedrock' ? 'bedrock-1.26.50' : 'java-26.2.x';
  const fileName = `dazen-converted-${editionLabel}.${extension}`;

  onLog('success', `Conversion complete. Output size: ${formatBytes(blob.size)}.`);
  onLog(
    'info',
    `Visual comparison prepared for ${previewEntries.length.toLocaleString()} entries${previewTruncated ? ` (generic texture preview capped at ${LIMITS.previewImages})` : ''}.`
  );

  return {
    blob,
    fileName,
    stats,
    skipped,
    previewEntries,
    previewTruncated,
    previewLimit: LIMITS.previewImages,
    artifacts: {
      geyserMappingsBlob: customItemsResult?.mappingsBlob || null,
      geyserMappingsFileName:
        customItemsResult?.mappingsFileName || 'dazen-geyser-custom-mappings.json',
      unresolvedCustomItems: customItemsResult?.unresolved || [],
      threeDFallbacks: Number(customItemsResult?.threeDFallbacks || 0),
      customItemsConverted: stats.customItems,
      fontsConverted: stats.fontGlyphs,
      fontPages: Number(fontsResult?.pages || 0),
      unresolvedFonts: Number(fontsResult?.unresolved || 0),
      autoAssignedFonts: Number(fontsResult?.autoAssigned || 0),
      adapterPlugins: inspection.adapter?.plugins || [],
    },
  };
}

function mapJavaToBedrock(path, experimentalUi) {
  if (path === 'pack.png') return mapped('pack_icon.png');
  if (path === 'pack.mcmeta') return skip('Java metadata is replaced by a generated Bedrock manifest.');
  if (JAVA_TO_BEDROCK_RENAMES[path]) return mapped(JAVA_TO_BEDROCK_RENAMES[path]);

  const rules = [
    ['assets/minecraft/textures/block/', 'textures/blocks/'],
    ['assets/minecraft/textures/item/', 'textures/items/'],
    ['assets/minecraft/textures/entity/', 'textures/entity/'],
    ['assets/minecraft/textures/painting/', 'textures/painting/'],
    ['assets/minecraft/textures/particle/', 'textures/particle/'],
    ['assets/minecraft/textures/colormap/', 'textures/colormap/'],
    ['assets/minecraft/textures/misc/', 'textures/misc/'],
    ['assets/minecraft/textures/trims/', 'textures/trims/'],
    ['assets/minecraft/textures/map/', 'textures/map/'],
  ];

  for (const [from, to] of rules) {
    if (path.startsWith(from) && path.toLowerCase().endsWith('.png')) {
      return passthrough(to + path.slice(from.length));
    }
  }

  if (path.startsWith('assets/minecraft/textures/environment/') && path.toLowerCase().endsWith('.png')) {
    const rel = path.slice('assets/minecraft/textures/environment/'.length);
    const direct = {
      'clouds.png': 'clouds.png',
      'end_sky.png': 'end_sky.png',
      'celestial/sun.png': 'sun.png',
      'celestial/end_flash.png': 'end_flash.png',
    }[rel];
    return direct
      ? mapped('textures/environment/' + direct)
      : skip('Environment layout differs between editions.');
  }

  if (path.startsWith('assets/minecraft/textures/gui/') && path.toLowerCase().endsWith('.png')) {
    return experimentalUi
      ? passthrough('textures/gui/' + path.slice('assets/minecraft/textures/gui/'.length))
      : skip('GUI conversion is experimental and disabled.');
  }

  if (path.toLowerCase().endsWith('.png.mcmeta')) {
    return skip('Java animation metadata is not directly compatible with Bedrock flipbooks.');
  }
  if (
    path.startsWith('assets/minecraft/models/') ||
    path.startsWith('assets/minecraft/blockstates/') ||
    path.startsWith('assets/minecraft/atlases/')
  ) {
    return skip('Java models/blockstates/atlases are outside texture-only conversion.');
  }
  if (path.startsWith('assets/minecraft/textures/font/') || path.startsWith('assets/minecraft/font/')) {
    return skip('Font formats differ between editions.');
  }

  return skip('No safe Bedrock target mapping in the current architecture.');
}

function mapBedrockToJava(path, experimentalUi) {
  if (path === 'pack_icon.png') return mapped('pack.png');
  if (path === 'manifest.json') return skip('Bedrock metadata is replaced by a generated Java pack.mcmeta.');
  if (BEDROCK_TO_JAVA_RENAMES[path]) return mapped(BEDROCK_TO_JAVA_RENAMES[path]);

  const rules = [
    ['textures/blocks/', 'assets/minecraft/textures/block/'],
    ['textures/items/', 'assets/minecraft/textures/item/'],
    ['textures/entity/', 'assets/minecraft/textures/entity/'],
    ['textures/painting/', 'assets/minecraft/textures/painting/'],
    ['textures/particle/', 'assets/minecraft/textures/particle/'],
    ['textures/colormap/', 'assets/minecraft/textures/colormap/'],
    ['textures/misc/', 'assets/minecraft/textures/misc/'],
    ['textures/trims/', 'assets/minecraft/textures/trims/'],
    ['textures/map/', 'assets/minecraft/textures/map/'],
  ];

  for (const [from, to] of rules) {
    if (path.startsWith(from) && path.toLowerCase().endsWith('.png')) {
      return passthrough(to + path.slice(from.length));
    }
  }

  if (path.startsWith('textures/environment/') && path.toLowerCase().endsWith('.png')) {
    const rel = path.slice('textures/environment/'.length);
    const direct = {
      'clouds.png': 'clouds.png',
      'end_sky.png': 'end_sky.png',
      'sun.png': 'celestial/sun.png',
      'end_flash.png': 'celestial/end_flash.png',
    }[rel];
    return direct
      ? mapped('assets/minecraft/textures/environment/' + direct)
      : skip('Environment atlas/layout differs between editions.');
  }

  if (path.startsWith('textures/gui/') && path.toLowerCase().endsWith('.png')) {
    return experimentalUi
      ? passthrough('assets/minecraft/textures/gui/' + path.slice('textures/gui/'.length))
      : skip('GUI conversion is experimental and disabled.');
  }

  if (path.toLowerCase().endsWith('.tga')) {
    return skip('Java resource packs do not use Bedrock TGA textures directly.');
  }
  if (
    path.startsWith('models/') ||
    path.startsWith('entity/') ||
    path.startsWith('attachables/') ||
    path.startsWith('render_controllers/') ||
    path.startsWith('animations/') ||
    path.startsWith('animation_controllers/')
  ) {
    return skip('Bedrock runtime/model JSON is outside texture-only conversion.');
  }
  if (path.startsWith('font/') || path.startsWith('ui/')) {
    return skip('Bedrock font/UI definitions do not map directly to Java.');
  }

  return skip('No safe Java target mapping in the current architecture.');
}

function makePreviewEntry({ sourcePath, targetPath, status, reason, bytes }) {
  const blob = new Blob([bytes], { type: 'image/png' });
  return {
    id: `texture:${sourcePath}->${targetPath || 'skipped'}`,
    name: readableTextureName(sourcePath),
    category: classifyTexture(sourcePath, targetPath),
    sourcePath,
    targetPath,
    status,
    reason,
    sourceBlob: blob,
    targetBlob: targetPath ? blob : null,
    editable: !!targetPath,
    editSpec: targetPath
      ? { type: 'direct-image', targetPath }
      : null,
  };
}

function classifyTexture(sourcePath, targetPath = '') {
  const path = `${sourcePath} ${targetPath || ''}`.toLowerCase();

  if (
    path.includes('/block/') ||
    path.includes('/blocks/') ||
    path.startsWith('textures/blocks/')
  ) return 'Blocks';

  if (
    path.includes('/item/') ||
    path.includes('/items/') ||
    path.startsWith('textures/items/')
  ) return 'Items';

  if (
    path.includes('/entity/') ||
    path.includes('/mobs/') ||
    path.startsWith('textures/entity/')
  ) return 'Mobs';

  if (
    path.includes('/font/') ||
    path.includes('/fonts/') ||
    path.startsWith('font/')
  ) return 'Fonts';

  if (path.includes('/gui/') || path.startsWith('ui/') || path.includes('/ui/')) return 'GUI';
  if (path.includes('/environment/')) return 'Environment';

  return 'Other Images';
}

function readableTextureName(path) {
  const leaf = path.split('/').pop()?.replace(/\.png$/i, '') || path;
  return leaf
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function createBedrockManifest() {
  return {
    format_version: 2,
    header: {
      name: 'Converted Resource Pack',
      description: 'Converted with Dazen Development Texture Pack Converter',
      uuid: uuid(),
      version: [1, 0, 0],
      min_engine_version: SUPPORTED.bedrock.minEngineVersion,
    },
    modules: [{
      type: 'resources',
      uuid: uuid(),
      version: [1, 0, 0],
      description: 'Converted resources',
    }],
  };
}

function createJavaMcmeta() {
  return {
    pack: {
      description: 'Converted with Dazen Development Texture Pack Converter',
      min_format: SUPPORTED.java.minFormat,
      max_format: SUPPORTED.java.maxFormat,
    },
  };
}

function createReport({ direction, stats, skipped, mappings, warnings }) {
  const lines = [
    'Dazen Development — Texture Pack Converter',
    `Direction: ${direction}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    'SUMMARY',
    `Files discovered: ${stats.discovered}`,
    `Version-specific mappings: ${stats.mapped}`,
    `Same-path passthrough: ${stats.passthrough}`,
    `Skipped: ${stats.skipped}`,
    `Prevented collisions: ${stats.collisions}`,
    '',
  ];

  if (warnings?.length) lines.push('SCAN WARNINGS', ...warnings.map(w => `- ${w}`), '');
  lines.push('MAPPINGS (first 250)', ...mappings.map(m => `- ${m}`), '');
  lines.push('SKIPPED (first 200)', ...(skipped.length ? skipped.map(s => `- ${s}`) : ['- None']), '');
  lines.push(
    'Note: This release focuses on classic PNG textures. Complex models, shaders, fonts, OptiFine/CIT, animation metadata and edition-specific GUIs may require manual conversion.'
  );

  return lines.join('\n');
}

function invalidInspection(zip, expectedEdition, error, detectedEdition = null, rootPrefix = '') {
  return {
    valid: false,
    zip,
    expectedEdition,
    detectedEdition,
    rootPrefix,
    error,
    warnings: [],
    names: [],
    counts: { files: 0, png: 0, tga: 0, mcmeta: 0 },
  };
}

function findRootFor(names, marker) {
  if (names.includes(marker)) return '';
  const matches = names.filter(name => name.endsWith('/' + marker));
  const oneLevel = matches.filter(name => name.split('/').length === 2);
  if (oneLevel.length === 1) return oneLevel[0].slice(0, -marker.length);
  return null;
}

function normalizedNames(names, rootPrefix) {
  return names
    .filter(n => n.startsWith(rootPrefix))
    .map(n => n.slice(rootPrefix.length))
    .filter(Boolean);
}

function isUnsafePath(path) {
  return path.split('/').some(part => part === '..') || path.startsWith('/') || path.includes('\\');
}
function sanitizeTargetPath(path) {
  return isUnsafePath(path) ? null : path.replace(/^\/+/, '');
}
function mapped(target) {
  return { target, mapped: true };
}
function passthrough(target) {
  return { target, mapped: false };
}
function skip(reason) {
  return { target: null, reason };
}
function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
