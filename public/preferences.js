const displayPreferences = (() => {
  const root = document.documentElement;
  const lkrPerUsd = 332.58;
  const rupees = new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

  function read(key) {
    try { return localStorage.getItem(`aurelia-${key}`); } catch { return null; }
  }

  function save(key, value) {
    try { localStorage.setItem(`aurelia-${key}`, value); } catch { }
  }

  function setTheme(value) {
    root.dataset.theme = value === 'dark' ? 'dark' : 'light';
  }

  let currency = read('currency') === 'USD' ? 'USD' : 'LKR';
  const savedTheme = read('theme');
  setTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  function format(amount) {
    return currency === 'USD'
      ? `≈ ${dollars.format(amount / lkrPerUsd)}`
      : `Rs ${rupees.format(amount)}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const controls = document.querySelector('.display-preferences');
    const themeChoice = controls.querySelector('[data-theme-choice]');
    const currencyChoice = controls.querySelector('[data-currency-choice]');
    themeChoice.setAttribute('aria-pressed', root.dataset.theme === 'dark');
    if (currencyChoice) currencyChoice.title = `USD estimates use Rs ${lkrPerUsd} per US dollar as of 26 November 2026`;
    currencyChoice?.setAttribute('aria-pressed', currency === 'USD');
    themeChoice.addEventListener('click', () => {
      setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
      themeChoice.setAttribute('aria-pressed', root.dataset.theme === 'dark');
      save('theme', root.dataset.theme);
    });
    currencyChoice?.addEventListener('click', () => {
      currency = currency === 'USD' ? 'LKR' : 'USD';
      currencyChoice.setAttribute('aria-pressed', currency === 'USD');
      save('currency', currency);
      document.querySelectorAll('[data-price-lkr]').forEach(price => {
        price.textContent = format(Number(price.dataset.priceLkr));
      });
    });
    controls.hidden = false;
  });

  return {
    price(value) {
      const amount = Number(value || 0);
      return `<span data-price-lkr="${amount}">${format(amount)}</span>`;
    }
  };
})();
