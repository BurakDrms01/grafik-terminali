import { save } from '../store.ts';

export type ThemeName = 'light' | 'dark';

/** styles.css'teki renk değişkenini okur (grafik renkleri tek yerden gelsin). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** "#d97757" + 0.2 → "rgba(217,119,87,0.2)" (canvas için). */
export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(t: ThemeName): void {
  document.documentElement.dataset.theme = t;
  save('theme', t);
}

export type AccentName = 'coral' | 'blue';

export function currentAccent(): AccentName {
  return document.documentElement.dataset.accent === 'blue' ? 'blue' : 'coral';
}

export function setAccent(a: AccentName): void {
  document.documentElement.dataset.accent = a;
  save('accent', a);
}
