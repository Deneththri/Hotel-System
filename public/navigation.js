const homeMenu = document.querySelector('.home-site-menu');
if (homeMenu) {
  const summaryControl = homeMenu.querySelector('summary');
  homeMenu.addEventListener('click', event => {
    if (event.target.closest('a')) homeMenu.open = false;
  });
  document.addEventListener('click', event => {
    if (homeMenu.open && !homeMenu.contains(event.target)) homeMenu.open = false;
  });
  homeMenu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && homeMenu.open) {
      homeMenu.open = false;
      summaryControl.focus();
    }
  });
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link || !document.body.matches('.home-page:not(.luxury-page)') || link.target) return;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const destination = new URL(link.href, location.href);
  if (!/\/index\.html$/i.test(destination.pathname) || destination.search || !destination.hash) return;
  const section = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
  if (!section) return;

  event.preventDefault();
  if (location.hash !== destination.hash) history.pushState(null, '', destination.hash);
  section.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start'
  });
});
