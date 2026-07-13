import json, os

def activate(api):
    api.register_command("theme-defaults.hello", "theme-defaults extension active", lambda: api.show_info("theme-defaults extension loaded"))

def deactivate():
    pass