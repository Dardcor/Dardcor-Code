/**
 * Dardcor Code - Strict ESLint Code Quality & Style Rules (Task 929)
 *
 * Flat config (ESLint 9+). Deliberately dependency-free: `typescript-eslint`
 * and `globals` are imported dynamically at the top of the consuming build
 * when available; the base config below only relies on ESLint core.
 */

// Minimal node/browser globals so core rules do not flag runtime APIs.
const nodeGlobals = Object.fromEntries([
	'process', 'console', 'Buffer', 'setTimeout', 'clearTimeout', 'setInterval',
	'clearInterval', 'setImmediate', 'clearImmediate', 'global', 'URL', 'TextEncoder',
	'TextDecoder', 'AbortController', 'AbortSignal', 'structuredClone', 'queueMicrotask',
	'__dirname', '__filename', 'require', 'module', 'exports', 'fetch', 'WebSocket',
].map(name => [name, 'readonly']));

const browserGlobals = Object.fromEntries([
	'window', 'document', 'navigator', 'location', 'history', 'localStorage',
	'sessionStorage', 'customElements', 'HTMLElement', 'HTMLDivElement',
	'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver',
	'IntersectionObserver', 'ResizeObserver', 'requestAnimationFrame',
	'cancelAnimationFrame', 'getComputedStyle', 'File', 'Blob', 'FormData',
	'RequestInit', 'Request', 'Response', 'Headers',
].map(name => [name, 'readonly']));

const ignoredFiles = [
	'dist/**',
	'node_modules/**',
	'release/**',
	'out/**',
	'coverage/**',
	'**/*.d.ts',
	'**/grammars/*.json',
];

/** @type {import('eslint').Linter.Config[]} */
const config = [
	{
		ignores: ignoredFiles,
	},
	{
		files: ['**/*.{js,mjs,cjs,ts}'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: { ...nodeGlobals, ...browserGlobals },
		},
		rules: {
			// ----- errors -----
			'no-undef': 'error',
			'no-unexpected-multiline': 'error',
			'no-unreachable': 'error',
			'no-constant-condition': ['error', { checkLoops: false }],
			'no-func-assign': 'error',
			'no-dupe-args': 'error',
			'no-dupe-keys': 'error',
			'no-cond-assign': ['error', 'except-parens'],
			'no-fallthrough': 'error',
			'no-irregular-whitespace': 'error',
			'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'no-extra-semi': 'error',
			'no-sparse-arrays': 'error',
			'valid-typeof': 'error',
			'no-debugger': 'error',
			'no-duplicate-imports': 'error',
			'no-import-assign': 'error',
			'no-new-native-nonconstructor': 'error',
			'no-shadow': ['error', { builtinGlobals: true }],

			// ----- best practices -----
			'eqeqeq': ['error', 'always', { null: 'ignore' }],
			'no-eval': 'error',
			'no-implied-eval': 'error',
			'no-iterator': 'error',
			'no-new-func': 'error',
			'no-param-reassign': 'error',
			'no-proto': 'error',
			'no-return-assign': ['error', 'always'],
			'no-sequences': 'error',
			'no-unmodified-loop-condition': 'error',
			'no-unused-expressions': 'error',
			'no-useless-call': 'error',
			'no-useless-concat': 'error',
			'no-useless-constructor': 'error',
			'no-useless-escape': 'error',
			'no-with': 'error',
			'prefer-const': 'error',
			'prefer-spread': 'error',
			'prefer-object-spread': 'error',
			'no-var': 'error',
			'object-shorthand': ['error', 'always'],
			'one-var': ['error', 'never'],
			'radix': 'error',

			// ----- style (matches dc conventions: tabs, double quotes, semicolons) -----
			'indent': ['error', 'tab', { SwitchCase: 1 }],
			'quotes': ['error', 'double', { avoidEscape: true }],
			'semi': ['error', 'always'],
			'comma-dangle': ['error', 'only-multiline'],
			'no-trailing-spaces': 'error',
			'no-multiple-empty-lines': ['error', { max: 1 }],
			'object-curly-spacing': ['error', 'always'],
			'array-bracket-spacing': ['error', 'never'],
			'comma-spacing': ['error', { before: false, after: true }],
			'key-spacing': ['error', { beforeColon: false, afterColon: true }],
			'keyword-spacing': ['error', { before: true, after: true }],
			'block-spacing': ['error', 'always'],
			'brace-style': ['error', '1tbs'],
			'space-before-function-paren': ['error', { anonymous: 'always', named: 'never', asyncArrow: 'always' }],
			'func-call-spacing': ['error', 'never'],
			'no-multi-spaces': 'error',
			'space-infix-ops': 'error',
			'operator-linebreak': ['error', 'after'],
			'camelcase': ['error', { properties: 'never', allow: ['^[A-Z][A-Z0-9_]*$'] }],
			'no-restricted-globals': ['error', 'event', 'fdescribe', 'fit', 'fcontext', 'xcontext'],
		},
	},
	{
		// TypeScript-aware rules require `typescript-eslint`; once added to
		// devDependencies, extend this block with:
		//   parser: await import('typescript-eslint').then(m => m.parser)
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
			},
		},
		rules: {
			'no-dupe-class-members': 'off',
			'no-redeclare': 'off',
			'no-useless-constructor': 'off',
		},
	},
	{
		files: ['tools/**/*.mjs'],
		rules: {
			'no-console': 'off', // CLI tooling
		},
	},
];

export default config;
