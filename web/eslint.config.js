import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// Bugs, not style. The build does not catch an undefined name — a missing
// component or a variable that moved out of scope compiles fine and only fails
// in the browser — so these rules are what stand between that and the server.
export default [
  { ignores: ['dist/'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',          // <Component/> that was never imported
      'react/jsx-uses-vars': 'error',         // so imported components count as used
      'react-hooks/rules-of-hooks': 'error',
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
]
