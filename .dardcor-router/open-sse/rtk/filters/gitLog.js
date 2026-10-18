import { GIT_LOG_MAX_LINES } from "../constants.js";

export function gitLog(text, maxLines = GIT_LOG_MAX_LINES) {
  if (!text) return "";

  const input = String(text);
  const lines = input.split("\n");
  const out = [];
  let skipped = 0;
  let inCommit = false;
  let subjectSeen = false;

  function pushLine(l) {
    if (out.length < maxLines) {
      out.push(l);
      return true;
    }
    skipped++;
    return false;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (/^commit [0-9a-f]{7,40}$/i.test(trimmed) || /^[*|/\\ ]+commit [0-9a-f]{7,40}/i.test(trimmed)) {
      inCommit = true;
      subjectSeen = false;
      pushLine(line);
      continue;
    }

    if (inCommit) {
      if (/^[*|/\\ ]*(Author|Date):/i.test(trimmed)) {
        pushLine(trimmed);
        continue;
      }
      if (trimmed === "") continue;
      if (!subjectSeen && /^[*|/\\ ]*    \S/.test(line)) {
        pushLine("  Subject: " + trimmed);
        subjectSeen = true;
        continue;
      }
      if (/^\d+ file\w* changed/.test(trimmed)) {
        pushLine("  " + trimmed);
        continue;
      }
      if (/^diff --git /.test(trimmed)) {
        pushLine("  ... diff body omitted");
        continue;
      }
      continue;
    }


    const graphMatch = trimmed.match(/^[*|/\\ ]+([0-9a-f]{7,40}\s+.+)/i);
    if (graphMatch) {
      pushLine(graphMatch[1]);
      continue;
    }

    if (/^[0-9a-f]{7,40}\s+/.test(trimmed)) {
      pushLine(trimmed);
      continue;
    }

    if (/^[*|/\\ ]+$/.test(trimmed) && /[*|/\\]/.test(trimmed)) {
      continue;
    }

    pushLine(trimmed);
  }

  if (skipped > 0) out.push(`... (${skipped} more lines)`);

  const result = out.join("\n");
  if (!result && input) return input;
  if (result.length > input.length) return input;
  return result;
}

gitLog.filterName = "git-log";
