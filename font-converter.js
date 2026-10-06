import { actualPathFor } from './plugin-adapters.js';

const BEDROCK_GLYPH_MIN = 0xE000;
const BEDROCK_GLYPH_MAX = 0xF8FF;
const JAVA_GLYPH_LIMIT = 1200;
const BEDROCK_ATLAS_CELL = 32;

function splitId(value, defaultNamespace = 'minecraft') {
  if (!value || typeof value !== 'string') return [defaultNamespace, ''];
  const idx = value.indexOf(':');
  return idx >= 0 ? [value.slice(0, idx), value.slice(idx + 1)] : [defaultNamespace, value];
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
    c.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to encode PNG image.')), 'image/png');
  });
}

async function cropBitmap(bitmap, sx, sy, sw, sh) {
  const c = canvas(sw, sh);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return canvasBlob(c);
}

function providerCells(chars) {
  const rows = Array.isArray(chars) ? chars : [];
  const codeRows = rows.map(row => [...String(row)]);
  const columns = Math.max(1, ...codeRows.map(row => row.length));
  return { rows: codeRows, columns };
}

function pageInfo(codePoint) {
  if (!Number.isInteger(codePoint) || codePoint < BEDROCK_GLYPH_MIN || codePoint > BEDROCK_GLYPH_MAX) return null;
  const page = codePoint >> 8;
  const slot = codePoint & 0xFF;
  return {
    page,
    pageHex: page.toString(16).toUpperCase().padStart(2, '0'),
    slot,
    row: slot >> 4,
    col: slot & 0x0F,
  };
}

function fitRect(srcW, srcH, cellSize) {
  const scale = Math.min(cellSize / srcW, cellSize / srcH);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  return {
    x: Math.floor((cellSize - w) / 2),
    y: Math.floor((cellSize - h) / 2),
    w,
    h,
  };
}

function fontDefinitionInfo(path) {
  const m = path.match(/^assets\/([^/]+)\/font\/(.+)\.json$/i);
  return m ? { namespace: m[1], name: m[2] } : null;
}

async function collectJavaBitmapGlyphs(inspection, onLog) {
  const glyphs = [];
  const used = new Set();

  for (const path of (inspection.names || []).filter(n => /^assets\/[^/]+\/font\/.+\.json$/i.test(n))) {
    const info = fontDefinitionInfo(path);
    const doc = await readJson(inspection, path);
    if (!info || !Array.isArray(doc?.providers)) continue;

    for (const provider of doc.providers) {
      if (provider?.type !== 'bitmap' || typeof provider.file !== 'string') continue;
      const sourcePath = texturePath(provider.file, info.namespace);
      if (!hasFile(inspection, sourcePath)) continue;

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
      const cellW = bitmap.width / grid.columns;
      const cellH = bitmap.height / Math.max(1, grid.rows.length);

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
            id: `${info.namespace}:${info.name}:${cp.toString(16)}`,
            char,
            codePoint: cp,
            sourcePath,
            sourceBlob: glyphBlob,
            height: Number(provider.height || cellH),
            ascent: Number(provider.ascent || provider.height || cellH),
            page,
          });

          if (glyphs.length >= JAVA_GLYPH_LIMIT) {
            onLog('warn', `Font conversion preview/export reached the safety limit of ${JAVA_GLYPH_LIMIT} private-use glyphs.`);
            return glyphs;
          }
        }
      }
    }
  }

  // Source-plugin configs can carry explicit chars before the plugin generates font JSON.
  for (const hint of inspection.adapter?.glyphHints || []) {
    if (!hint.resolvable || !hint.char) continue;
    const cp = hint.char.codePointAt(0);
    const page = pageInfo(cp);
    if (!page || used.has(cp)) continue;

    const sourcePath = texturePath(hint.textureRef, hint.namespace || 'minecraft');
    if (!hasFile(inspection, sourcePath)) continue;
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
    });
  }

  return glyphs;
}

