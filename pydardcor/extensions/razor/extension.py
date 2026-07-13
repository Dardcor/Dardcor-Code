import json, os

def activate(api):
    api.register_command("razor.hello", "razor extension active", lambda: api.show_info("razor extension loaded"))

def deactivate():
    pass