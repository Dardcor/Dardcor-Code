import json, os

def activate(api):
    api.register_command("php-language-features.hello", "PHP Language Features active", lambda: api.show_info("PHP Language Features loaded"))

def deactivate():
    pass