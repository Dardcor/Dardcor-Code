import json, os

def activate(api):
    api.register_command("restructuredtext.hello", "restructuredtext extension active", lambda: api.show_info("restructuredtext extension loaded"))

def deactivate():
    pass