import { actualPathFor } from './plugin-adapters.js';

const BEDROCK_GLYPH_MIN = 0xE000;
const BEDROCK_GLYPH_MAX = 0xF8FF;
const SAFE_SUGGESTION_RANGES = [
  [0xE800, 0xF8FF],
  [0xE200, 0xE7FF],
];
const JAVA_GLYPH_LIMIT = 1200;
const MAX_ATLAS_CELL = 256;

function splitId(value, defaultNamespace = 'minecraft') {
  if (!value || typeof value !== 'string') return [defaultNamespace, ''];
  const idx = value.indexOf(':');
  return idx >= 0
    ? [value.slice(0, idx), value.slice(idx + 1)]
    : [defaultNamespace, value];
}

function sourceFile(inspection, normalizedPath) {
  return inspection.zip.file(actualPathFor(inspection, normalizedPath));
}

function hasFile(inspection, normalizedPath) {
  return !!sourceFile(inspection, normalizedPath);
}

async function readJson(inspection, path) {
  const file = sourceFile(inspection, path);
  if (!file) return null;
  try {
    return JSON.parse(await file.async('string'));
  } catch {
    return null;
  }
}

function texturePath(ref, defaultNamespace) {
  const [ns, raw] = splitId(ref, defaultNamespace);
  const path = raw.replace(/^textures\//, '').replace(/\.png$/i, '');
  return `assets/${ns}/textures/${path}.png`;
}

function javaTextureRef(path) {
  const match = String(path || '').match(
    /^assets\/([^/]+)\/textures\/(.+\.png)$/i
  );
  return match ? `${match[1]}:${match[2]}` : null;
}

async function imageBitmapFromBlob(blob) {
  if (globalThis.createImageBitmap) return createImageBitmap(blob);

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to decode PNG image.'));
    };
    img.src = url;
  });
}

function canvas(width, height) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

function canvasBlob(c) {
  return new Promise((resolve, reject) => {
    c.toBlob(
      blob => blob
        ? resolve(blob)
        : reject(new Error('Unable to encode PNG image.')),
      'image/png'
    );
  });
}

async function cropBitmap(bitmap, sx, sy, sw, sh) {
  const c = canvas(sw, sh);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return canvasBlob(c);
}

async function cropVisiblePixels(bitmap, sx, sy, sw, sh) {
  const cell = canvas(sw, sh);
  const ctx = cell.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cell.width, cell.height);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, cell.width, cell.height);

  const image = ctx.getImageData(0, 0, cell.width, cell.height);
  const { data, width, height } = image;

  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 5) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) return null;

  const outW = right - left + 1;
  const outH = bottom - top + 1;
  return {
    blob: await cropBitmap(cell, left, top, outW, outH),
    bounds: { x: left, y: top, w: outW, h: outH },
  };
}

function providerCells(chars) {
  const rows = Array.isArray(chars) ? chars : [];
  const codeRows = rows.map(row => [...String(row)]);
  const columns = Math.max(1, ...codeRows.map(row => row.length));
  return { rows: codeRows, columns };
}

function pageInfo(codePoint) {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < BEDROCK_GLYPH_MIN ||
    codePoint > BEDROCK_GLYPH_MAX
  ) return null;

  const page = codePoint >> 8;
  const slot = codePoint & 0xFF;

  return {
    page,
    pageHex: page.toString(16).toUpperCase().padStart(2, '0'),
    slot,
    slotHex: slot.toString(16).toUpperCase().padStart(2, '0'),
    row: slot >> 4,
    col: slot & 0x0F,
  };
}

function nextPowerOfTwo(value) {
  let n = 16;
  while (n < value && n < MAX_ATLAS_CELL) n *= 2;
  return Math.min(MAX_ATLAS_CELL, Math.max(16, n));
}

function fontDefinitionInfo(path) {
  const match = path.match(/^assets\/([^/]+)\/font\/(.+)\.json$/i);
  return match ? { namespace: match[1], name: match[2] } : null;
}

