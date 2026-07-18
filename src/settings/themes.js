// Theme presets, in the shape defined by /home/alex/apps/shared/css-best-practices.md
// (Multi-theme color system). Ember is the folder-wide default dark theme;
// "light" is the explicit, persistent light-mode override (never
// prefers-color-scheme — see the shared doc's Dark/light mode section).

export const THEMES = {
  ember: {
    label: 'Ember',
    dark: true,
    a: { name: 'Amber', bg: '#b87040', border: '#7a4820' },
    b: { name: 'Teal', bg: '#3d8c7a', border: '#255c50' },
  },
  light: {
    label: 'Light',
    dark: false,
    a: { name: 'Amber', bg: '#b87040', border: '#7a4820' },
    b: { name: 'Teal', bg: '#3d8c7a', border: '#255c50' },
  },
};

export const DEFAULT_THEME_KEY = 'ember';
const STORAGE_KEY = 'slowframe.theme';

export function loadTheme() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_KEY;
}

export function applyTheme(key) {
  const theme = THEMES[key] ? key : DEFAULT_THEME_KEY;
  document.documentElement.dataset.theme = THEMES[theme].dark ? 'dark' : 'light';
  localStorage.setItem(STORAGE_KEY, theme);
  return theme;
}
