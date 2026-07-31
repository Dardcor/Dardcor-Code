/**
 * Dardcor Code - SVG Icon to Custom Icon Font Generator (Task 927)
 *
 * NOTE: This is a graphic placeholder pipeline, NOT a full font builder.
 * It parses an SVG icon directory, assigns each icon a Private Use Area
 * codepoint, emits a mapping JSON plus a CSS stylesheet with a base64
 * placeholder font (structurally valid minimal TTF with empty glyphs).
 * A real production build would replace the placeholder font data with
 * glyph outlines generated from the SVG path data.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_ICON_DIR = path.join(ROOT, 'public', 'icons');
const DEFAULT_OUT = path.join(ROOT, 'dist', 'icon-font');

const PUA_START = 0xE000;
const MAX_ICONS = 0xF8FF - 0xE000 + 1;

function parseArgs(argv) {
	const opt = (name, fallback) => {
		const i = argv.indexOf(name);
		return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
	};
	return {
		dir: path.resolve(ROOT, opt('--dir', DEFAULT_ICON_DIR)),
		out: path.resolve(ROOT, opt('--out', DEFAULT_OUT)),
		fontName: opt('--font-name', 'dc-icons'),
	};
}

function extractSvgPaths(svgText) {
	const paths = [];
	const dRegex = /<path[^>]*\bd="([^"]+)"/g;
	let match;
	while ((match = dRegex.exec(svgText)) !== null) {
		paths.push(match[1]);
	}
	return paths;
}

function readSvgIcons(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter(name => /\.svg$/i.test(name))
		.map(name => {
			const svg = fs.readFileSync(path.join(dir, name), 'utf8');
			return {
				name: name.replace(/\.svg$/i, ''),
				paths: extractSvgPaths(svg),
				raw: svg,
			};
		});
}

/**
 * Builds a minimal structurally-valid TTF with `glyphCount` empty glyphs
 * (glyph 0 = .notdef, glyph 1..n = blank placeholders for the icons).
 * All glyphs are empty so any renderer can load the font, though nothing
 * is drawn - the placeholder's role is to make @font-face resolvable.
 */
