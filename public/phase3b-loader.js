(() => {
  if (document.querySelector('script[data-phase3b]')) return;
  const script = document.createElement('script');
  script.src = '/phase3b.js'; script.defer = true; script.dataset.phase3b = 'true';
  document.head.appendChild(script);
})();