function unicodeLabel(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function escapedUnicode(cp) {
  return `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function safeKey(value) {
  return String(value || 'glyph')
    .toLowerCase()
    .replace(/\.png$/i, '')
    .replace(/[^a-z0-9_/-]+/g, '_')
    .replace(/[/-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'glyph';
}

function allocateSuggestedCodePoint(used) {
  for (const [start, end] of SAFE_SUGGESTION_RANGES) {
    for (let cp = start; cp <= end; cp++) {
      if (used.has(cp)) continue;
      used.add(cp);
      return cp;
    }
  }
  return null;
}

function makeSuggestionSnippets({ cp, sourcePath, id, namespace = 'dazen' }) {
  const char = String.fromCodePoint(cp);
  const key = safeKey(id || sourcePath?.split('/').pop() || 'glyph');
  const sourceRef =
    javaTextureRef(sourcePath) ||
    `${namespace}:font/${key}.png`;

  const pluginNamespace =
    namespace === 'minecraft' || !namespace
      ? 'dazen_converted'
      : namespace;

  const sourceLeaf =
    sourcePath?.split('/').pop()?.replace(/\.png$/i, '') ||
    key;

  const pluginTextureRef =
    `${pluginNamespace}:font/${safeKey(sourceLeaf)}`;

  return {
    javaJson: [
      '{',
      '  "type": "bitmap",',
      `  "file": "${sourceRef}",`,
      '  "ascent": 8,',
      '  "height": 8,',
      `  "chars": ["${escapedUnicode(cp)}"]`,
      '}',
    ].join('\n'),
    itemsAdder: [
      `# Copy PNG to: contents/${pluginNamespace}/textures/font/${safeKey(sourceLeaf)}.png`,
      'info:',
      `  namespace: ${pluginNamespace}`,
      'font_images:',
      `  ${key}:`,
      `    path: "font/${safeKey(sourceLeaf)}.png"`,
      `    symbol: "${char}"`,
      '    scale_ratio: 8',
      '    y_position: 8',
    ].join('\n'),
    nexo: [
      `# Copy PNG to: Nexo/pack/assets/${pluginNamespace}/textures/font/${safeKey(sourceLeaf)}.png`,
      `${key}:`,
      `  texture: ${pluginTextureRef}`,
      '  ascent: 8',
      '  height: 8',
      `  char: "${char}"`,
    ].join('\n'),
    oraxen: [
      `# Copy PNG to: Oraxen/pack/assets/${pluginNamespace}/textures/font/${safeKey(sourceLeaf)}.png`,
      `${key}:`,
      `  texture: ${pluginTextureRef}`,
      '  ascent: 8',
      '  height: 8',
      `  char: "${char}"`,
    ].join('\n'),
  };
}

function candidateFontTexture(path) {
  return /^assets\/[^/]+\/textures\/(?:font|fonts|rank|ranks|glyph|glyphs|emoji|emojis)\/.+\.png$/i.test(path);
}

