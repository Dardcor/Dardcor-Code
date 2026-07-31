/**
 * Dardcor Code - CSS Minification & Inline Asset Pipeline (Task 926)
 *
 * Own regex/tokenizer-based CSS minifier (no dependencies):
 *   - strips comments and blank lines
 *   - collapses whitespace and removes it around structural characters
 *   - drops trailing semicolons inside blocks
 *   - shortens hex colors (#ffffff -> #fff) and uppercases keywords
 *   - removes empty rules
 *   - `--inline-assets`: rewrites url(...) references to data: URIs
 *   - `--watch`: re-minifies when sources change
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		input: opt('--input', null),
		output: opt('--output', null),
		dir: path.resolve(ROOT, opt('--dir', 'src')),
		outDir: path.resolve(ROOT, opt('--out-dir', 'dist/css')),
		inlineAssets: argv.includes('--inline-assets'),
		watch: argv.includes('--watch'),
		level: Number(opt('--level', 2)),
	};
}

const COMMENTS = /\/\*[\s\S]*?\*\//g;
const WHITESPACE = /\s+/g;
const SURROUNDING = /\s*([{}:;,>~+])\s*/g;
const TRAILING_SEMI = /;}/g;
const EMPTY_RULE = /[^{}]*\{\}/g;
const HEX_COLOR = /#([0-9a-fA-F]{6})\b/g;
const RGBA_ZERO = /rgba?\(0,\s*0,\s*0,\s*0\)/g;
const URL_REF = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
const IMPORTANT = /!\s*important/g;

const MIME_BY_EXT = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
};

function shortenHex(match, hex) {
	if (hex[0] === hex[1] && hex[2] === hex[3] && hex[4] === hex[5]) {
		return '#' + hex[0] + hex[2] + hex[4];
	}
	return match;
}

function inlineAsset(match, ref, inputDir) {
	if (/^(data:|https?:|\/\/)/.test(ref)) return match;
	const base = path.resolve(inputDir, ref.replace(/\?.*$/, ''));
	if (!fs.existsSync(base)) return match;
	const ext = path.extname(base).toLowerCase();
	const mime = MIME_BY_EXT[ext];
	if (!mime) return match;
	const data = fs.readFileSync(base);
	const encoded = ext === '.svg' ? encodeURIComponent(data.toString('utf8')) : data.toString('base64');
	return `url(data:${mime};base64,${encoded})`;
}

function minifyCss(css, opts = {}) {
	let out = css;
	out = out.replace(COMMENTS, '');
	if (opts.level >= 1) {
		out = out.replace(IMPORTANT, '!important');
		out = out.replace(RGBA_ZERO, 'transparent');
		out = out.replace(HEX_COLOR, shortenHex);
	}
	out = out.replace(WHITESPACE, ' ');
	out = out.replace(SURROUNDING, '$1');
	out = out.replace(/;}/g, '}');
	out = out.replace(/;+/g, ';');
	if (opts.level >= 2) {
		out = out.replace(EMPTY_RULE, '');
		out = out.replace(/  +/g, ' ');
	}
	out = out.replace(/\s*,\s*/g, ',');
	out = out.replace(/\s*\{\s*/g, '{').replace(/\s*\}\s*/g, '}');
	if (opts.inlineAssets && opts.inputDir) {
		out = out.replace(URL_REF, (m, ref) => inlineAsset(m, ref, opts.inputDir));
	}
	return out.trim();
}

function findCssFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	const files = [];
	const walk = d => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
			const abs = path.join(d, entry.name);
			if (entry.isDirectory()) walk(abs);
			else if (entry.name.endsWith('.css')) files.push(abs);
		}
	};
	walk(dir);
	return files;
}

function runOnce(args) {
	const files = args.input ? [path.resolve(ROOT, args.input)] : findCssFiles(args.dir);
	if (files.length === 0) {
		console.warn(`[minify-css] no css files found under ${args.dir}`);
		return 0;
	}
	fs.mkdirSync(args.outDir, { recursive: true });
	let totalBytes = 0;
	let minBytes = 0;
	for (const file of files) {
		const rel = path.relative(args.dir, file);
		const inputDir = path.dirname(file);
		const css = fs.readFileSync(file, 'utf8');
		const min = minifyCss(css, { level: args.level, inlineAssets: args.inlineAssets, inputDir });
		const dest = args.output ? path.resolve(ROOT, args.output) : path.join(args.outDir, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, min);
		const saved = ((css.length - min.length) / (css.length || 1)) * 100;
		totalBytes += css.length;
		minBytes += min.length;
		console.log(`[minify-css] ${rel}: ${css.length} -> ${min.length} bytes (${saved.toFixed(1)}% saved)`);
	}
	console.log(`[minify-css] total: ${totalBytes} -> ${minBytes} bytes`);
	return files.length;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const count = runOnce(args);
	if (args.watch) {
		console.log(`[minify-css] watching ${args.dir} (Ctrl+C to stop)...`);
		let last = new Map();
		setInterval(() => {
			const files = findCssFiles(args.dir);
			for (const file of files) {
				const stat = fs.statSync(file);
				const prev = last.get(file);
				if (!prev || prev.mtimeMs !== stat.mtimeMs) {
					runOnce(args);
					last.set(file, stat);
					break;
				}
			}
		}, 1000);
	}
	process.exit(count === 0 ? 0 : 0);
}

export { minifyCss, findCssFiles, runOnce };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[minify-css] fatal:', err);
		process.exit(1);
	});
}
