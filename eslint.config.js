/**
 * ESLint v9 flat config.
 * Browser globals only. Vendor JS is excluded from linting.
 */
const globals = require('globals').browser;

module.exports = [
  {
    ignores: ['vendor/**', 'node_modules/**', 'assets/**']
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals,
        L: 'readonly',
        turf: 'readonly',
        jspdf: 'readonly',
        html2canvas: 'readonly',
        FAC_CONFIG: 'readonly',
        FAC_UTILS: 'readonly',
        FAC_UNITS: 'readonly',
        FAC_GEOMETRY: 'readonly',
        FAC_STORAGE: 'readonly',
        FAC_MAP: 'readonly',
        FAC_DRAWING: 'readonly',
        FAC_GEOLOCATION: 'readonly',
        FAC_UI: 'readonly',
        FAC_UI_STATE: 'readonly',
        FAC_PDF: 'readonly',
        FAC_IMPORT: 'readonly',
        FAC_BOTTOM_SHEET: 'readonly',
        FAC_SHARE: 'readonly',
        FAC_MOBILE_MENU: 'readonly',
        FAC_REPORTER: 'readonly',
        FAC_I18N: 'readonly',
        pako: 'readonly',
        __fac: 'readonly',
      },
    },
    rules: {
      // Our own rules
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'warn',
      'eqeqeq': ['error', 'smart'],
      'no-var': 'error',
      'no-implicit-globals': 'off',
      // Recommended set, applied selectively
      'no-unused-expressions': 'error',
      'no-prototype-builtins': 'error',
      'no-self-assign': 'error',
      'no-dupe-keys': 'error',
      'no-useless-escape': 'warn',
    },
  },
];
