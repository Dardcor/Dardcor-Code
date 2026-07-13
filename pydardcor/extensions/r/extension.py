import json, os

def activate(api):
    api.register_command("r.hello", "r extension active", lambda: api.show_info("r extension loaded"))

def deactivate():
    pass