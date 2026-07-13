import json, os

def activate(api):
    api.register_command("less.hello", "less extension active", lambda: api.show_info("less extension loaded"))

def deactivate():
    pass