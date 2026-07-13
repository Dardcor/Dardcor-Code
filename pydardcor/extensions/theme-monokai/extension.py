import json, os

def activate(api):
    api.register_command("theme-monokai.hello", "theme-monokai extension active", lambda: api.show_info("theme-monokai extension loaded"))

def deactivate():
    pass