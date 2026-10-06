function safeYaml(text) {
  try {
    return globalThis.jsyaml?.load(text) || null;
  } catch {
    return null;
  }
}

function normMaterial(value) {
  if (!value || typeof value !== 'string') return 'minecraft:paper';
  const clean = value.toLowerCase().replace(/^minecraft:/, '');
  return `minecraft:${clean}`;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function numericOrNull(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function makePathMap() {
  return Object.create(null);
}

function addMapped(pathMap, normalized, actual) {
  if (!normalized || !actual || pathMap[normalized]) return;
  pathMap[normalized.replace(/^\/+/, '')] = actual;
}

async function readText(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  try {
    return await file.async('string');
  } catch {
    return null;
  }
}

function inferItemsAdderModel(namespace, itemId, item) {
  if (typeof item?.item_model === 'string') {
    return { itemModel: qualify(item.item_model, namespace), confidence: 'explicit' };
  }
  const graphics = item?.graphics;
  if (graphics && typeof graphics === 'object') {
    // Modern ItemsAdder 1.21.4+ creates a dedicated ItemModel for the item.
    return { itemModel: `${namespace}:${itemId}`, confidence: 'inferred-modern' };
  }
  return { itemModel: null, confidence: null };
}

function qualify(value, namespace) {
  if (!value || typeof value !== 'string') return null;
  return value.includes(':') ? value : `${namespace}:${value.replace(/^\/+/, '')}`;
}

function iaTextureCandidates(namespace, item) {
  const out = [];
  for (const raw of asArray(item?.graphics?.texture)) out.push(qualifyTexture(raw, namespace));
  for (const raw of asArray(item?.graphics?.textures)) {
    if (typeof raw === 'string') out.push(qualifyTexture(raw, namespace));
    else if (raw && typeof raw === 'object') {
      for (const value of Object.values(raw)) out.push(qualifyTexture(value, namespace));
    }
  }
  for (const raw of asArray(item?.resource?.textures)) out.push(qualifyTexture(raw, namespace));
  if (item?.graphics?.icon) out.unshift(qualifyTexture(item.graphics.icon, namespace));
  return out.filter(Boolean);
}

function qualifyTexture(value, namespace) {
  if (!value || typeof value !== 'string') return null;
  let v = value.replace(/\.png$/i, '').replace(/^textures\//, '');
  return v.includes(':') ? v : `${namespace}:${v}`;
}

function configDisplayName(itemId, item) {
  const raw = item?.name || item?.display_name || item?.displayname || item?.itemname || itemId;
  return String(raw).replace(/<[^>]+>/g, '').replace(/&[0-9a-fk-or]/gi, '').trim() || itemId;
}

async function parseItemsAdder(zip, rawNames, pathMap) {
  const hints = [];
  const glyphs = [];
  const namespaces = new Set();
  const configs = rawNames.filter(n =>
    /(?:^|\/)contents\/[^/]+\/configs\/.*\.ya?ml$/i.test(n) ||
    /(?:^|\/)configs\/.*\.ya?ml$/i.test(n) ||
    /(?:^|\/)data\/items_packs\/[^/]+\/.*\.ya?ml$/i.test(n)
  );

  for (const path of configs) {
    const text = await readText(zip, path);
    const doc = text ? safeYaml(text) : null;
    if (!doc || typeof doc !== 'object') continue;

    const namespace = String(doc?.info?.namespace || '').trim();
    if (!namespace) continue;
    namespaces.add(namespace);

    if (doc.items && typeof doc.items === 'object') {
      for (const [itemId, item] of Object.entries(doc.items)) {
        if (!item || typeof item !== 'object' || item.template === true) continue;
        const modern = inferItemsAdderModel(namespace, itemId, item);
        const legacyCmd = numericOrNull(item?.resource?.model_id);
        const modelPath = item?.graphics?.model || item?.resource?.model_path || null;
        hints.push({
          plugin: 'itemsadder',
          id: `${namespace}:${itemId}`,
          namespace,
          itemId,
          displayName: configDisplayName(itemId, item),
          baseItem: normMaterial(item?.material || item?.resource?.material),
          itemModel: modern.itemModel,
          mappingConfidence: modern.confidence || (legacyCmd != null ? 'explicit' : 'unresolved'),
          customModelData: legacyCmd,
          modelRef: modelPath ? qualify(modelPath, namespace) : null,
          textureRefs: iaTextureCandidates(namespace, item),
          handheld: /(?:sword|axe|pickaxe|shovel|hoe|mace|bow|crossbow|rod|staff|spear|hammer|dagger)/i.test(itemId),
        });
      }
    }

    if (doc.font_images && typeof doc.font_images === 'object') {
      for (const [glyphId, glyph] of Object.entries(doc.font_images)) {
        if (!glyph || typeof glyph !== 'object' || !glyph.path) continue;
        const symbol = typeof glyph.symbol === 'string' ? glyph.symbol :
          typeof glyph.char === 'string' ? glyph.char : null;
        glyphs.push({
          plugin: 'itemsadder',
          id: `${namespace}:${glyphId}`,
          namespace,
          glyphId,
          textureRef: qualifyTexture(glyph.path, namespace),
          char: symbol,
          height: Number(glyph.scale_ratio || 8),
          ascent: Number(glyph.y_position || glyph.scale_ratio || 8),
          resolvable: !!symbol,
        });
      }
    }
  }

  // ItemsAdder source bundle resources. Modern vendor packs generally use
  // contents/<namespace>/resourcepack/assets/... while font-image-only packs
  // often place PNGs directly in contents/<namespace>/textures/.
  for (const actual of rawNames) {
    const marker = actual.toLowerCase().indexOf('/resourcepack/assets/');
    if (marker >= 0 && /(?:^|\/)contents\//i.test(actual)) {
      const normalized = actual.slice(marker + '/resourcepack/'.length);
      addMapped(pathMap, normalized, actual);
      continue;
    }

    const legacyData = actual.match(
      /(?:^|\/)data\/resource_pack\/(assets\/.+)$/i
    );
    if (legacyData) {
      addMapped(pathMap, legacyData[1], actual);
      continue;
    }

    const directContent = actual.match(/(?:^|\/)contents\/([^/]+)\/(textures|models|font)\/(.+)$/i);
    if (directContent) {
      const [, ns, kind, rel] = directContent;
      addMapped(pathMap, `assets/${ns}/${kind.toLowerCase()}/${rel}`, actual);
      continue;
    }

    if (/^assets\//i.test(actual)) {
      addMapped(pathMap, actual, actual);
      continue;
    }

    const rootResource = actual.match(/^(textures|models|font)\/(.+)$/i);
    if (rootResource && namespaces.size === 1) {
      const ns = [...namespaces][0];
      addMapped(pathMap, `assets/${ns}/${rootResource[1].toLowerCase()}/${rootResource[2]}`, actual);
    }
  }

  // Last-resort filename matching for simple ItemsAdder vendor bundles.
  for (const actual of rawNames) {
    if (!actual.toLowerCase().endsWith('.png')) continue;
    for (const hint of [...hints, ...glyphs]) {
      const refs = hint.textureRef ? [hint.textureRef] : (hint.textureRefs || []);
      for (const ref of refs) {
        if (!ref) continue;
        const [ns, rel] = ref.split(':');
        const leaf = rel?.split('/').pop();
        if (leaf && actual.toLowerCase().endsWith('/' + leaf.toLowerCase() + '.png')) {
          addMapped(pathMap, `assets/${ns}/textures/${rel}.png`, actual);
        }
      }
    }
  }

  return { itemHints: hints, glyphHints: glyphs, configPaths: configs };
}

async function parseNexo(zip, rawNames, pathMap) {
  const hints = [];
  const glyphs = [];
  const configs = rawNames.filter(n => /(?:^|\/)Nexo\/items\/.*\.ya?ml$/i.test(n) || /^items\/.*\.ya?ml$/i.test(n));

  for (const path of configs) {
    const text = await readText(zip, path);
    const doc = text ? safeYaml(text) : null;
    if (!doc || typeof doc !== 'object') continue;
    for (const [itemId, item] of Object.entries(doc)) {
      if (!item || typeof item !== 'object') continue;
      const pack = item.Pack || item.pack || {};
      const components = item.Components || item.components || {};
      const itemModel = typeof components.item_model === 'string'
        ? qualify(components.item_model, 'nexo')
        : null;
      const modelRef = typeof pack.model === 'string' ? qualify(pack.model, 'minecraft') : null;
      hints.push({
        plugin: 'nexo',
        id: `nexo:${itemId}`,
        namespace: 'nexo',
        itemId,
        displayName: configDisplayName(itemId, item),
        baseItem: normMaterial(item.material),
        itemModel,
        mappingConfidence: itemModel ? 'explicit' : numericOrNull(pack.custom_model_data) != null ? 'explicit' : 'unresolved',
        customModelData: numericOrNull(pack.custom_model_data),
        modelRef,
        textureRefs: asArray(pack.textures).map(v => qualifyTexture(v, 'minecraft')).filter(Boolean),
        handheld: /(?:sword|axe|pickaxe|shovel|hoe|mace|bow|crossbow|rod|staff|spear|hammer|dagger)/i.test(itemId),
      });
    }
  }

  const glyphConfigs = rawNames.filter(n => /(?:^|\/)Nexo\/glyphs\/.*\.ya?ml$/i.test(n) || /^glyphs\/.*\.ya?ml$/i.test(n));
  for (const path of glyphConfigs) {
    const text = await readText(zip, path);
    const doc = text ? safeYaml(text) : null;
    if (!doc || typeof doc !== 'object') continue;
    for (const [glyphId, glyph] of Object.entries(doc)) {
      if (!glyph || typeof glyph !== 'object') continue;
      const texture = glyph.texture || glyph.path;
      if (!texture) continue;
      const chars = glyph.char || glyph.chars;
      const char = typeof chars === 'string' ? chars : Array.isArray(chars) ? chars[0] : null;
      glyphs.push({
        plugin: 'nexo',
        id: `nexo:${glyphId}`,
        namespace: 'nexo',
        glyphId,
        textureRef: qualifyTexture(texture, 'nexo'),
        char,
        height: Number(glyph.height || 8),
        ascent: Number(glyph.ascent || glyph.height || 8),
        resolvable: !!char,
      });
    }
  }

  for (const actual of rawNames) {
    const m = actual.match(/(?:^|\/)Nexo\/pack\/(assets\/.+)$/i);
    if (m) addMapped(pathMap, m[1], actual);
    else if (/^assets\//i.test(actual)) addMapped(pathMap, actual, actual);
  }

  return { itemHints: hints, glyphHints: glyphs, configPaths: [...configs, ...glyphConfigs] };
}

async function parseOraxen(zip, rawNames, pathMap) {
  const hints = [];
  const glyphs = [];
  const configs = rawNames.filter(n => /(?:^|\/)Oraxen\/items\/.*\.ya?ml$/i.test(n) || /^items\/.*\.ya?ml$/i.test(n));

  for (const path of configs) {
    const text = await readText(zip, path);
    const doc = text ? safeYaml(text) : null;
    if (!doc || typeof doc !== 'object') continue;
    for (const [itemId, item] of Object.entries(doc)) {
      if (!item || typeof item !== 'object') continue;
      const pack = item.Pack || item.pack || {};
      const components = item.Components || item.components || {};
      const itemModel = typeof components.item_model === 'string'
        ? qualify(components.item_model, 'oraxen')
        : null;
      hints.push({
        plugin: 'oraxen',
        id: `oraxen:${itemId}`,
        namespace: 'oraxen',
        itemId,
        displayName: configDisplayName(itemId, item),
        baseItem: normMaterial(item.material),
        itemModel,
        mappingConfidence: itemModel ? 'explicit' : numericOrNull(pack.custom_model_data) != null ? 'explicit' : 'unresolved',
        customModelData: numericOrNull(pack.custom_model_data),
        modelRef: typeof pack.model === 'string' ? qualify(pack.model, 'minecraft') : null,
        textureRefs: asArray(pack.textures).map(v => qualifyTexture(v, 'minecraft')).filter(Boolean),
        handheld: /(?:sword|axe|pickaxe|shovel|hoe|mace|bow|crossbow|rod|staff|spear|hammer|dagger)/i.test(itemId),
      });
    }
  }

  const glyphConfigs = rawNames.filter(n => /(?:^|\/)Oraxen\/glyphs\/.*\.ya?ml$/i.test(n) || /^glyphs\/.*\.ya?ml$/i.test(n));
  for (const path of glyphConfigs) {
    const text = await readText(zip, path);
    const doc = text ? safeYaml(text) : null;
    if (!doc || typeof doc !== 'object') continue;
    for (const [glyphId, glyph] of Object.entries(doc)) {
      if (!glyph || typeof glyph !== 'object' || !glyph.texture) continue;
      const chars = glyph.char || glyph.chars;
      const char = typeof chars === 'string' ? chars : Array.isArray(chars) ? chars[0] : null;
      glyphs.push({
        plugin: 'oraxen',
        id: `oraxen:${glyphId}`,
        namespace: 'minecraft',
        glyphId,
        textureRef: qualifyTexture(glyph.texture, 'minecraft'),
        char,
        height: Number(glyph.height || 8),
        ascent: Number(glyph.ascent || glyph.height || 8),
        resolvable: !!char,
      });
    }
  }

  for (const actual of rawNames) {
    const direct = actual.match(/(?:^|\/)Oraxen\/pack\/(models|textures|font)\/(.+)$/i);
    if (direct) {
      addMapped(pathMap, `assets/minecraft/${direct[1].toLowerCase()}/${direct[2]}`, actual);
      continue;
    }
    const full = actual.match(/(?:^|\/)Oraxen\/pack\/(assets\/.+)$/i);
    if (full) addMapped(pathMap, full[1], actual);
    else if (/^assets\//i.test(actual)) addMapped(pathMap, actual, actual);
  }

  return { itemHints: hints, glyphHints: glyphs, configPaths: [...configs, ...glyphConfigs] };
}

export async function detectJavaPluginBundle(zip, rawNames) {
  const usableNames = rawNames.filter(name =>
    !name.startsWith('__MACOSX/') &&
    !name.split('/').some(part => part.startsWith('._')) &&
    !name.endsWith('/.DS_Store') &&
    !name.endsWith('.DS_Store')
  );

  const hasIA =
    usableNames.some(n => /(?:^|\/)ItemsAdder\/(?:contents|data)\//i.test(n)) ||
    usableNames.some(n => /(?:^|\/)contents\/[^/]+\/(?:configs|resourcepack|textures)\//i.test(n)) ||
    (
      usableNames.some(n => /(?:^|\/)data\/items_packs\/[^/]+\/.*\.ya?ml$/i.test(n)) &&
      usableNames.some(n => /(?:^|\/)data\/resource_pack\/assets\//i.test(n))
    ) ||
    (
      usableNames.some(n => /^configs\/.*\.ya?ml$/i.test(n)) &&
      usableNames.some(n => /^textures\/.*\.png$/i.test(n))
    );

  const hasNexo =
    usableNames.some(n => /(?:^|\/)Nexo\/(?:items|pack|glyphs)\//i.test(n));

  const hasOraxen =
    usableNames.some(n => /(?:^|\/)Oraxen\/(?:items|pack|glyphs)\//i.test(n));

  // Parse each plugin alternative into its OWN virtual Java resource tree.
  // A vendor ZIP commonly contains the same pack three times (ItemsAdder,
  // Nexo and Oraxen). Sharing one path map caused duplicate alternatives to
  // leak into conversion as ordinary PNGs and show "No target mapping".
  const adapters = [];

  if (hasIA) {
    const pathMap = makePathMap();
    adapters.push([
      'itemsadder',
      await parseItemsAdder(zip, usableNames, pathMap),
      pathMap,
    ]);
  }

  if (hasNexo) {
    const pathMap = makePathMap();
    adapters.push([
      'nexo',
      await parseNexo(zip, usableNames, pathMap),
      pathMap,
    ]);
  }

  if (hasOraxen) {
    const pathMap = makePathMap();
    adapters.push([
      'oraxen',
      await parseOraxen(zip, usableNames, pathMap),
      pathMap,
    ]);
  }

  if (!adapters.length) return null;

  // Vendor archives ship these as alternative install variants for the SAME
  // content. Prefer ItemsAdder, then Nexo, then Oraxen, and convert only that
  // primary virtual tree. Reverse output can still generate helper folders
  // for every supported plugin.
  const [primaryName, primary, primaryPathMap] = adapters[0];
  const itemHints = primary.itemHints || [];
  const glyphHints = primary.glyphHints || [];
  const configPaths = primary.configPaths || [];
  const names = Object.keys(primaryPathMap);
  const plugins = adapters.map(([name]) => name);

  const alternativeCounts = Object.fromEntries(
    adapters.map(([name, , map]) => [
      name,
      Object.keys(map).length,
    ])
  );

  const warnings = [
    `Detected Java plugin source bundle: ${plugins.join(', ')}.`,
    `Using ${primaryName} as the primary source variant for conversion.`,
  ];

  if (adapters.length > 1) {
    warnings.push(
      'Multiple plugin alternatives were found in one vendor ZIP. Duplicate ItemsAdder/Nexo/Oraxen resource copies are now excluded from the conversion tree instead of being reported as unmapped files.'
    );
  }

  const unresolvedGlyphs = glyphHints.filter(g => !g.resolvable).length;
  if (unresolvedGlyphs) {
    warnings.push(
      `${unresolvedGlyphs} font-image/glyph entries do not expose an explicit character. The font converter will assign deterministic free private-use characters and generate matching Java/plugin config patches.`
    );
  }

  return {
    type:
      adapters.length === 1
        ? primaryName
        : 'multi-plugin-bundle',
    primaryPlugin: primaryName,
    plugins,
    pathMap: primaryPathMap,
    names,
    itemHints,
    glyphHints,
    configPaths,
    alternativeCounts,
    warnings,
  };
}

export function actualPathFor(inspection, normalizedPath) {
  return inspection?.pathMap?.[normalizedPath] || (inspection?.rootPrefix || '') + normalizedPath;
}