function buildPlaceholderTtf(iconCount) {
	const numGlyphs = iconCount + 1;
	const unitsPerEm = 1000;

	const chunks = [];
	const tableData = {};

	// --- head ---
	const head = Buffer.alloc(54);
	head.writeUInt32BE(0x00010000, 0);
	head.writeUInt32BE(0x00010000, 4);   // fontRevision
	head.writeUInt32BE(0, 8);            // checksumAdjustment (patched later)
	head.writeUInt32BE(0x5F0F3CF5, 12);  // magic
	head.writeUInt16BE(0, 16);           // flags
	head.writeUInt16BE(unitsPerEm, 18);
	head.writeInt32BE(0, 24);            // xMin
	head.writeInt32BE(0, 28);            // yMin
	head.writeInt32BE(0, 32);            // xMax
	head.writeInt32BE(0, 36);            // yMax
	head.writeUInt16BE(0, 40);           // macStyle
	head.writeUInt16BE(8, 42);           // lowestRecPPEM
	head.writeInt16BE(2, 44);            // fontDirectionHint
	head.writeInt16BE(0, 46);            // indexToLocFormat (short offsets)
	head.writeInt16BE(0, 48);            // glyphDataFormat
	tableData.head = head;

	// --- hhea ---
	const hhea = Buffer.alloc(36);
	hhea.writeUInt32BE(0x00010000, 0);
	hhea.writeInt16BE(unitsPerEm, 4);    // ascender
	hhea.writeInt16BE(-200, 6);          // descender
	hhea.writeInt16BE(0, 8);             // lineGap
	hhea.writeUInt16BE(500, 10);         // advanceWidthMax
	hhea.writeInt16BE(0, 12);            // minLeftSideBearing
	hhea.writeInt16BE(0, 14);            // minRightSideBearing
	hhea.writeInt16BE(0, 16);            // xMaxExtent
	hhea.writeInt16BE(0, 18);            // caretSlopeRise
	hhea.writeInt16BE(1, 20);            // caretSlopeRun
	hhea.writeInt16BE(0, 22);            // caretOffset
	hhea.writeInt16BE(0, 26);
	hhea.writeInt16BE(0, 28);
	hhea.writeInt16BE(0, 30);
	hhea.writeInt16BE(0, 32);
	hhea.writeInt16BE(numGlyphs, 34);    // numberOfHMetrics
	tableData.hhea = hhea;

	// --- maxp ---
	const maxp = Buffer.alloc(32);
	maxp.writeUInt32BE(0x00010000, 0);
	maxp.writeUInt16BE(numGlyphs, 4);
	maxp.writeUInt16BE(0, 6);  maxp.writeUInt16BE(0, 8);   // maxPoints/maxContours
	maxp.writeUInt16BE(0, 10); maxp.writeUInt16BE(0, 12);  // maxCompositePoints/maxCompositeContours
	maxp.writeUInt16BE(0, 14); maxp.writeUInt16BE(0, 16);  // maxZones/maxTwilightPoints
	maxp.writeUInt16BE(0, 18); maxp.writeUInt16BE(0, 20);  // maxStorage/maxFunctionDefs
	maxp.writeUInt16BE(0, 22); maxp.writeUInt16BE(0, 24);  // maxInstructionDefs/maxStackElements
	maxp.writeUInt16BE(0, 26); maxp.writeUInt16BE(0, 28);  // maxSizeOfInstructions/maxComponentElements
	maxp.writeUInt16BE(0, 30);                             // maxComponentDepth
	tableData.maxp = maxp;

	// --- hmtx: numGlyphs entries of (advance=500, lsb=0) ---
	const hmtx = Buffer.alloc(numGlyphs * 4);
	for (let i = 0; i < numGlyphs; i++) {
		hmtx.writeUInt16BE(500, i * 4);
		hmtx.writeInt16BE(0, i * 4 + 2);
	}
	tableData.hmtx = hmtx;

	// --- loca: short offsets, all glyphs at offset 0 (glyf is empty) ---
	const loca = Buffer.alloc((numGlyphs + 1) * 2);
	tableData.loca = loca;

	// --- glyf: empty ---
	tableData.glyf = Buffer.alloc(0);

	// --- name: no records ---
	const name = Buffer.alloc(6);
	tableData.name = name;

	// --- post ---
	const post = Buffer.alloc(32);
	post.writeUInt32BE(0x00030000, 0);
	post.writeInt32BE(0, 4);   // italicAngle
	post.writeInt16BE(-100, 8); // underlinePosition
	post.writeInt16BE(50, 10); // underlineThickness
	post.writeUInt32BE(0, 12); // isFixedPitch
	post.writeUInt32BE(0, 16); post.writeUInt32BE(0, 20);
	post.writeUInt32BE(0, 24); post.writeUInt32BE(0, 28);
	tableData.post = post;

	// --- cmap: format 4, one segment mapping PUA_START..PUA_START+n-1 ---
	if (iconCount > 0) {
		const firstCp = PUA_START;
		const lastCp = PUA_START + iconCount - 1;
		const segCount = 2; // segment 0: codepoint 0; segment 1: the PUA range
		const segCountX2 = segCount * 2;
		const maxPower = Math.pow(2, Math.floor(Math.log2(segCount)));
		const searchRange = maxPower * 2;
		const entrySelector = Math.log2(maxPower);
		const rangeShift = segCountX2 - searchRange;

		const subtable = Buffer.alloc(16 + segCountX2 * 4 + 2 + 0);
		subtable.writeUInt16BE(4, 0);      // format
		subtable.writeUInt16BE(16 + segCountX2 * 4 + 2, 2); // length
		subtable.writeUInt16BE(0, 4);      // language
		subtable.writeUInt16BE(segCountX2, 6);
		subtable.writeUInt16BE(searchRange, 8);
		subtable.writeUInt16BE(entrySelector, 10);
		subtable.writeUInt16BE(rangeShift, 12);
		// endCode[segCount] then reservedPad then startCode[segCount]
		subtable.writeUInt16BE(0, 14);
		subtable.writeUInt16BE(lastCp, 16);
		subtable.writeUInt16BE(0, 18);     // reservedPad
		subtable.writeUInt16BE(0, 20);     // startCode[0]
		subtable.writeUInt16BE(firstCp, 22);
		// idDelta[segCount]: glyph = (cp + idDelta) mod 65536
		subtable.writeUInt16BE(0, 24);
		subtable.writeUInt16BE((1 - firstCp) & 0xFFFF, 26);
		// idRangeOffset[segCount] = 0 (delta mapping)
		subtable.writeUInt16BE(0, 28);
		subtable.writeUInt16BE(0, 30);

		const cmap = Buffer.alloc(4 + 8 + subtable.length);
		cmap.writeUInt16BE(0, 0);          // version
		cmap.writeUInt16BE(1, 2);          // numTables
		cmap.writeUInt16BE(3, 4);          // platformID (Windows)
		cmap.writeUInt16BE(1, 6);          // encodingID (Unicode BMP)
		cmap.writeUInt32BE(12, 8);         // subtable offset
		subtable.copy(cmap, 12);
		tableData.cmap = cmap;
	} else {
		tableData.cmap = Buffer.alloc(4);
	}

	// --- assemble sfnt ---
	const tags = ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'];
	const offsetTable = Buffer.alloc(12);
	const numTables = tags.length;
	const maxPower = Math.pow(2, Math.floor(Math.log2(numTables)));
	const searchRange = maxPower * 16;
	const entrySelector = Math.log2(maxPower);
	const rangeShift = numTables * 16 - searchRange;
	offsetTable.writeUInt32BE(0x00010000, 0);
	offsetTable.writeUInt16BE(numTables, 4);
	offsetTable.writeUInt16BE(searchRange, 6);
	offsetTable.writeUInt16BE(entrySelector, 8);
	offsetTable.writeUInt16BE(rangeShift, 10);
	chunks.push(offsetTable);

	const tableRecords = [];
	let offset = 12 + numTables * 16;
	for (const tag of tags) {
		const data = tableData[tag];
		tableRecords.push({ tag, data, offset });
		offset += Math.ceil(data.length / 4) * 4;
	}
	for (const rec of tableRecords) {
		const record = Buffer.alloc(16);
		record.write(rec.tag, 0, 4, 'ascii');
		record.writeUInt32BE(checksum(rec.data), 4);
		record.writeUInt32BE(rec.offset, 8);
		record.writeUInt32BE(rec.data.length, 12);
		chunks.push(record);
	}
	for (const rec of tableRecords) {
		chunks.push(rec.data);
		const pad = (4 - (rec.data.length % 4)) % 4;
		if (pad > 0) chunks.push(Buffer.alloc(pad));
	}

	const font = Buffer.concat(chunks);
	// Patch head.checksumAdjustment = 0xB1B0AFBA - sum(all checksums)
	const headRec = tableRecords.find(r => r.tag === 'head');
	let total = 0;
	for (const rec of tableRecords) {
		total = (total + checksum(rec.data)) >>> 0;
	}
	const adjustment = (0xB1B0AFBA - total) >>> 0;
	font.writeUInt32BE(adjustment, headRec.offset + 8);
	return font;
}

