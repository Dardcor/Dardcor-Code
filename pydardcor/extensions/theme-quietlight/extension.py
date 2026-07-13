import json, os

def activate(api):
    api.register_command("theme-quietlight.hello", "theme-quietlight extension active", lambda: api.show_info("theme-quietlight extension loaded"))

def deactivate():
    pass