export async function convertJavaFontsToBedrock({ inspection, output, onLog = () => {} }) {
  const glyphs = await collectJavaBitmapGlyphs(inspection, onLog);
  if (!glyphs.length) {
    const unresolved = (inspection.adapter?.glyphHints || []).filter(g => !g.resolvable);
    if (unresolved.length) {
      output.file('dazen/unresolved_font_images.json', JSON.stringify(unresolved.map(g => ({
        id: g.id,
        texture: g.textureRef,
        reason: 'The source plugin config does not expose the assigned Unicode character. Convert the generated Java resource pack, or set an explicit symbol/char in the plugin config.',
      })), null, 2));
      onLog('warn', `${unresolved.length} plugin font image(s) have no explicit Unicode character, so Bedrock glyph slots cannot be assigned safely.`);
    }
    return { converted: 0, previewEntries: [], pages: 0, unresolved: unresolved.length };
  }

  const pages = new Map();
  const previewEntries = [];

  for (const glyph of glyphs) {
    const key = glyph.page.pageHex;
    if (!pages.has(key)) {
      const c = canvas(BEDROCK_ATLAS_CELL * 16, BEDROCK_ATLAS_CELL * 16);
      pages.set(key, c);
    }

    const atlas = pages.get(key);
    const ctx = atlas.getContext('2d');
    const bitmap = await imageBitmapFromBlob(glyph.sourceBlob);
    const fit = fitRect(bitmap.width, bitmap.height, BEDROCK_ATLAS_CELL);
    const x = glyph.page.col * BEDROCK_ATLAS_CELL + fit.x;
    const y = glyph.page.row * BEDROCK_ATLAS_CELL + fit.y;
    ctx.clearRect(
      glyph.page.col * BEDROCK_ATLAS_CELL,
      glyph.page.row * BEDROCK_ATLAS_CELL,
      BEDROCK_ATLAS_CELL,
      BEDROCK_ATLAS_CELL
    );
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, x, y, fit.w, fit.h);

    const isolated = canvas(BEDROCK_ATLAS_CELL, BEDROCK_ATLAS_CELL);
    const ictx = isolated.getContext('2d');
    ictx.imageSmoothingEnabled = false;
    ictx.drawImage(bitmap, fit.x, fit.y, fit.w, fit.h);
    const targetBlob = await canvasBlob(isolated);
    const atlasPath = `font/glyph_${key}.png`;

    previewEntries.push({
      id: `font:${glyph.codePoint}`,
      name: `U+${glyph.codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
      category: 'Fonts',
      sourcePath: glyph.sourcePath,
      targetPath: `${atlasPath} #${glyph.page.slot.toString(16).toUpperCase().padStart(2, '0')}`,
      status: 'mapped',
      reason: `Java bitmap glyph mapped to Bedrock glyph_${key} slot ${glyph.page.slot.toString(16).toUpperCase().padStart(2, '0')}.`,
      sourceBlob: glyph.sourceBlob,
      targetBlob,
      editable: true,
      editSpec: {
        type: 'atlas-cell',
        targetPath: atlasPath,
        cellSize: BEDROCK_ATLAS_CELL,
        row: glyph.page.row,
        col: glyph.page.col,
      },
      metadata: {
        char: glyph.char,
        codePoint: glyph.codePoint,
        javaHeight: glyph.height,
        javaAscent: glyph.ascent,
      },
    });
  }

  for (const [key, c] of pages) {
    const blob = await canvasBlob(c);
    output.file(`font/glyph_${key}.png`, blob);
  }

  const unresolved = (inspection.adapter?.glyphHints || []).filter(g => !g.resolvable);
  if (unresolved.length) {
    output.file('dazen/unresolved_font_images.json', JSON.stringify(unresolved.map(g => ({
      id: g.id,
      texture: g.textureRef,
      reason: 'No explicit Unicode char/symbol is present in the source plugin config.',
    })), null, 2));
  }

  onLog('success', `Fonts: mapped ${glyphs.length} Java private-use bitmap glyph(s) into ${pages.size} Bedrock glyph atlas page(s).`);
  if (unresolved.length) {
    onLog('warn', `${unresolved.length} plugin font image(s) remain unresolved because their Java Unicode assignment is generated by the plugin at runtime/build time.`);
  }

  return {
    converted: glyphs.length,
    previewEntries,
    pages: pages.size,
    unresolved: unresolved.length,
  };
}

async function bitmapAndPixels(blob) {
  const bitmap = await imageBitmapFromBlob(blob);
  const c = canvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return { bitmap, canvas: c, ctx, data: ctx.getImageData(0, 0, c.width, c.height) };
}

function cellHasPixels(imageData, imageWidth, x, y, w, h) {
  const data = imageData.data;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(imageWidth, Math.ceil(x + w));
  const y1 = Math.ceil(y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      if (data[(yy * imageWidth + xx) * 4 + 3] > 5) return true;
    }
  }
  return false;
}

