import json, os

def activate(api):
    api.register_command("theme-seti.hello", "theme-seti extension active", lambda: api.show_info("theme-seti extension loaded"))

def deactivate():
    pass