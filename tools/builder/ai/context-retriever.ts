/**
 * Dardcor Code - Workspace Code Vector Search & RAG Context Builder (Task 918)
 *
 * Dependency-free retrieval pipeline for AI context assembly:
 *   - indexes workspace files into line-based chunks
 *   - scores chunks with TF-IDF (term frequency + inverse document frequency)
 *   - optionally refines with exact keyword (regex) queries
 *   - builds a prompt-ready context block bounded by a character budget
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface RetrievalOptions {
	readonly includeGlobs?: readonly string[];
	readonly excludeDirs?: readonly string[];
	readonly maxChunkLines?: number;
	readonly topK?: number;
	readonly maxCharsPerFile?: number;
}

export interface ContextChunk {
	readonly file: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly content: string;
}

export interface ScoredChunk {
	readonly chunk: ContextChunk;
	readonly score: number;
	readonly matchedTerms: number;
}

export interface BuildContextResult {
	readonly context: string;
	readonly chunks: readonly ScoredChunk[];
	readonly totalChars: number;
}

const DEFAULT_EXCLUDE = ['node_modules', 'dist', '.git', 'out', 'release', 'coverage'];
const EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx', '.json', '.css', '.html', '.md', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.sh']);

function tokenize(text: string): string[] {
	return text.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(w => w.length > 1);
}

export class ContextRetriever {
	private _chunks: ContextChunk[] = [];
	private _docFreq = new Map<string, number>();
	private _chunkTerms: string[][] = [];
	private readonly _options: Required<RetrievalOptions>;

	constructor(rootDir: string, options: RetrievalOptions = {}) {
		this._rootDir = rootDir;
		this._options = {
			includeGlobs: options.includeGlobs ?? [],
			excludeDirs: options.excludeDirs ?? DEFAULT_EXCLUDE,
			maxChunkLines: options.maxChunkLines ?? 60,
			topK: options.topK ?? 8,
			maxCharsPerFile: options.maxCharsPerFile ?? 200_000,
		};
	}

	private readonly _rootDir: string;

	private _isExcluded(dir: string): boolean {
		return this._options.excludeDirs.includes(path.basename(dir));
	}

	private _matchesInclude(file: string): boolean {
		if (this._options.includeGlobs.length === 0) return true;
		const rel = file.slice(this._rootDir.length).replace(/\\/g, '/');
		return this._options.includeGlobs.some(glob => {
			const pattern = glob.replace(/\./g, '\\.').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*');
			return new RegExp(`^${pattern}$`).test(rel);
		});
	}

	private async _listFiles(dir: string): Promise<string[]> {
		const files: string[] = [];
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return files;
		}
		for (const entry of entries) {
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!this._isExcluded(abs)) files.push(...await this._listFiles(abs));
			} else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && this._matchesInclude(abs)) {
				files.push(abs);
			}
		}
		return files;
	}

	private _chunkFile(file: string, text: string): ContextChunk[] {
		const chunks: ContextChunk[] = [];
		const lines = text.split('\n');
		for (let start = 0; start < lines.length; start += this._options.maxChunkLines) {
			const end = Math.min(start + this._options.maxChunkLines, lines.length);
			chunks.push({ file, startLine: start + 1, endLine: end, content: lines.slice(start, end).join('\n') });
		}
		return chunks;
	}

	/** Full pipeline: list files -> chunk -> compute TF-IDF index. */
	async indexWorkspace(): Promise<{ files: number; chunks: number }> {
		const files = await this._listFiles(this._rootDir);
		this._chunks = [];
		this._docFreq.clear();
		this._chunkTerms = [];

		const allTerms = new Map<string, Set<number>>();
		for (const file of files) {
			let text: string;
			try {
				text = (await readFile(file, 'utf8')).slice(0, this._options.maxCharsPerFile);
			} catch {
				continue;
			}
			const chunks = this._chunkFile(file, text);
			const baseIndex = this._chunks.length;
			this._chunks.push(...chunks);
			chunks.forEach((_, i) => {
				const terms = new Set(tokenize(chunks[i].content));
				this._chunkTerms[baseIndex + i] = [...terms];
				for (const term of terms) {
					if (!allTerms.has(term)) allTerms.set(term, new Set());
					allTerms.get(term)!.add(baseIndex + i);
				}
			});
		}
		for (const [term, chunkSet] of allTerms) {
			this._docFreq.set(term, chunkSet.size);
		}
		return { files: files.length, chunks: this._chunks.length };
	}

	/** TF-IDF ranked retrieval over the indexed chunks. */
	async retrieve(query: string, topK?: number): Promise<ScoredChunk[]> {
		const k = topK ?? this._options.topK;
		const queryTerms = tokenize(query);
		if (queryTerms.length === 0 || this._chunks.length === 0) return [];
		const totalChunks = Math.max(1, this._chunks.length);

		const scores = this._chunkTerms.map((terms, index) => {
			let score = 0;
			let matched = 0;
			const seen = new Set<string>();
			for (const term of queryTerms) {
				if (seen.has(term)) continue;
				seen.add(term);
				if (terms.includes(term)) {
					const df = this._docFreq.get(term) ?? 0;
					const idf = Math.log((totalChunks + 1) / (df + 1)) + 1;
					score += idf;
					matched++;
				}
			}
			return { index, score, matched };
		});
		scores.sort((a, b) => b.score - a.score || a.index - b.index);
		return scores
			.filter(s => s.score > 0)
			.slice(0, k)
			.map(s => ({ chunk: this._chunks[s.index], score: s.score, matchedTerms: s.matched }));
	}

	/** Builds a prompt-ready context block within a character budget. */
	async buildContext(query: string, maxChars: number = 8000): Promise<BuildContextResult> {
		const ranked = await this.retrieve(query);
		const parts: string[] = [];
		const used: ScoredChunk[] = [];
		let totalChars = 0;
		for (const item of ranked) {
			const header = `${item.chunk.file}:${item.chunk.startLine}-${item.chunk.endLine}`;
			const block = `## ${header}\n\`\`\`\n${item.chunk.content}\n\`\`\``;
			if (totalChars + block.length > maxChars) break;
			parts.push(block);
			used.push(item);
			totalChars += block.length;
		}
		return {
			context: parts.join('\n\n'),
			chunks: used,
			totalChars,
		};
	}

	async searchExact(pattern: string, topK: number = 20): Promise<ContextChunk[]> {
		const regex = new RegExp(pattern, 'g');
		const hits: ContextChunk[] = [];
		for (const chunk of this._chunks) {
			let count = 0;
			regex.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = regex.exec(chunk.content)) !== null) count++;
			if (count > 0) hits.push(chunk);
			if (hits.length >= topK) break;
		}
		return hits;
	}
}
