"""Problem Matcher - VS Code style problem matchers for task output parsing.

Supports predefined matchers ($tsc, $eslint-compact, $jshint, etc.),
user-defined matchers from tasks.json, multi-line patterns, background watching patterns,
and watching matchers.
"""

import os
import re
import logging
from typing import List, Dict, Optional, Callable, Any

logger = logging.getLogger(__name__)


# ---- Built-in matchers ----

PREDEFINED_MATCHERS = {
    "$tsc": {
        "pattern": re.compile(
            r'^(.*)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.*)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "severity": 4,
            "code": 5,
            "message": 6,
        },
    },
    "$tsc-watch": {
        "pattern": re.compile(
            r'^(.*)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.*)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "severity": 4,
            "code": 5,
            "message": 6,
        },
        "background": {
            "beginsPattern": re.compile(r'Starting compilation in watch mode'),
            "endsPattern": re.compile(r'File change detected|Watching for file changes'),
        },
    },
    "$eslint-compact": {
        "pattern": re.compile(
            r'^(.*):\s+line\s+(\d+),\s+col\s+(\d+),\s+(Error|Warning)\s+-\s+(.*)\s+\((.*)\)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "severity": 4,
            "message": 5,
            "code": 6,
        },
    },
    "$eslint-stylish": {
        "pattern": re.compile(
            r'^\s+(\d+):(\d+)\s+(error|warning)\s+(.*)\s+(.*)$'
        ),
    },
    "$eslint-stylish7": {
        "pattern": re.compile(
            r'^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s+\((.*)\))?$'
        ),
        "mapping": {
            "line": 1,
            "column": 2,
            "severity": 3,
            "message": 4,
            "code": 5,
        },
    },
    "$jshint": {
        "pattern": re.compile(
            r'^(.*):\s+line\s+(\d+),\s+col\s+(\d+),\s+(.*)\s+\((E|W)\)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "message": 4,
            "code": 5,
        },
    },
    "$jslint": {
        "pattern": re.compile(
            r'^(.*)\((\d+)\):\s+(error|warning)\s+(.*)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "severity": 3,
            "message": 4,
        },
    },
    "$go": {
        "pattern": re.compile(
            r'^(.*):(\d+):(\d+):\s+(.*)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "message": 4,
        },
    },
    "$csc": {
        "pattern": re.compile(
            r'^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(CS\d+):\s+(.*)'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "severity": 4,
            "code": 5,
            "message": 6,
        },
    },
    "$less": {
        "pattern": re.compile(
            r'^(.*):(\d+):(\d+)\s+(error|warning):\s+(.*)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "severity": 4,
            "message": 5,
        },
    },
    "$sass": {
        "pattern": re.compile(
            r'^(.*):(\d+):(\d+)\s+(error|warning):\s+(.*)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "severity": 4,
            "message": 5,
        },
    },
    "$typescript": {
        "pattern": re.compile(
            r'^(.*)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.*)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "severity": 4,
            "code": 5,
            "message": 6,
        },
    },
    "$python": {
        "pattern": re.compile(
            r'^  File "(.*)", line (\d+)(?:, in (.*))?$'
        ),
    },
    "$rustc": {
        "pattern": re.compile(
            r'^(.*):(\d+):(\d+):\s+(\d+:\d+\s+error|error|warning):\s+(.*)$'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "column": 3,
            "severity": 4,
            "message": 5,
        },
    },
    "$mscompile": {
        "pattern": re.compile(
            r'^(.*)\((\d+)\):\s+(error|warning)\s+(\w+\s*\d+):\s+(.*)'
        ),
        "mapping": {
            "file": 1,
            "line": 2,
            "severity": 3,
            "code": 4,
            "message": 5,
        },
    },
}


