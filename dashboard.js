import { getUsageAnalytics } from './analytics.js';

const DISCORD_GUILD_ID = '1525395816225964133';
const DISCORD_WIDGET_API =
  `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/widget.json`;
const DISCORD_WIDGET_BASE =
  `https://discord.com/widget?id=${DISCORD_GUILD_ID}`;

const refs = {
  communityOnline: document.querySelector('#stat-community-online'),
  conversions: document.querySelector('#stat-conversions'),
  generations: document.querySelector('#stat-generations'),
  toolOpens: document.querySelector('#stat-tool-opens'),
  pageViews: document.querySelector('#stat-page-views'),
  guildName: document.querySelector('#discord-guild-name'),
  guildOnline: document.querySelector('#discord-online-copy'),
  memberStrip: document.querySelector('#discord-member-strip'),
  apiStatus: document.querySelector('#discord-api-status'),
  joinButton: document.querySelector('#discord-community-join'),
  iframe: document.querySelector('#discord-widget-frame'),
};

function number(value) {
  return Number(value || 0).toLocaleString();
}

function renderLocalStats() {
  const usage = getUsageAnalytics();

  if (refs.conversions) refs.conversions.textContent = number(usage.conversions);
  if (refs.generations) refs.generations.textContent = number(usage.generations);
  if (refs.toolOpens) refs.toolOpens.textContent = number(usage.toolOpens);
  if (refs.pageViews) refs.pageViews.textContent = number(usage.pageViews);
}

function currentDiscordTheme() {
  return document.documentElement.dataset.theme === 'light'
    ? 'light'
    : 'dark';
}

function syncDiscordWidgetTheme() {
  if (!refs.iframe) return;
  const src = `${DISCORD_WIDGET_BASE}&theme=${currentDiscordTheme()}`;
  if (refs.iframe.src !== src) refs.iframe.src = src;
}

function renderMembers(members = []) {
  if (!refs.memberStrip) return;
  refs.memberStrip.replaceChildren();

  const visible = members.slice(0, 8);

  for (const member of visible) {
    const wrap = document.createElement('div');
    wrap.className = 'discord-member-avatar';
    wrap.title = member.username || 'Discord member';

    const img = document.createElement('img');
    img.src = member.avatar_url || '';
    img.alt = member.username || 'Discord member';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';

    const status = document.createElement('span');
    status.className =
      'discord-member-status ' + String(member.status || 'online').toLowerCase();

    wrap.append(img, status);
    refs.memberStrip.appendChild(wrap);
  }

  if (members.length > visible.length) {
    const more = document.createElement('span');
    more.className = 'discord-member-more';
    more.textContent = `+${members.length - visible.length}`;
    refs.memberStrip.appendChild(more);
  }

  if (!members.length) {
    const empty = document.createElement('span');
    empty.className = 'discord-member-empty';
    empty.textContent = 'Member preview will appear when Discord returns widget members.';
    refs.memberStrip.appendChild(empty);
  }
}

async function loadDiscordCommunity() {
  if (refs.apiStatus) refs.apiStatus.textContent = 'Connecting to Discord…';

  try {
    const response = await fetch(DISCORD_WIDGET_API, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Discord widget returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const online = Number(data.presence_count || 0);

    if (refs.communityOnline) {
      refs.communityOnline.textContent = number(online);
      refs.communityOnline.closest('.dashboard-metric-card')?.classList.add('is-live');
    }

    if (refs.guildName) refs.guildName.textContent = data.name || 'Dazen Development';
    if (refs.guildOnline) {
      refs.guildOnline.textContent =
        `${number(online)} member${online === 1 ? '' : 's'} online now`;
    }

    if (refs.apiStatus) {
      refs.apiStatus.textContent = 'Live from Discord';
      refs.apiStatus.classList.add('is-live');
    }

    if (refs.joinButton && data.instant_invite) {
      refs.joinButton.href = data.instant_invite;
    }

    renderMembers(Array.isArray(data.members) ? data.members : []);
  } catch (error) {
    if (refs.communityOnline) refs.communityOnline.textContent = '—';
    if (refs.guildOnline) refs.guildOnline.textContent = 'Live member count unavailable';
    if (refs.apiStatus) {
      refs.apiStatus.textContent = 'Discord API unavailable';
      refs.apiStatus.classList.add('is-error');
      refs.apiStatus.title = error.message || String(error);
    }
    renderMembers([]);
  }
}

renderLocalStats();
syncDiscordWidgetTheme();
loadDiscordCommunity();

const themeObserver = new MutationObserver(mutations => {
  if (
    mutations.some(
      mutation =>
        mutation.type === 'attributes' &&
        mutation.attributeName === 'data-theme'
    )
  ) {
    syncDiscordWidgetTheme();
  }
});

themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});
