import json, os, subprocess

def activate(api):
    api.register_command("notebook-renderers.hello", "Notebook Renderers active", lambda: api.show_info("Notebook Renderers loaded"))

def deactivate():
    pass