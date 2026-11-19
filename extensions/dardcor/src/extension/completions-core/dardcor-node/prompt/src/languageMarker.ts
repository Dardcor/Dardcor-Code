/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { DocumentInfo } from './prompt';

interface CommentMarker {
	start: string;
	end: string;
}

interface ILanguageInfo {
	readonly lineComment: CommentMarker;
	readonly markdownLanguageIds?: string[];
}

interface ILanguage extends ILanguageInfo {
	readonly languageId: string;
}

export const languageMarkers: { [language: string]: ILanguageInfo } = {
	abap: {
		lineComment: { start: '"', end: '' },
		markdownLanguageIds: ['abap', 'sap-abap'],
	},
	aspdotnet: {
		lineComment: { start: '<%--', end: '--%>' },
	},
	bat: {
		lineComment: { start: 'REM', end: '' },
	},
	bibtex: {
		lineComment: { start: '%', end: '' },
		markdownLanguageIds: ['bibtex'],
	},
	blade: {
		lineComment: { start: '#', end: '' },
	},
	BluespecSystemVerilog: {
		lineComment: { start: '//', end: '' },
	},
	c: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['c', 'h'],
	},
	clojure: {
		lineComment: { start: ';', end: '' },
		markdownLanguageIds: ['clojure', 'clj'],
	},
	coffeescript: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['coffeescript', 'coffee', 'cson', 'iced'],
	},
	cpp: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['cpp', 'hpp', 'cc', 'hh', 'c++', 'h++', 'cxx', 'hxx'],
	},
	csharp: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['csharp', 'cs'],
	},
	css: {
		lineComment: { start: '/*', end: '*/' },
	},
	cuda: {
		lineComment: { start: '//', end: '' },
	},
	dart: {
		lineComment: { start: '//', end: '' },
	},
	dockerfile: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['dockerfile', 'docker'],
	},
	dotenv: {
		lineComment: { start: '#', end: '' },
	},
	elixir: {
		lineComment: { start: '#', end: '' },
	},
	erb: {
		lineComment: { start: '<%#', end: '%>' },
	},
	erlang: {
		lineComment: { start: '%', end: '' },
		markdownLanguageIds: ['erlang', 'erl'],
	},
	fsharp: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['fsharp', 'fs', 'fsx', 'fsi', 'fsscript'],
	},
	go: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['go', 'golang'],
	},
	graphql: {
		lineComment: { start: '#', end: '' },
	},
	groovy: {
		lineComment: { start: '//', end: '' },
	},
	haml: {
		lineComment: { start: '-#', end: '' },
	},
	handlebars: {
		lineComment: { start: '{{!', end: '}}' },
		markdownLanguageIds: ['handlebars', 'hbs', 'html.hbs', 'html.handlebars'],
	},
	haskell: {
		lineComment: { start: '--', end: '' },
		markdownLanguageIds: ['haskell', 'hs'],
	},
	hlsl: {
		lineComment: { start: '//', end: '' },
	},
	html: {
		lineComment: { start: '<!--', end: '-->' },
		markdownLanguageIds: ['html', 'xhtml'],
	},
	ini: {
		lineComment: { start: ';', end: '' },
	},
	java: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['java', 'jsp'],
	},
	javascript: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['javascript', 'js'],
	},
	javascriptreact: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['jsx'],
	},
	jsonc: {
		lineComment: { start: '//', end: '' },
	},
	jsx: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['jsx'],
	},
	julia: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['julia', 'jl'],
	},
	kotlin: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['kotlin', 'kt'],
	},
	latex: {
		lineComment: { start: '%', end: '' },
		markdownLanguageIds: ['tex'],
	},
	legend: {
		lineComment: { start: '//', end: '' },
	},
	less: {
		lineComment: { start: '//', end: '' },
	},
	lua: {
		lineComment: { start: '--', end: '' },
		markdownLanguageIds: ['lua', 'pluto'],
	},
	makefile: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['makefile', 'mk', 'mak', 'make'],
	},
	markdown: {
		lineComment: { start: '[]: #', end: '' },
		markdownLanguageIds: ['markdown', 'md', 'mkdown', 'mkd'],
	},
	'objective-c': {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['objectivec', 'mm', 'objc', 'obj-c'],
	},
	'objective-cpp': {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['objectivec++', 'objc+'],
	},
	perl: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['perl', 'pl', 'pm'],
	},
	php: {
		lineComment: { start: '//', end: '' },
	},
	powershell: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['powershell', 'ps', 'ps1'],
	},
	pug: {
		lineComment: { start: '//', end: '' },
	},
	python: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['python', 'py', 'gyp'],
	},
	ql: {
		lineComment: { start: '//', end: '' },
	},
	r: {
		lineComment: { start: '#', end: '' },
	},
	razor: {
		lineComment: { start: '<!--', end: '-->' },
		markdownLanguageIds: ['cshtml', 'razor', 'razor-cshtml'],
	},
	ruby: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['ruby', 'rb', 'gemspec', 'podspec', 'thor', 'irb'],
	},
	rust: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['rust', 'rs'],
	},
	sass: {
		lineComment: { start: '//', end: '' },
	},
	scala: {
		lineComment: { start: '//', end: '' },
	},
	scss: {
		lineComment: { start: '//', end: '' },
	},
	shellscript: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['bash', 'sh', 'zsh'],
	},
	slang: {
		lineComment: { start: '//', end: '' },
	},
	slim: {
		lineComment: { start: '/', end: '' },
	},
	solidity: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['solidity', 'sol'],
	},
	sql: {
		lineComment: { start: '--', end: '' },
	},
	stylus: {
		lineComment: { start: '//', end: '' },
	},
	svelte: {
		lineComment: { start: '<!--', end: '-->' },
	},
	swift: {
		lineComment: { start: '//', end: '' },
	},
	systemverilog: {
		lineComment: { start: '//', end: '' },
	},
	terraform: {
		lineComment: { start: '#', end: '' },
	},
	tex: {
		lineComment: { start: '%', end: '' },
	},
	typescript: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['typescript', 'ts'],
	},
	typescriptreact: {
		lineComment: { start: '//', end: '' },
		markdownLanguageIds: ['tsx'],
	},
	vb: {
		lineComment: { start: `'`, end: '' },
		markdownLanguageIds: ['vb', 'vbscript'],
	},
	verilog: {
		lineComment: { start: '//', end: '' },
	},
	'vue-html': {
		lineComment: { start: '<!--', end: '-->' },
	},
	vue: {
		lineComment: { start: '//', end: '' },
	},
	xml: {
		lineComment: { start: '<!--', end: '-->' },
	},
	xsl: {
		lineComment: { start: '<!--', end: '-->' },
	},
	yaml: {
		lineComment: { start: '#', end: '' },
		markdownLanguageIds: ['yaml', 'yml'],
	},
};

