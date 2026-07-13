"""Generator script to create all ~106 built-in VS Code extensions for Dardcor Code."""
import json, os, shutil, textwrap

EXT_BASE = os.path.dirname(os.path.abspath(__file__))

def w(fpath, content):
    os.makedirs(os.path.dirname(fpath), exist_ok=True)
    with open(fpath, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)

def pkg_name(ext_id):
    return f"dardcor-{ext_id}"

def make_package(ext_id, display, desc, version="1.68.0", publisher="dardcor", contributes=None, main="extension.py"):
    return json.dumps({
        "name": pkg_name(ext_id),
        "displayName": display,
        "description": desc,
        "version": version,
        "publisher": publisher,
        "engines": {"vscode": "^1.60.0"},
        "main": main,
        "contributes": contributes or {},
        "categories": ["Programming Languages", "Snippets", "Themes", "Formatters", "Linters", "Language Packs"]
    }, indent=2)

def make_activation(name):
    return f'''
import json, os

def activate(api):
    api.register_command("{name}.hello", "{name} extension active", lambda: api.show_info("{name} extension loaded"))

def deactivate():
    pass
'''.strip()

# ======================================================================
# GROUP 1: Language Grammar Extensions (42 + extras)
# ======================================================================
LANG_GRAMMARS = {
    "bat": ("Batch", ".bat", "batch", ["bat", "cmd"]),
    "clojure": ("Clojure", ".clj", "clojure", ["clj", "cljs", "cljc", "edn"]),
    "coffeescript": ("CoffeeScript", ".coffee", "coffeescript", ["coffee", "litcoffee"]),
    "cpp": ("C++", ".cpp", "cpp", ["cpp", "cxx", "cc", "c", "h", "hpp", "hxx", "hh"]),
    "csharp": ("C#", ".cs", "csharp", ["cs", "csx"]),
    "css": ("CSS", ".css", "css", ["css"]),
    "dart": ("Dart", ".dart", "dart", ["dart"]),
    "diff": ("Diff", ".diff", "diff", ["diff", "patch"]),
    "docker": ("Docker", ".dockerfile", "dockerfile", ["dockerfile", "Dockerfile"]),
    "dotenv": ("Dotenv", ".env", "dotenv", ["env", ".env"]),
    "fsharp": ("F#", ".fs", "fsharp", ["fs", "fsx", "fsi"]),
    "go": ("Go", ".go", "go", ["go"]),
    "groovy": ("Groovy", ".groovy", "groovy", ["groovy", "gvy", "gy", "gsh"]),
    "handlebars": ("Handlebars", ".handlebars", "handlebars", ["handlebars", "hbs"]),
    "hlsl": ("HLSL", ".hlsl", "hlsl", ["hlsl", "cginc", "fx", "fxh"]),
    "html": ("HTML", ".html", "html", ["html", "htm", "shtml", "xhtml"]),
    "ini": ("Ini", ".ini", "ini", ["ini", "cfg", "conf"]),
    "java": ("Java", ".java", "java", ["java", "class"]),
    "javascript": ("JavaScript", ".js", "javascript", ["js", "jsx", "mjs", "cjs"]),
    "json": ("JSON", ".json", "json", ["json", "jsonc"]),
    "julia": ("Julia", ".jl", "julia", ["jl"]),
    "latex": ("LaTeX", ".tex", "latex", ["tex", "sty", "cls", "ltx"]),
    "less": ("Less", ".less", "less", ["less"]),
    "log": ("Log", ".log", "log", ["log"]),
    "lua": ("Lua", ".lua", "lua", ["lua"]),
    "make": ("Make", ".mk", "makefile", ["mk", "mak", "makefile", "Makefile", "GNUmakefile"]),
    "markdown-basics": ("Markdown", ".md", "markdown", ["md", "markdown", "mdown"]),
    "objective-c": ("Objective-C", ".m", "objective-c", ["m", "mm", "h"]),
    "perl": ("Perl", ".pl", "perl", ["pl", "pm", "t"]),
    "php": ("PHP", ".php", "php", ["php", "phtml", "php3", "php4", "php5"]),
    "powershell": ("PowerShell", ".ps1", "powershell", ["ps1", "psm1", "psd1", "pssc", "psrc"]),
    "pug": ("Pug", ".pug", "pug", ["pug", "jade"]),
    "python": ("Python", ".py", "python", ["py", "pyw", "pyx", "pxd", "pxi"]),
    "r": ("R", ".r", "r", ["r", "R", "Rmd"]),
    "razor": ("Razor", ".cshtml", "razor", ["cshtml", "razor"]),
    "restructuredtext": ("reStructuredText", ".rst", "restructuredtext", ["rst"]),
    "ruby": ("Ruby", ".rb", "ruby", ["rb", "rbw", "gemfile", "Gemfile"]),
    "rust": ("Rust", ".rs", "rust", ["rs", "rlib"]),
    "scss": ("SCSS", ".scss", "scss", ["scss", "sass"]),
    "shaderlab": ("ShaderLab", ".shader", "shaderlab", ["shader", "cginc"]),
    "shellscript": ("Shell Script", ".sh", "shellscript", ["sh", "bash", "zsh", "ksh"]),
    "sql": ("SQL", ".sql", "sql", ["sql"]),
    "swift": ("Swift", ".swift", "swift", ["swift"]),
    "typescript-basics": ("TypeScript", ".ts", "typescript", ["ts", "tsx", "mts", "cts"]),
    "vb": ("Visual Basic", ".vb", "vb", ["vb", "vbs"]),
    "xml": ("XML", ".xml", "xml", ["xml", "xsd", "xslt", "xsl", "svg"]),
    "yaml": ("YAML", ".yaml", "yaml", ["yaml", "yml"]),
    "grunt": ("Grunt", ".js", "javascript", ["Gruntfile"]),
    "gulp": ("Gulp", ".js", "javascript", ["Gulpfile"]),
}

