import json, os

def activate(api):
    api.register_command("rust.hello", "rust extension active", lambda: api.show_info("rust extension loaded"))

def deactivate():
    pass