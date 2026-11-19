/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it } from 'node:test';

/**
 * Test integritas tool Dardcor Code.
 *
 * Test ini mengunci tiga jaminan yang diperbaiki:
 *  1. Tidak ada tool yang mengembalikan hasil fabrikasi (angka/klaim hardcoded).
 *  2. Setiap tool berisiko memiliki mekanisme konfirmasi.
 *  3. Manifest tool konsisten (nol tool yatim, nol referensi dangling).
 */

/**
 * Menemukan root repo dengan berjalan ke atas dari direktori kerja.
 * Dilakukan tanpa `__dirname` / `import.meta` agar test dapat dijalankan
 * baik sebagai CommonJS (tsc) maupun ESM (node --experimental-strip-types).
 */
function findRepoRoot(start: string): string {
	let dir = path.resolve(start);
	for (let i = 0; i < 12; i++) {
		if (fs.existsSync(path.join(dir, 'extensions', 'dardcor', 'package.json'))) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	throw new Error(`Tidak dapat menemukan root repo Dardcor Code dari: ${start}`);
}

const REPO_ROOT = findRepoRoot(process.cwd());
const EXT_ROOT = path.join(REPO_ROOT, 'extensions', 'dardcor');
const TOOLS_NODE = path.join(EXT_ROOT, 'src', 'extension', 'tools', 'node');
const PACKAGE_JSON = path.join(EXT_ROOT, 'package.json');

function readTool(...segments: string[]): string {
	return fs.readFileSync(path.join(TOOLS_NODE, ...segments), 'utf8');
}

/**
 * Membuang komentar agar assertion tidak tertipu oleh penjelasan dokumentasi.
 * Komentar diperbolehkan menyebut pola lama (mis. "sebelumnya mengklaim 0.985");
 * yang dilarang adalah pola tersebut muncul di kode yang dieksekusi.
 */
function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readToolCode(...segments: string[]): string {
	return stripComments(readTool(...segments));
}

describe('Tool Integrity — Zero Fabrication', () => {
	it('swarmConsensusTool tidak boleh mengembalikan skor konsensus hardcoded', () => {
		const src = readTool('swarmConsensusTool.tsx');
		assert.ok(!/0\.985/.test(src), 'skor konsensus 0.985 masih hardcoded');
		assert.ok(!/hallucinationRisk:\s*'0\.00%'/.test(src), 'hallucinationRisk 0.00% masih hardcoded');
		// Harus benar-benar memanggil model melalui chat/completions.
		assert.ok(/chat\/completions/.test(src), 'tool harus memanggil endpoint chat/completions');
	});

	it('visualPerceptualTool tidak boleh mengembalikan metrik accessibility hardcoded', () => {
		const src = readTool('visualPerceptualTool.tsx');
		assert.ok(!/wcagRating:\s*'AAA'/.test(src), "wcagRating 'AAA' masih hardcoded");
		assert.ok(!/contrastRatioAverage:\s*'7\.8:1'/.test(src), 'contrastRatioAverage 7.8:1 masih hardcoded');
		assert.ok(!/targetFrameRate:\s*'60 FPS'/.test(src), 'targetFrameRate 60 FPS masih hardcoded');
	});

	it('omniscientRuntimeSentinelTool tidak boleh mengklaim memindai buffer terminal', () => {
		const src = readTool('omniscientRuntimeSentinelTool.tsx');
		assert.ok(!/No active crash loops or uncaught exceptions detected in terminal buffers/.test(src),
			'masih mengklaim pemindaian buffer terminal yang tidak mungkin dilakukan');
		assert.ok(/bufferAvailable:\s*false/.test(src), 'harus menyatakan bufferAvailable: false secara eksplisit');
	});

	it('securitySynthesizerTool tidak boleh mengklaim auto-patch tanpa menulis', () => {
		const src = readToolCode('securitySynthesizerTool.tsx');
		assert.ok(!/autoPatched:\s*Boolean\(autoPatch\)/.test(src),
			'masih mengklaim autoPatched dari input tanpa melakukan patch');
		assert.ok(/autoPatchSupported:\s*false/.test(src), 'harus menyatakan autoPatchSupported: false');
	});

	it('shadowWorktreeTool tidak boleh mengklaim copy-on-write palsu', () => {
		const src = readToolCode('shadowWorktreeTool.tsx');
		assert.ok(!/copy-on-write/i.test(src), 'masih mengklaim copy-on-write');
		assert.ok(/git['"\s,]+worktree|'worktree'/.test(src), 'harus memakai git worktree nyata');
	});
});

describe('Tool Integrity — Konfirmasi untuk Aksi Berisiko', () => {
	const risky: Array<[string, RegExp]> = [
		['codeModeOrchestratorTool.ts', /confirmationMessages/],
		['osc633TerminalRunnerTool.ts', /confirmationMessages/],
		['shadowSnapshotCheckpointTool.ts', /confirmationMessages/],
		['shadowWorktreeTool.tsx', /confirmationMessages/],
		['securitySynthesizerTool.tsx', /confirmationMessages/],
	];

	for (const [file, pattern] of risky) {
		it(`${file} harus memiliki confirmationMessages`, () => {
			assert.ok(pattern.test(readTool(file)), `${file} tidak memiliki confirmationMessages`);
		});
	}

	it('codeModeOrchestratorTool harus menolak pola escape sandbox vm', () => {
		const src = readTool('codeModeOrchestratorTool.ts');
		assert.ok(/ESCAPE_PATTERNS/.test(src), 'harus memiliki daftar pola escape');
		assert.ok(/constructor\s*\\\.\s*constructor/.test(src) || /constructor\\s\*\\\.\\s\*constructor/.test(src) || src.includes('constructor.constructor'),
			'harus mendeteksi constructor.constructor');
	});

	it('osc633TerminalRunnerTool harus memakai TerminalSecurityGuard', () => {
		const src = readTool('osc633TerminalRunnerTool.ts');
		assert.ok(/TerminalSecurityGuard/.test(src), 'harus memakai TerminalSecurityGuard sebelum spawn');
	});
});

describe('Tool Manifest — Konsistensi Registrasi', () => {
	const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
	const tools: any[] = pkg.contributes.languageModelTools ?? [];
	const toolSets: any[] = pkg.contributes.languageModelToolSets ?? [];

	it('tidak ada tool yatim (tidak masuk toolset mana pun)', () => {
		const inSet = new Set<string>(toolSets.flatMap(s => s.tools ?? []));
		const orphans = tools
			.filter(t => t.toolReferenceName && !inSet.has(t.toolReferenceName))
			.map(t => t.name);
		assert.deepStrictEqual(orphans, [], `tool yatim: ${orphans.join(', ')}`);
	});

	it('setiap tool punya toolReferenceName dan modelDescription memadai', () => {
		for (const t of tools) {
			assert.ok(t.toolReferenceName, `${t.name} tidak punya toolReferenceName`);
			if (t.name === 'dardcor_editFiles') {
				continue; // placeholder yang dikelola workbench
			}
			assert.ok(
				typeof t.modelDescription === 'string' && t.modelDescription.length >= 40,
				`${t.name} modelDescription terlalu pendek`,
			);
		}
	});

	it('todowrite terdaftar di manifest', () => {
		assert.ok(tools.some(t => t.name === 'dardcor_todowrite'), 'dardcor_todowrite tidak terdaftar');
	});

	it('toolset omega tersedia dan memuat tool verifikasi', () => {
		const omega = toolSets.find(s => s.name === 'omega');
		assert.ok(omega, 'toolset omega tidak ada');
		for (const required of ['swarmConsensusMesh', 'securitySynthesizer', 'omniscientRuntimeSentinel']) {
			assert.ok(omega.tools.includes(required), `toolset omega tidak memuat ${required}`);
		}
	});
});
