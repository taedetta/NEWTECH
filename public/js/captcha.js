/**
 * Cloudflare Turnstile widget helper for auth and public forms.
 */
(function (global) {
  let enabled = false;
  let siteKey = '';
  const widgetIds = {};
  let initPromise = null;
  let scriptPromise = null;

  function isEnabled() {
    return enabled;
  }

  function waitForTurnstile(timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function poll() {
        if (window.turnstile && typeof window.turnstile.render === 'function') {
          return resolve();
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error('Captcha timed out'));
        }
        setTimeout(poll, 30);
      })();
    });
  }

  function loadScript() {
    if (!enabled || !siteKey) return Promise.resolve();
    if (window.turnstile) return waitForTurnstile();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = function () { waitForTurnstile().then(resolve).catch(reject); };
      s.onerror = function () { reject(new Error('Captcha script failed to load')); };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = fetch('/api/config?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        enabled = !!cfg.captchaEnabled;
        siteKey = cfg.turnstileSiteKey || '';
        if (enabled) return loadScript();
      })
      .catch(function () {
        enabled = false;
        siteKey = '';
      });
    return initPromise;
  }

  function isContainerVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    var panel = el.closest('.auth-tab-panel');
    if (panel && panel.classList.contains('active')) return true;
    return el.getClientRects().length > 0;
  }

  function renderWidget(containerId, el) {
    if (widgetIds[containerId] && window.turnstile) {
      try { window.turnstile.remove(widgetIds[containerId]); } catch (_) {}
      delete widgetIds[containerId];
    }
    el.innerHTML = '';
    el.dataset.captchaMounted = '1';
    widgetIds[containerId] = window.turnstile.render(el, {
      sitekey: siteKey,
      theme: 'dark',
    });
  }

  function mount(containerId) {
    if (!enabled || !siteKey) return Promise.resolve();
    return loadScript().then(function () {
      var el = document.getElementById(containerId);
      if (!el) return;

      var hasIframe = !!el.querySelector('iframe');
      if (el.dataset.captchaMounted === '1' && hasIframe) return;

      el.dataset.captchaMounted = '0';

      var attempts = 0;
      function tryRender() {
        if (!isContainerVisible(el) && attempts++ < 120) {
          requestAnimationFrame(tryRender);
          return;
        }
        renderWidget(containerId, el);
      }

      requestAnimationFrame(tryRender);
    });
  }

  function getToken(containerId) {
    if (!enabled) return '';
    var wId = widgetIds[containerId];
    if (!wId || !window.turnstile) return '';
    return window.turnstile.getResponse(wId) || '';
  }

  function reset(containerId) {
    var wId = widgetIds[containerId];
    if (wId && window.turnstile) {
      window.turnstile.reset(wId);
      return;
    }
    var el = document.getElementById(containerId);
    if (el) {
      el.dataset.captchaMounted = '0';
      el.innerHTML = '';
    }
    mount(containerId);
  }

  function requireToken(containerId) {
    if (!enabled) return Promise.resolve(null);
    var token = getToken(containerId);
    if (!token) {
      return Promise.reject(new Error('Please complete the security check before continuing.'));
    }
    return Promise.resolve(token);
  }

  global.FSCaptcha = {
    init: init,
    mount: mount,
    getToken: getToken,
    reset: reset,
    requireToken: requireToken,
    isEnabled: isEnabled,
  };

  init();
})(window);
