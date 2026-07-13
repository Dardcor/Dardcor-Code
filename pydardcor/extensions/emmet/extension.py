import json, os, subprocess

def activate(api):
    api.register_command("emmet.hello", "Emmet active", lambda: api.show_info("Emmet loaded"))

def deactivate():
    pass