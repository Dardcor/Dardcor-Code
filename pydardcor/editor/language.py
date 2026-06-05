import os

# Language detection map
LANGUAGE_EXTENSIONS = {
    ".py": "python", ".pyw": "python", ".pyi": "python",
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".jsx": "javascript",
    ".go": "go", ".rs": "rust", ".java": "java",
    ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp",
    ".c": "c", ".h": "c",
    ".cs": "csharp",
    ".html": "html", ".htm": "html",
    ".css": "css", ".scss": "scss", ".sass": "scss", ".less": "less",
    ".json": "json", ".jsonc": "jsonc",
    ".yaml": "yaml", ".yml": "yaml",
    ".md": "markdown", ".mdx": "mdx",
    ".xml": "xml", ".svg": "xml",
    ".sql": "sql",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".bat": "bat", ".cmd": "bat",
    ".ps1": "powershell", ".psm1": "powershell",
    ".toml": "ini", ".ini": "ini", ".cfg": "ini",
    ".rb": "ruby", ".php": "php",
    ".swift": "swift", ".kt": "kotlin",
    ".dart": "dart", ".lua": "lua",
    ".r": "r", ".R": "r",
    ".txt": "plaintext", ".log": "plaintext",
    ".graphql": "graphql", ".gql": "graphql",
    ".vue": "html", ".svelte": "html",
    ".dockerfile": "dockerfile",
    ".tf": "hcl", ".hcl": "hcl",
    ".proto": "proto",
}

LANGUAGE_DISPLAY = {
    "python": "Python", "javascript": "JavaScript", "typescript": "TypeScript",
    "go": "Go", "rust": "Rust", "java": "Java", "cpp": "C++", "c": "C",
    "csharp": "C#", "html": "HTML", "css": "CSS", "scss": "SCSS", "less": "Less",
    "json": "JSON", "jsonc": "JSONC", "yaml": "YAML", "markdown": "Markdown",
    "xml": "XML", "sql": "SQL", "shell": "Shell Script", "bat": "Batch",
    "powershell": "PowerShell", "ini": "TOML/INI", "ruby": "Ruby", "php": "PHP",
    "swift": "Swift", "kotlin": "Kotlin", "dart": "Dart", "lua": "Lua",
    "r": "R", "plaintext": "Plain Text", "graphql": "GraphQL",
    "dockerfile": "Dockerfile", "hcl": "HCL", "proto": "Protocol Buffers",
    "mdx": "MDX",
}

def detect_language(filename):
    name = os.path.basename(filename).lower()
    if name == "dockerfile":
        return "dockerfile"
    if name == "makefile":
        return "makefile"
    ext = os.path.splitext(filename)[1].lower()
    return LANGUAGE_EXTENSIONS.get(ext, "plaintext")
