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
    label: 'CONFIG & UTILITIES',
    items: [
      { key: 'converter', label: 'Resource Pack Converter', href: './converter.html', icon: '⇄' },
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
  return `
    <a class="sidebar-nav-item${active}" href="${item.href}" data-nav="${item.key}">
      <span class="sidebar-nav-icon" aria-hidden="true">${item.icon}</span>
      <span>${item.label}</span>
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
