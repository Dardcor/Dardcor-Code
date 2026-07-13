import json, os

def activate(api):
    api.register_command("hlsl.hello", "hlsl extension active", lambda: api.show_info("hlsl extension loaded"))

def deactivate():
    pass