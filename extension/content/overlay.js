// Adds a floating "Rules" button to DAM pages. Clicking it opens the Rules Manager for *this* site as an
// overlay (an iframe of the extension's own page) on top of the DAM; Shift+click opens it in a new tab.
(() => {
  if (!globalThis.ARM_FEATURES?.standaloneViews) return; // switched off in features.js
  if (window.top !== window || document.getElementById('arm-root')) return;
  const tenant = location.hostname.split('.')[0];

  const host = document.createElement('div');
  host.id = 'arm-root';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .fab { position: fixed; right: 18px; bottom: 18px; z-index: 2147483646; display: flex; align-items: center; gap: 6px;
        padding: 9px 14px; border: 0; border-radius: 999px; background: #3b5bdb; color: #fff; cursor: pointer;
        font: 600 13px system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,.25); opacity: .9; }
      .fab:hover { opacity: 1; }
      .overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.35); display: none; }
      .overlay.open { display: block; }
      iframe { position: absolute; inset: 16px; width: calc(100% - 32px); height: calc(100% - 32px); border: 0; border-radius: 12px;
        background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
    </style>
    <button class="fab" title="Aprimo Builder Tools: Rules Manager (Shift+click: open in new tab)">⚙︎ Rules</button>
    <div class="overlay"></div>`;
  const fab = shadow.querySelector('.fab');
  const overlay = shadow.querySelector('.overlay');
  let frame = null;

  const open = () => {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL(`app/index.html?tenant=${encodeURIComponent(tenant)}&embedded=1`);
      frame.allow = 'clipboard-write';
      overlay.appendChild(frame);
    }
    overlay.classList.add('open');
  };
  const close = () => overlay.classList.remove('open');

  fab.addEventListener('click', (e) => {
    if (e.shiftKey) chrome.runtime.sendMessage({ type: 'open-tab', tenant });
    else if (overlay.classList.contains('open')) close();
    else open();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('message', (e) => {
    if (frame && e.source === frame.contentWindow && e.data?.type === 'arm-close') close();
  });

  document.documentElement.appendChild(host);
})();
