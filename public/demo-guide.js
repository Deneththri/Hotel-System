(() => {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!local || new URLSearchParams(location.search).get('demo') !== '1') return;
  const dismissalKey = 'aurelia-demo-guide-dismissed';
  try {
    if (localStorage.getItem(dismissalKey)) return;
  } catch {
    // The guide can still be dismissed for the current page.
  }

  const guide = document.createElement('aside');
  guide.className = 'demo-guide';
  guide.setAttribute('aria-label', 'Demo guide');
  guide.innerHTML = `
    <div class="demo-guide-heading">
      <strong>Demo guide</strong>
      <button type="button">Got it</button>
    </div>
    <ol>
      <li><a href="index.html#stay">Search &amp; book a room</a></li>
      <li><a href="index.html#dining">Try dining &amp; room delivery</a></li>
    </ol>
    <a href="admin.html">Staff demo login</a>
  `;

  guide.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem(dismissalKey, 'true'); } catch { }
    guide.remove();
    document.querySelector('.home-book-link')?.focus({ preventScroll: true });
  });
  document.body.append(guide);
})();
