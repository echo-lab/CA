/** @type {import('tailwindcss').Config} */

// Must stay Tailwind v3 in a file named exactly tailwind.config.js: react-scripts 5 detects it by name, and v4 renamed the PostCSS plugin.
module.exports = {
  // tw- prefix avoids clashing with Bootstrap's !important utilities while pages migrate; drop it once Bootstrap is gone.
  prefix: 'tw-',
  content: ['./src/**/*.{js,jsx}'],
  corePlugins: {
    // Preflight off: its reset would break CSS written against Bootstrap's reboot (e.g. the img margin --line-highlight-rise depends on); revisit after Bootstrap.
    preflight: false,
  },
  theme: { extend: {} },
  plugins: [],
};
