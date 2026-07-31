/**
 * Dardcor Code - Web Workbench App Bundling Configuration (Task 907)
 *
 * Vite configuration for the browser workbench target. Plain data object
 * (no `vite` import) so the file can be consumed as configuration data by
 * build scripts even when Vite is not installed.
 */

const root = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

/** @type {object} */
const config = {
	root,
	base: './',
	publicDir: 'public',
	plugins: [],
	resolve: {
		alias: {
			'@dc': `${root}/src/dc`,
		},
	},
	build: {
		outDir: 'dist/web',
		emptyOutDir: true,
		sourcemap: true,
		minify: 'esbuild',
		target: 'es2022',
		rollupOptions: {
			input: {
				workbench: `${root}/src/dc/main.ts`,
			},
			output: {
				entryFileNames: 'assets/[name].js',
				chunkFileNames: 'assets/[name]-[hash].js',
				assetFileNames: 'assets/[name]-[hash][extname]',
			},
		},
	},
	server: {
		port: 5173,
		strictPort: false,
	},
	preview: {
		port: 4173,
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts', 'src/**/test/*.suite.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'lcov'],
		},
	},
};

export default config;
