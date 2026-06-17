import re
import logging
from typing import List, Dict, Callable

logger = logging.getLogger(__name__)

class ProblemMatcher:
    """Parses terminal/task output to extract errors and warnings (diagnostics)."""

    def __init__(self):
        # Maps predefined problem matcher names to their regex patterns
        self._matchers = {
            "$tsc": {
                # Example tsc error: test.ts(2,3): error TS2322: Type 'string' is not assignable to type 'number'.
                "pattern": re.compile(r'^(.*)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.*)$'),
                "mapping": {
                    "file": 1,
                    "line": 2,
                    "column": 3,
                    "severity": 4,
                    "code": 5,
                    "message": 6
                }
            },
            "$eslint-stylish": {
                "pattern": re.compile(r'^\s+(\d+):(\d+)\s+(error|warning)\s+(.*)\s+(.*)$'),
                # requires a multi-line state machine in reality
            },
            "$python": {
                # File "script.py", line 10, in <module>
                "pattern": re.compile(r'^  File "(.*)", line (\d+)(?:, in (.*))?$'),
            }
        }
        
        self.on_problem_found: List[Callable[[dict], None]] = []
        
        # State for multi-line matchers
        self._current_file = None

    def process_line(self, line: str, matcher_name: str):
        """Process a single line of output using the specified matcher."""
        if matcher_name not in self._matchers:
            return

        matcher = self._matchers[matcher_name]
        pattern = matcher.get("pattern")
        mapping = matcher.get("mapping")

        if not pattern or not mapping:
            # Handle special cases like python traceback
            self._handle_special(line, matcher_name)
            return

        match = pattern.search(line)
        if match:
            try:
                problem = {
                    "file": match.group(mapping["file"]),
                    "line": int(match.group(mapping["line"])),
                    "column": int(match.group(mapping.get("column", 0))) if "column" in mapping else 1,
                    "severity": match.group(mapping["severity"]).lower() if "severity" in mapping else "error",
                    "code": match.group(mapping.get("code", 0)) if "code" in mapping else "",
                    "message": match.group(mapping["message"]) if "message" in mapping else line.strip(),
                }
                
                for callback in self.on_problem_found:
                    callback(problem)
            except Exception as e:
                logger.error(f"Error parsing problem match: {e}")

    def _handle_special(self, line: str, matcher_name: str):
        if matcher_name == "$python":
            pattern = self._matchers["$python"]["pattern"]
            match = pattern.search(line)
            if match:
                self._current_file = match.group(1)
                self._current_line = int(match.group(2))
            elif self._current_file and line.strip() and not line.startswith(" "):
                # This is likely the error message (e.g. ValueError: something)
                problem = {
                    "file": self._current_file,
                    "line": self._current_line,
                    "column": 1,
                    "severity": "error",
                    "code": "",
                    "message": line.strip()
                }
                for callback in self.on_problem_found:
                    callback(problem)
                
                self._current_file = None
