import json, os

def activate(api):
    api.register_command("julia.hello", "julia extension active", lambda: api.show_info("julia extension loaded"))

def deactivate():
    pass