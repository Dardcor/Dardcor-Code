import json, os

def activate(api):
    api.register_command("theme-solarized-light.hello", "theme-solarized-light extension active", lambda: api.show_info("theme-solarized-light extension loaded"))

def deactivate():
    pass