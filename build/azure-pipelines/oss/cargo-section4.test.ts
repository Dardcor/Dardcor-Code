/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import fs from 'fs';
import path from 'path';
import { isSpdxStub, parseCargoLock, getCrateRepository, crateLicenseRefs } from './scan-licenses.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
	if (cond) {
		passed++;
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.error(`  FAIL ${name}`);
	}
}

console.log('isSpdxStub — known stub bodies (must be TRUE):');

const stubBodies: Array<[string, string]> = [
	['objc2', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-app-kit', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-cloud-kit', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-core-data', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-core-foundation', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-core-graphics', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-foundation', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-io-kit', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-metal', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-quartz-core', 'Zlib OR Apache-2.0 OR MIT'],
	['objc2-encode', 'Zlib OR Apache-2.0 OR MIT'],
	['dispatch2', 'Zlib OR Apache-2.0 OR MIT'],
	['crc-catalog', 'MIT OR Apache-2.0'],
	['linux-keyutils', 'Apache-2.0 OR MIT'],
	['winapi-i686-pc-windows-gnu', 'MIT/Apache-2.0'],
	['winapi-x86_64-pc-windows-gnu', 'MIT/Apache-2.0'],
	['yasna', 'MIT OR Apache-2.0'],
	['encoding_rs', '(Apache-2.0 OR MIT) AND BSD-3-Clause'],
	['nested-leading-paren', '(MIT OR Apache-2.0) AND BSD-3-Clause'],
];
for (const [crate, body] of stubBodies) {
	check(`stub: ${crate} ("${body}")`, isSpdxStub(body) === true);
}

console.log('isSpdxStub — real / non-stub bodies (must be FALSE):');
const isc = `ISC License

Copyright (c) 2004-2010 by Internet Systems Consortium, Inc. ("ISC")

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.`;
const bsd2 = `Copyright (c) 2015, Some Author
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:`;
const zeroBsd = `Zero-Clause BSD

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.`;
const mit = `MIT License

Copyright (c) 2020 Author

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal`;
const prose = 'Permission is hereby granted, free of charge, to any person obtaining a copy';

check('real: ISC body', isSpdxStub(isc) === false);
check('real: BSD-2-Clause body', isSpdxStub(bsd2) === false);
check('real: 0BSD body', isSpdxStub(zeroBsd) === false);
check('real: MIT body', isSpdxStub(mit) === false);
check('real: bare permission prose line', isSpdxStub(prose) === false);
check('real: empty body', isSpdxStub('') === false);
check('real: whitespace only', isSpdxStub('   \n  ') === false);

console.log('parseCargoLock:');
const repoRoot = path.resolve(process.cwd(), '..', '..', '..');
const cliLockPath = path.join(repoRoot, 'cli', 'Cargo.lock');
const win32LockPath = path.join(repoRoot, 'build', 'win32', 'Cargo.lock');

const cliPkgs = parseCargoLock(fs.readFileSync(cliLockPath, 'utf8'));
console.log(`  cli/Cargo.lock: ${cliPkgs.length} packages parsed`);
check('cli: parsed a substantial number of packages (>300)', cliPkgs.length > 300);

const cliNoSource = cliPkgs.filter(p => !p.source);
const cliWithSource = cliPkgs.filter(p => p.source);
console.log(`  cli/Cargo.lock: ${cliNoSource.length} workspace crates (no source), ${cliWithSource.length} with source`);
check('cli: at least one workspace crate (no source) present', cliNoSource.length >= 1);
check('cli: most crates have a source', cliWithSource.length > 300);

const clap = cliPkgs.find(p => p.name === 'clap');
check('cli: clap present with version + registry source', !!clap && /^\d/.test(clap!.version) && !!clap!.source);
const jiff = cliPkgs.find(p => p.name === 'jiff');
check('cli: jiff present with version + registry source', !!jiff && /^\d/.test(jiff!.version) && !!jiff!.source);

const win32Pkgs = parseCargoLock(fs.readFileSync(win32LockPath, 'utf8'));
console.log(`  build/win32/Cargo.lock: ${win32Pkgs.length} packages parsed`);
const slog = win32Pkgs.find(p => p.name === 'slog');
check('win32: slog present with version', !!slog && /^\d/.test(slog!.version));
const term = win32Pkgs.find(p => p.name === 'term');
check('win32: term present with version', !!term && /^\d/.test(term!.version));

check('parse: no malformed names', cliPkgs.every(p => /^[A-Za-z0-9_.-]+$/.test(p.name)));
check('parse: no malformed versions', cliPkgs.every(p => /^[0-9]/.test(p.version)));

console.log('getCrateRepository override map:');
const mk = (id: string) => ({ crate: { id, repository: 'https://example.com/wrong' }, versions: [] });
check('isatty -> dtolnay/isatty', getCrateRepository(mk('isatty')) === 'https://github.com/dtolnay/isatty');
check('redox_syscall -> redox-os/syscall', getCrateRepository(mk('redox_syscall')) === 'https://github.com/redox-os/syscall');
check('redox_termios -> redox-os/termios', getCrateRepository(mk('redox_termios')) === 'https://github.com/redox-os/termios');
check('termion -> redox-os/termion', getCrateRepository(mk('termion')) === 'https://github.com/redox-os/termion');
check('fallback -> crate.repository', getCrateRepository({ crate: { id: 'clap', repository: 'https://github.com/clap-rs/clap' }, versions: [] }) === 'https://github.com/clap-rs/clap');

console.log('crateLicenseRefs:');
const refs = crateLicenseRefs('clap', '4.5.20');
check('refs: v<version> first', refs[0] === 'v4.5.20');
check('refs: <version> second', refs[1] === '4.5.20');
check('refs: <name>-v<version>', refs[2] === 'clap-v4.5.20');
check('refs: <name>-<version>', refs[3] === 'clap-4.5.20');
check('refs: default-branch fallbacks last', refs.includes('main') && refs.includes('master'));

console.log('');
console.log(`=== cargo-section4 unit checks: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
