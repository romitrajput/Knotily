let timer;

export function toast(message, { action } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  clearTimeout(timer);
  region.innerHTML = `<div class="toast" role="status"><span>${message}</span>${
    action ? `<button type="button" class="toast-action">${action.label}</button>` : ''
  }</div>`;
  const el = region.firstElementChild;
  if (action) el.querySelector('button').addEventListener('click', () => { action.onClick(); dismiss(); });
  requestAnimationFrame(() => el.classList.add('in'));
  const dismiss = () => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  };
  timer = setTimeout(dismiss, 3600);
}
