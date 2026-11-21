// Adds an "External Builder Tools (Experimental)" section to the bottom of Aprimo's Administration menu and shows
// each tool inside Aprimo's admin layout, clearly labelled as an external tool (not an Aprimo-built page).
//
// How it fits in:
// - A tool opens on the admin home route with a marker: #/management/home?arm=<tool>. Aprimo keeps the marker, so
//   Back, Refresh and bookmarks work, and it still draws its header, breadcrumb and admin menu. On that address
//   we hide the admin home content and put the tool (an extension page) in its place.
// - The section is our own copy of Aprimo's menu markup (so it looks native) with its own expand/collapse.
// - Anchors are Aprimo's data-automation-id attributes (used by Aprimo's own UI tests), not generated class names.
// - Aprimo redraws parts of the page as you navigate, so everything is re-checked whenever the page changes.
(() => {
  if (window.top !== window || window.__armNav) return;
  window.__armNav = true;
  const host = location.hostname.toLowerCase();
  if (!/\.aprimo\.com$/.test(host) || /\.dam\.aprimo\.com$/.test(host)) return; // the Aprimo shell, not the DAM
  const tenant = host.split('.')[0];

  const SECTION_TITLE = 'External Builder Tools (Experimental)';
  const SECTION_ID = 'arm-external-tools-left-accordion';
  const TOOLS = [
    { id: 'rules-manager', label: 'Rules Manager', page: 'app/index.html',
      subtitle: 'Browse, search and edit DAM rules with their logic in view.' },
    { id: 'job-log', label: 'Job Log Search', page: 'app/jobs.html',
      subtitle: 'Search and filter DAM maintenance jobs (System → Jobs) by status, type, creator and date.' },
    { id: 'bulk-versioning', label: 'Bulk Versioning', page: 'app/bulk.html',
      subtitle: 'Drop updated files and add each as a new version of the matching record (from Aprimo Admin Tools).' },
    { id: 'wisp', label: 'Aprimo Wspr Settings', page: 'app/wisp/settings.html',
      subtitle: 'An AI guide that answers out loud and points at the right spot on the page: set it up, add knowledge, teach it features.' },
  ];
  const EXTERNAL_NOTE = 'Community-built and maintained tool, not core Aprimo functionality. Use at your own risk.';
  const routeOf = (t) => `#/management/home?arm=${t.id}`;
  const currentTool = () => {
    const m = location.hash.match(/^#\/management\/home\?(?:.*&)?arm=([\w-]+)(?:&|$)/);
    return m ? TOOLS.find((t) => t.id === m[1]) || null : null;
  };

  // Earlier versions opened the Rules Manager next to Aprimo's Rules page; send old links to the new place.
  if (/^#\/management\/rulesDamUi\?(?:.*&)?arm=manager(?:&|$)/.test(location.hash)) location.replace(routeOf(TOOLS[0]));

  let frame = null;
  let shownTool = null;
  let saved = null; // Aprimo's own heading/subtitle/title, restored when leaving a tool

  // ── Menu section ──────────────────────────────────────────────────────────
  function buildSection() {
    const accordion = document.querySelector('.administration-landing-page-left-content mat-accordion');
    const template = accordion && [...accordion.querySelectorAll(':scope > mat-expansion-panel')].pop();
    const itemTemplate = template?.querySelector('.admin-navigation-item > a')?.parentElement;
    if (!accordion || !template || !itemTemplate) return null;
    const existing = accordion.querySelector(`[data-automation-id="${SECTION_ID}"]`);
    if (existing) {
      if (existing !== accordion.lastElementChild) accordion.appendChild(existing); // stay at the very bottom
      return existing;
    }

    const panel = template.cloneNode(true);
    panel.setAttribute('data-automation-id', SECTION_ID);
    panel.classList.remove('mat-expanded');
    const header = panel.querySelector('mat-expansion-panel-header');
    header.removeAttribute('id');
    header.setAttribute('aria-expanded', 'false');
    header.classList.remove('mat-expanded');
    const title = header.querySelector('.admin-menu-item-label') || header.querySelector('mat-panel-title');
    title.textContent = SECTION_TITLE;
    title.setAttribute('title', `${SECTION_TITLE}: ${EXTERNAL_NOTE}`);
    const wrapper = panel.querySelector('.mat-expansion-panel-content-wrapper');
    const body = panel.querySelector('.mat-expansion-panel-body');
    body.textContent = '';
    for (const tool of TOOLS) {
      const item = itemTemplate.cloneNode(true);
      const a = item.querySelector('a');
      a.setAttribute('href', routeOf(tool));
      a.removeAttribute('target');
      a.removeAttribute('rel');
      a.setAttribute('data-automation-id', `arm-${tool.id}-left`);
      a.setAttribute('title', `${tool.label}: ${EXTERNAL_NOTE}`);
      a.classList.remove('selected', 'cdk-focused', 'cdk-mouse-focused', 'cdk-keyboard-focused');
      item.querySelector('mat-icon')?.remove(); // no "open in new" icon: tools open in place
      (item.querySelector('.admin-menu-item-label') || a).textContent = tool.label;
      body.appendChild(item);
    }

    const setOpen = (open) => {
      panel.classList.toggle('mat-expanded', open);
      header.classList.toggle('mat-expanded', open);
      header.setAttribute('aria-expanded', String(open));
      if (open) wrapper.removeAttribute('inert'); else wrapper.setAttribute('inert', '');
      wrapper.style.gridTemplateRows = open ? '1fr' : '';
      wrapper.style.visibility = open ? 'visible' : '';
    };
    header.addEventListener('click', (e) => { e.preventDefault(); setOpen(!panel.classList.contains('mat-expanded')); });
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!panel.classList.contains('mat-expanded')); }
    });
    panel.__armSetOpen = setOpen;
    accordion.appendChild(panel);
    return panel;
  }

  // ── Header: say plainly that this is an external tool ─────────────────────
  function headerParts() {
    const h1 = document.querySelector('h1[data-automation-id="standard-header-title"]');
    return { h1 };
  }

  function setHeader(tool) {
    const { h1 } = headerParts();
    if (!h1) return;
    if (!saved) saved = { h1: h1.textContent, h1Title: h1.getAttribute('title'), docTitle: document.title };
    if (h1.textContent.trim() !== tool.label) {
      h1.textContent = ` ${tool.label} `;
      h1.title = tool.label;
    }
    let note = document.getElementById('arm-external-note');
    if (!note) {
      note = document.createElement('div');
      note.id = 'arm-external-note';
      note.style.cssText = 'font:500 13px/1.5 Roboto,Helvetica,Arial,sans-serif;color:#d32f2f;margin:-4px 0 6px;'; // Aprimo's error red
      // The heading sits in a flex row; put the note on its own line under that row, not beside the heading.
      (h1.closest('.header-row') || h1).insertAdjacentElement('afterend', note);
    }
    // One short line: Aprimo's header has a fixed height. Each tool shows its own description inside the tool.
    const text = EXTERNAL_NOTE;
    if (note.textContent !== text) note.textContent = text;
    const wanted = `${tool.label} (External Builder Tools) - Aprimo`;
    if (document.title !== wanted) document.title = wanted;
  }

  function restoreHeader() {
    document.getElementById('arm-external-note')?.remove();
    const { h1 } = headerParts();
    if (h1 && TOOLS.some((t) => h1.textContent.trim() === t.label)) {
      h1.textContent = saved?.h1 || ' Administration ';
      if (saved?.h1Title) h1.setAttribute('title', saved.h1Title); else h1.removeAttribute('title');
    }
    if (/\(External Builder Tools\) - Aprimo$/.test(document.title)) document.title = saved?.docTitle || 'Administration - Aprimo';
    saved = null;
  }

  // ── Content pane ───────────────────────────────────────────────────────────
  function sync() {
    const panel = buildSection();
    const tool = currentTool();
    for (const t of TOOLS) {
      const a = document.querySelector(`a[data-automation-id="arm-${t.id}-left"]`);
      a?.classList.toggle('selected', tool === t);
    }
    const main = document.querySelector('div.main-content app-administration-home')?.parentElement;
    if (tool) {
      if (panel && !panel.classList.contains('mat-expanded') && shownTool !== tool) panel.__armSetOpen?.(true);
      setHeader(tool);
      if (main) {
        for (const child of main.children) if (child !== frame && child.style.display !== 'none') child.style.display = 'none';
        // Extra route parameters a tool understands (e.g. rule=<id> opens that rule in the Rules Manager).
        const rule = (location.hash.match(/[?&]rule=([0-9a-fA-F-]{32,36})(?:&|$)/) || [])[1] || '';
        if (!frame || !frame.isConnected || shownTool !== tool || frame.dataset.rule !== rule) {
          frame?.remove();
          frame = document.createElement('iframe');
          frame.src = chrome.runtime.getURL(`${tool.page}?tenant=${encodeURIComponent(tenant)}&embedded=page${rule ? `&rule=${rule}` : ''}`);
          frame.dataset.rule = rule;
          frame.width = '100%';
          frame.height = '100%';
          frame.allow = 'clipboard-write';
          frame.title = tool.label;
          frame.dataset.arm = tool.id;
          frame.style.cssText = 'border:0;display:block;width:100%;height:100%;min-height:600px;';
          main.appendChild(frame);
          main.scrollTop = 0;
        }
      }
      shownTool = tool;
    } else {
      if (frame) { frame.remove(); frame = null; }
      if (main) for (const child of main.children) if (child.style.display === 'none') child.style.display = '';
      if (shownTool) restoreHeader();
      shownTool = null;
    }
  }

  let timer;
  const soon = () => { clearTimeout(timer); timer = setTimeout(sync, 80); };
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', sync);
  // Safety net for a race with Aprimo's own redraws: while a tool is open, re-check once a second.
  setInterval(() => { if (currentTool()) sync(); }, 1000);
  sync();
})();
