const TOOLS = {
  'rank-generator': {
    section: 'Generators',
    title: 'Rank Generator',
    icon: 'R',
    description: 'Generate rank-oriented assets and configuration-ready output for Minecraft server resource-pack workflows.',
    capabilities: ['Rank artwork workspace', 'Font/glyph-ready export', 'Character mapping support', 'Plugin configuration output'],
  },
  'pack-generator': {
    section: 'Generators',
    title: 'Pack Generator',
    icon: 'P',
    description: 'Create a clean resource-pack project structure with edition-aware files and namespaces.',
    capabilities: ['Pack scaffold', 'Namespace setup', 'Metadata generation', 'Java / Bedrock structure presets'],
  },
  'item-pack-gen': {
    section: 'Generators',
    title: 'Item Pack Gen',
    icon: 'I',
    description: 'Build custom-item resource structures and integration-ready files for supported Minecraft plugin ecosystems.',
    capabilities: ['Custom item assets', 'ItemModel/CMD planning', 'ItemsAdder/Nexo/Oraxen layouts', 'Geyser-ready mapping workflow'],
  },
  'pack-merger': {
    section: 'Generators',
    title: 'Pack Merger',
    icon: 'M',
    description: 'Combine multiple resource packs while surfacing path conflicts and allowing controlled overwrite decisions.',
    capabilities: ['Multi-pack input', 'Conflict detection', 'Merge priority', 'Merged archive export'],
  },
  'server-tester': {
    section: 'Config & Utilities',
    title: 'Server Tester',
    icon: 'S',
    description: 'Test Minecraft server reachability and inspect connection-facing information from one utility page.',
    capabilities: ['Server address input', 'Reachability checks', 'Version/status inspection', 'Readable diagnostics'],
  },
  'server-icon-maker': {
    section: 'Config & Utilities',
    title: 'Server Icon Maker',
    icon: '◫',
    description: 'Prepare Minecraft server icons with the expected dimensions and export format.',
    capabilities: ['Image upload', 'Crop and scale', '64×64 preview', 'PNG export'],
  },
  'motd-maker': {
    section: 'Config & Utilities',
    title: 'MOTD Maker',
    icon: 'T',
    description: 'Compose and preview Minecraft server MOTDs with formatting controls.',
    capabilities: ['MOTD editor', 'Formatting codes', 'Live preview', 'Copy-ready output'],
  },
  'rgb-gradients': {
    section: 'Config & Utilities',
    title: 'RGB Gradients',
    icon: 'RGB',
    description: 'Generate smooth Minecraft-compatible RGB text gradients and formatting output.',
    capabilities: ['Gradient endpoints', 'Live text preview', 'Multiple output syntaxes', 'Copy controls'],
  },
  'circle-generator': {
    section: 'Config & Utilities',
    title: 'Circle Generator',
    icon: '○',
    description: 'Generate block-based circle and ellipse patterns for Minecraft builds.',
    capabilities: ['Radius/diameter controls', 'Grid preview', 'Layer pattern', 'Build reference output'],
  },
  'item-command': {
    section: 'Config & Utilities',
    title: 'Item Command',
    icon: '/',
    description: 'Build item command syntax with structured fields instead of manually assembling long commands.',
    capabilities: ['Item selector', 'Components/NBT fields', 'Command preview', 'Copy-ready command'],
  },
  'menu-maker': {
    section: 'Config & Utilities',
    title: 'Menu Maker',
    icon: '☷',
    description: 'Design inventory-style server menus with slots, items, labels, and actions.',
    capabilities: ['Inventory grid editor', 'Slot configuration', 'Item/action metadata', 'Config export'],
  },
  'votifier-tester': {
    section: 'Config & Utilities',
    title: 'Votifier Tester',
    icon: 'V',
    description: 'Prepare and test Votifier-compatible vote payload workflows with clear diagnostics.',
    capabilities: ['Host/port fields', 'Vote payload form', 'Protocol-aware testing', 'Result console'],
  },
};

const params = new URLSearchParams(location.search);
const key = params.get('tool');
const tool = TOOLS[key] || {
  section: 'Dazen Utility',
  title: 'Utility Not Found',
  icon: '?',
  description: 'This utility route does not exist in the current Dazen Development workspace.',
  capabilities: ['Return to the dashboard to choose another utility.'],
};

document.title = `${tool.title} · Dazen Development`;
document.querySelector('#tool-section').textContent = tool.section;
document.querySelector('#tool-title').textContent = tool.title;
document.querySelector('#tool-subtitle').textContent = tool.description;
document.querySelector('#tool-icon').textContent = tool.icon;
document.querySelector('#tool-heading').textContent = tool.title;
document.querySelector('#tool-description').textContent = tool.description;
document.querySelector('#tool-label').textContent = tool.section;

const list = document.querySelector('#tool-capabilities');
for (const capability of tool.capabilities) {
  const row = document.createElement('div');
  row.innerHTML = '<span>✓</span><strong></strong>';
  row.querySelector('strong').textContent = capability;
  list.appendChild(row);
}