async function collectJavaBitmapGlyphs(inspection, onLog) {
  const glyphs = [];
  const used = new Set();
  const referencedTextures = new Set();
  const explicitHintIds = new Set();

  for (const path of (inspection.names || []).filter(
    n => /^assets\/[^/]+\/font\/.+\.json$/i.test(n)
  )) {
    const info = fontDefinitionInfo(path);
    const doc = await readJson(inspection, path);
    if (!info || !Array.isArray(doc?.providers)) continue;

    for (const provider of doc.providers) {
      if (
        provider?.type !== 'bitmap' ||
        typeof provider.file !== 'string'
      ) continue;

      const sourcePath = texturePath(
        provider.file,
        info.namespace
      );
      if (!hasFile(inspection, sourcePath)) continue;
      referencedTextures.add(sourcePath);

      const file = sourceFile(inspection, sourcePath);
      const bytes = await file.async('uint8array');
      const blob = new Blob([bytes], { type: 'image/png' });

      let bitmap;
      try {
        bitmap = await imageBitmapFromBlob(blob);
      } catch {
        continue;
      }

      const grid = providerCells(provider.chars);
      const rowCount = Math.max(1, grid.rows.length);
      const cellW = bitmap.width / grid.columns;
      const cellH = bitmap.height / rowCount;

      for (let row = 0; row < grid.rows.length; row++) {
        const chars = grid.rows[row];

        for (let col = 0; col < chars.length; col++) {
          const char = chars[col];
          const cp = char.codePointAt(0);
          const page = pageInfo(cp);

          if (!page || used.has(cp)) continue;
          used.add(cp);

          const glyphBlob = await cropBitmap(
            bitmap,
            Math.round(col * cellW),
            Math.round(row * cellH),
            Math.max(1, Math.round(cellW)),
            Math.max(1, Math.round(cellH))
          );

          glyphs.push({
            id:
              `${info.namespace}:${info.name}:${cp.toString(16)}`,
            char,
            codePoint: cp,
            sourcePath,
            sourceBlob: glyphBlob,
            height: Number(provider.height || cellH),
            ascent: Number(
              provider.ascent ||
              provider.height ||
              cellH
            ),
            page,
            autoAssigned: false,
          });

          if (glyphs.length >= JAVA_GLYPH_LIMIT) {
            onLog(
              'warn',
              `Font conversion reached the safety limit of ${JAVA_GLYPH_LIMIT} private-use glyphs.`
            );
            return {
              glyphs,
              assignments: [],
              used,
              referencedTextures,
            };
          }
        }
      }
    }
  }

  // Explicit plugin glyph characters are authoritative when supplied.
  for (const hint of inspection.adapter?.glyphHints || []) {
    if (!hint.resolvable || !hint.char) continue;

    const cp = hint.char.codePointAt(0);
    const page = pageInfo(cp);
    if (!page || used.has(cp)) continue;

    const sourcePath = texturePath(
      hint.textureRef,
      hint.namespace || 'minecraft'
    );
    if (!hasFile(inspection, sourcePath)) continue;

    explicitHintIds.add(hint.id);
    referencedTextures.add(sourcePath);

    const file = sourceFile(inspection, sourcePath);
    const bytes = await file.async('uint8array');
    const blob = new Blob([bytes], { type: 'image/png' });

    used.add(cp);
    glyphs.push({
      id: hint.id,
      char: hint.char,
      codePoint: cp,
      sourcePath,
      sourceBlob: blob,
      height: hint.height || 8,
      ascent: hint.ascent || 8,
      page,
      plugin: hint.plugin,
      autoAssigned: false,
    });
  }

  // When a font/rank image has the same plugin/font structure as mapped
  // glyphs but no explicit character, assign a deterministic free PUA code
  // instead of leaving it as "No target mapping". We ALSO generate Java /
  // ItemsAdder / Nexo / Oraxen config patches so the source side can be made
  // to use the exact same character.
  const assignments = [];
  const assignmentSeen = new Set();
  const allocationUsed = new Set(used);

  async function addAssignment({
    id,
    sourcePath,
    namespace = 'dazen',
    reason,
    plugin = null,
    height = 8,
    ascent = 8,
  }) {
    if (
      !sourcePath ||
      assignmentSeen.has(sourcePath) ||
      !hasFile(inspection, sourcePath)
    ) return;

    const cp = allocateSuggestedCodePoint(allocationUsed);
    if (cp == null) return;

    const file = sourceFile(inspection, sourcePath);
    const bytes = await file.async('uint8array');
    const blob = new Blob([bytes], { type: 'image/png' });
    const page = pageInfo(cp);
    const char = String.fromCodePoint(cp);
    const snippets = makeSuggestionSnippets({
      cp,
      sourcePath,
      id,
      namespace,
    });

    assignmentSeen.add(sourcePath);
    referencedTextures.add(sourcePath);
    used.add(cp);

    const assignment = {
      id: id || `auto:${sourcePath}`,
      name: safeKey(
        id || sourcePath.split('/').pop()
      ),
      namespace,
      sourcePath,
      sourceBlob: blob,
      plugin,
      reason,
      height,
      ascent,
      char,
      codePoint: cp,
      page,
      snippets,
    };

    assignments.push(assignment);

    glyphs.push({
      id: assignment.id,
      char,
      codePoint: cp,
      sourcePath,
      sourceBlob: blob,
      height,
      ascent,
      page,
      plugin,
      autoAssigned: true,
      assignmentReason: reason,
      configSuggestions: snippets,
    });
  }

  for (const hint of inspection.adapter?.glyphHints || []) {
    if (hint.resolvable || explicitHintIds.has(hint.id)) {
      continue;
    }

    const sourcePath = texturePath(
      hint.textureRef,
      hint.namespace || 'minecraft'
    );

    await addAssignment({
      id: hint.id,
      sourcePath,
      namespace: hint.namespace || 'dazen',
      plugin: hint.plugin,
      height: hint.height || 8,
      ascent: hint.ascent || 8,
      reason:
        'The source plugin defines this font/rank image but does not expose a character. The converter assigned a deterministic free private-use character and generated matching source-side config patches.',
    });
  }

  for (const path of inspection.names || []) {
    if (
      !candidateFontTexture(path) ||
      referencedTextures.has(path) ||
      assignmentSeen.has(path)
    ) continue;

    const match = path.match(
      /^assets\/([^/]+)\/textures\//i
    );

    await addAssignment({
      id: `unmapped:${path}`,
      sourcePath: path,
      namespace: match?.[1] || 'dazen',
      reason:
        'This rank/font/emoji PNG was not referenced by the current Java font JSON. The converter assigned a deterministic free private-use character and generated source-side mapping examples.',
    });
  }

  return {
    glyphs,
    assignments,
    used,
    referencedTextures,
  };
}

