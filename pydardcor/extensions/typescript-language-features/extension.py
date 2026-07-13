import json, os

def activate(api):
    api.register_command("typescript-language-features.hello", "TypeScript Language Features active", lambda: api.show_info("TypeScript Language Features loaded"))

def deactivate():
    pass