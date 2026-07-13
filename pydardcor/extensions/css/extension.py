import json, os

def activate(api):
    api.register_command("css.hello", "css extension active", lambda: api.show_info("css extension loaded"))

def deactivate():
    pass