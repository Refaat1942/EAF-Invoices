/**
 * Cairo font as inline @font-face rules (base64 data URIs) for server-built HTML.
 * PDF pages are rendered with page.setContent (no base URL) and the app must work on an
 * offline server, so these pages cannot load fonts from Google Fonts or by relative URL.
 */
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'public', 'vendor', 'fonts', 'cairo');

// Subsets and unicode ranges mirror public/vendor/fonts/cairo/cairo.css.
const CAIRO_SUBSETS = [
  {
    file: 'cairo-arabic-wght-normal.woff2',
    range:
      'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC',
  },
  {
    file: 'cairo-latin-ext-wght-normal.woff2',
    range:
      'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  },
  {
    file: 'cairo-latin-wght-normal.woff2',
    range:
      'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  },
];

let cachedCss = null;

function cairoFontFaceCss() {
  if (cachedCss !== null) return cachedCss;
  const rules = [];
  for (const subset of CAIRO_SUBSETS) {
    try {
      const data = fs.readFileSync(path.join(FONT_DIR, subset.file)).toString('base64');
      rules.push(
        `@font-face{font-family:'Cairo';font-style:normal;font-display:block;font-weight:200 1000;` +
          `src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${subset.range};}`
      );
    } catch (err) {
      // Missing font file: fall back to the system font rather than failing the print.
      console.warn(`[fonts] ${subset.file} not found: ${err.message}`);
    }
  }
  cachedCss = rules.join('\n');
  return cachedCss;
}

module.exports = { cairoFontFaceCss };
