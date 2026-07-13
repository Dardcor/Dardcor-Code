import json, os, subprocess

def activate(api):
    api.register_command("tunnel-forwarding.hello", "Tunnel Forwarding active", lambda: api.show_info("Tunnel Forwarding loaded"))

def deactivate():
    pass