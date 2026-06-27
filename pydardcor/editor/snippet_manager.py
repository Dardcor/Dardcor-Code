"""Snippet Manager - VS Code style user snippets support."""

import os
import json
from typing import Dict, List, Optional
from ..core.config import get_user_data_dir


SNIPPETS_DIR = os.path.join(get_user_data_dir(), "snippets")


class Snippet:
    """Represents a single code snippet."""

    def __init__(self, name: str, prefix: str, body: List[str], description: str = "", scope: str = ""):
        self.name = name
        self.prefix = prefix
        self.body = body
        self.description = description
        self.scope = scope

    def get_insert_text(self) -> str:
        return "\n".join(self.body)

    def to_dict(self) -> dict:
        return {
            "prefix": self.prefix,
            "body": self.body,
            "description": self.description,
        }


class SnippetManager:
    """Manages user-defined code snippets per language."""

    def __init__(self):
        self._snippets: Dict[str, List[Snippet]] = {}
        os.makedirs(SNIPPETS_DIR, exist_ok=True)
        self._load_all()

    def _load_all(self):
        """Load all snippet files from the snippets directory."""
        if not os.path.isdir(SNIPPETS_DIR):
            return
        for fname in os.listdir(SNIPPETS_DIR):
            if fname.endswith(".json"):
                lang = fname.replace(".json", "")
                self._load_language(lang)

    def _load_language(self, language: str):
        fpath = os.path.join(SNIPPETS_DIR, f"{language}.json")
        if not os.path.exists(fpath):
            return
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                content = f.read()
                # Strip comments (// style)
                lines = [l for l in content.split("\n") if not l.strip().startswith("//")]
                data = json.loads("\n".join(lines))

            snippets = []
            for name, val in data.items():
                prefix = val.get("prefix", name)
                body = val.get("body", [])
                if isinstance(body, str):
                    body = [body]
                desc = val.get("description", "")
                snippets.append(Snippet(name, prefix, body, desc, language))
            self._snippets[language] = snippets
        except Exception:
            pass

    def get_snippets(self, language: str) -> List[Snippet]:
        """Get all snippets for a language."""
        return self._snippets.get(language, [])

    def get_completions_for_prefix(self, language: str, typed: str) -> List[Snippet]:
        """Get snippets whose prefix starts with the typed text."""
        if not typed:
            return []
        result = []
        for snippet in self.get_snippets(language):
            if snippet.prefix.lower().startswith(typed.lower()):
                result.append(snippet)
        # Also check global snippets
        for snippet in self._snippets.get("global", []):
            if snippet.prefix.lower().startswith(typed.lower()):
                result.append(snippet)
        return result

    def add_snippet(self, language: str, name: str, prefix: str, body: List[str], description: str = ""):
        """Add or update a snippet."""
        if language not in self._snippets:
            self._snippets[language] = []

        # Remove existing with same name
        self._snippets[language] = [s for s in self._snippets[language] if s.name != name]
        self._snippets[language].append(Snippet(name, prefix, body, description, language))
        self._save_language(language)

    def remove_snippet(self, language: str, name: str):
        if language in self._snippets:
            self._snippets[language] = [s for s in self._snippets[language] if s.name != name]
            self._save_language(language)

    def _save_language(self, language: str):
        fpath = os.path.join(SNIPPETS_DIR, f"{language}.json")
        data = {}
        for snippet in self._snippets.get(language, []):
            data[snippet.name] = snippet.to_dict()
        os.makedirs(SNIPPETS_DIR, exist_ok=True)
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def create_default_snippets(self):
        """Create default Python snippets if none exist."""
        if "python" not in self._snippets or not self._snippets["python"]:
            defaults = {
                "Print": {"prefix": "print", "body": ["print($1)"], "description": "Print statement"},
                "For Loop": {"prefix": "for", "body": ["for ${1:item} in ${2:iterable}:", "\t$3"], "description": "For loop"},
                "If Statement": {"prefix": "if", "body": ["if ${1:condition}:", "\t$2"], "description": "If statement"},
                "Function": {"prefix": "def", "body": ["def ${1:name}(${2:params}):", '\t"""${3:docstring}"""', "\t${4:pass}"], "description": "Function definition"},
                "Class": {"prefix": "class", "body": ["class ${1:Name}:", '\t"""${2:docstring}"""', "", "\tdef __init__(self${3:, params}):", "\t\t${4:pass}"], "description": "Class definition"},
                "Try Except": {"prefix": "try", "body": ["try:", "\t${1:pass}", "except ${2:Exception} as e:", "\t${3:raise}"], "description": "Try/except block"},
                "With Statement": {"prefix": "with", "body": ["with ${1:expression} as ${2:var}:", "\t${3:pass}"], "description": "With statement"},
                "Main Block": {"prefix": "main", "body": ['if __name__ == "__main__":', "\t${1:main()}"], "description": "Main guard"},
                "List Comprehension": {"prefix": "lc", "body": ["[${1:expr} for ${2:item} in ${3:iterable}]"], "description": "List comprehension"},
                "Lambda": {"prefix": "lambda", "body": ["lambda ${1:args}: ${2:expression}"], "description": "Lambda function"},
            }
            fpath = os.path.join(SNIPPETS_DIR, "python.json")
            os.makedirs(SNIPPETS_DIR, exist_ok=True)
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(defaults, f, indent=2)
            self._load_language("python")

        if "javascript" not in self._snippets or not self._snippets["javascript"]:
            defaults = {
                "Console Log": {"prefix": "cl", "body": ["console.log($1);"], "description": "Console log"},
                "Arrow Function": {"prefix": "af", "body": ["const ${1:name} = (${2:params}) => {", "\t$3", "};"], "description": "Arrow function"},
                "Async Function": {"prefix": "afn", "body": ["async function ${1:name}(${2:params}) {", "\t$3", "}"], "description": "Async function"},
                "For Loop": {"prefix": "for", "body": ["for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {", "\t$3", "}"], "description": "For loop"},
                "Import": {"prefix": "imp", "body": ["import ${1:module} from '${2:path}';"], "description": "ES6 import"},
                "Try Catch": {"prefix": "try", "body": ["try {", "\t$1", "} catch (${2:error}) {", "\t$3", "}"], "description": "Try/catch block"},
            }
            fpath = os.path.join(SNIPPETS_DIR, "javascript.json")
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(defaults, f, indent=2)
            self._load_language("javascript")


_snippet_manager = None

def get_snippet_manager() -> SnippetManager:
    global _snippet_manager
    if _snippet_manager is None:
        _snippet_manager = SnippetManager()
        _snippet_manager.create_default_snippets()
    return _snippet_manager
