// Load security and workspace UI without changing the existing frontend bundle.
(() => {
  if (document.querySelector('script[data-phase3a]')) return;
  const script = document.createElement('script');
  script.src = '/phase3a.js'; script.defer = true; script.dataset.phase3a = 'true';
  document.head.appendChild(script);
})();
