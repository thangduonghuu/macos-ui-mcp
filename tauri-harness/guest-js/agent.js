// macos-ui-mcp — webview agent. Injected at document start by the Tauri plugin.
// Defines window.__MACOS_UI_MCP__.dispatch(reqId, op, params); results go back
// to Rust via the `deliver` command.
;(function () {
  if (window.__MACOS_UI_MCP__) return;

  var seq = 0;
  var idToEl = new Map(); // string -> Element (rebuilt lazily if stale)

  function idOf(el) {
    if (el.dataset && el.dataset.testid) return el.dataset.testid;
    if (el.id) return el.id;
    if (!el.__mcpId) el.__mcpId = 'dom-' + ++seq;
    return el.__mcpId;
  }
  function register(el) {
    var id = idOf(el);
    idToEl.set(id, el);
    return id;
  }
  function findById(id) {
    var el = idToEl.get(id);
    if (el && el.isConnected) return el;
    try {
      var q = document.querySelector('[data-testid="' + CSS.escape(id) + '"], #' + CSS.escape(id));
      if (q) { idToEl.set(id, q); return q; }
    } catch (e) {}
    // fall back to a synthesized-id scan
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) if (all[i].__mcpId === id) return all[i];
    return null;
  }

  function invoke(cmd, payload) {
    var internals = window.__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === 'function') return internals.invoke(cmd, payload);
    if (window.__TAURI__ && window.__TAURI__.core) return window.__TAURI__.core.invoke(cmd, payload);
    return Promise.reject(new Error('Tauri invoke unavailable'));
  }
  function deliver(id, ok, data, detail) {
    invoke('plugin:macos-ui-mcp|deliver', {
      id: id,
      ok: !!ok,
      data: data == null ? null : data,
      detail: detail || null,
    }).catch(function (e) {
      console.error('[macos-ui-mcp] deliver failed', e);
    });
  }

  // ---- DOM -> node tree ----------------------------------------------------

  var SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, NOSCRIPT: 1, BASE: 1 };

  function roleOf(el) {
    var explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    var tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'img') return 'image';
    if (tag === 'input') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
      return 'textfield';
    }
    if (tag === 'textarea') return 'textfield';
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag) || tag === 'p' || tag === 'label' || tag === 'span' || tag === 'li') return 'text';
    return tag;
  }

  function labelOf(el) {
    var al = el.getAttribute && el.getAttribute('aria-label');
    if (al) return al;
    var lb = el.getAttribute && el.getAttribute('aria-labelledby');
    if (lb) {
      var n = document.getElementById(lb);
      if (n) return (n.textContent || '').trim();
    }
    if (el.tagName === 'INPUT' && el.labels && el.labels.length) {
      return (el.labels[0].textContent || '').trim();
    }
    var isLeaf = !el.children || el.children.length === 0;
    if (isLeaf || el.tagName === 'BUTTON' || roleOf(el) === 'button' || roleOf(el) === 'link') {
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 120) return text;
    }
    return undefined;
  }

  function valueOf(el) {
    if (el.tagName === 'INPUT') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return !!el.checked;
      return el.value;
    }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return el.value;
    if (el.isContentEditable) return (el.textContent || '').trim();
    return undefined;
  }

  function nodeOf(el) {
    var node = { id: register(el), role: roleOf(el) };
    var label = labelOf(el);
    if (label !== undefined) node.label = label;
    var value = valueOf(el);
    if (value !== undefined) node.value = value;
    if ('disabled' in el) node.enabled = !el.disabled;
    if (el === document.activeElement) node.focused = true;

    var r = el.getBoundingClientRect();
    node.frame = { x: r.x, y: r.y, width: r.width, height: r.height };

    var kids = [];
    var children = el.children || [];
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (SKIP[c.tagName]) continue;
      if (c.getAttribute && c.getAttribute('aria-hidden') === 'true') continue;
      kids.push(nodeOf(c));
    }
    if (kids.length) node.children = kids;
    return node;
  }

  function rootEl() {
    return document.body || document.documentElement;
  }

  // ---- interactions ------------------------------------------------------

  function setNativeValue(el, value) {
    var proto =
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype :
      el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype :
      window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // A native <select>'s popup is rendered by the OS, outside the DOM/webview —
  // a synthetic click on its <option> never reaches it, so `.click()` is a
  // no-op there. Selecting the option's value directly (framework-safe via
  // setNativeValue) reproduces what a real choice would do.
  function selectOption(option) {
    var select = option.parentElement;
    while (select && select.tagName !== 'SELECT') select = select.parentElement;
    if (!select) return false;
    setNativeValue(select, option.value);
    return true;
  }

  // ---- snapshot (dependency-free SVG <foreignObject> rasterization) -------
  // Fidelity is approximate. For pixel-accurate output, set
  // window.__MACOS_UI_MCP_SNAPSHOT__ = (el) => Promise<pngDataUrl>  (e.g. wrap
  // html-to-image / modern-screenshot).

  function inlineStyles(src, dst) {
    var cs = getComputedStyle(src);
    var text = '';
    for (var i = 0; i < cs.length; i++) {
      var prop = cs[i];
      text += prop + ':' + cs.getPropertyValue(prop) + ';';
    }
    dst.setAttribute('style', text);
    var a = src.children || [];
    var b = dst.children || [];
    for (var j = 0; j < a.length; j++) if (b[j]) inlineStyles(a[j], b[j]);
  }

  function snapshot(nodeId) {
    var el = nodeId ? findById(nodeId) : rootEl();
    if (!el) return Promise.reject(new Error('no such node: ' + nodeId));

    var custom = window.__MACOS_UI_MCP_SNAPSHOT__;
    if (typeof custom === 'function') return Promise.resolve(custom(el));

    var rect = el.getBoundingClientRect();
    var w = Math.max(1, Math.ceil(rect.width));
    var h = Math.max(1, Math.ceil(rect.height));
    var clone = el.cloneNode(true);
    inlineStyles(el, clone);
    var xml = new XMLSerializer().serializeToString(clone);
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<foreignObject width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml">' + xml + '</div>' +
      '</foreignObject></svg>';

    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        var bg = getComputedStyle(document.body).backgroundColor;
        ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        try {
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(new Error('canvas tainted (cross-origin content): ' + e.message));
        }
      };
      img.onerror = function () {
        reject(new Error('SVG rasterization failed'));
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // ---- dispatch --------------------------------------------------------

  function dispatch(reqId, op, params) {
    params = params || {};
    try {
      if (op === 'tree') {
        deliver(reqId, true, nodeOf(rootEl()));
      } else if (op === 'tap') {
        var el = findById(params.node);
        if (!el) return deliver(reqId, false, null, 'no such node');
        if (el.tagName === 'OPTION') {
          if (!selectOption(el)) return deliver(reqId, false, null, 'option has no <select> ancestor');
          return deliver(reqId, true, null);
        }
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        deliver(reqId, true, null);
      } else if (op === 'setText') {
        var target = findById(params.node);
        if (!target) return deliver(reqId, false, null, 'no such node');
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          setNativeValue(target, params.text);
          deliver(reqId, true, null);
        } else if (target.isContentEditable) {
          target.textContent = params.text;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          deliver(reqId, true, null);
        } else {
          deliver(reqId, false, null, 'not a text control');
        }
      } else if (op === 'action') {
        var hooks = window.__MACOS_UI_MCP_ACTIONS__ || {};
        var fn = hooks[params.name];
        if (typeof fn !== 'function') return deliver(reqId, false, null, 'no such action: ' + params.name);
        Promise.resolve()
          .then(fn)
          .then(function () { deliver(reqId, true, null); })
          .catch(function (e) { deliver(reqId, false, null, String((e && e.message) || e)); });
      } else if (op === 'snapshot') {
        snapshot(params.node).then(
          function (dataUrl) { deliver(reqId, true, { dataUrl: dataUrl }); },
          function (e) { deliver(reqId, false, null, String((e && e.message) || e)); }
        );
      } else {
        deliver(reqId, false, null, 'unknown op: ' + op);
      }
    } catch (e) {
      deliver(reqId, false, null, String((e && e.stack) || e));
    }
  }

  window.__MACOS_UI_MCP_ACTIONS__ = window.__MACOS_UI_MCP_ACTIONS__ || {};
  window.__MACOS_UI_MCP__ = { dispatch: dispatch, version: 1 };
  console.log('[macos-ui-mcp] webview agent ready');
})();