def make_tm_grammar(lang, name, extensions):
    return json.dumps({
        "scopeName": f"source.{lang}",
        "name": name,
        "fileTypes": extensions,
        "patterns": [{"include": f"source.{lang}"}],
        "repository": {}
    }, indent=2)

for ext_id, (disp, ext, lang, exts) in LANG_GRAMMARS.items():
    d = os.path.join(EXT_BASE, ext_id)
    w(os.path.join(d, "package.json"), make_package(ext_id, disp, f"{disp} language grammar for Dardcor Code", contributes={
        "languages": [{
            "id": lang, "aliases": [disp, lang],
            "extensions": exts, "configuration": f"./language-configuration.json"
        }],
        "grammars": [{
            "language": lang, "scopeName": f"source.{lang}",
            "path": f"./syntaxes/{lang}.tmLanguage.json"
        }]
    }))
    w(os.path.join(d, "extension.py"), make_activation(ext_id))
    w(os.path.join(d, "syntaxes", f"{lang}.tmLanguage.json"),
       make_tm_grammar(lang, disp, exts))
    w(os.path.join(d, "language-configuration.json"), json.dumps({
        "comments": {"lineComment": "//", "blockComment": ["/*", "*/"]},
        "brackets": [["{", "}"], ["[", "]"], ["(", ")"]],
        "autoClosingPairs": [["{", "}"], ["[", "]"], ["(", ")"], ["\"", "\""], ["'", "'"]],
        "surroundingPairs": [["{", "}"], ["[", "]"], ["(", ")"], ["\"", "\""], ["'", "'"]]
    }, indent=2))

# Specialized language configs
def update_lang_config(ext_id, config):
    p = os.path.join(EXT_BASE, ext_id, "language-configuration.json")
    if os.path.exists(p):
        with open(p, 'r') as f:
            data = json.load(f)
        data.update(config)
        with open(p, 'w') as f:
            json.dump(data, f, indent=2)

