import json, os

def activate(api):
    api.register_command("markdown-language-features.hello", "Markdown Language Features active", lambda: api.show_info("Markdown Language Features loaded"))

def deactivate():
    pass