import json, os, subprocess

def activate(api):
    api.register_command("search-result.hello", "Search Result active", lambda: api.show_info("Search Result loaded"))

def deactivate():
    pass