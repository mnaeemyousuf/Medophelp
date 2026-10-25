// Apply the saved colour theme before first paint to avoid a flash. Kept as a file (not inline)
// so the server's Content-Security-Policy can stay strict (script-src 'self').
try {
  var t = localStorage.getItem('hms-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