const mdLanguageIdToLanguageId: { [markdownLanguageId: string]: string } = {};
for (const [languageId, info] of Object.entries(languageMarkers)) {
	if (info.markdownLanguageIds) {
		for (const mdLanguageId of info.markdownLanguageIds) {
			mdLanguageIdToLanguageId[mdLanguageId] = languageId;
		}
	} else {
		mdLanguageIdToLanguageId[languageId] = languageId;
	}
}

export function mdCodeBlockLangToLanguageId(mdLanguageId: string): string | undefined {
	return mdLanguageIdToLanguageId[mdLanguageId];
}

const defaultCommentMarker: CommentMarker = { start: '//', end: '' };

const dontAddLanguageMarker: string[] = [
	'php',
	'plaintext',
];

// prettier-ignore
const shebangLines: { [language: string]: string } = {
	'html': '<!DOCTYPE html>',
	'python': '#!/usr/bin/env python3',
	'ruby': '#!/usr/bin/env ruby',
	'shellscript': '#!/bin/sh',
	'yaml': '# YAML data'
};

export function isShebangLine(line: string): boolean {
	return Object.values(shebangLines).includes(line.trim());
}

// prettier-ignore
export function hasLanguageMarker({ source }: DocumentInfo): boolean {
	return source.startsWith('#!') || source.startsWith('<!DOCTYPE');
}

export function comment(text: string, languageId: string) {
	const markers = languageMarkers[languageId] ? languageMarkers[languageId].lineComment : defaultCommentMarker;
	if (markers) {
		const end = markers.end === '' ? '' : ' ' + markers.end;
		return `${markers.start} ${text}${end}`;
	}
	return '';
}

export function commentBlockAsSingles(text: string, languageId: string) {
	if (text === '') {
		return '';
	}
	const trailingNewline = text.endsWith('\n');
	const lines = (trailingNewline ? text.slice(0, -1) : text).split('\n');
	const commented = lines.map(line => comment(line, languageId)).join('\n');
	return trailingNewline ? commented + '\n' : commented;
}

export function getLanguageMarker(doc: DocumentInfo): string {
	const { languageId } = doc;
	if (dontAddLanguageMarker.indexOf(languageId) === -1 && !hasLanguageMarker(doc)) {
		if (languageId in shebangLines) {
			return shebangLines[languageId];
		} else {
			return `Language: ${languageId}`;
		}
	}
	return '';
}

export function getPathMarker(doc: DocumentInfo): string {
	if (doc.relativePath) {
		return `Path: ${doc.relativePath}`;
	}
	return '';
}

export function newLineEnded(str: string): string {
	return str === '' || str.endsWith('\n') ? str : str + '\n';
}

export function getLanguage(languageId: string | undefined): ILanguage {
	if (typeof languageId === 'string') {
		return _getLanguage(languageId);
	}
	return _getLanguage('plaintext');
}

function _getLanguage(languageId: string): ILanguage {
	if (languageMarkers[languageId] !== undefined) {
		return { languageId, ...languageMarkers[languageId] };
	} else {
		return { languageId, lineComment: { start: '//', end: '' } };
	}
}
