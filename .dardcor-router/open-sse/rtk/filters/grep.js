import { GREP_PER_FILE_MAX } from "../constants.js";

export function grep(input) {
  const byFile = new Map();
  let total = 0;

  for (const line of input.split("\n")) {
    const first = line.indexOf(":");
    if (first === -1) continue;
    const second = line.indexOf(":", first + 1);
    if (second === -1) continue;
    const file = line.slice(0, first);
    const lineNumStr = line.slice(first + 1, second);
    const content = line.slice(second + 1);
    if (!/^\d+$/.test(lineNumStr)) continue;
    total++;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push([lineNumStr, content]);
  }

  if (total === 0) return input;

  const files = Array.from(byFile.keys()).sort();
  let out = `${total} matches in ${files.length}F:\n\n`;

  for (const file of files) {
    const matches = byFile.get(file);
    out += `[file] ${file} (${matches.length}):\n`;
    const show = matches.slice(0, GREP_PER_FILE_MAX);
    for (const [lineNum, content] of show) {
      out += `  ${lineNum.padStart(4)}: ${content.trim()}\n`;
    }
    if (matches.length > GREP_PER_FILE_MAX) {
      out += `  +${matches.length - GREP_PER_FILE_MAX}\n`;
    }
    out += "\n";
  }

  return out;
}

grep.filterName = "grep";