class BackgroundMonitor:
    """Tracks background/begins/ends patterns for watching matchers."""

    def __init__(self, bg_config: dict):
        self.active = False
        self.begins_pattern = None
        self.ends_pattern = None
        if bg_config:
            begins = bg_config.get("beginsPattern")
            ends = bg_config.get("endsPattern")
            if begins:
                self.begins_pattern = re.compile(begins) if isinstance(begins, str) else begins
            if ends:
                self.ends_pattern = re.compile(ends) if isinstance(ends, str) else ends

    def process_line(self, line: str) -> bool:
        """Returns True if the background state changed."""
        if not self.active and self.begins_pattern:
            if self.begins_pattern.search(line):
                self.active = True
                return True
        if self.active and self.ends_pattern:
            if self.ends_pattern.search(line):
                self.active = False
                return True
        return False


class MultiLineStateMachine:
    """Handles multi-line problem matcher patterns (loop: true)."""

    def __init__(self, pattern: dict):
        self.pattern = pattern
        self.buffer = []
        self.current_file = None
        self.current_line = None
        self.current = {}

    def process_line(self, line: str) -> Optional[dict]:
        """Process a line and return a problem dict if a complete match is formed."""
        pat = self.pattern.get("pattern")
        if not pat:
            return None
        if isinstance(pat, list):
            return self._process_multi_pattern(line)
        return self._process_single(line)

    def _process_single(self, line: str) -> Optional[dict]:
        pat = self.pattern.get("pattern")
        if isinstance(pat, str):
            pat = re.compile(pat)
        mapping = self.pattern.get("mapping")
        if not pat or not mapping:
            return None

        match = pat.search(line)
        if not match:
            return None

        try:
            problem = {
                "file": match.group(mapping.get("file", 0)) if "file" in mapping else "",
                "line": int(match.group(mapping["line"])) if "line" in mapping else 1,
                "column": int(match.group(mapping.get("column", 0))) if "column" in mapping and match.group(mapping["column"]) else 1,
                "severity": match.group(mapping.get("severity", 0)).lower() if "severity" in mapping else "error",
                "code": match.group(mapping.get("code", 0)) if "code" in mapping and match.group(mapping["code"]) else "",
                "message": match.group(mapping.get("message", 0)) if "message" in mapping else line.strip(),
                "location": match.group(mapping.get("location", 0)) if "location" in mapping else "",
            }
            return problem
        except Exception as e:
            logger.error(f"Error parsing problem match: {e}")
            return None

    def _process_multi_pattern(self, line: str) -> Optional[dict]:
        """Handle loop: true patterns (multiple sub-patterns)."""
        patterns = self.pattern.get("pattern", [])
        if not patterns:
            return None

        first = patterns[0]
        if isinstance(first, dict):
            regexp = first.get("regexp", "")
            if isinstance(regexp, str):
                regexp = re.compile(regexp)
            match = regexp.search(line)
            if match:
                self.current = {}
                for key, idx in first.items():
                    if key != "regexp":
                        try:
                            self.current[key] = match.group(idx) if idx else ""
                        except (IndexError, TypeError):
                            pass
                self.buffer = [self.current.copy()]
                return None

        for sub_pat in patterns[1:]:
            regexp = sub_pat.get("regexp", "")
            if isinstance(regexp, str):
                regexp = re.compile(regexp)
            match = regexp.search(line)
            if match:
                merged = self.current.copy()
                for key, idx in sub_pat.items():
                    if key != "regexp":
                        try:
                            merged[key] = match.group(idx) if idx else ""
                        except (IndexError, TypeError):
                            pass
                self.buffer.append(merged.copy())
                if self.pattern.get("loop", False):
                    merged = self.buffer[-1]
                    return self._build_problem(merged)

        return None

    def _build_problem(self, data: dict) -> dict:
        file = data.get("file", "")
        line_val = data.get("line", 1)
        if isinstance(line_val, str):
            try:
                line_val = int(line_val)
            except ValueError:
                line_val = 1
        col_val = data.get("column", 1)
        if isinstance(col_val, str):
            try:
                col_val = int(col_val)
            except ValueError:
                col_val = 1
        severity = data.get("severity", "error").lower()
        if severity not in ("error", "warning", "info"):
            severity = "error"
        return {
            "file": file,
            "line": line_val,
            "column": col_val,
            "severity": severity,
            "code": data.get("code", ""),
            "message": data.get("message", ""),
        }