async function measureGlyphs(glyphs) {
  const measured = [];
  for (const glyph of glyphs) {
    const bitmap = await imageBitmapFromBlob(glyph.sourceBlob);
    measured.push({
      ...glyph,
      bitmap,
      pixelWidth: bitmap.width,
      pixelHeight: bitmap.height,
    });
  }
  return measured;
}

function assignmentResourceInfo(sourcePath) {
  const match = String(sourcePath || '').match(
    /^assets\/([^/]+)\/textures\/(.+\.png)$/i
  );
  if (!match) return null;

  return {
    namespace: match[1],
    relative: match[2],
    ref:
      `${match[1]}:${match[2].replace(/\.png$/i, '')}`,
  };
}

function writeAutoAssignmentPatches(output, assignments) {
  if (!assignments.length) return;

  const byNamespace = new Map();

  for (const assignment of assignments) {
    const resource =
      assignmentResourceInfo(assignment.sourcePath);
    if (!resource) continue;

    if (!byNamespace.has(resource.namespace)) {
      byNamespace.set(resource.namespace, []);
    }

    byNamespace.get(resource.namespace).push({
      ...assignment,
      resource,
      key: safeKey(
        assignment.id?.split(':').pop() ||
        resource.relative.split('/').pop()
      ),
    });
  }

  for (const [namespace, entries] of byNamespace) {
    const javaProviders = entries.map(entry => ({
      type: 'bitmap',
      file:
        `${namespace}:${entry.resource.relative}`,
      ascent: Number(entry.ascent || 8),
      height: Number(entry.height || 8),
      chars: [entry.char],
    }));

    output.file(
      `integrations/Java/assets/${namespace}/font/dazen_auto_assigned.json`,
      JSON.stringify({ providers: javaProviders }, null, 2)
    );

    const ia = [
      'info:',
      `  namespace: ${namespace}`,
      'font_images:',
    ];

    const nexo = [];
    const oraxen = [];

    for (const entry of entries) {
      ia.push(
        `  ${entry.key}:`,
        `    path: "${entry.resource.relative}"`,
        `    symbol: "${entry.char}"`,
        `    scale_ratio: ${Number(entry.height || 8)}`,
        `    y_position: ${Number(entry.ascent || entry.height || 8)}`
      );

      nexo.push(
        `${entry.key}:`,
        `  texture: ${entry.resource.ref}`,
        `  ascent: ${Number(entry.ascent || 8)}`,
        `  height: ${Number(entry.height || 8)}`,
        `  char: "${entry.char}"`
      );

      oraxen.push(
        `${entry.key}:`,
        `  texture: ${entry.resource.ref}`,
        `  ascent: ${Number(entry.ascent || 8)}`,
        `  height: ${Number(entry.height || 8)}`,
        `  char: "${entry.char}"`
      );
    }

    const iaConfig = ia.join('\n') + '\n';

    output.file(
      `integrations/ItemsAdder/contents/${namespace}/configs/dazen_auto_assigned_font_images.yml`,
      iaConfig
    );

    // Legacy / alternate ItemsAdder architecture:
    // data/items_packs/<namespace>/*.yml + data/resource_pack/assets/...
    output.file(
      `integrations/ItemsAdder/data/items_packs/${namespace}/dazen_auto_assigned_font_images.yml`,
      iaConfig
    );

    output.file(
      `integrations/Nexo/glyphs/dazen_auto_assigned_${namespace}.yml`,
      nexo.join('\n') + '\n'
    );

    output.file(
      `integrations/Oraxen/glyphs/dazen_auto_assigned_${namespace}.yml`,
      oraxen.join('\n') + '\n'
    );
  }
}

