import json, os

def activate(api):
    api.register_command("theme-abyss.hello", "theme-abyss extension active", lambda: api.show_info("theme-abyss extension loaded"))

def deactivate():
    pass