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

  function loadScript() {
    if (!enabled || !siteKey) return Promise.resolve();
    if (window.turnstile) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = resolve;
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

  function mount(containerId) {
    if (!enabled || !siteKey) return Promise.resolve();
    return loadScript().then(function () {
      var el = document.getElementById(containerId);
      if (!el || el.dataset.captchaMounted === '1') return;
      el.dataset.captchaMounted = '1';
      el.innerHTML = '';
      widgetIds[containerId] = window.turnstile.render(el, {
        sitekey: siteKey,
        theme: 'dark',
      });
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
    if (wId && window.turnstile) window.turnstile.reset(wId);
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
})(window);
