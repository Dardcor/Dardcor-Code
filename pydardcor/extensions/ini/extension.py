import json, os

def activate(api):
    api.register_command("ini.hello", "ini extension active", lambda: api.show_info("ini extension loaded"))

def deactivate():
    pass