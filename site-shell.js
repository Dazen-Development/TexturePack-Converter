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

const LOAD_SESSION_KEY = 'dazen-initial-load-complete';

function hasCompletedInitialLoad() {
  try {
    return sessionStorage.getItem(LOAD_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markInitialLoadComplete() {
  try {
    sessionStorage.setItem(LOAD_SESSION_KEY, '1');
  } catch {}
}

function pageLoaderElements() {
  return {
    overlay: document.querySelector('#dazen-page-loader'),
    initialBar: document.querySelector('#dazen-load-progress'),
    navTrack: document.querySelector('#dazen-nav-load-track'),
    navBar: document.querySelector('#dazen-nav-load-progress'),
    text: document.querySelector('#dazen-load-text'),
  };
}

let progressTimer = null;
let progressValue = 6;
let activeLoadingMode = null;

function setLoadProgress(value) {
  progressValue = Math.max(0, Math.min(100, value));
  const { initialBar, navBar } = pageLoaderElements();
  const scale = `scaleX(${progressValue / 100})`;
  if (initialBar) initialBar.style.transform = scale;
  if (navBar) navBar.style.transform = scale;
}

function beginProgressLoop() {
  clearInterval(progressTimer);
  progressValue = Math.max(6, progressValue);
  setLoadProgress(progressValue);

  progressTimer = setInterval(() => {
    const remaining = 92 - progressValue;
    if (remaining <= 0.4) return;
    progressValue += Math.max(.3, remaining * .055);
    setLoadProgress(progressValue);
  }, 120);
}

function startInitialLoading(message = 'Loading Dazen utilities…') {
  activeLoadingMode = 'initial';
  const { overlay, navTrack, text } = pageLoaderElements();

  document.documentElement.classList.add('dazen-initial-loading');
  document.documentElement.classList.remove('dazen-route-loading');

  if (navTrack) navTrack.hidden = true;
  if (overlay) {
    overlay.hidden = false;
    overlay.classList.remove('is-leaving');
  }
  if (text) text.textContent = message;

  beginProgressLoop();
}

function startNavigationLoading() {
  activeLoadingMode = 'navigation';
  const { overlay, navTrack } = pageLoaderElements();

  // Once the user has entered the site, internal page changes never show the
  // fullscreen loader again. Only the thin browser-style top progress line.
  markInitialLoadComplete();
  document.documentElement.classList.remove('dazen-initial-loading');
  document.documentElement.classList.add('dazen-route-loading');

  if (overlay) overlay.hidden = true;
  if (navTrack) navTrack.hidden = false;

  progressValue = 6;
  beginProgressLoop();
}

function finishInitialLoading() {
  clearInterval(progressTimer);
  progressTimer = null;
  setLoadProgress(100);

  const { overlay, navTrack } = pageLoaderElements();
  markInitialLoadComplete();

  setTimeout(() => {
    document.documentElement.classList.remove('dazen-initial-loading');
    document.documentElement.classList.add('dazen-loaded');

    if (overlay) overlay.classList.add('is-leaving');

    setTimeout(() => {
      if (overlay) {
        overlay.hidden = true;
        overlay.classList.remove('is-leaving');
      }
      if (navTrack) navTrack.hidden = true;
      setLoadProgress(0);
      activeLoadingMode = null;
    }, 260);
  }, 120);
}

function finishNavigationLoading() {
  clearInterval(progressTimer);
  progressTimer = null;
  setLoadProgress(100);

  const { navTrack, overlay } = pageLoaderElements();
  if (overlay) overlay.hidden = true;

  setTimeout(() => {
    document.documentElement.classList.remove('dazen-route-loading');
    document.documentElement.classList.add('dazen-loaded');

    if (navTrack) {
      navTrack.classList.add('is-complete');
      setTimeout(() => {
        navTrack.hidden = true;
        navTrack.classList.remove('is-complete');
        setLoadProgress(0);
        activeLoadingMode = null;
      }, 220);
    } else {
      setLoadProgress(0);
      activeLoadingMode = null;
    }
  }, 80);
}

function finishCurrentLoading() {
  if (activeLoadingMode === 'initial') {
    finishInitialLoading();
  } else {
    finishNavigationLoading();
  }
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

    startNavigationLoading();
  }, true);
}

function installLoadLifecycle() {
  const firstEntry = !hasCompletedInitialLoad();

  if (firstEntry) {
    startInitialLoading();
  } else {
    // This document was reached from another internal page. The early inline
    // bootstrap already prevents the fullscreen overlay from flashing.
    startNavigationLoading();
  }

  const complete = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(finishCurrentLoading);
    });
  };

  if (document.readyState === 'complete') {
    complete();
  } else {
    addEventListener('load', complete, { once: true });

    // Do not leave either loading mode stuck because of a slow/failed
    // third-party resource.
    setTimeout(() => {
      if (
        document.documentElement.classList.contains('dazen-initial-loading') ||
        document.documentElement.classList.contains('dazen-route-loading')
      ) {
        finishCurrentLoading();
      }
    }, 9000);
  }

  addEventListener('pageshow', event => {
    if (event.persisted) {
      if (hasCompletedInitialLoad()) {
        activeLoadingMode = 'navigation';
        finishNavigationLoading();
      } else {
        activeLoadingMode = 'initial';
        finishInitialLoading();
      }
    }
  });
}

const THEME_STORAGE_KEY = 'dazen-theme';

function getSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = normalized;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      'content',
      normalized === 'light' ? '#f4f6fa' : '#0b0d12'
    );
  }

  document.querySelectorAll('[data-theme-toggle]').forEach(toggle => {
    const light = normalized === 'light';
    toggle.classList.toggle('is-light', light);
    toggle.setAttribute('aria-pressed', String(light));
    toggle.setAttribute(
      'aria-label',
      light ? 'Switch to dark mode' : 'Switch to light mode'
    );

    const label = toggle.querySelector('.theme-toggle-label');
    if (label) label.textContent = light ? 'Light' : 'Dark';
  });
}

function ensureFloatingThemeToggle() {
  let toggle = document.querySelector('[data-theme-toggle].theme-toggle-floating');
  if (toggle) return toggle;

  toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'theme-toggle theme-toggle-floating';
  toggle.setAttribute('data-theme-toggle', '');
  toggle.setAttribute('aria-label', 'Switch to light mode');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.innerHTML = `
    <span class="theme-toggle-icon-stack" aria-hidden="true">
      <span class="theme-toggle-icon theme-toggle-sun">☀</span>
      <span class="theme-toggle-icon theme-toggle-moon">☾</span>
    </span>
  `;

  document.body.appendChild(toggle);
  return toggle;
}

function installThemeToggle() {
  const toggle = ensureFloatingThemeToggle();
  applyTheme(getSavedTheme());

  toggle.addEventListener('click', () => {
    const next =
      document.documentElement.dataset.theme === 'light'
        ? 'dark'
        : 'light';

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}

    applyTheme(next);
  });
}

function initShell() {
  installSidebar();
  installThemeToggle();
  installNavigationLoader();
  installLoadLifecycle();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initShell, { once: true });
} else {
  initShell();
}
