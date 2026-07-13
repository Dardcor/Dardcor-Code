import json, os

def activate(api):
    api.register_command("json.hello", "json extension active", lambda: api.show_info("json extension loaded"))

def deactivate():
    pass