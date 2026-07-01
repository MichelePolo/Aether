// Aether site — minimal interactions (no deps). Degrades gracefully without JS.

// Copy-to-clipboard for [data-copy] buttons inside a .cmd-block
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const block = btn.closest('.cmd-block');
    const text = block?.querySelector('.cmd')?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(text.trim());
      btn.textContent = 'copiato ✓';
    } catch {
      btn.textContent = 'copia a mano';
    }
    setTimeout(() => { btn.textContent = 'copia'; }, 1500);
  });
});

// Install channel tabs: [data-tab] toggles [data-panel]. JS sets the initial
// single-visible state, so without JS all panels stay visible (still usable).
const tabs = [...document.querySelectorAll('[data-tab]')];
const panels = [...document.querySelectorAll('[data-panel]')];
function selectTab(key) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === key));
  panels.forEach((p) => { p.hidden = p.dataset.panel !== key; });
}
if (tabs.length) {
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
  selectTab(tabs[0].dataset.tab);
}

// Carousel: scroll-snap track + prev/next arrows + dot indicators.
// Without JS the track is still a horizontal swipe gallery (graceful degrade).
document.querySelectorAll('.carousel').forEach((car) => {
  const track = car.querySelector('.carousel-track');
  const slides = [...track.children];
  const dotsWrap = car.querySelector('.carousel-dots');
  const current = () => Math.round(track.scrollLeft / track.clientWidth);
  const go = (i) => {
    const n = Math.max(0, Math.min(slides.length - 1, i));
    track.scrollTo({ left: n * track.clientWidth, behavior: 'smooth' });
  };
  car.querySelector('.prev')?.addEventListener('click', () => go(current() - 1));
  car.querySelector('.next')?.addEventListener('click', () => go(current() + 1));
  slides.forEach((_, i) => {
    const b = document.createElement('button');
    b.setAttribute('aria-label', 'Vai alla slide ' + (i + 1));
    b.addEventListener('click', () => go(i));
    dotsWrap?.appendChild(b);
  });
  const setActive = () => {
    const c = current();
    [...(dotsWrap?.children ?? [])].forEach((d, i) => d.classList.toggle('active', i === c));
  };
  track.addEventListener('scroll', () => requestAnimationFrame(setActive), { passive: true });
  window.addEventListener('resize', setActive);
  setActive();
});