export async function convertJavaFontsToBedrock({
  inspection,
  output,
  onLog = () => {},
}) {
  const collected =
    await collectJavaBitmapGlyphs(
      inspection,
      onLog
    );

  const measured =
    await measureGlyphs(collected.glyphs);

  const previewEntries = [];
  const pageGroups = new Map();

  for (const glyph of measured) {
    const key = glyph.page.pageHex;
    if (!pageGroups.has(key)) {
      pageGroups.set(key, []);
    }
    pageGroups.get(key).push(glyph);
  }

  for (const [key, glyphs] of pageGroups) {
    const largest = glyphs.reduce(
      (max, glyph) =>
        Math.max(
          max,
          glyph.pixelWidth,
          glyph.pixelHeight
        ),
      16
    );

    const cellSize = nextPowerOfTwo(largest);

    if (largest > MAX_ATLAS_CELL) {
      onLog(
        'warn',
        `Glyph page ${key} contains an image larger than ${MAX_ATLAS_CELL}px. It will be clipped to the maximum safe editor cell size.`
      );
    }

    const atlas = canvas(
      cellSize * 16,
      cellSize * 16
    );
    const ctx = atlas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const usedSlots = [];

    for (const glyph of glyphs) {
      const x =
        glyph.page.col * cellSize +
        Math.floor(
          (cellSize - glyph.pixelWidth) / 2
        );

      const y =
        glyph.page.row * cellSize +
        Math.floor(
          (cellSize - glyph.pixelHeight) / 2
        );

      ctx.drawImage(glyph.bitmap, x, y);
      usedSlots.push(glyph.page.slot);

      const isolated = canvas(
        cellSize,
        cellSize
      );
      const isolatedCtx =
        isolated.getContext('2d');
      isolatedCtx.imageSmoothingEnabled = false;

      isolatedCtx.drawImage(
        glyph.bitmap,
        Math.floor(
          (cellSize - glyph.pixelWidth) / 2
        ),
        Math.floor(
          (cellSize - glyph.pixelHeight) / 2
        )
      );

      const targetBlob =
        await canvasBlob(isolated);

      const atlasPath =
        `font/glyph_${key}.png`;

      const autoText = glyph.autoAssigned
        ? ' Auto-assigned because the source plugin/image had no explicit character; apply one of the generated Java/plugin config patches so the source side uses the same character.'
        : '';

      previewEntries.push({
        id: `font:${glyph.codePoint}`,
        name:
          `${unicodeLabel(glyph.codePoint)} · slot ${glyph.page.slotHex}` +
          (glyph.autoAssigned
            ? ' · auto-mapped'
            : ''),
        category: 'Fonts',
        sourcePath: glyph.sourcePath,
        targetPath:
          `${atlasPath} #${glyph.page.slotHex}`,
        status: 'mapped',
        reason:
          `Character ${unicodeLabel(glyph.codePoint)} maps to glyph_${key}.png cell ${glyph.page.slotHex} (row ${glyph.page.row.toString(16).toUpperCase()}, column ${glyph.page.col.toString(16).toUpperCase()}). Artwork is kept at its original pixel size and centered by default.${autoText}`,
        sourceBlob: glyph.sourceBlob,
        targetBlob,
        editable: true,
        editSpec: {
          type: 'atlas-cell',
          targetPath: atlasPath,
          cellSize,
          row: glyph.page.row,
          col: glyph.page.col,
        },
        metadata: {
          char: glyph.char,
          codePoint: glyph.codePoint,
          unicode:
            unicodeLabel(glyph.codePoint),
          pageHex: key,
          slotHex: glyph.page.slotHex,
          row: glyph.page.row,
          col: glyph.page.col,
          javaHeight: glyph.height,
          javaAscent: glyph.ascent,
          cellSize,
          autoAssigned:
            !!glyph.autoAssigned,
          suggested:
            !!glyph.autoAssigned,
          plugin:
            glyph.plugin || null,
          configSuggestions:
            glyph.configSuggestions || null,
        },
      });
    }

    const atlasBlob =
      await canvasBlob(atlas);

    output.file(
      `font/glyph_${key}.png`,
      atlasBlob
    );

    previewEntries.unshift({
      id: `font-atlas:${key}`,
      name:
        `Glyph Page ${key} · ${glyphs.length} mapped character(s)`,
      category: 'Fonts',
      sourcePath:
        'Java bitmap providers / auto-assigned font images',
      targetPath:
        `font/glyph_${key}.png`,
      status: 'mapped',
      reason:
        `Full 16×16 Bedrock glyph page. Each cell is ${cellSize}×${cellSize}px; the two hex digits printed by the viewer are the row+column slot (00–FF).`,
      sourceBlob: null,
      targetBlob: atlasBlob,
      editable: false,
      metadata: {
        atlasPage: true,
        pageHex: key,
        cellSize,
        atlasSize:
          cellSize * 16,
        usedSlots,
        rangeStart:
          `U+${key}00`,
        rangeEnd:
          `U+${key}FF`,
      },
    });
  }

  if (collected.assignments.length) {
    writeAutoAssignmentPatches(
      output,
      collected.assignments
    );

    const report =
      collected.assignments.map(item => ({
        id: item.id,
        source_texture:
          item.sourcePath,
        plugin: item.plugin,
        reason: item.reason,
        assigned_character:
          item.char,
        unicode:
          unicodeLabel(item.codePoint),
        bedrock_page:
          `glyph_${item.page.pageHex}.png`,
        bedrock_slot:
          item.page.slotHex,
        configuration_examples:
          item.snippets,
      }));

    output.file(
      'dazen/font-character-assignments.json',
      JSON.stringify(report, null, 2)
    );

    output.file(
      'dazen/APPLY_FONT_CHARACTER_PATCHES.txt',
      [
        'Dazen Texture Pack Converter - auto-assigned font characters',
        '',
        `${collected.assignments.length} rank/font image(s) had no explicit Java/plugin character.`,
        'The converter assigned deterministic private-use characters and mapped them into the Bedrock glyph atlas.',
        '',
        'IMPORTANT:',
        'For Java/Bedrock cross-play to use the same symbols, apply the matching generated patch for your Java-side plugin/resource pack:',
        '- integrations/Java/',
        '- integrations/ItemsAdder/',
        '- integrations/Nexo/',
        '- integrations/Oraxen/',
        '',
        'The conversion viewer shows the assigned character, Unicode code point, Bedrock glyph page/slot, and copy buttons.',
      ].join('\n')
    );

    onLog(
      'success',
      `Auto-mapped ${collected.assignments.length} rank/font image(s) that had no explicit target character and generated matching Java/ItemsAdder/Nexo/Oraxen character patches.`
    );
  }

  if (measured.length) {
    onLog(
      'success',
      `Fonts: mapped ${measured.length} Java/plugin bitmap glyph(s) into ${pageGroups.size} Bedrock glyph atlas page(s) using pixel-preserving atlas cells.`
    );
  }

  return {
    converted: measured.length,
    previewEntries,
    pages: pageGroups.size,
    unresolved: 0,
    autoAssigned:
      collected.assignments.length,
  };
}

