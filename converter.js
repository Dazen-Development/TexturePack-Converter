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

function packRootCandidates(names, marker) {
  const markerLower = marker.toLowerCase();
  const suffix = '/' + markerLower;
  const roots = new Set();

  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower === markerLower) {
      roots.add('');
    } else if (lower.endsWith(suffix)) {
      roots.add(name.slice(0, -marker.length));
    }
  }

  return [...roots];
}

function scorePackRoot(names, root, edition) {
  let score = 1000;
  let files = 0;

  for (const name of names) {
    if (!name.startsWith(root)) continue;
    const normalized = name.slice(root.length);
    if (!normalized) continue;
    files++;

    if (edition === 'java') {
      if (/^assets\//i.test(normalized)) score += 2;
      if (/^assets\/[^/]+\/textures\/.+\.(png|tga)$/i.test(normalized)) score += 3;
      if (/^assets\/[^/]+\/models\/.+\.json$/i.test(normalized)) score += 4;
      if (/^assets\/minecraft\/models\/item\/[^/]+\.json$/i.test(normalized)) score += 8;
      if (/^assets\/[^/]+\/items\/.+\.json$/i.test(normalized)) score += 8;
    } else {
      if (/^textures\//i.test(normalized)) score += 4;
      if (/^textures\/item_texture\.json$/i.test(normalized)) score += 25;
      if (/^attachables\/.+\.json$/i.test(normalized)) score += 7;
      if (/^models\/entity\/.+\.json$/i.test(normalized)) score += 7;
      if (/^animations?\//i.test(normalized)) score += 3;
    }
  }

  // Prefer richer pack roots and avoid accidentally selecting a tiny nested
  // metadata-only pack when several candidates exist.
  score += Math.min(files, 1000);
  score -= root.split('/').filter(Boolean).length;

  return score;
}

function findBestRootFor(names, marker, edition) {
  const candidates = packRootCandidates(names, marker);
  if (!candidates.length) return null;

  return candidates
    .map(root => ({ root, score: scorePackRoot(names, root, edition) }))
    .sort((a, b) => b.score - a.score)[0].root;
}

async function findNestedPackCandidate(zip, rawNames, expectedEdition) {
  const marker = expectedEdition === 'java' ? 'pack.mcmeta' : 'manifest.json';
  const candidates = rawNames
    .filter(name => /\.(?:mcpack|zip)$/i.test(name))
    .map(name => {
      const lower = name.toLowerCase();
      let preference = 0;
      if (expectedEdition === 'bedrock' && /(?:^|\/)geyser\/packs\//i.test(name)) preference += 300;
      if (expectedEdition === 'bedrock' && /(?:^|\/)resource_packs\//i.test(name)) preference += 220;
      if (expectedEdition === 'java' && /(?:^|\/)rss\//i.test(name)) preference += 200;
      if (/\.mcpack$/i.test(lower)) preference += 80;
      return { name, preference };
    })
    .sort((a, b) => b.preference - a.preference)
    .slice(0, 16);

  let best = null;

  for (const candidate of candidates) {
    const file = zip.file(candidate.name);
    if (!file) continue;

    try {
      const bytes = await file.async('uint8array');
      if (bytes.byteLength > LIMITS.maxArchiveBytes) continue;

      const nestedZip = await window.JSZip.loadAsync(bytes, { createFolders: true });
      const nestedNames = Object.keys(nestedZip.files)
        .filter(name => !nestedZip.files[name].dir);

      if (!nestedNames.length || nestedNames.length > LIMITS.maxEntries) continue;
      if (nestedNames.some(isUnsafePath)) continue;

      const root = findBestRootFor(
        nestedNames,
        marker,
        expectedEdition
      );
      if (root === null) continue;

      const score =
        candidate.preference +
        scorePackRoot(nestedNames, root, expectedEdition);

      if (!best || score > best.score) {
        best = {
          path: candidate.name,
          zip: nestedZip,
          rawNames: nestedNames,
          rootPrefix: root,
          score,
        };
      }
    } catch {
      // A .zip/.mcpack in a vendor bundle is not necessarily a resource pack.
      // Ignore non-pack nested archives and continue scoring other candidates.
    }
  }

  return best;
}

export async function inspectPack(arrayBuffer, expectedEdition) {
  if (!window.JSZip) throw new Error('ZIP engine did not load. Check your internet connection and reload the page.');
  let zip = await window.JSZip.loadAsync(arrayBuffer, { createFolders: true });
  let rawNames = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  let containerPath = null;

  if (rawNames.length > LIMITS.maxEntries) {
    throw new Error(`Archive contains ${rawNames.length.toLocaleString()} files; the safety limit is ${LIMITS.maxEntries.toLocaleString()}.`);
  }
  if (rawNames.some(isUnsafePath)) throw new Error('Archive contains unsafe relative paths and was rejected.');

  let javaRoot = findBestRootFor(rawNames, 'pack.mcmeta', 'java');
  let bedrockRoot = findBestRootFor(rawNames, 'manifest.json', 'bedrock');

  // Vendor downloads frequently wrap the actual resource pack inside a ZIP
  // or MCPACK (for example Geyser/packs/<pack>.mcpack). Open the strongest
  // nested candidate automatically instead of requiring the user to extract it.
  if (javaRoot === null && bedrockRoot === null) {
    const nested = await findNestedPackCandidate(zip, rawNames, expectedEdition);
    if (nested) {
      zip = nested.zip;
      rawNames = nested.rawNames;
      containerPath = nested.path;
      javaRoot = findBestRootFor(rawNames, 'pack.mcmeta', 'java');
      bedrockRoot = findBestRootFor(rawNames, 'manifest.json', 'bedrock');
    }
  }

  let detectedEdition =
    expectedEdition === 'java' && javaRoot !== null
      ? 'java'
      : expectedEdition === 'bedrock' && bedrockRoot !== null
        ? 'bedrock'
        : javaRoot !== null
          ? 'java'
          : bedrockRoot !== null
            ? 'bedrock'
            : null;

  let rootPrefix =
    detectedEdition === 'java'
      ? javaRoot
      : detectedEdition === 'bedrock'
        ? bedrockRoot
        : '';

  let adapter = null;
  let pathMap = null;
  let names = null;

  // Always inspect Java vendor architecture when Java is expected. This allows
  // a single ZIP containing RSS + ItemsAdder + Oraxen alternatives to be
  // normalized automatically even when one subfolder already has pack.mcmeta.
  if (expectedEdition === 'java') {
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
      'Could not find a Java/Bedrock pack root, nested MCPACK/ZIP, or supported RSS/ItemsAdder/Nexo/Oraxen source architecture.'
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
  if (containerPath) {
    warnings.unshift(
      `Automatically opened nested ${expectedEdition === 'bedrock' ? 'Bedrock' : 'Java'} resource pack: ${containerPath}.`
    );
  }
  let metadata = null;
  let encryptedResources = false;

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
      const mappedMetaPath = adapter.pathMap?.['pack.mcmeta'];
      if (mappedMetaPath) {
        try {
          metadata = JSON.parse(await zip.file(mappedMetaPath).async('string'));
        } catch {
          metadata = null;
        }
      }

      metadata ||= {
        pack: {
          description: `Detected ${adapter.plugins.join(', ')} source bundle`,
        },
      };

      warnings.push(
        `Source-bundle mode enabled for ${adapter.plugins.join(', ')}; the converter selected the strongest matching architecture automatically.`
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

    const protectedCandidates = [
      rootPrefix + 'textures/item_texture.json',
      rootPrefix + 'contents.json',
    ];

    for (const protectedPath of protectedCandidates) {
      const protectedFile = zip.file(protectedPath);
      if (!protectedFile) continue;

      try {
        const bytes = await protectedFile.async('uint8array');
        const sample = new TextDecoder().decode(bytes.slice(0, 96)).trimStart();
        if (sample && !sample.startsWith('{') && !sample.startsWith('[')) {
          encryptedResources = true;
          break;
        }
      } catch {}
    }

    if (encryptedResources) {
      warnings.push(
        'This Bedrock resource pack appears to use encrypted/protected content. The pack structure can be detected, but protected textures/models cannot be safely reverse-converted.'
      );
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
    containerPath,
    zip,
    metadata,
    encryptedResources,
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
  if (
    direction === 'bedrock-to-java' &&
    inspection.encryptedResources
  ) {
    throw new Error(
      'This Bedrock pack uses encrypted/protected resource content. Its wrapper and manifest are detectable, but the protected textures/models cannot be reverse-converted safely.'
    );
  }

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
  const skippedDetails = [];
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
      const reason = decision?.reason || 'Unsupported';
      stats.skipped++;
      skippedDetails.push(
        makeSkippedDetail({
          sourcePath,
          reason,
          attemptedTarget: null,
          code: 'no-safe-target',
        })
      );
      if (skipped.length < 200) {
        skipped.push(`${sourcePath} — ${reason}`);
      }

      if (isPng) {
        if (genericPreviewEntries.length < LIMITS.previewImages) {
          const bytes = await sourceFile.async('uint8array');
          genericPreviewEntries.push(
            makePreviewEntry({
              sourcePath,
              targetPath: null,
              status: 'skipped',
              reason,
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
      const reason = 'Generated target path was unsafe and was rejected.';
      stats.skipped++;
      skippedDetails.push(
        makeSkippedDetail({
          sourcePath,
          reason,
          attemptedTarget: decision.target || null,
          code: 'unsafe-target',
        })
      );
      if (skipped.length < 200) skipped.push(`${sourcePath} — ${reason}`);
      continue;
    }

    if (occupied.has(target)) {
      const reason = `Another source file already claimed the output path ${target}.`;
      stats.collisions++;
      stats.skipped++;
      skippedDetails.push(
        makeSkippedDetail({
          sourcePath,
          reason,
          attemptedTarget: target,
          code: 'target-collision',
        })
      );
      if (skipped.length < 200) {
        skipped.push(`${sourcePath} — ${reason}`);
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

    for (let i = skippedDetails.length - 1; i >= 0; i--) {
      if (rescuedGenericPaths.has(skippedDetails[i].sourcePath)) {
        skippedDetails.splice(i, 1);
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
    skippedEntries: skippedDetails,
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

function makeSkippedDetail({
  sourcePath,
  reason,
  attemptedTarget = null,
  code = 'skipped',
}) {
  const lower = String(sourcePath || '').toLowerCase();
  const extensionMatch = lower.match(/\.([a-z0-9]+)$/i);
  const extension = extensionMatch ? extensionMatch[1].toUpperCase() : 'FILE';

  let category = 'Other';
  if (lower.endsWith('pack.mcmeta') || lower.endsWith('manifest.json')) {
    category = 'Metadata';
  } else if (
    lower.includes('/models/') ||
    lower.includes('/blockstates/') ||
    lower.includes('/attachables/') ||
    lower.includes('/entity/')
  ) {
    category = 'Models / Runtime';
  } else if (lower.includes('/font/') || lower.includes('/fonts/')) {
    category = 'Fonts';
  } else if (lower.includes('/gui/') || lower.includes('/ui/')) {
    category = 'GUI';
  } else if (lower.includes('/animation') || lower.endsWith('.mcmeta')) {
    category = 'Animation';
  } else if (/\.(png|tga|jpg|jpeg)$/i.test(lower)) {
    category = 'Texture';
  } else if (/\.json$/i.test(lower)) {
    category = 'JSON';
  }

  return {
    id: `skipped:${sourcePath}`,
    sourcePath,
    fileType: extension,
    category,
    reason: String(reason || 'No safe conversion rule matched this file.'),
    attemptedTarget,
    code,
    output:
      attemptedTarget
        ? `No output written. Attempted target: ${attemptedTarget}`
        : 'No output file was generated for this source.',
  };
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
