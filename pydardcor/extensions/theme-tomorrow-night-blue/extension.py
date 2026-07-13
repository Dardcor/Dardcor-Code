import json, os

def activate(api):
    api.register_command("theme-tomorrow-night-blue.hello", "theme-tomorrow-night-blue extension active", lambda: api.show_info("theme-tomorrow-night-blue extension loaded"))

def deactivate():
    pass