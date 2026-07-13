import json, os, subprocess

def activate(api):
    api.register_command("ipynb.hello", "ipynb active", lambda: api.show_info("ipynb loaded"))

def deactivate():
    pass