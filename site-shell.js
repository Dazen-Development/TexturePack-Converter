const ORG = {
  name: 'Dazen Development',
  avatar: 'https://avatars.githubusercontent.com/u/317466458?v=4',
  github: 'https://github.com/Dazen-Development',
  discord: 'https://discord.gg/zvxHEPzr4M',
};

const navGroups = [
  {
    label: 'OVERVIEW',
    items: [
      { key: 'dashboard', label: 'Dashboard', href: './index.html', icon: '▦' },
      { key: 'about', label: 'About Us', href: './about.html', icon: '◉' },
      { key: 'privacy', label: 'Privacy Policy', href: './privacy.html', icon: '◇' },
    ],
  },
  {
    label: 'GENERATORS & PACKS',
    items: [
      { key: 'rank-generator', label: 'Rank Generator', href: 'https://tools.lamico.net/rank-gen', icon: 'R', badge: 'Hot', external: true },
      { key: 'pack-generator', label: 'Pack Generator', href: 'https://tools.lamico.net/pack-gen', icon: 'P', external: true },
      { key: 'item-pack-gen', label: 'Item Pack Gen', href: 'https://tools.lamico.net/item-pack', icon: 'I', external: true },
      { key: 'pack-merger', label: 'Pack Merger', href: 'https://tools.lamico.net/pack-merger', icon: 'M', external: true },
      { key: 'pack-hosting', label: 'Pack Hosting', href: 'https://tools.lamico.net/pack-host', icon: 'H', badge: 'Live', external: true },
    ],
  },
  {
    label: 'CONFIG & UTILITIES',
    items: [
      { key: 'converter', label: 'Resource Pack Converter', href: './converter.html', icon: '⇄' },
      { key: 'server-tester', label: 'Server Tester', href: 'https://tools.lamico.net/server-tester', icon: 'S', badge: 'New', external: true },
      { key: 'server-icon-maker', label: 'Server Icon Maker', href: 'https://tools.lamico.net/server-icon-maker', icon: '◫', external: true },
      { key: 'motd-maker', label: 'MOTD Maker', href: 'https://tools.lamico.net/motd-maker', icon: 'T', external: true },
      { key: 'rgb-gradients', label: 'RGB Gradients', href: 'https://tools.lamico.net/rgb-gen', icon: 'RGB', external: true },
      { key: 'circle-generator', label: 'Circle Generator', href: 'https://tools.lamico.net/circle-gen', icon: '○', external: true },
      { key: 'item-command', label: 'Item Command', href: 'https://tools.lamico.net/item-gen', icon: '/', external: true },
      { key: 'menu-maker', label: 'Menu Maker', href: 'https://tools.lamico.net/menu-maker', icon: '☷', external: true },
      { key: 'votifier-tester', label: 'Votifier Tester', href: 'https://tools.lamico.net/votifier-test', icon: 'V', external: true },
    ],
  },
];

function currentPageKey() {
  const explicit = document.body?.dataset?.page;
  if (explicit) return explicit;

  const file = location.pathname.split('/').pop() || 'index.html';
  if (file === 'converter.html' || file === 'preview.html' || file === 'editor.html') return 'converter';
  if (file === 'about.html') return 'about';
  if (file === 'privacy.html') return 'privacy';
  return 'dashboard';
}

function renderNavItem(item, activeKey) {
  const active = item.key === activeKey ? ' active' : '';
  const external = item.external ? ' target="_blank" rel="noreferrer"' : '';
  const badge = item.badge
    ? `<span class="sidebar-nav-badge ${item.badge.toLowerCase()}">${item.badge}</span>`
    : '';
  const externalMark = item.external
    ? '<span class="sidebar-nav-external" aria-hidden="true">↗</span>'
    : '';

  return `
    <a class="sidebar-nav-item${active}" href="${item.href}" data-nav="${item.key}"${external}>
      <span class="sidebar-nav-icon" aria-hidden="true">${item.icon}</span>
      <span class="sidebar-nav-text">${item.label}</span>
      ${badge}
      ${externalMark}
    </a>
  `;
}

function buildSidebar() {
  const activeKey = currentPageKey();

  const nav = navGroups.map(group => `
    <section class="sidebar-nav-group">
      <div class="sidebar-nav-label">${group.label}</div>
      <nav class="sidebar-nav-list">
        ${group.items.map(item => renderNavItem(item, activeKey)).join('')}
      </nav>
    </section>
  `).join('');

  return `
    <div class="sidebar-backdrop" data-sidebar-close></div>
    <aside class="app-sidebar" aria-label="Dazen Development navigation">
      <div class="sidebar-inner">
        <a class="sidebar-brand" href="./index.html" aria-label="Dazen Development dashboard">
          <img src="${ORG.avatar}" alt="Dazen Development organization logo" width="48" height="48" />
          <span class="sidebar-brand-copy">
            <strong>Dazen Development</strong>
            <small>Developer Utilities</small>
          </span>
        </a>

        <div class="sidebar-scroll">
          ${nav}
        </div>

        <div class="sidebar-footer">
          <a class="sidebar-discord" href="${ORG.discord}" target="_blank" rel="noreferrer">
            <span class="discord-mark" aria-hidden="true">◖◗</span>
            <span>
              <strong>Join Discord</strong>
              <small>Dazen Development community</small>
            </span>
            <span aria-hidden="true">↗</span>
          </a>

          <a class="sidebar-github-link" href="${ORG.github}" target="_blank" rel="noreferrer">
            GitHub Organization ↗
          </a>
        </div>
      </div>
    </aside>

    <button class="sidebar-mobile-toggle" type="button" aria-label="Open navigation" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  `;
}

function installSidebar() {
  document.body.classList.add('has-sidebar');

  const mount = document.querySelector('#site-sidebar');
  if (mount) {
    mount.innerHTML = buildSidebar();
  } else {
    const holder = document.createElement('div');
    holder.id = 'site-sidebar';
    holder.innerHTML = buildSidebar();
    document.body.prepend(holder);
  }

  const toggle = document.querySelector('.sidebar-mobile-toggle');
  const closeTargets = document.querySelectorAll('[data-sidebar-close]');
  const sidebarLinks = document.querySelectorAll('.sidebar-nav-item');

  const setOpen = open => {
    document.body.classList.toggle('sidebar-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
  };

  toggle?.addEventListener('click', () => {
    setOpen(!document.body.classList.contains('sidebar-open'));
  });

  closeTargets.forEach(el => el.addEventListener('click', () => setOpen(false)));
  sidebarLinks.forEach(link => link.addEventListener('click', () => setOpen(false)));

  addEventListener('keydown', event => {
    if (event.key === 'Escape') setOpen(false);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installSidebar, { once: true });
} else {
  installSidebar();
}
