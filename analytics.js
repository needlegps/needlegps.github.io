// Privacy-aware analytics for the NeedleGPS preview.
//
// Why: leadership wants to see who is visiting (counter, geo, referrer).
// Privacy posture:
//   - GA4 configured with IP anonymization and no advertising features.
//   - Cookie-free configuration (`client_storage: 'none'`) so we don't
//     drop persistent identifiers; viewers stay anonymous beyond a session.
//   - Loads ONLY after the soft gate has been unlocked (the gate sets
//     sessionStorage['ngps-gate-passed']), so unauthenticated probes do not
//     get counted.
//   - Honors browser Do-Not-Track and the Global Privacy Control signal.
//
// To activate: set NGPS_GA_ID at the top of this file to your GA4
// measurement ID (looks like "G-XXXXXXXXXX"). When left as the placeholder
// no requests are sent — the file is a no-op until you fill in the ID.

(() => {
  const NGPS_GA_ID = 'G-PWLLG1Y8QP'; // NeedleGPS GA4 measurement ID (stream 14915813152)

  if (!NGPS_GA_ID || NGPS_GA_ID === 'G-PLACEHOLDER') return;

  // Privacy short-circuit: respect DNT and GPC.
  const dnt =
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    navigator.msDoNotTrack === '1' ||
    navigator.globalPrivacyControl === true;
  if (dnt) {
    console.info('[analytics] DNT/GPC detected; analytics suppressed.');
    return;
  }

  // Only fire after the visitor has passed the preview gate.
  function gatePassed() {
    try { return sessionStorage.getItem('ngps-gate-passed') !== null; }
    catch (_) { return false; }
  }

  function injectGA() {
    // gtag.js loader
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(NGPS_GA_ID);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag(){ window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', NGPS_GA_ID, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      client_storage: 'none',   // cookie-free
      send_page_view: true,
      page_title: 'NeedleGPS preview',
      page_path: location.pathname + location.search,
    });
  }

  if (gatePassed()) {
    injectGA();
  } else {
    // wait until the gate is passed (the gate writes to sessionStorage),
    // then fire once.
    const start = Date.now();
    const iv = setInterval(() => {
      if (gatePassed()) { clearInterval(iv); injectGA(); }
      else if (Date.now() - start > 30 * 60 * 1000) { clearInterval(iv); } // give up after 30 min
    }, 1500);
  }
})();
