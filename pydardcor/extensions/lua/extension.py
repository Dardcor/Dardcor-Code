import json, os

def activate(api):
    api.register_command("lua.hello", "lua extension active", lambda: api.show_info("lua extension loaded"))

def deactivate():
    pass