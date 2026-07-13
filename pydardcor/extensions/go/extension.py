import json, os

def activate(api):
    api.register_command("go.hello", "go extension active", lambda: api.show_info("go extension loaded"))

def deactivate():
    pass