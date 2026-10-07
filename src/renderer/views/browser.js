// Built-in browser: a webview with an address bar, for checking what the crew ships.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class BrowserView {
  constructor(root) {
    this.root = root;
    this.url = 'http://localhost:3000';
    root.innerHTML = `<div class="br-bar"><button class="btn small" data-nav="back">‹</button><button class="btn small" data-nav="fwd">›</button><button class="btn small" data-nav="reload">↻</button>
      <form id="brForm"><input id="brUrl" value="${esc(this.url)}" spellcheck="false"></form><button class="btn small" data-nav="ext" title="Sistem tarayıcısında aç">↗</button></div>
      <webview id="brView"></webview>`;
    this.view = root.querySelector('#brView');
    this.input = root.querySelector('#brUrl');
    root.querySelector('#brForm').onsubmit = (e) => { e.preventDefault(); this.go(this.input.value); };
    root.querySelector('.br-bar').onclick = (e) => {
      const nav = e.target.closest('[data-nav]')?.dataset.nav;
      if (!nav) return;
      try {
        if (nav === 'back' && this.view.canGoBack()) this.view.goBack();
        if (nav === 'fwd' && this.view.canGoForward()) this.view.goForward();
        if (nav === 'reload') this.view.reload();
        if (nav === 'ext') window.open(this.view.getURL() || this.url);
      } catch { /* webview not ready */ }
    };
    const nav = (e) => { if (!e.url || e.url === 'about:blank') return; this.url = e.url; this.input.value = e.url; };
    this.view.addEventListener('did-navigate', nav);
    this.view.addEventListener('did-navigate-in-page', nav);
    this.started = false;
  }

  go(u) {
    let url = String(u || '').trim();
    if (!url) return;
    if (url === 'about:blank') return;
    if (!/^[a-z]+:\/\//i.test(url)) url = /^(localhost|\d+\.\d+\.\d+\.\d+)/.test(url) ? `http://${url}` : `https://${url}`;
    this.url = url; this.input.value = url;
    this.view.src = url;
    this.started = true;
  }

  show() { if (!this.started) this.go(this.url); }
  // a hidden webview must not keep the keyboard
  blur() { try { if (this.started) this.view.blur(); } catch { /* not ready */ } if (document.activeElement === this.view) document.activeElement.blur(); }
}
