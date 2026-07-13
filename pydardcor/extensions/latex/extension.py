import json, os

def activate(api):
    api.register_command("latex.hello", "latex extension active", lambda: api.show_info("latex extension loaded"))

def deactivate():
    pass