import json, os

def activate(api):
    api.register_command("cpp.hello", "cpp extension active", lambda: api.show_info("cpp extension loaded"))

def deactivate():
    pass