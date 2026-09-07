/*
 * বাংলা সংবাদ — Google Sheet Ads Loader v16 DIRECT
 *
 * Google Sheet (Ads):
 * A = Position | B = Active | C = Image URL | D = Click URL | E = Title | F = Ad Code
 *
 * The loader reads the Ads tab on every page load. Ad Code is rendered directly
 * in the page (the normal method for third-party ad snippets), while image ads
 * remain the reliable fallback. Slots are rendered one-by-one so providers
 * that use globals such as `atOptions` do not overwrite another slot's config.
 */
(function () {
  'use strict';

  const SHEET_ID = '1gX73WskIs3D-8IcyPJ24NT0xn1KIEJSjMXOF9nCQqTg';
  const SHEET_NAME = 'Ads';
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
    '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(SHEET_NAME);
  const VERSION = 'ads-v16-direct-final';
  const MAX_AD_HEIGHT = 700;
  const WAIT_MS = 9000;

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
    return /^(https?:|mailto:|tel:|\/\/)/i.test(x) ? x : '';
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
    img.loading = 'eager';
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

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  function hasCreative(host) {
    if (!host) return false;
    if (host.querySelector('iframe, img, object, embed, video, canvas, svg, ins, [data-ad-status="filled"], [data-ad], [class*=ad], [id*=ad]')) {
      return Array.from(host.querySelectorAll('iframe, img, object, embed, video, canvas, svg, ins, [data-ad-status="filled"], [data-ad], [class*=ad], [id*=ad]')).some(isVisible);
    }
    return host.getBoundingClientRect().height > 2 && (host.textContent || '').trim().length > 12;
  }

  function copyAttributes(from, to) {
    for (const attr of Array.from(from.attributes || [])) to.setAttribute(attr.name, attr.value);
  }

  // Some ad snippets use document.write(). When a dynamically inserted ad
  // script calls it synchronously, redirect the generated markup into this
  // slot instead of allowing it to replace the whole news page.
  function withSafeDocumentWrite(host, fn) {
    const originalWrite = document.write;
    const originalWriteln = document.writeln;
    const append = html => {
      if (html == null) return;
      const template = document.createElement('template');
      template.innerHTML = String(html);
      host.appendChild(template.content.cloneNode(true));
    };
    document.write = append;
    document.writeln = html => append(String(html == null ? '' : html) + '\n');
    try {
      return fn();
    } finally {
      document.write = originalWrite;
      document.writeln = originalWriteln;
    }
  }

  function executeScriptsInOrder(host, source) {
    const template = document.createElement('template');
    template.innerHTML = source;

    const scripts = Array.from(template.content.querySelectorAll('script'));
    const fragment = template.content.cloneNode(true);
    fragment.querySelectorAll('script').forEach(s => s.remove());
    host.appendChild(fragment);

    let chain = Promise.resolve();
    scripts.forEach(original => {
      chain = chain.then(() => new Promise(resolve => {
        const script = document.createElement('script');
        copyAttributes(original, script);
        if (original.src) {
          script.async = false;
          const restoreWrite = (() => {
            const originalWrite = document.write;
            const originalWriteln = document.writeln;
            const append = html => {
              if (html == null) return;
              const template = document.createElement('template');
              template.innerHTML = String(html);
              host.appendChild(template.content.cloneNode(true));
            };
            document.write = append;
            document.writeln = html => append(String(html == null ? '' : html) + '\n');
            return () => {
              document.write = originalWrite;
              document.writeln = originalWriteln;
            };
          })();
          const done = () => {
            restoreWrite();
            resolve();
          };
          script.onload = done;
          script.onerror = done;
          host.appendChild(script);
          // Safety valve for a provider script that never fires load/error.
          setTimeout(done, WAIT_MS);
        } else {
          script.text = original.textContent || '';
          withSafeDocumentWrite(host, () => host.appendChild(script));
          resolve();
        }
      }));
    });
    return chain;
  }

  async function executeAdCode(slot, code, title) {
    const source = String(code || '').trim();
    if (!source) return false;

    clear(slot);
    const host = document.createElement('div');
    host.className = 'ad-code-host';
    host.setAttribute('data-ad-renderer', VERSION);
    host.style.width = '100%';
    host.style.maxWidth = '100%';
    host.style.minWidth = '0';
    host.style.margin = '0 auto';
    host.style.padding = '0';
    host.style.textAlign = 'center';
    host.style.overflow = 'visible';
    slot.appendChild(host);

    let observer;
    const started = Date.now();
    try {
      observer = new MutationObserver(() => {
        if (hasCreative(host)) {
          markLoaded(slot, title);
          observer.disconnect();
        }
      });
      observer.observe(host, { childList: true, subtree: true, attributes: true });

      await executeScriptsInOrder(host, source);

      const checks = [100, 400, 1000, 2000, 4000, 6500];
      for (const ms of checks) {
        const remaining = ms - (Date.now() - started);
        if (remaining > 0) await sleep(remaining);
        if (hasCreative(host)) {
          markLoaded(slot, title);
          observer.disconnect();
          return true;
        }
      }

      if (hasCreative(host)) {
        markLoaded(slot, title);
        observer.disconnect();
        return true;
      }
    } catch (e) {
      console.warn('Ad code execution failed:', e);
    } finally {
      if (observer) observer.disconnect();
    }

    return false;
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

      // Sequential execution is intentional: many third-party ad snippets use
      // one global configuration object. Running them together can cause one
      // slot to overwrite another slot's configuration before the provider reads it.
      for (let i = 0; i < list.length; i++) {
        const pos = slotPosition(list[i], i, list.length);
        const ad = chooseAd(groups, pos);
        const ok = await render(list[i], ad);
        if (!ok && ad && (ad.code || ad.image)) {
          list[i].setAttribute('data-ad-error', 'creative-not-rendered');
        }
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
