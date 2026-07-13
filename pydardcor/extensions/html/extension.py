import json, os

def activate(api):
    api.register_command("html.hello", "html extension active", lambda: api.show_info("html extension loaded"))

def deactivate():
    pass