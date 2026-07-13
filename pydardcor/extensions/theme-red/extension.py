import json, os

def activate(api):
    api.register_command("theme-red.hello", "theme-red extension active", lambda: api.show_info("theme-red extension loaded"))

def deactivate():
    pass