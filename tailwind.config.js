/** @type {import('tailwindcss').Config} */

// Tailwind v3, not v4. react-scripts 5.0.1 detects this file by its exact name
// (config/webpack.config.js: fs.existsSync('tailwind.config.js')) and injects the
// literal string 'tailwindcss' into its hardcoded PostCSS plugin list. v4 renamed
// the plugin to @tailwindcss/postcss and dropped this config file by default, so
// it would both fail the plugin resolve and silently disable CRA's detection.
// Renaming this file to .cjs/.mjs/.ts breaks the detection too.
module.exports = {
  // Bootstrap and Tailwind share class names with DIFFERENT values, and every
  // Bootstrap utility carries !important (.p-3 = 1rem !important vs Tailwind's
  // 0.75rem), so Bootstrap wins any shared name no matter the load order. The
  // prefix removes the overlap entirely, which is what lets the two coexist
  // while pages are migrated one at a time. Drop it once Bootstrap is gone.
  prefix: 'tw-',
  content: ['./src/**/*.{js,jsx}'],
  corePlugins: {
    // Tailwind's reset would land on ~1,900 lines of CSS written against browser
    // defaults and Bootstrap's reboot — notably the global `img` rule in
    // Story.css, whose 10px bottom margin the --line-highlight-rise knob is
    // calibrated against. Revisit once Bootstrap is removed.
    preflight: false,
  },
  theme: { extend: {} },
  plugins: [],
};
