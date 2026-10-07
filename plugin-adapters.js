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
    /(?:^|\/)data\/items_packs\/.*\.ya?ml$/i.test(n)
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
        stateModels: {
          pulling: asArray(pack.pulling_models).map(v => qualify(v, 'minecraft')).filter(Boolean),
          blocking: typeof pack.blocking_model === 'string' ? qualify(pack.blocking_model, 'minecraft') : null,
          cast: typeof pack.cast_model === 'string' ? qualify(pack.cast_model, 'minecraft') : null,
        },
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


function markerRoots(names, marker) {
  const suffix = '/' + marker.toLowerCase();
  const roots = new Set();

  for (const actual of names) {
    const lower = actual.toLowerCase();
    if (lower === marker.toLowerCase()) {
      roots.add('');
      continue;
    }
    if (lower.endsWith(suffix)) {
      roots.add(actual.slice(0, -marker.length));
    }
  }

  return [...roots];
}

function scoreResourcePackRoot(names, root) {
  let score = 0;
  let files = 0;
  let models = 0;
  let textures = 0;
  let overrides = 0;

  for (const actual of names) {
    if (!actual.startsWith(root)) continue;
    const normalized = actual.slice(root.length);
    if (!normalized) continue;
    files++;
    if (/^assets\/[^/]+\/models\/.+\.json$/i.test(normalized)) models++;
    if (/^assets\/[^/]+\/textures\/.+\.(png|tga)$/i.test(normalized)) textures++;
    if (/^assets\/minecraft\/models\/item\/[^/]+\.json$/i.test(normalized)) overrides++;
  }

  score += Math.min(files, 500);
  score += models * 4;
  score += textures * 2;
  score += overrides * 12;
  if (/(?:^|\/)rss\/$/i.test(root)) score += 250;

  return { score, files, models, textures, overrides };
}

