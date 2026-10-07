import { actualPathFor } from './plugin-adapters.js';

function splitId(value, defaultNamespace = 'minecraft') {
  if (!value || typeof value !== 'string') return [defaultNamespace, ''];
  const idx = value.indexOf(':');
  return idx >= 0 ? [value.slice(0, idx), value.slice(idx + 1)] : [defaultNamespace, value];
}

function safeId(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, '_')
    .replace(/[/.]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90) || 'item';
}

function titleCase(value) {
  return String(value || '')
    .replace(/[/:_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

async function readJson(inspection, normalizedPath) {
  const file = inspection.zip.file(actualPathFor(inspection, normalizedPath));
  if (!file) return null;
  try {
    return JSON.parse(await file.async('string'));
  } catch {
    return null;
  }
}

function hasNormalized(inspection, normalizedPath) {
  if (inspection.pathMap) return !!inspection.pathMap[normalizedPath];
  return !!inspection.zip.file((inspection.rootPrefix || '') + normalizedPath);
}

function sourceFile(inspection, normalizedPath) {
  return inspection.zip.file(actualPathFor(inspection, normalizedPath));
}

function modelPathFromRef(ref, defaultNamespace = 'minecraft') {
  const [ns, path] = splitId(ref, defaultNamespace);
  return `assets/${ns}/models/${path.replace(/^models\//, '')}.json`;
}

function texturePathFromRef(ref, defaultNamespace = 'minecraft') {
  const [ns, path] = splitId(ref, defaultNamespace);
  return `assets/${ns}/textures/${path.replace(/^textures\//, '').replace(/\.png$/i, '')}.png`;
}

function itemDefinitionIdFromPath(path) {
  const m = path.match(/^assets\/([^/]+)\/items\/(.+)\.json$/i);
  return m ? { namespace: m[1], path: m[2], id: `${m[1]}:${m[2]}` } : null;
}

function isLikelyHandheld(baseItem, model) {
  const haystack = `${baseItem || ''} ${model?.parent || ''}`.toLowerCase();
  return /(sword|axe|pickaxe|shovel|hoe|mace|bow|crossbow|fishing_rod|handheld|spear|staff|hammer|dagger)/.test(haystack);
}

function normalizedModelType(value) {
  return String(value || '').replace(/^minecraft:/, '');
}

function normalizedModelProperty(value) {
  return String(value || '').replace(/^minecraft:/, '');
}

function flattenModelLeaves(node, context = {}, out = []) {
  if (!node || typeof node !== 'object') return out;

  const type = normalizedModelType(node.type);
  const currentPriority = Number(context.priority || 0);

  if (type === 'model' && typeof node.model === 'string') {
    out.push({
      modelRef: node.model,
      context: { ...context, priority: currentPriority },
    });
    return out;
  }

  if (type === 'range_dispatch') {
    const property = normalizedModelProperty(node.property);
    for (const entry of node.entries || []) {
      const next = { ...context, priority: currentPriority };
      if (property === 'custom_model_data') {
        next.customModelData = Number(entry.threshold);
      } else {
        next.predicate = {
          type: 'range_dispatch',
          property,
          threshold: entry.threshold,
        };
      }
      flattenModelLeaves(entry.model, next, out);
    }

    if (node.fallback) {
      flattenModelLeaves(
        node.fallback,
        {
          ...context,
          fallback: true,
          priority: currentPriority + 2,
        },
        out
      );
    }
    return out;
  }

  if (type === 'condition') {
    const property = normalizedModelProperty(node.property);
    if (node.on_true) {
      flattenModelLeaves(
        node.on_true,
        {
          ...context,
          predicate: { type: 'condition', property, expected: true },
          priority: currentPriority,
        },
        out
      );
    }
    if (node.on_false) {
      // The false branch is normally the stable inventory/not-in-use state
      // for bows, crossbows, shields, fishing rods, etc. Prefer it for the
      // Bedrock icon when several Java runtime states share one CMD.
      flattenModelLeaves(
        node.on_false,
        {
          ...context,
          predicate: { type: 'condition', property, expected: false },
          priority: currentPriority + 4,
        },
        out
      );
    }
    return out;
  }

  if (type === 'select') {
    const property = normalizedModelProperty(node.property);
    for (const itemCase of node.cases || []) {
      flattenModelLeaves(
        itemCase.model,
        {
          ...context,
          predicate: { type: 'select', property, when: itemCase.when },
          priority: currentPriority,
        },
        out
      );
    }
    if (node.fallback) {
      flattenModelLeaves(
        node.fallback,
        {
          ...context,
          fallback: true,
          priority: currentPriority + 3,
        },
        out
      );
    }
  }

  return out;
}

function preferredLeaves(leaves) {
  const groups = new Map();

  for (const leaf of leaves) {
    const key = Number.isFinite(leaf.context?.customModelData)
      ? `cmd:${leaf.context.customModelData}`
      : 'default';
    const current = groups.get(key);
    if (
      !current ||
      Number(leaf.context?.priority || 0) > Number(current.context?.priority || 0)
    ) {
      groups.set(key, leaf);
    }
  }

  return [...groups.values()];
}

async function resolveModelIcon(inspection, modelRef, defaultNamespace = 'minecraft') {
  if (!modelRef) return null;
  const modelPath = modelPathFromRef(modelRef, defaultNamespace);
  const model = await readJson(inspection, modelPath);
  if (!model) return null;

  const textures = model.textures && typeof model.textures === 'object' ? model.textures : {};
  const candidates = [];
  for (const key of ['layer0', '0', 'particle', '1', 'texture']) {
    const value = textures[key];
    if (typeof value === 'string' && !value.startsWith('#')) candidates.push(value);
  }
  for (const value of Object.values(textures)) {
    if (typeof value === 'string' && !value.startsWith('#') && !candidates.includes(value)) candidates.push(value);
  }

  const modelNs = splitId(modelRef, defaultNamespace)[0];
  for (const textureRef of candidates) {
    const path = texturePathFromRef(textureRef, modelNs);
    if (hasNormalized(inspection, path)) {
      return {
        model,
        modelPath,
        textureRef,
        texturePath: path,
        is3d: Array.isArray(model.elements) && model.elements.length > 0,
        handheld: isLikelyHandheld('', model),
      };
    }
  }

  return {
    model,
    modelPath,
    textureRef: null,
    texturePath: null,
    is3d: Array.isArray(model.elements) && model.elements.length > 0,
    handheld: isLikelyHandheld('', model),
  };
}

async function resolveHintIcon(inspection, hint) {
  if (hint.modelRef) {
    const modelNs = hint.plugin === 'itemsadder' ? hint.namespace : 'minecraft';
    const resolved = await resolveModelIcon(inspection, hint.modelRef, modelNs);
    if (resolved?.texturePath) return resolved;
  }

  for (const ref of hint.textureRefs || []) {
    const path = texturePathFromRef(ref, hint.namespace || 'minecraft');
    if (hasNormalized(inspection, path)) {
      return {
        model: null,
        modelPath: null,
        textureRef: ref,
        texturePath: path,
        is3d: false,
        handheld: !!hint.handheld,
      };
    }
  }
  return null;
}

function makeBedrockIdentifier(seed, used) {
  const base = `dazen:${safeId(seed)}`;
  let value = base;
  let i = 2;
  while (used.has(value)) value = `${base}_${i++}`;
  used.add(value);
  return value;
}

function pushMapping(mappings, baseItem, definition) {
  if (!mappings.items[baseItem]) mappings.items[baseItem] = [];
  mappings.items[baseItem].push(definition);
}

function legacyPredicateState(predicate = {}) {
  const keys = Object.keys(predicate).filter(key => key !== 'custom_model_data');
  if (!keys.length) return 'base';
  if (predicate.blocking != null) return 'blocking';
  if (predicate.cast != null) return 'cast';
  if (predicate.pulling != null || predicate.pull != null) return 'pulling';
  return keys.sort().join('+') || 'variant';
}

async function scanGeneratedJavaItems(inspection) {
  const records = [];
  const names = inspection.names || [];
  const hints = inspection.adapter?.itemHints || [];
  const hintByItemModel = new Map();
  for (const hint of hints) {
    if (hint.itemModel) hintByItemModel.set(hint.itemModel, hint);
  }

  for (const path of names.filter(n => /^assets\/[^/]+\/items\/.+\.json$/i.test(n))) {
    const info = itemDefinitionIdFromPath(path);
    const doc = await readJson(inspection, path);
    if (!info || !doc?.model) continue;

    const hint = hintByItemModel.get(info.id) || null;
    const leaves = preferredLeaves(flattenModelLeaves(doc.model));

    for (const leaf of leaves) {
      if (leaf.context?.fallback) continue;

      if (Number.isFinite(leaf.context?.customModelData)) {
        const baseItem = info.namespace === 'minecraft'
          ? `minecraft:${info.path}`
          : hint?.baseItem || null;
        records.push({
          source: 'item-definition',
          mappingType: 'legacy',
          baseItem,
          customModelData: leaf.context.customModelData,
          itemModel: info.id,
          modelRef: leaf.modelRef,
          defaultModelNamespace: info.namespace,
          displayName: titleCase(leaf.modelRef),
          hint,
          predicate: leaf.context?.predicate || null,
        });
      } else {
        const baseItem = hint?.baseItem || (info.namespace === 'minecraft' ? `minecraft:${info.path}` : null);
        records.push({
          source: 'item-definition',
          mappingType: 'definition',
          baseItem,
          customModelData: null,
          itemModel: info.id,
          modelRef: leaf.modelRef,
          defaultModelNamespace: info.namespace,
          displayName: hint?.displayName || titleCase(info.path),
          hint,
          predicate: leaf.context?.predicate || null,
        });
      }
    }
  }

  // Pre-1.21.4 legacy overrides. Group state predicates such as bow
  // pulling, shield blocking and fishing-rod cast under one base CMD item.
  // They are visual states of the same custom item, not separate mappings.
  const legacyGroups = new Map();

  for (const path of names.filter(n => /^assets\/minecraft\/models\/item\/[^/]+\.json$/i.test(n))) {
    const doc = await readJson(inspection, path);
    if (!Array.isArray(doc?.overrides)) continue;

    const base = path.split('/').pop().replace(/\.json$/i, '');
    const baseItem = `minecraft:${base}`;

    for (const override of doc.overrides) {
      const cmd = Number(override?.predicate?.custom_model_data);
      if (!Number.isFinite(cmd) || typeof override?.model !== 'string') continue;

      const key = `${baseItem}|${cmd}`;
      if (!legacyGroups.has(key)) {
        legacyGroups.set(key, {
          baseItem,
          customModelData: cmd,
          primary: null,
          variants: [],
        });
      }

      const group = legacyGroups.get(key);
      const state = legacyPredicateState(override.predicate || {});
      const variant = {
        state,
        modelRef: override.model,
        predicate: override.predicate || {},
      };

      group.variants.push(variant);
      if (state === 'base' || !group.primary) group.primary = variant;
    }
  }

  for (const group of legacyGroups.values()) {
    const primary = group.primary || group.variants[0];
    if (!primary?.modelRef) continue;

    records.push({
      source: 'legacy-model-overrides',
      mappingType: 'legacy',
      baseItem: group.baseItem,
      customModelData: group.customModelData,
      itemModel: null,
      modelRef: primary.modelRef,
      defaultModelNamespace: 'minecraft',
      displayName: titleCase(primary.modelRef),
      hint: null,
      predicate: null,
      stateModels: {
        pulling: group.variants
          .filter(v => v.state === 'pulling' && v.modelRef !== primary.modelRef)
          .map(v => v.modelRef),
        blocking: group.variants.find(v => v.state === 'blocking')?.modelRef || null,
        cast: group.variants.find(v => v.state === 'cast')?.modelRef || null,
        variants: group.variants,
      },
    });
  }

  return records;
}

function mergePluginHints(records, inspection) {
  const hints = inspection.adapter?.itemHints || [];
  const signatures = new Set(records.map(r => [
    r.mappingType,
    r.baseItem,
    r.customModelData,
    r.itemModel,
    r.modelRef,
  ].join('|')));

  for (const hint of hints) {
    let mappingType = null;
    if (Number.isFinite(hint.customModelData)) mappingType = 'legacy';
    else if (hint.itemModel) mappingType = 'definition';

    if (!mappingType) {
      records.push({
        source: `${hint.plugin}-config`,
        mappingType: 'unresolved',
        baseItem: hint.baseItem,
        customModelData: null,
        itemModel: null,
        modelRef: hint.modelRef,
        defaultModelNamespace: hint.plugin === 'itemsadder' ? hint.namespace : 'minecraft',
        displayName: hint.displayName,
        hint,
        predicate: null,
        stateModels: hint.stateModels || null,
        unresolvedReason: 'Plugin config does not expose a fixed CustomModelData or item_model identifier.',
      });
      continue;
    }

    const record = {
      source: `${hint.plugin}-config`,
      mappingType,
      baseItem: hint.baseItem,
      customModelData: hint.customModelData,
      itemModel: hint.itemModel,
      modelRef: hint.modelRef,
      defaultModelNamespace: hint.plugin === 'itemsadder' ? hint.namespace : 'minecraft',
      displayName: hint.displayName,
      hint,
      predicate: null,
      stateModels: hint.stateModels || null,
    };
    const sig = [record.mappingType, record.baseItem, record.customModelData, record.itemModel, record.modelRef].join('|');
    if (!signatures.has(sig)) {
      signatures.add(sig);
      records.push(record);
    }
  }
  return records;
}

export async function convertJavaCustomItems({ inspection, output, onLog = () => {} }) {
  const records = mergePluginHints(await scanGeneratedJavaItems(inspection), inspection);

  if (inspection.adapter) {
    output.file(
      'dazen/detected_source_architectures.json',
      JSON.stringify({
        type: inspection.adapter.type,
        primary: inspection.adapter.primaryPlugin,
        detected: inspection.adapter.plugins || [],
        alternatives: inspection.adapter.alternatives || {},
        mapping_profiles: inspection.adapter.mappingProfiles || {},
      }, null, 2)
    );
  }
  const mappings = { format_version: 2, items: {} };
  const itemTexture = {
    resource_pack_name: 'Dazen Converted Resource Pack',
    texture_name: 'atlas.items',
    texture_data: {},
  };
  const previewEntries = [];
  const unresolved = [];
  const usedIdentifiers = new Set();
  const copiedTextures = new Map();
  let converted = 0;
  let threeDFallbacks = 0;

  for (const record of records) {
    let icon = null;
    if (record.hint) icon = await resolveHintIcon(inspection, record.hint);
    if (!icon && record.modelRef) {
      icon = await resolveModelIcon(inspection, record.modelRef, record.defaultModelNamespace);
    }

    if (!icon?.texturePath) {
      unresolved.push({ ...record, reason: record.unresolvedReason || 'Could not resolve an icon texture from the Java model.' });
      continue;
    }

    const source = sourceFile(inspection, icon.texturePath);
    if (!source) {
      unresolved.push({ ...record, reason: 'Resolved texture path is missing from the archive.' });
      continue;
    }

    const sourceBytes = await source.async('uint8array');
    const sourceBlob = new Blob([sourceBytes], { type: 'image/png' });
    const seed = record.hint?.id || record.itemModel || record.modelRef || icon.texturePath;
    const bedrockIdentifier = makeBedrockIdentifier(seed, usedIdentifiers);
    const slug = bedrockIdentifier.split(':')[1];
    const bedrockTexturePath = `textures/items/dazen/${slug}.png`;

    if (!copiedTextures.has(icon.texturePath)) {
      output.file(bedrockTexturePath, sourceBytes, { binary: true });
      copiedTextures.set(icon.texturePath, bedrockTexturePath);
    } else {
      // Keep a stable per-item key, but let multiple mappings share the same Bedrock texture file.
    }

    const actualBedrockTexture = copiedTextures.get(icon.texturePath);
    itemTexture.texture_data[bedrockIdentifier] = { textures: [actualBedrockTexture.replace(/\.png$/i, '')] };

    const options = {
      icon: bedrockIdentifier,
      display_handheld: !!(record.hint?.handheld || icon.handheld || isLikelyHandheld(record.baseItem, icon.model)),
    };

    let mapped = false;
    if (record.mappingType === 'legacy' && record.baseItem && Number.isFinite(record.customModelData)) {
      pushMapping(mappings, record.baseItem, {
        type: 'legacy',
        custom_model_data: record.customModelData,
        bedrock_identifier: bedrockIdentifier,
        display_name: record.displayName,
        bedrock_options: options,
      });
      mapped = true;
    } else if (
      record.mappingType === 'definition' &&
      record.baseItem &&
      record.itemModel &&
      !record.itemModel.startsWith('minecraft:')
    ) {
      const def = {
        type: 'definition',
        model: record.itemModel,
        bedrock_identifier: bedrockIdentifier,
        display_name: record.displayName,
        bedrock_options: options,
      };
      if (record.predicate) def.predicate = record.predicate;
      pushMapping(mappings, record.baseItem, def);
      mapped = true;
    } else {
      unresolved.push({
        ...record,
        bedrockIdentifier,
        texturePath: actualBedrockTexture,
        reason: record.unresolvedReason ||
          (record.itemModel?.startsWith('minecraft:')
            ? 'A minecraft: item_model requires a Geyser predicate; no safe predicate was inferred.'
            : 'Java base item or mapping key could not be inferred safely.'),
      });
    }

    if (icon.is3d) threeDFallbacks++;
    converted++;

    previewEntries.push({
      id: `custom-item:${bedrockIdentifier}`,
      name: record.displayName || titleCase(slug),
      category: 'Items',
      sourcePath: icon.texturePath,
      targetPath: actualBedrockTexture,
      status: mapped ? 'mapped' : 'unresolved',
      reason: mapped
        ? (icon.is3d ? '3D Java model mapped with a 2D Bedrock icon fallback.' : 'Geyser custom item mapping generated.')
        : 'Texture converted, but server-side Geyser mapping needs review.',
      sourceBlob,
      targetBlob: sourceBlob,
      editable: true,
      editSpec: { type: 'direct-image', targetPath: actualBedrockTexture },
      metadata: {
        mappingType: record.mappingType,
        baseItem: record.baseItem,
        customModelData: record.customModelData,
        itemModel: record.itemModel,
        bedrockIdentifier,
        modelRef: record.modelRef,
        is3d: !!icon.is3d,
        plugin: record.hint?.plugin || null,
        stateModels: record.stateModels || record.hint?.stateModels || null,
      },
    });
  }

  if (Object.keys(itemTexture.texture_data).length) {
    output.file('textures/item_texture.json', JSON.stringify(itemTexture, null, 2));
  }

  const mappingCount = Object.values(mappings.items)
    .reduce((total, definitions) => total + definitions.length, 0);
  const mappingText = JSON.stringify(mappings, null, 2);

  if (mappingCount) {
    output.file('dazen/geyser_custom_mappings.json', mappingText);
    output.file('dazen/GEYSER_SETUP.txt', [
      'Dazen Texture Pack Converter - Geyser custom items',
      '',
      '1. Put the generated .mcpack/.zip resource pack in Geyser\'s packs folder.',
      '2. Put geyser_custom_mappings.json in Geyser\'s custom_mappings folder.',
      '3. Ensure Geyser custom content is enabled.',
      '4. Restart Geyser/server and test every custom item.',
      '',
      'Items that are listed in unresolved_custom_items.json need manual review or explicit server-side IDs.',
      '3D Java models may currently use their resolved icon texture as the Bedrock inventory/held fallback.',
    ].join('\n'));
  }

  if (unresolved.length) {
    output.file('dazen/unresolved_custom_items.json', JSON.stringify(unresolved.map(item => ({
      source: item.source,
      base_item: item.baseItem,
      custom_model_data: item.customModelData,
      item_model: item.itemModel,
      model: item.modelRef,
      bedrock_identifier: item.bedrockIdentifier || null,
      texture: item.texturePath || null,
      state_models: item.stateModels || item.hint?.stateModels || null,
      reason: item.reason,
    })), null, 2));
  }

  if (converted) {
    onLog('success', `Custom items: prepared ${converted} Bedrock item icons and ${mappingCount} Geyser mappings.`);
  }
  if (threeDFallbacks) {
    onLog('warn', `${threeDFallbacks} Java 3D item model(s) currently use a 2D Bedrock inventory/icon fallback. Full attachable geometry conversion is not yet generated by this web build.`);
  }
  if (unresolved.length) {
    onLog('warn', `${unresolved.length} custom item mapping(s) need review because the source did not expose enough server-side mapping metadata.`);
  }

  return {
    converted,
    mappings,
    mappingsBlob: mappingCount ? new Blob([mappingText], { type: 'application/json' }) : null,
    mappingsFileName: mappingCount ? 'dazen-geyser-custom-mappings.json' : null,
    unresolved,
    previewEntries,
    threeDFallbacks,
  };
}

function findBedrockTextureFile(inspection, ref) {
  if (!ref || typeof ref !== 'string') return null;
  let path = ref.replace(/^\/+/, '');
  if (!/\.(png|tga)$/i.test(path)) path += '.png';
  if (hasNormalized(inspection, path)) return path;

  const alt = path.startsWith('textures/') ? path : `textures/${path}`;
  if (hasNormalized(inspection, alt)) return alt;
  return null;
}

function flattenGeyserMappings(doc) {
  const out = [];
  if (!doc?.items || typeof doc.items !== 'object') return out;
  for (const [baseItem, defs] of Object.entries(doc.items)) {
    for (const def of Array.isArray(defs) ? defs : []) {
      if (!def || typeof def !== 'object') continue;
      out.push({ baseItem, ...def });
    }
  }
  return out;
}

function pluginIntegrationFiles(items) {
  const ia = [
    'info:',
    '  namespace: dazen_converted',
    'items:',
  ];
  const nexo = [];
  const oraxen = [];

  for (const item of items) {
    const material = (item.baseItem || 'minecraft:paper').replace(/^minecraft:/, '').toUpperCase();
    ia.push(
      `  ${item.slug}:`,
      `    name: "${item.displayName.replace(/"/g, '\\"')}"`,
      `    material: ${material}`,
      `    item_model: dazen:${item.slug}`
    );
    nexo.push(
      `${item.slug}:`,
      `  itemname: "<white>${item.displayName.replace(/"/g, '')}"`,
      `  material: ${material}`,
      '  Components:',
      `    item_model: dazen:${item.slug}`
    );
    oraxen.push(
      `${item.slug}:`,
      `  displayname: "<white>${item.displayName.replace(/"/g, '')}"`,
      `  material: ${material}`,
      '  Components:',
      `    item_model: dazen:${item.slug}`
    );
  }

  return {
    itemsAdder: ia.join('\n') + '\n',
    nexo: nexo.join('\n') + '\n',
    oraxen: oraxen.join('\n') + '\n',
  };
}

export async function convertBedrockCustomItems({ inspection, output, onLog = () => {} }) {
  const itemTexture = await readJson(inspection, 'textures/item_texture.json');
  if (!itemTexture?.texture_data || typeof itemTexture.texture_data !== 'object') {
    return { converted: 0, previewEntries: [], integrations: null };
  }

  const embeddedMappings = await readJson(inspection, 'dazen/geyser_custom_mappings.json');
  const mappingDefs = flattenGeyserMappings(embeddedMappings);
  const byBedrockId = new Map(mappingDefs.map(def => [def.bedrock_identifier, def]));

  const previewEntries = [];
  const integrationItems = [];
  const legacyByBase = new Map();
  let converted = 0;

  for (const [bedrockId, data] of Object.entries(itemTexture.texture_data)) {
    const textures = asTextureArray(data);
    const texturePath = textures.map(ref => findBedrockTextureFile(inspection, ref)).find(Boolean);
    if (!texturePath || !texturePath.toLowerCase().endsWith('.png')) continue;

    const file = sourceFile(inspection, texturePath);
    if (!file) continue;
    const bytes = await file.async('uint8array');
    const blob = new Blob([bytes], { type: 'image/png' });
    const slug = safeId(bedrockId);
    const javaTexture = `assets/dazen/textures/item/${slug}.png`;
    const javaModel = `assets/dazen/models/item/${slug}.json`;
    const javaItemDef = `assets/dazen/items/${slug}.json`;

    const modelJson = JSON.stringify({
      parent: 'minecraft:item/generated',
      textures: { layer0: `dazen:item/${slug}` },
    }, null, 2);
    const itemDefJson = JSON.stringify({
      model: { type: 'model', model: `dazen:item/${slug}` },
    }, null, 2);

    output.file(javaTexture, bytes, { binary: true });
    output.file(javaModel, modelJson);
    output.file(javaItemDef, itemDefJson);

    // Ready-to-drop resource folders matching the three supported Java
    // content plugins. Nexo follows the full vanilla assets structure;
    // ItemsAdder content packs can merge assets from resourcepack/assets;
    // Oraxen accepts a full assets tree under pack as well as shortcuts.
    output.file(
      `integrations/ItemsAdder/contents/dazen_converted/resourcepack/assets/dazen/textures/item/${slug}.png`,
      bytes,
      { binary: true }
    );
    output.file(
      `integrations/ItemsAdder/contents/dazen_converted/resourcepack/assets/dazen/models/item/${slug}.json`,
      modelJson
    );
    output.file(
      `integrations/ItemsAdder/contents/dazen_converted/resourcepack/assets/dazen/items/${slug}.json`,
      itemDefJson
    );

    // Alternate/legacy ItemsAdder layout found in vendor packs:
    // data/items_packs/<namespace>/*.yml
    // data/resource_pack/assets/<namespace>/...
    output.file(
      `integrations/ItemsAdder/data/resource_pack/assets/dazen/textures/item/${slug}.png`,
      bytes,
      { binary: true }
    );
    output.file(
      `integrations/ItemsAdder/data/resource_pack/assets/dazen/models/item/${slug}.json`,
      modelJson
    );
    output.file(
      `integrations/ItemsAdder/data/resource_pack/assets/dazen/items/${slug}.json`,
      itemDefJson
    );

    output.file(
      `integrations/Nexo/pack/assets/dazen/textures/item/${slug}.png`,
      bytes,
      { binary: true }
    );
    output.file(
      `integrations/Nexo/pack/assets/dazen/models/item/${slug}.json`,
      modelJson
    );
    output.file(
      `integrations/Nexo/pack/assets/dazen/items/${slug}.json`,
      itemDefJson
    );

    output.file(
      `integrations/Oraxen/pack/assets/dazen/textures/item/${slug}.png`,
      bytes,
      { binary: true }
    );
    output.file(
      `integrations/Oraxen/pack/assets/dazen/models/item/${slug}.json`,
      modelJson
    );
    output.file(
      `integrations/Oraxen/pack/assets/dazen/items/${slug}.json`,
      itemDefJson
    );

    const original = byBedrockId.get(bedrockId) || null;
    const baseItem = original?.baseItem || original?.base_item || 'minecraft:paper';
    const displayName = original?.display_name || titleCase(bedrockId);

    if (original?.type === 'legacy' && Number.isFinite(Number(original.custom_model_data))) {
      if (!legacyByBase.has(baseItem)) legacyByBase.set(baseItem, []);
      legacyByBase.get(baseItem).push({
        threshold: Number(original.custom_model_data),
        model: { type: 'model', model: `dazen:item/${slug}` },
      });
    } else if (original?.type === 'definition' && typeof original.model === 'string') {
      const [ns, rel] = splitId(original.model, 'dazen');
      output.file(`assets/${ns}/items/${rel}.json`, JSON.stringify({
        model: { type: 'model', model: `dazen:item/${slug}` },
      }, null, 2));
    }

    integrationItems.push({ slug, displayName, baseItem });
    previewEntries.push({
      id: `bedrock-item:${bedrockId}`,
      name: displayName,
      category: 'Items',
      sourcePath: texturePath,
      targetPath: javaTexture,
      status: original ? 'mapped' : 'passthrough',
      reason: original
        ? 'Original Dazen/Geyser mapping metadata restored.'
        : 'Generated a modern Java item_model using minecraft:paper as the safe default server base.',
      sourceBlob: blob,
      targetBlob: blob,
      editable: true,
      editSpec: { type: 'direct-image', targetPath: javaTexture },
      metadata: {
        bedrockIdentifier: bedrockId,
        baseItem,
        itemModel: `dazen:${slug}`,
        originalMapping: original,
      },
    });
    converted++;
  }

  for (const [baseItem, entries] of legacyByBase) {
    const base = baseItem.replace(/^minecraft:/, '');
    entries.sort((a, b) => a.threshold - b.threshold);
    output.file(`assets/minecraft/items/${base}.json`, JSON.stringify({
      model: {
        type: 'range_dispatch',
        property: 'custom_model_data',
        fallback: { type: 'model', model: `minecraft:item/${base}` },
        entries,
      },
    }, null, 2));
  }

  const integrations = pluginIntegrationFiles(integrationItems);
  output.file(
    'integrations/ItemsAdder/contents/dazen_converted/configs/dazen_converted.yml',
    integrations.itemsAdder
  );

  output.file(
    'integrations/ItemsAdder/data/items_packs/dazen_converted/dazen_converted.yml',
    integrations.itemsAdder
  );
  output.file('integrations/Nexo/items/dazen_converted.yml', integrations.nexo);
  output.file('integrations/Oraxen/items/dazen_converted.yml', integrations.oraxen);
  output.file('integrations/README.txt', [
    'Dazen Texture Pack Converter - Java plugin integration helpers',
    '',
    'These files are generated helpers, not a substitute for testing on your server.',
    'ItemsAdder: two helper layouts are generated. Modern contents/: integrations/ItemsAdder/contents/dazen_converted/{configs,resourcepack/assets}. Alternate data/: integrations/ItemsAdder/data/{items_packs/dazen_converted,resource_pack/assets}. Use the structure that matches your installation/vendor pack and regenerate the pack.',
    'Nexo: integrations/Nexo mirrors Nexo/{items,pack/assets}. Copy/adapt these files into plugins/Nexo and regenerate/reload the pack.',
    'Oraxen: integrations/Oraxen mirrors Oraxen/{items,pack/assets}. Copy/adapt these files into plugins/Oraxen and regenerate the pack.',
    '',
    'For external Bedrock packs without embedded Geyser mappings, minecraft:paper is used as the conservative default base item.',
  ].join('\n'));

  if (converted) {
    onLog('success', `Bedrock custom items: converted ${converted} item_texture.json entries into modern Java item models.`);
    onLog('info', 'Generated ItemsAdder, Nexo and Oraxen integration helper YAML files inside integrations/.');
  }

  return { converted, previewEntries, integrations };
}

function asTextureArray(data) {
  if (typeof data === 'string') return [data];
  const textures = data?.textures;
  if (typeof textures === 'string') return [textures];
  if (Array.isArray(textures)) return textures.filter(v => typeof v === 'string');
  return [];
}
