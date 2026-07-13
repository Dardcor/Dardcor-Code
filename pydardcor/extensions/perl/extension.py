import json, os

def activate(api):
    api.register_command("perl.hello", "perl extension active", lambda: api.show_info("perl extension loaded"))

def deactivate():
    pass