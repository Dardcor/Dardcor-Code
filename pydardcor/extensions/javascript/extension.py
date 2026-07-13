import json, os

def activate(api):
    api.register_command("javascript.hello", "javascript extension active", lambda: api.show_info("javascript extension loaded"))

def deactivate():
    pass