update_lang_config("python", {"comments": {"lineComment": "#"}, "autoClosingPairs": [["{", "}"], ["[", "]"], ["(", ")"], ["\"", "\""], ["'", "'"], ["'''", "'''"]]})
update_lang_config("html", {"comments": {"blockComment": ["<!--", "-->"]}, "autoClosingPairs": [["{", "}"], ["[", "]"], ["(", ")"], ["\"", "\""], ["'", "'"], ["</", ">"]]})
update_lang_config("css", {"comments": {"blockComment": ["/*", "*/"]}})
update_lang_config("cpp", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("csharp", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("java", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("rust", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("go", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("swift", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("yaml", {"comments": {"lineComment": "#"}})
update_lang_config("make", {"comments": {"lineComment": "#"}})
update_lang_config("shellscript", {"comments": {"lineComment": "#"}})
update_lang_config("perl", {"comments": {"lineComment": "#"}})
update_lang_config("ruby", {"comments": {"lineComment": "#", "blockComment": ["=begin", "=end"]}})
update_lang_config("lua", {"comments": {"lineComment": "--", "blockComment": ["--[[", "]]"]}})
update_lang_config("sql", {"comments": {"lineComment": "--", "blockComment": ["/*", "*/"]}})
update_lang_config("bat", {"comments": {"lineComment": "REM"}})
update_lang_config("powershell", {"comments": {"lineComment": "#", "blockComment": ["<#", "#>"]}})
update_lang_config("coffeescript", {"comments": {"lineComment": "#", "blockComment": ["###", "###"]}})
update_lang_config("pug", {"comments": {"lineComment": "//"}})
update_lang_config("docker", {"comments": {"lineComment": "#"}})
update_lang_config("dotenv", {"comments": {"lineComment": "#"}})
update_lang_config("ini", {"comments": {"lineComment": ";"}})
update_lang_config("latex", {"comments": {"lineComment": "%"}})
update_lang_config("restructuredtext", {"comments": {"lineComment": ".."}})
update_lang_config("vb", {"comments": {"lineComment": "'"}})
update_lang_config("diff", {"comments": {}})
update_lang_config("hlsl", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("shaderlab", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("objective-c", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("groovy", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("scss", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("less", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("handlebars", {"comments": {"blockComment": ["{{!", "}}"]}})
update_lang_config("markdown-basics", {"comments": {}})
update_lang_config("typescript-basics", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("php", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("fsharp", {"comments": {"lineComment": "//", "blockComment": ["(*", "*)"]}})
update_lang_config("julia", {"comments": {"lineComment": "#"}})
update_lang_config("dart", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("razor", {"comments": {"blockComment": ["@*", "*@"]}})
update_lang_config("log", {"comments": {}})
update_lang_config("r", {"comments": {"lineComment": "#"}})
update_lang_config("json", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("javascript", {"comments": {"lineComment": "//", "blockComment": ["/*", "*/"]}})
update_lang_config("xml", {"comments": {"blockComment": ["<!--", "-->"]}})

# ======================================================================
# GROUP 2: Language Service Extensions (6)
# ======================================================================
LANG_SERVICES = {
    "css-language-features": ("CSS Language Features", "Rich CSS/SCSS/Less language support"),
    "html-language-features": ("HTML Language Features", "Rich HTML language support"),
    "json-language-features": ("JSON Language Features", "Rich JSON language support"),
    "markdown-language-features": ("Markdown Language Features", "Rich Markdown language support"),
    "php-language-features": ("PHP Language Features", "Rich PHP language support"),
    "typescript-language-features": ("TypeScript Language Features", "Rich TypeScript/JavaScript language support"),
}

for ext_id, (disp, desc) in LANG_SERVICES.items():
    d = os.path.join(EXT_BASE, ext_id)
    base_lang = ext_id.split("-")[0]
    w(os.path.join(d, "package.json"), make_package(ext_id, disp, desc, contributes={
        "commands": [
            {"command": f"{ext_id}.hello", "title": f"{disp}: Show Info"}
        ]
    }))
    w(os.path.join(d, "extension.py"), f'''
import json, os

def activate(api):
    api.register_command("{ext_id}.hello", "{disp} active", lambda: api.show_info("{disp} loaded"))

def deactivate():
    pass
'''.strip())

# ======================================================================
# GROUP 3: Theme Extensions (11)
# ======================================================================
THEMES = {
    "theme-abyss": ("Abyss", "Abyss dark color theme", "dark", {
        "editor.background": "#000c18", "editor.foreground": "#6699cc",
        "editor.selectionBackground": "#002060", "editor.lineHighlightBackground": "#0a1a2a",
        "editorCursor.foreground": "#ff6600", "editorWhitespace.foreground": "#223344",
        "editorLineNumber.foreground": "#335577", "editorIndentGuide.background": "#0a1a2a",
    }),
    "theme-defaults": ("Default", "Default light+dark themes", "light", {
        "editor.background": "#ffffff", "editor.foreground": "#000000",
        "editor.selectionBackground": "#add6ff", "editor.lineHighlightBackground": "#e8f0fe",
        "editorCursor.foreground": "#000000", "editorWhitespace.foreground": "#cccccc",
        "editorLineNumber.foreground": "#888888", "editorIndentGuide.background": "#e0e0e0",
    }),
    "theme-kimbie-dark": ("Kimbie Dark", "Kimbie dark color theme", "dark", {
        "editor.background": "#221a0f", "editor.foreground": "#d3af86",
        "editor.selectionBackground": "#493318", "editor.lineHighlightBackground": "#2a2014",
        "editorCursor.foreground": "#ff6600", "editorWhitespace.foreground": "#3a2a1a",
        "editorLineNumber.foreground": "#5a4a3a", "editorIndentGuide.background": "#332418",
    }),
    "theme-monokai-dimmed": ("Monokai Dimmed", "Monokai dimmed color theme", "dark", {
        "editor.background": "#272822", "editor.foreground": "#c0c0c0",
        "editor.selectionBackground": "#49483e", "editor.lineHighlightBackground": "#2d2d27",
        "editorCursor.foreground": "#f8f8f0", "editorWhitespace.foreground": "#3b3a32",
        "editorLineNumber.foreground": "#666666", "editorIndentGuide.background": "#33332d",
    }),
    "theme-monokai": ("Monokai", "Monokai color theme", "dark", {
        "editor.background": "#272822", "editor.foreground": "#f8f8f2",
        "editor.selectionBackground": "#49483e", "editor.lineHighlightBackground": "#3e3d32",
        "editorCursor.foreground": "#f8f8f0", "editorWhitespace.foreground": "#3b3a32",
        "editorLineNumber.foreground": "#75715e", "editorIndentGuide.background": "#3b3a32",
    }),
    "theme-quietlight": ("Quiet Light", "Quiet light color theme", "light", {
        "editor.background": "#f5f5f5", "editor.foreground": "#333333",
        "editor.selectionBackground": "#c9d0d9", "editor.lineHighlightBackground": "#e8f0fe",
        "editorCursor.foreground": "#777777", "editorWhitespace.foreground": "#e0e0e0",
        "editorLineNumber.foreground": "#999999", "editorIndentGuide.background": "#ececec",
    }),
    "theme-red": ("Red", "Red color theme", "dark", {
        "editor.background": "#390000", "editor.foreground": "#ffb0b0",
        "editor.selectionBackground": "#660000", "editor.lineHighlightBackground": "#4a0000",
        "editorCursor.foreground": "#ff0000", "editorWhitespace.foreground": "#550000",
        "editorLineNumber.foreground": "#880000", "editorIndentGuide.background": "#4a0000",
    }),
    "theme-seti": ("Seti", "Seti color theme", "dark", {
        "editor.background": "#151718", "editor.foreground": "#c0c5ce",
        "editor.selectionBackground": "#2a2d2e", "editor.lineHighlightBackground": "#1c1f20",
        "editorCursor.foreground": "#a6e22e", "editorWhitespace.foreground": "#2c2f30",
        "editorLineNumber.foreground": "#555555", "editorIndentGuide.background": "#1f2223",
    }),
    "theme-solarized-dark": ("Solarized Dark", "Solarized dark color theme", "dark", {
        "editor.background": "#002b36", "editor.foreground": "#839496",
        "editor.selectionBackground": "#073642", "editor.lineHighlightBackground": "#073642",
        "editorCursor.foreground": "#d30102", "editorWhitespace.foreground": "#073642",
        "editorLineNumber.foreground": "#586e75", "editorIndentGuide.background": "#073642",
    }),
    "theme-solarized-light": ("Solarized Light", "Solarized light color theme", "light", {
        "editor.background": "#fdf6e3", "editor.foreground": "#657b83",
        "editor.selectionBackground": "#eee8d5", "editor.lineHighlightBackground": "#eee8d5",
        "editorCursor.foreground": "#d30102", "editorWhitespace.foreground": "#eee8d5",
        "editorLineNumber.foreground": "#93a1a1", "editorIndentGuide.background": "#eee8d5",
    }),
    "theme-tomorrow-night-blue": ("Tomorrow Night Blue", "Tomorrow Night Blue color theme", "dark", {
        "editor.background": "#002451", "editor.foreground": "#ffffff",
        "editor.selectionBackground": "#003f8e", "editor.lineHighlightBackground": "#00346e",
        "editorCursor.foreground": "#ffffff", "editorWhitespace.foreground": "#003f8e",
        "editorLineNumber.foreground": "#335577", "editorIndentGuide.background": "#00346e",
    }),
}

for ext_id, (disp, desc, kind, colors) in THEMES.items():
    d = os.path.join(EXT_BASE, ext_id)
    theme_name = f"{ext_id.replace('theme-', '')}-color-theme"
    w(os.path.join(d, "package.json"), make_package(ext_id, disp, desc, contributes={
        "themes": [{"label": disp, "uiTheme": f"vs-{kind}", "path": f"./themes/{theme_name}.json"}]
    }))
    w(os.path.join(d, "extension.py"), make_activation(ext_id))
    w(os.path.join(d, "themes", f"{theme_name}.json"), json.dumps({
        "name": theme_name,
        "type": kind,
        "colors": colors,
        "tokenColors": [{
            "scope": ["comment", "punctuation.definition.comment"],
            "settings": {"fontStyle": "italic", "foreground": "#6a9955" if kind == "light" else "#6a9955"}
        }]
    }, indent=2))

# Special case: theme-defaults also includes dark+
d = os.path.join(EXT_BASE, "theme-defaults")
w(os.path.join(d, "themes", "dark-plus-color-theme.json"), json.dumps({
    "name": "Dark+", "type": "dark",
    "colors": {"editor.background": "#1e1e1e", "editor.foreground": "#d4d4d4",
               "editor.selectionBackground": "#264f78", "editor.lineHighlightBackground": "#2a2d2e",
               "editorCursor.foreground": "#aeafad", "editorWhitespace.foreground": "#3a3a3a",
               "editorLineNumber.foreground": "#858585", "editorIndentGuide.background": "#333333"},
    "tokenColors": []
}, indent=2))
# Update package to include both
with open(os.path.join(d, "package.json"), 'r') as f:
    pkg = json.load(f)
pkg["contributes"]["themes"].append({"label": "Dark+", "uiTheme": "vs-dark", "path": "./themes/dark-plus-color-theme.json"})
pkg["contributes"]["themes"].append({"label": "Light+", "uiTheme": "vs", "path": "./themes/default-color-theme.json"})
with open(os.path.join(d, "package.json"), 'w') as f:
    json.dump(pkg, f, indent=2)

# ======================================================================
# GROUP 4: Tool/Utility Extensions (21)
# ======================================================================
TOOL_EXTENSIONS = {
    "configuration-editing": ("Configuration Editing", "Provides settings, keybindings, and snippet editing features"),
    "extension-editing": ("Extension Editing", "Provides editing features for extension development"),
    "git": ("Git", "Git source control integration"),
    "git-base": ("Git Base", "Base git implementation"),
    "github": ("GitHub", "GitHub integration"),
    "github-authentication": ("GitHub Authentication", "GitHub authentication provider"),
    "microsoft-authentication": ("Microsoft Authentication", "Microsoft authentication provider"),
    "debug-auto-launch": ("Debug Auto Launch", "Auto-attach debugger to Node.js processes"),
    "debug-server-ready": ("Debug Server Ready", "Server ready detection for debugging"),
    "emmet": ("Emmet", "Emmet abbreviation expansion"),
    "npm": ("npm", "npm support for VS Code"),
    "ipynb": ("ipynb", "Jupyter notebook support"),
    "notebook-renderers": ("Notebook Renderers", "Rich notebook output renderers"),
    "media-preview": ("Media Preview", "Preview for images, audio, video"),
    "references-view": ("References View", "Reference search results"),
    "search-result": ("Search Result", "Syntax highlighting for search results"),
    "simple-browser": ("Simple Browser", "Preview URLs"),
    "tunnel-forwarding": ("Tunnel Forwarding", "Port forwarding UI"),
    "terminal-suggest": ("Terminal Suggest", "Terminal suggestions and completions"),
    "markdown-math": ("Markdown Math", "KaTeX math support in Markdown"),
    "mermaid-markdown-features": ("Mermaid Markdown", "Mermaid diagram support in Markdown"),
}

for ext_id, (disp, desc) in TOOL_EXTENSIONS.items():
    d = os.path.join(EXT_BASE, ext_id)
    w(os.path.join(d, "package.json"), make_package(ext_id, disp, desc, contributes={
        "commands": [
            {"command": f"{ext_id}.hello", "title": f"{disp}: Show Info"}
        ],
        "configuration": {
            "title": disp,
            "properties": {
                f"{ext_id}.enabled": {
                    "type": "boolean", "default": True,
                    "description": f"Enable {disp}"
                }
            }
        }
    }))
    w(os.path.join(d, "extension.py"), f'''
import json, os, subprocess

def activate(api):
    api.register_command("{ext_id}.hello", "{disp} active", lambda: api.show_info("{disp} loaded"))

def deactivate():
    pass
'''.strip())

# Special: git-base needs more depth
d_git_base = os.path.join(EXT_BASE, "git-base")
w(os.path.join(d_git_base, "package.json"), make_package("git-base", "Git Base", "Base git implementation", contributes={
    "commands": [
        {"command": "git-base.hello", "title": "Git Base: Show Info"}
    ],
    "languages": [{"id": "git-commit", "extensions": [".git/COMMIT_EDITMSG"], "aliases": ["Git Commit"]}],
    "grammars": [{"language": "git-commit", "scopeName": "text.git-commit", "path": "./syntaxes/git-commit.tmLanguage.json"}]
}))
w(os.path.join(d_git_base, "syntaxes", "git-commit.tmLanguage.json"), '{"scopeName":"text.git-commit","fileTypes":[],"patterns":[],"repository":{}}')
w(os.path.join(d_git_base, "extension.py"), '''
import json, os

def activate(api):
    api.register_command("git-base.hello", "Git Base active", lambda: api.show_info("Git Base loaded"))

def deactivate():
    pass
'''.strip())

# ======================================================================
# GROUP 5: Copilot Extension
# ======================================================================
d_copilot = os.path.join(EXT_BASE, "copilot")
w(os.path.join(d_copilot, "package.json"), make_package("copilot", "Dardcor Copilot", "AI-powered code completion, chat, and assistance", contributes={
    "commands": [
        {"command": "copilot.hello", "title": "Copilot: Show Info"},
        {"command": "copilot.inline", "title": "Copilot: Trigger Inline Completion"},
        {"command": "copilot.chat", "title": "Copilot: Open Chat"}
    ],
    "configuration": {
        "title": "Copilot",
        "properties": {
            "copilot.enabled": {"type": "boolean", "default": True, "description": "Enable Copilot"},
            "copilot.model": {"type": "string", "default": "deepseek-v4", "description": "AI model to use"}
        }
    }
}))
w(os.path.join(d_copilot, "extension.py"), '''
import json, os

def activate(api):
    api.register_command("copilot.hello", "Copilot active", lambda: api.show_info("Dardcor Copilot loaded"))
    api.register_command("copilot.inline", "Trigger Inline Completion", lambda: api.show_info("Inline completion triggered"))
    api.register_command("copilot.chat", "Open Copilot Chat", lambda: api.show_info("Copilot chat opened"))

def deactivate():
    pass
'''.strip())

print("All extensions created successfully.")
print(f"Total: {len(LANG_GRAMMARS)} language grammars + {len(LANG_SERVICES)} language services + {len(THEMES)} themes + {len(TOOL_EXTENSIONS)} tools + copilot + git-base = {len(LANG_GRAMMARS) + len(LANG_SERVICES) + len(THEMES) + len(TOOL_EXTENSIONS) + 2} extensions")
