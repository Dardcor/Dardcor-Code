/**
 * Dardcor Code - TextMate Syntax Grammar Compilation Script (Task 904)
 *
 * Reads raw TextMate grammars (*.tmLanguage.json / *.json with a `patterns`
 * root) from a grammars directory, resolves `repository`/`include` references
 * into flattened pattern lists, validates regexes, and writes a compiled
 * grammar JSON that the engine tokenizer can consume without further
 * resolution at runtime.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_SRC = path.join(ROOT, 'src', 'dc', 'engine', 'tokenizer', 'grammars');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'grammars');

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		src: path.resolve(ROOT, opt('--src', DEFAULT_SRC)),
		out: path.resolve(ROOT, opt('--out', DEFAULT_OUT)),
	};
}

function isTmLanguageFile(name) {
	return /\.(tmLanguage|tmLanguage\.json|json)$/.test(name);
}

function validateRegex(regex, scope) {
	// Oniguruma supports a superset of ECMAScript; fall back to a soft check
	// that only rejects clearly malformed patterns (unbalanced groups).
	let depth = 0;
	for (let i = 0; i < regex.length; i++) {
		const ch = regex[i];
		if (ch === '\\') { i++; continue; }
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		if (depth < 0) return false;
	}
	return depth === 0;
}

function resolveInclude(grammar, repository, patterns, visited, pathTrace) {
	const out = [];
	for (const pattern of patterns) {
		if (!pattern || typeof pattern !== 'object') continue;
		if (typeof pattern.include === 'string') {
			let target = pattern.include;
			if (target === '$self') target = '$self';
			else if (target === '$base') target = '$base';
			const key = pathTrace + '->' + target;
			if (visited.has(key)) {
				out.push({ __cycleGuard: target, _include: target });
				continue;
			}
			visited.add(key);
			let resolved;
			if (target === '$self') {
				resolved = grammar.patterns || [];
			} else if (target === '$base') {
				resolved = grammar.patterns || [];
			} else {
				const repoKey = target.startsWith('#') ? target.slice(1) : target;
				const repoPattern = repository[repoKey];
				if (repoPattern) {
					resolved = Array.isArray(repoPattern.patterns) ? repoPattern.patterns : repoPattern ? [repoPattern] : [];
				} else {
					out.push({ __unresolvedInclude: target });
					continue;
				}
			}
			out.push(...resolveInclude(grammar, repository, resolved, visited, key));
			visited.delete(key);
		} else {
			out.push(pattern);
		}
	}
	return out;
}

function compileGrammar(file, name) {
	const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
	const grammar = {
		$schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
		name: raw.name || name,
		scopeName: raw.scopeName || `source.${name}`,
		fileTypes: raw.fileTypes || [],
		repository: raw.repository || {},
		patterns: raw.patterns || [],
	};
	if (grammar.patterns.length === 0 && Object.keys(grammar.repository).length === 0) {
		// Empty grammar - nothing to compile; still emit a valid compiled file.
		grammar.compiled = { empty: true };
		return { grammar, stats: { patterns: 0, repository: 0, includes: 0, errors: 0 } };
	}
	const stats = { patterns: 0, repository: 0, includes: 0, errors: 0 };
	const count = node => {
		if (!node || typeof node !== 'object') return;
		stats.patterns++;
		for (const [key, value] of Object.entries(node)) {
			if (key === 'include') stats.includes++;
			if (typeof value === 'object' && value !== null) {
				if (Array.isArray(value)) value.forEach(count);
				else count(value);
			}
			if (typeof value === 'string' && key === 'match') {
				if (!validateRegex(value, node.scopeName)) {
					stats.errors++;
					console.warn(`[compile-grammars] invalid regex in ${name}: ${value.slice(0, 60)}`);
				}
			}
		}
	};
	// Flatten includes: repository patterns are kept; top-level patterns get
	// their `include` entries resolved inline for fast lookup.
	grammar.compiled = {
		flattenedPatterns: resolveInclude(grammar, grammar.repository, grammar.patterns, new Set(), 'root'),
		repositoryIncludes: Object.keys(grammar.repository),
		compiledAt: new Date().toISOString(),
	};
	// Depth-count representative stats (avoid traversing the flattened tree twice).
	count({ patterns: grammar.patterns, repository: grammar.repository });
	return { grammar, stats };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!fs.existsSync(args.src)) {
		console.warn(`[compile-grammars] source directory not found: ${args.src} (nothing to compile)`);
		process.exit(0);
	}
	fs.mkdirSync(args.out, { recursive: true });
	const files = fs.readdirSync(args.src).filter(isTmLanguageFile);
	if (files.length === 0) {
		console.warn(`[compile-grammars] no grammars found in ${args.src}`);
		process.exit(0);
	}
	let totalErrors = 0;
	const manifest = {};
	for (const file of files) {
		const name = file.replace(/\.(tmLanguage|json)$/, '');
		try {
			const { grammar, stats } = compileGrammar(path.join(args.src, file), name);
			const outFile = path.join(args.out, name + '.json');
			fs.writeFileSync(outFile, JSON.stringify(grammar, null, '\t'));
			manifest[name] = { scopeName: grammar.scopeName, file: outFile, ...stats };
			totalErrors += stats.errors;
			console.log(`[compile-grammars] ${name}: ${stats.patterns} nodes, ${stats.includes} includes, ${stats.errors} regex errors`);
		} catch (err) {
			totalErrors++;
			console.error(`[compile-grammars] FAILED ${name}: ${err.message}`);
		}
	}
	fs.writeFileSync(path.join(args.out, 'grammar-manifest.json'), JSON.stringify(manifest, null, '\t'));
	console.log(`[compile-grammars] compiled ${files.length} grammars -> ${args.out}`);
	process.exit(totalErrors > 0 ? 1 : 0);
}

export { compileGrammar, validateRegex, resolveInclude };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[compile-grammars] fatal:', err);
		process.exit(1);
	});
}
