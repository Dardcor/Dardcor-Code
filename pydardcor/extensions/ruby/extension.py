import json, os

def activate(api):
    api.register_command("ruby.hello", "ruby extension active", lambda: api.show_info("ruby extension loaded"))

def deactivate():
    pass