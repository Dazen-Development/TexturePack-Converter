const ORG = {
  name: 'Dazen Development',
  avatar: 'https://avatars.githubusercontent.com/u/317466458?v=4',
  github: 'https://github.com/Dazen-Development',
  discord: 'https://discord.gg/zvxHEPzr4M',
};

const navGroups = [
  {
    label: 'GENERATORS',
    items: [
      { key: 'rank-generator', label: 'Rank Generator', href: './tool.html?tool=rank-generator', icon: 'R' },
      { key: 'pack-generator', label: 'Pack Generator', href: './tool.html?tool=pack-generator', icon: 'P' },
      { key: 'item-pack-gen', label: 'Item Pack Gen', href: './tool.html?tool=item-pack-gen', icon: 'I' },
      { key: 'pack-merger', label: 'Pack Merger', href: './tool.html?tool=pack-merger', icon: 'M' },
    ],
  },
  {
    label: 'CONFIG & UTILITIES',
    items: [
      { key: 'converter', label: 'Resource Pack Converter', href: './converter.html', icon: '⇄' },
      { key: 'server-tester', label: 'Server Tester', href: './tool.html?tool=server-tester', icon: 'S' },
      { key: 'server-icon-maker', label: 'Server Icon Maker', href: './tool.html?tool=server-icon-maker', icon: '◫' },
      { key: 'motd-maker', label: 'MOTD Maker', href: './tool.html?tool=motd-maker', icon: 'T' },
      { key: 'rgb-gradients', label: 'RGB Gradients', href: './tool.html?tool=rgb-gradients', icon: 'RGB' },
      { key: 'circle-generator', label: 'Circle Generator', href: './tool.html?tool=circle-generator', icon: '○' },
      { key: 'item-command', label: 'Item Command', href: './tool.html?tool=item-command', icon: '/' },
      { key: 'menu-maker', label: 'Menu Maker', href: './tool.html?tool=menu-maker', icon: '☷' },
      { key: 'votifier-tester', label: 'Votifier Tester', href: './tool.html?tool=votifier-tester', icon: 'V' },
    ],
  },
];

function currentPageKey() {
  const explicit = document.body?.dataset?.page;
  if (explicit && explicit !== 'tool') return explicit;

  const file = location.pathname.split('/').pop() || 'index.html';
  if (file === 'converter.html' || file === 'preview.html' || file === 'editor.html') return 'converter';
  if (file === 'tool.html') return new URLSearchParams(location.search).get('tool') || '';
  return '';
}

function renderNavItem(item, activeKey) {
  const active = item.key === activeKey ? ' active' : '';

  return `
    <a class="sidebar-nav-item${active}" href="${item.href}" data-nav="${item.key}">
      <span class="sidebar-nav-icon" aria-hidden="true">${item.icon}</span>
      <span class="sidebar-nav-text">${item.label}</span>
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

function pageLoaderElements() {
  return {
    overlay: document.querySelector('#dazen-page-loader'),
    bar: document.querySelector('#dazen-load-progress'),
    text: document.querySelector('#dazen-load-text'),
  };
}

let progressTimer = null;
let progressValue = 6;

function setLoadProgress(value) {
  progressValue = Math.max(0, Math.min(100, value));
  const { bar } = pageLoaderElements();
  if (bar) bar.style.transform = `scaleX(${progressValue / 100})`;
}

function startPageLoading(message = 'Loading Dazen utilities…') {
  const { overlay, text } = pageLoaderElements();
  document.documentElement.classList.add('dazen-loading');
  if (overlay) overlay.hidden = false;
  if (text) text.textContent = message;

  clearInterval(progressTimer);
  progressValue = Math.max(6, progressValue);
  setLoadProgress(progressValue);

  progressTimer = setInterval(() => {
    const remaining = 91 - progressValue;
    if (remaining <= 0.5) return;
    progressValue += Math.max(.35, remaining * .055);
    setLoadProgress(progressValue);
  }, 120);
}

function finishPageLoading() {
  clearInterval(progressTimer);
  progressTimer = null;
  setLoadProgress(100);

  const { overlay } = pageLoaderElements();

  setTimeout(() => {
    document.documentElement.classList.remove('dazen-loading');
    document.documentElement.classList.add('dazen-loaded');
    if (overlay) overlay.classList.add('is-leaving');

    setTimeout(() => {
      if (overlay) overlay.hidden = true;
      if (overlay) overlay.classList.remove('is-leaving');
      setLoadProgress(0);
    }, 260);
  }, 120);
}

function installNavigationLoader() {
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    if (event.defaultPrevented) return;
    if (event.button && event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target === '_blank' || link.hasAttribute('download')) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    let target;
    try {
      target = new URL(link.href, location.href);
    } catch {
      return;
    }

    if (target.origin !== location.origin) return;
    if (target.href === location.href) return;

    startPageLoading('Opening ' + (link.textContent.trim() || 'page') + '…');
  }, true);
}

function installLoadLifecycle() {
  startPageLoading();

  if (document.readyState === 'complete') {
    requestAnimationFrame(finishPageLoading);
  } else {
    addEventListener('load', () => {
      // Give fonts/images one frame to settle before revealing the app.
      requestAnimationFrame(() => requestAnimationFrame(finishPageLoading));
    }, { once: true });

    // Never trap the user behind the loading screen if one third-party
    // resource takes too long or fails to fire a normal load completion.
    setTimeout(() => {
      if (document.documentElement.classList.contains('dazen-loading')) {
        finishPageLoading();
      }
    }, 9000);
  }

  addEventListener('pageshow', event => {
    if (event.persisted) finishPageLoading();
  });
}

function initShell() {
  installSidebar();
  installNavigationLoader();
  installLoadLifecycle();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShell, { once: true });
} else {
  initShell();
}
