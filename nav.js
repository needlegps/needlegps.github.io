// Smooth-scroll for in-page anchor clicks (nav links, hero CTAs, etc.).
//
// We intercept clicks on any <a href="#..."> that points to a real element on
// the page, then ease the window scroll via requestAnimationFrame over a
// duration tuned to the distance — short hops snap (≈600ms), long jumps
// (Team / Contact from the top) glide (≈1300ms). The browser's native
// scroll-behavior: smooth is uncontrollable on duration and tends to feel
// abrupt on long jumps, which is what the user reported.

(() => {
  const NAV_HEIGHT = 68;             // fixed nav height; the scroll target offsets by this
  const MIN_MS = 600;
  const MAX_MS = 1400;
  const PX_PER_MS = 2.6;             // scroll speed budget for picking duration

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function smoothScrollTo(targetY) {
    if (reduceMotion) { window.scrollTo(0, targetY); return; }
    const startY = window.scrollY;
    const distance = targetY - startY;
    if (Math.abs(distance) < 4) return;
    const duration = Math.max(MIN_MS, Math.min(MAX_MS, Math.abs(distance) / PX_PER_MS));
    const startT = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startT) / duration);
      const eased = easeInOutCubic(t);
      window.scrollTo(0, Math.round(startY + distance * eased));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  document.addEventListener('click', (e) => {
    // Ignore middle/right click, modifier keys (let the browser do its thing)
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const hash = a.getAttribute('href');
    if (!hash || hash === '#') return;
    const id = hash.slice(1);
    const target = id === 'top' ? document.body : document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    const targetY = rect.top + window.scrollY - NAV_HEIGHT - 8;
    smoothScrollTo(targetY);
    // Update the URL hash without jumping (history API doesn't trigger scroll).
    history.replaceState(null, '', '#' + id);
  });
})();
