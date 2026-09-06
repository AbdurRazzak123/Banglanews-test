/*
 * বাংলা সংবাদ — Adsterra / Google Sheet Ads Loader v12
 *
 * Google Sheet (Ads):
 * A = Position | B = Active | C = Image URL | D = Click URL | E = Title | F = Ad Code
 *
 * Supported positions:
 * TOP, MIDDLE TOP, MIDDLE BOTTOM, BOTTOM, ALL, MIDDLE (legacy)
 *
 * Each page slot gets its own live ad iframe. This keeps third-party ad
 * globals/container IDs isolated, so the SAME Ad Code can safely be used
 * in 2/3/4 slots and different companies can occupy different slots.
 */
(function () {
  'use strict';

  const SHEET_ID = '1gX73WskIs3D-8IcyPJ24NT0xn1KIEJSjMXOF9nCQqTg';
  const SHEET_NAME = 'Ads';
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
    '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(SHEET_NAME);
  const VERSION = 'ads-v12';
  const MAX_AD_HEIGHT = 620;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function value(row, index) {
    return row && row.c && row.c[index] && row.c[index].v != null
      ? String(row.c[index].v).trim() : '';
  }

  function parseGViz(raw) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) throw new Error('Invalid Google Sheet response');
    const data = JSON.parse(raw.slice(start, end));
    if (data.status && data.status !== 'ok') throw new Error('Google Sheet status: ' + data.status);
    return data.table && Array.isArray(data.table.rows) ? data.table.rows : [];
  }

  function isActive(v) {
    const x = String(v || '').trim().toLowerCase();
    return !x || ['yes', 'true', '1', 'active', 'on', 'হ্যাঁ', 'চালু'].includes(x);
  }

  function normalizePosition(v) {
    const p = String(v || '').toUpperCase().trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    if (p === 'TOP') return 'TOP';
    if (p === 'BOTTOM' || p === 'FOOTER') return 'BOTTOM';
    if (p === 'MIDDLE TOP' || p === 'MIDDLETOP') return 'MIDDLE_TOP';
    if (p === 'MIDDLE BOTTOM' || p === 'MIDDLEBOTTOM') return 'MIDDLE_BOTTOM';
    if (p === 'MIDDLE') return 'MIDDLE';
    if (p === 'ALL' || p === 'EVERYWHERE' || p === 'ALL POSITIONS') return 'ALL';
    return '';
  }

  function safeUrl(v) {
    const x = String(v || '').trim();
    return /^(https?:|mailto:|tel:)/i.test(x) ? x : '';
  }

  function getSlots() {
    const result = [];
    const seen = new Set();
    document.querySelectorAll('.sheet-ad-slot, .ad-slot').forEach(el => {
      if (seen.has(el)) return;
      if (!el.matches('.sheet-ad-slot') && !el.hasAttribute('data-ad-slot') && !el.hasAttribute('data-ad-position')) return;
      seen.add(el);
      result.push(el);
    });
    return result;
  }

  function slotPosition(slot, index, total) {
    const explicit = normalizePosition(slot.getAttribute('data-ad-position') || slot.getAttribute('data-ad-slot'));
    if (explicit) return explicit;
    if (total === 2) return index === 0 ? 'TOP' : 'BOTTOM';
    if (total === 3) return ['TOP', 'MIDDLE', 'BOTTOM'][index];
    if (total === 4) return ['TOP', 'MIDDLE_TOP', 'MIDDLE_BOTTOM', 'BOTTOM'][index];
    return '';
  }

  // Exact position wins. ALL is the fallback for any empty position.
  function chooseAd(groups, pos) {
    if (groups[pos] && groups[pos].length) return groups[pos][0];
    if (groups.ALL && groups.ALL.length) return groups.ALL[0];
    if ((pos === 'MIDDLE_TOP' || pos === 'MIDDLE_BOTTOM') && groups.MIDDLE && groups.MIDDLE.length) {
      return groups.MIDDLE[0];
    }
    return null;
  }

  function clear(slot) {
    slot.replaceChildren();
    slot.removeAttribute('data-ad-error');
    slot.removeAttribute('data-ad-loaded');
    slot.classList.remove('ad-loaded');
  }

  function markLoaded(slot, title) {
    slot.classList.add('ad-loaded');
    slot.setAttribute('data-ad-loaded', 'yes');
    slot.setAttribute('aria-label', title || 'Advertisement');
  }

  function imageAd(slot, image, click, title) {
    const src = safeUrl(image);
    if (!src) return false;
    clear(slot);

    const img = document.createElement('img');
    img.src = src;
    img.alt = title || 'Advertisement';
    img.loading = 'lazy';
    img.decoding = 'async';

    const href = safeUrl(click);
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer sponsored';
      a.appendChild(img);
      slot.appendChild(a);
    } else {
      slot.appendChild(img);
    }
    markLoaded(slot, title);
    return true;
  }

  function buildIframeHtml(code) {
    // A real about:blank iframe is deliberately used instead of srcdoc.
    // Adsterra snippets that rely on document.write can therefore execute
    // normally inside their own isolated document.
    return '<!doctype html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>html,body{margin:0;padding:0;width:100%;min-height:0;background:transparent;overflow:hidden;text-align:center;}*{box-sizing:border-box;max-width:100%;}</style>' +
      '</head><body>' + code + '</body></html>';
  }

  function measureIframe(iframe) {
    try {
      const doc = iframe.contentDocument;
      if (!doc || !doc.body) return;
      const body = doc.body;
      const html = doc.documentElement;
      const height = Math.ceil(Math.max(
        body.scrollHeight, body.offsetHeight,
        html.scrollHeight, html.offsetHeight,
        body.getBoundingClientRect().height
      ));
      if (height > 0) iframe.style.height = Math.min(height + 2, MAX_AD_HEIGHT) + 'px';
    } catch (_) {}
  }

  function executeAdCode(slot, code, title) {
    const source = String(code || '').trim();
    if (!source) return Promise.resolve(false);

    clear(slot);

    const iframe = document.createElement('iframe');
    iframe.title = title || 'Advertisement';
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
    iframe.style.width = '100%';
    iframe.style.maxWidth = '100%';
    iframe.style.height = '90px';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.style.margin = '0 auto';
    iframe.style.background = 'transparent';
    slot.appendChild(iframe);

    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        if (ok) {
          markLoaded(slot, title);
          setTimeout(() => measureIframe(iframe), 50);
          setTimeout(() => measureIframe(iframe), 400);
          setTimeout(() => measureIframe(iframe), 1500);
        }
        resolve(ok);
      };

      const start = () => {
        try {
          const doc = iframe.contentDocument;
          if (!doc) return finish(false);
          doc.open();
          doc.write(buildIframeHtml(source));
          doc.close();

          // Give Adsterra/external scripts time to create their banner iframe.
          setTimeout(() => measureIframe(iframe), 100);
          setTimeout(() => measureIframe(iframe), 800);
          setTimeout(() => finish(true), 1600);
        } catch (e) {
          console.warn('Ad code execution failed:', e);
          finish(false);
        }
      };

      iframe.addEventListener('load', start, { once: true });
      // about:blank is normally already loaded by the time the listener is added.
      setTimeout(() => {
        if (!settled && iframe.contentDocument) start();
      }, 0);
      setTimeout(() => finish(false), 7000);
    });
  }

  async function render(slot, ad) {
    clear(slot);
    if (!ad) return false;

    if (ad.code) {
      const ok = await executeAdCode(slot, ad.code, ad.title);
      if (ok) return true;
    }
    return imageAd(slot, ad.image, ad.click, ad.title);
  }

  async function fetchSheet() {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(SHEET_URL + '&_=' + Date.now() + '-' + attempt, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'follow'
        });
        if (!response.ok) throw new Error('Google Sheet HTTP ' + response.status);
        return parseGViz(await response.text());
      } catch (e) {
        lastError = e;
        if (attempt < 2) await sleep(700 * (attempt + 1));
      }
    }
    throw lastError || new Error('Google Sheet request failed');
  }

  async function loadAds() {
    const list = getSlots();
    if (!list.length) return;

    if (location.protocol === 'file:') {
      console.warn('Ads: use GitHub Pages/HTTPS, not file://');
      return;
    }

    list.forEach((slot, i) => {
      const pos = slotPosition(slot, i, list.length);
      slot.dataset.adsLoader = VERSION;
      slot.dataset.adPosition = pos.toLowerCase().replace(/_/g, '-');
    });

    try {
      const rows = await fetchSheet();
      const groups = { TOP: [], MIDDLE: [], MIDDLE_TOP: [], MIDDLE_BOTTOM: [], BOTTOM: [], ALL: [] };

      rows.forEach(row => {
        const pos = normalizePosition(value(row, 0));
        if (!pos || !Object.prototype.hasOwnProperty.call(groups, pos) || !isActive(value(row, 1))) return;
        const ad = {
          image: value(row, 2),
          click: value(row, 3),
          title: value(row, 4),
          code: value(row, 5)
        };
        if (ad.code || ad.image) groups[pos].push(ad);
      });

      // Render sequentially. Each slot is isolated, so the same third-party
      // code can be rendered independently in every slot without global-ID clashes.
      for (let i = 0; i < list.length; i++) {
        const pos = slotPosition(list[i], i, list.length);
        await render(list[i], chooseAd(groups, pos));
      }
    } catch (e) {
      console.warn('Google Sheet Ads load failed:', e);
      list.forEach(slot => slot.setAttribute('data-ad-error', 'sheet-load-failed'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAds, { once: true });
  } else {
    loadAds();
  }
})();
