(function initializeCalculatorNavigation() {
  'use strict';

  const STORAGE_KEY = 'smartEnergySettings';
  const isCalculatorPage = Boolean(document.querySelector('[data-calculator]'));
  const isSolarPage = Boolean(document.querySelector('[data-solar-lab]'));
  const homePath = isCalculatorPage ? '../../index.html' : '../index.html';
  const calculationsPath = isCalculatorPage ? '../index.html' : '../calculators/index.html';
  const solarPath = isCalculatorPage ? '../../solar-lab/index.html' : isSolarPage ? './index.html' : '../solar-lab/index.html';
  const header = document.querySelector('body > header');

  const icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z"></path>',
    monitoring: '<path d="M3 12h4l2-7 4 14 2-7h6"></path>',
    calculators: '<rect x="4" y="2" width="16" height="20" rx="2"></rect><path d="M8 6h8M8 11h2m4 0h2M8 15h2m4 0h2M8 19h2m4 0h2"></path>',
    lab: '<path d="M9 3h6m-5 0v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3"></path><path d="M8 15h8"></path>',
    solar: '<circle cx="12" cy="12" r="3.5"></circle><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>'
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;

  header.className = 'topbar calculator-topbar';
  header.innerHTML = `<a class="brand" href="${homePath}#home" aria-label="SMART ENERGY — главная"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M13 2 4.8 13h6.4L11 22l8.2-11h-6.4L13 2Z"></path></svg></span><span>SMART ENERGY</span></a><div class="topbar-actions"><button class="icon-button" id="calculatorThemeToggle" type="button" aria-label="Переключить тему">🌙</button></div>`;

  const navigation = document.createElement('nav');
  navigation.className = 'bottom-navigation';
  navigation.setAttribute('aria-label', 'Основные разделы');
  navigation.innerHTML = `<a href="${homePath}#home">${icon('home')}<span>Главная</span></a><a href="${homePath}#monitoring">${icon('monitoring')}<span>Монитор.</span></a><a class="${isSolarPage ? '' : 'active'}" href="${calculationsPath}" ${isSolarPage ? '' : 'aria-current="page"'}>${icon('calculators')}<span>Расчёты</span></a><a href="${homePath}#energy-lab">${icon('lab')}<span>EnergyLab</span></a><a class="${isSolarPage ? 'active' : ''}" href="${solarPath}" ${isSolarPage ? 'aria-current="page"' : ''}>${icon('solar')}<span>Solar</span></a>`;
  document.body.appendChild(navigation);

  let settings = {};
  try {
    settings = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (error) {
    settings = {};
  }
  const themeButton = document.getElementById('calculatorThemeToggle');
  const applyTheme = (theme) => {
    const light = theme === 'light';
    document.body.classList.toggle('light-theme', light);
    themeButton.textContent = light ? '☀️' : '🌙';
    themeButton.setAttribute('aria-label', light ? 'Включить тёмную тему' : 'Включить светлую тему');
    settings.theme = light ? 'light' : 'dark';
  };
  applyTheme(settings.theme === 'light' ? 'light' : 'dark');
  themeButton.addEventListener('click', () => {
    applyTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light');
    try {
      const latestSettings = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      settings = { ...latestSettings, theme: settings.theme };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      // Навигация и тема остаются рабочими без localStorage.
    }
  });
})();