function checksum(buffer) {
	const padded = buffer.length % 4 === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4))]);
	let sum = 0;
	for (let i = 0; i < padded.length; i += 4) {
		sum = (sum + padded.readUInt32BE(i)) >>> 0;
	}
	return sum;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const icons = readSvgIcons(args.dir);
	if (icons.length === 0) {
		console.warn(`[generate-icon-font] no svg icons in ${args.dir} - generating empty mapping`);
	} else if (icons.length > MAX_ICONS) {
		console.error(`[generate-icon-font] too many icons (max ${MAX_ICONS})`);
		process.exit(1);
	}
	fs.mkdirSync(args.out, { recursive: true });

	const mapping = {};
	icons.forEach((icon, index) => {
		const codepoint = PUA_START + index;
		mapping[icon.name] = {
			codepoint: `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`,
			glyph: String.fromCodePoint(codepoint),
			pathCount: icon.paths.length,
		};
	});

	const ttf = buildPlaceholderTtf(icons.length);
	const ttfBase64 = ttf.toString('base64');
	// Also emit a WOFF-ish placeholder using deflate (wraps the ttf payload).
	const woffBase64 = zlib.deflateSync(ttf).toString('base64');

	const css = `/**
 * Dardcor Code - Icon Font Stylesheet (generated by generate-icon-font.mjs)
 * NOTE: base64 payload below is a PLACEHOLDER font (empty glyphs) - it
 * exists so @font-face resolves; replace with real outlines in production.
 */
@font-face {
	font-family: '${args.fontName}';
	src: url(data:font/ttf;base64,${ttfBase64}) format('truetype');
	font-weight: normal;
	font-style: normal;
	font-display: block;
}

.dc-icon {
	font-family: '${args.fontName}' !important;
	font-style: normal;
	font-weight: normal;
	line-height: 1;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

${icons.map(icon => `.dc-icon-${icon.name}:before { content: "\\${mapping[icon.name].glyph.codePointAt(0).toString(16).padStart(4, '0')}"; }`).join('\n')}
`;

	fs.writeFileSync(path.join(args.out, 'icons.json'), JSON.stringify({ fontFamily: args.fontName, codepointStart: PUA_START, icons: mapping }, null, '\t'));
	fs.writeFileSync(path.join(args.out, 'icons.css'), css);
	fs.writeFileSync(path.join(args.out, 'placeholder.ttf'), ttf);
	fs.writeFileSync(path.join(args.out, 'placeholder.woff'), zlib.deflateSync(ttf));

	console.log(`[generate-icon-font] parsed ${icons.length} svg icons -> ${args.out}`);
	console.log(`[generate-icon-font] mapping: ${Object.keys(mapping).slice(0, 5).join(', ')}${icons.length > 5 ? ', ...' : ''}`);
	console.log(`[generate-icon-font] placeholder font: ${ttfBase64.length} chars base64 (${(ttf.length / 1024).toFixed(1)} KB)`);
	console.log('[generate-icon-font] NOTE: placeholder graphics only - real glyph outlines need a full font builder');
}

export { extractSvgPaths, readSvgIcons, buildPlaceholderTtf, checksum };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error('[generate-icon-font] fatal:', err);
		process.exit(1);
	});
}
