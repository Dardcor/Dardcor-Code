import json, os

def activate(api):
    api.register_command("pug.hello", "pug extension active", lambda: api.show_info("pug extension loaded"))

def deactivate():
    pass