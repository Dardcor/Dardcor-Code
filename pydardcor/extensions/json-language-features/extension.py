import json, os

def activate(api):
    api.register_command("json-language-features.hello", "JSON Language Features active", lambda: api.show_info("JSON Language Features loaded"))

def deactivate():
    pass