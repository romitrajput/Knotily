// A small, clean "into the bag" moment: the product picture shrinks along a soft arc
// into the bag icon, which then gives a little bounce. 2D, ~0.7 s, skipped with reduced motion.
export async function flyToBag(fromEl) {
  const bag = document.querySelector('[data-open-cart]');
  if (!fromEl || !bag || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const img = fromEl.querySelector('img[src]:not([src^="data:image/gif"])') || fromEl.querySelector('svg');
  if (!img) return;
  const a = img.getBoundingClientRect();
  const b = bag.getBoundingClientRect();
  if (!a.width) return;
  const ghost = img.cloneNode(true);
  Object.assign(ghost.style, {
    position: 'fixed', left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`,
    objectFit: 'contain', zIndex: 95, pointerEvents: 'none', borderRadius: '12px', background: 'var(--tile)',
    boxShadow: '0 18px 40px rgba(0,0,0,0.18)', transformOrigin: 'center center',
  });
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const s = Math.max(0.06, 28 / a.width);
  const anim = ghost.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 80}px) scale(${(1 + s) / 2.4})`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.4 },
    ],
    { duration: 720, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' }
  );
  await anim.finished.catch(() => {});
  ghost.remove();
  bag.classList.remove('bump');
  void bag.offsetWidth;
  bag.classList.add('bump');
  await new Promise((r) => setTimeout(r, 260));
}