export async function convertBedrockFontsToJava({ inspection, output, onLog = () => {} }) {
  const pages = (inspection.names || [])
    .map(path => ({ path, match: path.match(/^font\/glyph_([EeFf][0-9A-Fa-f])\.png$/) }))
    .filter(item => item.match);

  if (!pages.length) return { converted: 0, previewEntries: [], pages: 0 };

  const providers = [];
  const previewEntries = [];
  const iaGlyphs = [];
  const nexoGlyphs = [];
  const oraxenGlyphs = [];
  let converted = 0;

  for (const pageFile of pages) {
    const page = parseInt(pageFile.match[1], 16);
    if (page < 0xE0 || page > 0xF8) continue;

    const file = sourceFile(inspection, pageFile.path);
    if (!file) continue;
    const bytes = await file.async('uint8array');
    const pageBlob = new Blob([bytes], { type: 'image/png' });
    const { bitmap, ctx, data } = await bitmapAndPixels(pageBlob);
    const cellW = bitmap.width / 16;
    const cellH = bitmap.height / 16;

    for (let slot = 0; slot < 256; slot++) {
      const row = slot >> 4;
      const col = slot & 15;
      const sx = col * cellW;
      const sy = row * cellH;
      if (!cellHasPixels(data, bitmap.width, sx, sy, cellW, cellH)) continue;

      const cp = (page << 8) | slot;
      const char = String.fromCodePoint(cp);
      const glyphBlob = await cropBitmap(
        bitmap,
        Math.round(sx),
        Math.round(sy),
        Math.max(1, Math.round(cellW)),
        Math.max(1, Math.round(cellH))
      );
      const id = `${page.toString(16)}_${slot.toString(16).padStart(2, '0')}`;
      const fileName = `glyph_${id}.png`;
      const resourceRef = `font/glyph_${id}`;
      const javaTexture = `assets/dazen/textures/${fileName.startsWith('glyph_') ? 'font/' : ''}${fileName}`;
      output.file(javaTexture, glyphBlob);

      output.file(
        `integrations/ItemsAdder/contents/dazen_converted/textures/font/${fileName}`,
        glyphBlob
      );
      output.file(
        `integrations/Nexo/pack/assets/dazen/textures/font/${fileName}`,
        glyphBlob
      );
      output.file(
        `integrations/Oraxen/pack/assets/dazen/textures/font/${fileName}`,
        glyphBlob
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

      previewEntries.push({
        id: `bedrock-font:${cp}`,
        name: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
        category: 'Fonts',
        sourcePath: `${pageFile.path} #${slot.toString(16).toUpperCase().padStart(2, '0')}`,
        targetPath: javaTexture,
        status: 'mapped',
        reason: 'Bedrock glyph atlas cell extracted into a Java bitmap font provider.',
        sourceBlob: glyphBlob,
        targetBlob: glyphBlob,
        editable: true,
        editSpec: { type: 'direct-image', targetPath: javaTexture },
        metadata: { char, codePoint: cp },
      });

      converted++;
      if (converted >= JAVA_GLYPH_LIMIT) break;
    }

    if (converted >= JAVA_GLYPH_LIMIT) {
      onLog('warn', `Bedrock → Java font conversion reached the safety limit of ${JAVA_GLYPH_LIMIT} non-empty glyph cells.`);
      break;
    }
  }

  if (providers.length) {
    output.file('assets/minecraft/font/default.json', JSON.stringify({ providers }, null, 2));

    output.file(
      'integrations/ItemsAdder/contents/dazen_converted/configs/dazen_fonts.yml',
      ['info:', '  namespace: dazen_converted', 'font_images:', ...iaGlyphs].join('\n') + '\n'
    );
    output.file(
      'integrations/Nexo/glyphs/dazen_converted.yml',
      nexoGlyphs.join('\n') + '\n'
    );
    output.file(
      'integrations/Oraxen/glyphs/dazen_converted.yml',
      oraxenGlyphs.join('\n') + '\n'
    );

    onLog('success', `Fonts: extracted ${providers.length} Bedrock private-use glyph cell(s) into Java bitmap font providers.`);
    onLog('info', 'Generated ItemsAdder, Nexo and Oraxen font/glyph integration folders.');
  }

  return { converted, previewEntries, pages: pages.length };
}
