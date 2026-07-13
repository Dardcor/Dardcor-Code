import json, os

def activate(api):
    api.register_command("typescript-basics.hello", "typescript-basics extension active", lambda: api.show_info("typescript-basics extension loaded"))

def deactivate():
    pass