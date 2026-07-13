import json, os

def activate(api):
    api.register_command("html-language-features.hello", "HTML Language Features active", lambda: api.show_info("HTML Language Features loaded"))

def deactivate():
    pass