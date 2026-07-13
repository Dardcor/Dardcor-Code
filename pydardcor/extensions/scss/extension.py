import json, os

def activate(api):
    api.register_command("scss.hello", "scss extension active", lambda: api.show_info("scss extension loaded"))

def deactivate():
    pass