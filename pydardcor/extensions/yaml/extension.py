import json, os

def activate(api):
    api.register_command("yaml.hello", "yaml extension active", lambda: api.show_info("yaml extension loaded"))

def deactivate():
    pass