async function bitmapAndPixels(blob) {
  const bitmap = await imageBitmapFromBlob(blob);
  const c = canvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);

  return {
    bitmap,
    canvas: c,
    ctx,
    data: ctx.getImageData(0, 0, c.width, c.height),
  };
}

function cellHasPixels(imageData, imageWidth, x, y, w, h) {
  const data = imageData.data;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(imageWidth, Math.ceil(x + w));
  const y1 = Math.min(imageData.height, Math.ceil(y + h));

  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      if (data[(yy * imageWidth + xx) * 4 + 3] > 5) return true;
    }
  }

  return false;
}

export async function convertBedrockFontsToJava({
  inspection,
  output,
  onLog = () => {},
}) {
  const pages = (inspection.names || [])
    .map(path => ({
      path,
      match: path.match(/^font\/glyph_([EeFf][0-9A-Fa-f])\.png$/),
    }))
    .filter(item => item.match);

  if (!pages.length) {
    return { converted: 0, previewEntries: [], pages: 0 };
  }

  const providers = [];
  const previewEntries = [];
  const iaGlyphs = [];
  const nexoGlyphs = [];
  const oraxenGlyphs = [];
  let converted = 0;

  for (const pageFile of pages) {
    const page = parseInt(pageFile.match[1], 16);
    if (page < 0xE0 || page > 0xF8) continue;

    const pageHex = page
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
    const file = sourceFile(inspection, pageFile.path);
    if (!file) continue;

    const bytes = await file.async('uint8array');
    const pageBlob = new Blob([bytes], { type: 'image/png' });
    const { bitmap, data } = await bitmapAndPixels(pageBlob);

    if (
      bitmap.width % 16 !== 0 ||
      bitmap.height % 16 !== 0 ||
      bitmap.width / 16 !== bitmap.height / 16
    ) {
      onLog(
        'warn',
        `${pageFile.path} is not a square 16×16 glyph grid and was skipped.`
      );
      continue;
    }

    const cellSize = bitmap.width / 16;
    const usedSlots = [];

    previewEntries.push({
      id: `bedrock-font-atlas:${pageHex}`,
      name: `Glyph Page ${pageHex} · full source atlas`,
      category: 'Fonts',
      sourcePath: pageFile.path,
      targetPath: 'Java bitmap providers',
      status: 'mapped',
      reason:
        `Full Bedrock 16×16 glyph page. Cell ${pageHex}XX corresponds directly to Unicode U+${pageHex}XX.`,
      sourceBlob: pageBlob,
      targetBlob: null,
      editable: false,
      metadata: {
        atlasPage: true,
        sourceAtlas: true,
        pageHex,
        cellSize,
        atlasSize: bitmap.width,
        usedSlots,
        rangeStart: `U+${pageHex}00`,
        rangeEnd: `U+${pageHex}FF`,
      },
    });

    for (let slot = 0; slot < 256; slot++) {
      const row = slot >> 4;
      const col = slot & 15;
      const sx = col * cellSize;
      const sy = row * cellSize;

      if (
        !cellHasPixels(
          data,
          bitmap.width,
          sx,
          sy,
          cellSize,
          cellSize
        )
      ) continue;

      const cropped = await cropVisiblePixels(
        bitmap,
        sx,
        sy,
        cellSize,
        cellSize
      );
      if (!cropped) continue;

      const cp = (page << 8) | slot;
      const char = String.fromCodePoint(cp);
      const slotHex = slot
        .toString(16)
        .toUpperCase()
        .padStart(2, '0');
      const id = `${page
        .toString(16)
        .toLowerCase()}_${slot
        .toString(16)
        .padStart(2, '0')}`;
      const fileName = `glyph_${id}.png`;
      const javaTexture =
        `assets/dazen/textures/font/${fileName}`;

      output.file(javaTexture, cropped.blob);
      output.file(
        `integrations/ItemsAdder/contents/dazen_converted/textures/font/${fileName}`,
        cropped.blob
      );

      output.file(
        `integrations/ItemsAdder/data/resource_pack/assets/dazen_converted/textures/font/${fileName}`,
        cropped.blob
      );
      output.file(
        `integrations/Nexo/pack/assets/dazen/textures/font/${fileName}`,
        cropped.blob
      );
      output.file(
        `integrations/Oraxen/pack/assets/dazen/textures/font/${fileName}`,
        cropped.blob
      );

      const yamlChar = JSON.stringify(char);

      iaGlyphs.push(
        `  glyph_${id}:`,
        `    path: "font/${fileName}"`,
        `    symbol: ${yamlChar}`,
        '    scale_ratio: 8',
        '    y_position: 8'
      );

      nexoGlyphs.push(
        `glyph_${id}:`,
        `  texture: dazen:font/${fileName.replace(/\.png$/i, '')}`,
        '  ascent: 8',
        '  height: 8',
        `  char: ${yamlChar}`
      );

      oraxenGlyphs.push(
        `glyph_${id}:`,
        `  texture: dazen:font/${fileName.replace(/\.png$/i, '')}`,
        '  ascent: 8',
        '  height: 8',
        `  char: ${yamlChar}`
      );

      providers.push({
        type: 'bitmap',
        file: `dazen:font/glyph_${id}.png`,
        ascent: 8,
        height: 8,
        chars: [char],
      });

      usedSlots.push(slot);

      previewEntries.push({
        id: `bedrock-font:${cp}`,
        name: `${unicodeLabel(cp)} · slot ${slotHex}`,
        category: 'Fonts',
        sourcePath: `${pageFile.path} #${slotHex}`,
        targetPath: javaTexture,
        status: 'mapped',
        reason:
          `Bedrock glyph_${pageHex}.png cell ${slotHex} was cropped to its visible pixel bounds and written as a Java bitmap font image.`,
        sourceBlob: cropped.blob,
        targetBlob: cropped.blob,
        editable: true,
        editSpec: {
          type: 'direct-image',
          targetPath: javaTexture,
        },
        metadata: {
          char,
          codePoint: cp,
          unicode: unicodeLabel(cp),
          pageHex,
          slotHex,
          row,
          col,
          sourceCellSize: cellSize,
          sourceBounds: cropped.bounds,
        },
      });

      converted++;
      if (converted >= JAVA_GLYPH_LIMIT) break;
    }

    if (converted >= JAVA_GLYPH_LIMIT) {
      onLog(
        'warn',
        `Bedrock → Java font conversion reached the safety limit of ${JAVA_GLYPH_LIMIT} non-empty glyph cells.`
      );
      break;
    }
  }

  if (providers.length) {
    output.file(
      'assets/minecraft/font/default.json',
      JSON.stringify({ providers }, null, 2)
    );

    const iaFontConfig = [
      'info:',
      '  namespace: dazen_converted',
      'font_images:',
      ...iaGlyphs,
    ].join('\n') + '\n';

    output.file(
      'integrations/ItemsAdder/contents/dazen_converted/configs/dazen_fonts.yml',
      iaFontConfig
    );

    output.file(
      'integrations/ItemsAdder/data/items_packs/dazen_converted/dazen_fonts.yml',
      iaFontConfig
    );

    output.file(
      'integrations/Nexo/glyphs/dazen_converted.yml',
      nexoGlyphs.join('\n') + '\n'
    );

    output.file(
      'integrations/Oraxen/glyphs/dazen_converted.yml',
      oraxenGlyphs.join('\n') + '\n'
    );

    onLog(
      'success',
      `Fonts: extracted ${providers.length} Bedrock glyph cell(s) into cropped Java bitmap providers while preserving each Unicode mapping.`
    );
    onLog(
      'info',
      'Generated ItemsAdder, Nexo and Oraxen glyph integration configs with explicit characters.'
    );
  }

  return {
    converted,
    previewEntries,
    pages: pages.length,
  };
}