class ProblemMatcher:
    """Parses terminal/task output to extract errors and warnings (diagnostics).

    Supports:
    - All VS Code predefined matchers
    - User-defined matchers from tasks.json
    - Multi-line patterns (loop: true)
    - Background watching patterns
    - File location resolution relative to workspace
    """

    def __init__(self, workspace_path: str = ""):
        self._workspace = workspace_path
        self._matchers: Dict[str, dict] = {}
        self._user_matchers: Dict[str, dict] = {}
        self._background_monitors: Dict[str, BackgroundMonitor] = {}
        self._state_machines: Dict[str, MultiLineStateMachine] = {}
        self._python_state = {"current_file": None, "current_line": None, "current_column": 1}
        self._severity_map = {
            "error": "error",
            "warning": "warning",
            "warn": "warning",
            "information": "info",
            "info": "info",
            "hint": "info",
            "note": "info",
        }
        self.on_problem_found: List[Callable[[dict], None]] = []
        self._init_predefined()

    def _init_predefined(self):
        for name, config in PREDEFINED_MATCHERS.items():
            self._register_predefined(name, config)

    def _register_predefined(self, name: str, config: dict):
        self._matchers[name] = config
        bg = config.get("background")
        if bg:
            self._background_monitors[name] = BackgroundMonitor(bg)

    def set_workspace(self, path: str):
        self._workspace = path

    def register_user_matcher(self, name: str, config: dict):
        """Register a user-defined problem matcher from tasks.json."""
        self._user_matchers[name] = config
        pattern_cfg = config.get("pattern", {})
        if isinstance(pattern_cfg, dict):
            if pattern_cfg.get("regexp"):
                if pattern_cfg.get("kind") == "multi-line":
                    self._state_machines[name] = MultiLineStateMachine(pattern_cfg)
                else:
                    pat = re.compile(pattern_cfg["regexp"])
                    self._matchers[name] = {
                        "pattern": pat,
                        "mapping": {
                            k: int(v) if v else 0
                            for k, v in pattern_cfg.items() if k != "regexp" and v
                        },
                    }
            elif pattern_cfg.get("pattern"):
                patterns = pattern_cfg["pattern"]
                if isinstance(patterns, list):
                    self._state_machines[name] = MultiLineStateMachine(pattern_cfg)

        bg = config.get("background")
        if bg:
            self._background_monitors[name] = BackgroundMonitor(bg)

    def register_matchers_from_task(self, task_data: dict):
        """Register problem matchers defined in a task's configuration."""
        matchers = task_data.get("problemMatcher", [])
        if isinstance(matchers, str):
            matchers = [matchers]
        elif isinstance(matchers, dict):
            matchers = [matchers]

        for entry in matchers:
            if isinstance(entry, dict):
                base = entry.get("base", "")
                if base and base in PREDEFINED_MATCHERS:
                    self._register_predefined(base, {**PREDEFINED_MATCHERS[base], **entry})
                name = entry.get("name", base or "__inline__")
                self.register_user_matcher(name, entry)

    def process_line(self, line: str, matcher_name: str, task_label: str = ""):
        """Process a single line of output using the specified matcher.

        Returns any problems found, and emits them via on_problem_found callback.
        """
        problems = []

        if not matcher_name:
            return problems

        bg_monitor = self._background_monitors.get(matcher_name)
        if bg_monitor:
            bg_monitor.process_line(line)

        multi = self._state_machines.get(matcher_name)
        if multi:
            result = multi.process_line(line)
            if result:
                result["task"] = task_label
                self._resolve_file(result)
                problems.append(result)
                for cb in self.on_problem_found:
                    cb(result)
            return problems

        if matcher_name == "$python":
            result = self._process_python(line)
            if result:
                problems.append(result)
                for cb in self.on_problem_found:
                    cb(result)
            return problems

        matcher = self._matchers.get(matcher_name) or self._user_matchers.get(matcher_name)
        if not matcher:
            # Try base name fallback
            for key in self._matchers:
                if matcher_name.startswith(key):
                    matcher = self._matchers[key]
                    break
            if not matcher:
                for key in self._user_matchers:
                    if matcher_name.startswith(key):
                        matcher = self._user_matchers[key]
                        break
        if not matcher:
            return problems

        pattern = matcher.get("pattern")
        mapping = matcher.get("mapping")

        if not pattern:
            return problems
        if isinstance(pattern, str):
            pattern = re.compile(pattern)

        if mapping:
            match = pattern.search(line)
            if match:
                try:
                    def safe_group(idx, default=""):
                        if idx is None or idx == 0:
                            return default
                        try:
                            return match.group(idx) or default
                        except (IndexError, AttributeError):
                            return default

                    severity_raw = safe_group(mapping.get("severity"), "error")
                    severity = self._severity_map.get(severity_raw.lower(), "error")

                    file_val = safe_group(mapping.get("file"), "")
                    line_val = safe_group(mapping.get("line"), "1")
                    col_val = safe_group(mapping.get("column"), "1")
                    code_val = safe_group(mapping.get("code"), "")
                    msg_val = safe_group(mapping.get("message"), line.strip())

                    try:
                        line_int = int(line_val)
                    except (ValueError, TypeError):
                        line_int = 1
                    try:
                        col_int = int(col_val)
                    except (ValueError, TypeError):
                        col_int = 1

                    problem = {
                        "file": file_val,
                        "line": line_int,
                        "column": col_int,
                        "severity": severity,
                        "code": code_val,
                        "message": msg_val,
                        "task": task_label,
                    }
                    self._resolve_file(problem)
                    problems.append(problem)
                    for cb in self.on_problem_found:
                        cb(problem)
                except Exception as e:
                    logger.error(f"Error parsing problem match with matcher {matcher_name}: {e}")
        else:
            match = pattern.search(line)
            if match:
                problem = {
                    "file": match.group(1) if match.lastindex >= 1 else "",
                    "line": int(match.group(2)) if match.lastindex >= 2 else 1,
                    "column": 1,
                    "severity": "error",
                    "code": "",
                    "message": line.strip(),
                    "task": task_label,
                }
                self._resolve_file(problem)
                problems.append(problem)
                for cb in self.on_problem_found:
                    cb(problem)

        return problems

    def _process_python(self, line: str) -> Optional[dict]:
        """Handle Python traceback output specially."""
        pat = PREDEFINED_MATCHERS["$python"]["pattern"]
        match = pat.search(line)
        if match:
            self._python_state["current_file"] = match.group(1)
            try:
                self._python_state["current_line"] = int(match.group(2))
            except ValueError:
                self._python_state["current_line"] = 1
            return None
        elif self._python_state["current_file"] and line.strip() and not line.startswith(" "):
            problem = {
                "file": self._python_state["current_file"],
                "line": self._python_state["current_line"],
                "column": 1,
                "severity": "error",
                "code": "",
                "message": line.strip(),
                "task": "",
            }
            self._resolve_file(problem)
            self._python_state["current_file"] = None
            self._python_state["current_line"] = None
            return problem
        return None

    def _resolve_file(self, problem: dict):
        """Resolve file paths relative to workspace."""
        f = problem.get("file", "")
        if not f:
            return
        if self._workspace and not os.path.isabs(f):
            abs_path = os.path.join(self._workspace, f)
            if os.path.exists(abs_path):
                problem["file"] = os.path.normpath(abs_path)
            elif os.path.exists(f):
                problem["file"] = os.path.normpath(f)

    def get_background_active(self, matcher_name: str) -> bool:
        """Check if a background watching matcher is currently active."""
        monitor = self._background_monitors.get(matcher_name)
        if monitor:
            return monitor.active
        return False

    def is_background_matcher(self, matcher_name: str) -> bool:
        return matcher_name in self._background_monitors

    def clear_state(self):
        self._python_state = {"current_file": None, "current_line": None, "current_column": 1}
        for name, sm in self._state_machines.items():
            sm.buffer.clear()
            sm.current = {}
