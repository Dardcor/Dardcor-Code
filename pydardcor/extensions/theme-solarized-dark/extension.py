import json, os

def activate(api):
    api.register_command("theme-solarized-dark.hello", "theme-solarized-dark extension active", lambda: api.show_info("theme-solarized-dark extension loaded"))

def deactivate():
    pass