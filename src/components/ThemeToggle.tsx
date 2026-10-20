'use client';
export default function ThemeToggle() {
  return <button className="theme" type="button" aria-label="Toggle light or dark theme" onClick={() => {
    const r = document.documentElement;
    const dark = getComputedStyle(r).getPropertyValue('--bg').trim() === '#070f26';
    const n = dark ? 'light' : 'dark'; r.setAttribute('data-theme', n);
    try { localStorage.setItem('theme', n); } catch {}
  }}>Theme</button>;
}
