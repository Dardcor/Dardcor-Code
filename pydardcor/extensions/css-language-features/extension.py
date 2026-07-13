import json, os

def activate(api):
    api.register_command("css-language-features.hello", "CSS Language Features active", lambda: api.show_info("CSS Language Features loaded"))

def deactivate():
    pass