function displayNameFromModel(modelRef) {
  const leaf = String(modelRef || 'item').split(':').pop().split('/').pop();
  return leaf
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function predicateState(predicate = {}) {
  const entries = Object.entries(predicate)
    .filter(([key]) => key !== 'custom_model_data');

  if (!entries.length) return 'base';
  if (predicate.blocking != null) return 'blocking';
  if (predicate.cast != null) return 'cast';
  if (predicate.pulling != null || predicate.pull != null) return 'pulling';
  return entries.map(([key]) => key).sort().join('+') || 'variant';
}

async function parseRssResourcePack(zip, rawNames, pathMap) {
  const candidateRoots = markerRoots(rawNames, 'pack.mcmeta')
    .filter(root =>
      /(?:^|\/)rss\/$/i.test(root) &&
      rawNames.some(name => name.startsWith(root + 'assets/'))
    )
    .map(root => ({ root, ...scoreResourcePackRoot(rawNames, root) }))
    .sort((a, b) => b.score - a.score);

  if (!candidateRoots.length) {
    return {
      itemHints: [],
      glyphHints: [],
      configPaths: [],
      rootPrefix: null,
      architectureScore: 0,
    };
  }

  const selected = candidateRoots[0];

  for (const actual of rawNames) {
    if (!actual.startsWith(selected.root)) continue;
    const normalized = actual.slice(selected.root.length);
    if (!normalized) continue;
    if (
      normalized === 'pack.mcmeta' ||
      normalized === 'pack.png' ||
      normalized.startsWith('assets/')
    ) {
      addMapped(pathMap, normalized, actual);
    }
  }

  const groups = new Map();

  for (const normalized of Object.keys(pathMap)) {
    const match = normalized.match(/^assets\/minecraft\/models\/item\/([^/]+)\.json$/i);
    if (!match) continue;

    const actual = pathMap[normalized];
    const text = await readText(zip, actual);
    let doc = null;
    try {
      doc = text ? JSON.parse(text) : null;
    } catch {
      doc = null;
    }
    if (!Array.isArray(doc?.overrides)) continue;

    const baseItem = normMaterial(match[1]);

    for (const override of doc.overrides) {
      const cmd = numericOrNull(override?.predicate?.custom_model_data);
      if (cmd == null || typeof override?.model !== 'string') continue;

      const key = `${baseItem}|${cmd}`;
      if (!groups.has(key)) {
        groups.set(key, {
          baseItem,
          customModelData: cmd,
          variants: [],
          primary: null,
        });
      }

      const group = groups.get(key);
      const state = predicateState(override.predicate || {});
      const variant = {
        state,
        modelRef: override.model,
        predicate: override.predicate || {},
      };
      group.variants.push(variant);

      if (state === 'base' || !group.primary) {
        group.primary = variant;
      }
    }
  }

  const itemHints = [...groups.values()].map(group => {
    const primary = group.primary || group.variants[0];
    const modelRef = primary?.modelRef || null;
    const stateModels = {
      pulling: group.variants
        .filter(v => v.state === 'pulling' && v.modelRef !== modelRef)
        .map(v => v.modelRef),
      blocking: group.variants.find(v => v.state === 'blocking')?.modelRef || null,
      cast: group.variants.find(v => v.state === 'cast')?.modelRef || null,
      variants: group.variants,
    };

    return {
      plugin: 'rss',
      id: `rss:${group.baseItem.replace(/^minecraft:/, '')}:${group.customModelData}`,
      namespace: modelRef?.includes(':') ? modelRef.split(':')[0] : 'minecraft',
      itemId: modelRef ? modelRef.split(':').pop().split('/').pop() : 'item',
      displayName: displayNameFromModel(modelRef),
      baseItem: group.baseItem,
      itemModel: null,
      mappingConfidence: 'explicit',
      customModelData: group.customModelData,
      modelRef,
      textureRefs: [],
      stateModels,
      handheld: /(?:sword|axe|pickaxe|shovel|hoe|mace|bow|crossbow|rod|staff|spear|hammer|dagger)/i
        .test(`${group.baseItem} ${modelRef || ''}`),
    };
  });

  return {
    itemHints,
    glyphHints: [],
    configPaths: [selected.root + 'pack.mcmeta'],
    rootPrefix: selected.root,
    architectureScore: selected.score,
    rootCandidates: candidateRoots,
  };
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
      usableNames.some(n => /(?:^|\/)data\/items_packs\/.*\.ya?ml$/i.test(n)) &&
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

  const hasRss =
    usableNames.some(n => /(?:^|\/)RSS\/pack\.mcmeta$/i.test(n)) &&
    usableNames.some(n => /(?:^|\/)RSS\/assets\//i.test(n));

  const adapters = [];

  if (hasRss) {
    const pathMap = makePathMap();
    const parsed = await parseRssResourcePack(zip, usableNames, pathMap);
    if (Object.keys(pathMap).length) {
      adapters.push(['rss', parsed, pathMap]);
    }
  }

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

  const usableAdapters = adapters.filter(([, parsed, map]) =>
    Object.keys(map).length > 0 ||
    (parsed.itemHints || []).length > 0 ||
    (parsed.glyphHints || []).length > 0
  );

  if (!usableAdapters.length) return null;

  // Select the architecture with the strongest directly verifiable mapping
  // data. A bundled RSS resource-pack variant wins when it exposes explicit
  // CustomModelData overrides; otherwise preserve the plugin preference order.
  const quality = ([name, parsed, map], order) => {
    const explicit = (parsed.itemHints || [])
      .filter(h => Number.isFinite(h.customModelData) || !!h.itemModel).length;
    const resources = Object.keys(map).length;
    const rssBonus = name === 'rss' ? Number(parsed.architectureScore || 0) : 0;
    return explicit * 10000 + rssBonus * 10 + resources - order;
  };

  const ranked = usableAdapters
    .map((entry, order) => ({ entry, order, score: quality(entry, order) }))
    .sort((a, b) => b.score - a.score);

  const [primaryName, primary, primaryPathMap] = ranked[0].entry;
  const itemHints = primary.itemHints || [];
  const glyphHints = primary.glyphHints || [];
  const configPaths = primary.configPaths || [];
  const names = Object.keys(primaryPathMap);
  const plugins = usableAdapters.map(([name]) => name);

  const alternatives = Object.fromEntries(
    usableAdapters.map(([name, parsed, map]) => [
      name,
      {
        resourceFiles: Object.keys(map).length,
        itemHints: (parsed.itemHints || []).length,
        glyphHints: (parsed.glyphHints || []).length,
        explicitMappings: (parsed.itemHints || [])
          .filter(h => Number.isFinite(h.customModelData) || !!h.itemModel).length,
        rootPrefix: parsed.rootPrefix || null,
      },
    ])
  );

  const mappingProfiles = Object.fromEntries(
    usableAdapters.map(([name, parsed]) => [
      name,
      (parsed.itemHints || []).map(hint => ({
        id: hint.id,
        displayName: hint.displayName,
        baseItem: hint.baseItem,
        customModelData: hint.customModelData,
        itemModel: hint.itemModel,
        modelRef: hint.modelRef,
        stateModels: hint.stateModels || null,
        mappingConfidence: hint.mappingConfidence || 'unresolved',
      })),
    ])
  );

  const warnings = [
    `Detected Java source architecture(s): ${plugins.join(', ')}.`,
    `Automatically selected ${primaryName} as the primary conversion tree because it has the strongest verifiable mapping/resource data.`,
  ];

  if (usableAdapters.length > 1) {
    warnings.push(
      'Multiple install variants were found in one vendor ZIP. The converter now auto-selects one normalized resource tree and excludes duplicate alternative copies from generic conversion.'
    );
  }

  if (hasRss && primaryName === 'rss') {
    warnings.push(
      'RSS/vanilla CustomModelData overrides were detected and are being used as explicit item mapping data instead of guessing plugin-generated IDs.'
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
      usableAdapters.length === 1
        ? primaryName
        : 'multi-architecture-bundle',
    primaryPlugin: primaryName,
    plugins,
    pathMap: primaryPathMap,
    names,
    itemHints,
    glyphHints,
    configPaths,
    alternatives,
    mappingProfiles,
    warnings,
  };
}

export function actualPathFor(inspection, normalizedPath) {
  return inspection?.pathMap?.[normalizedPath] || (inspection?.rootPrefix || '') + normalizedPath;
}
