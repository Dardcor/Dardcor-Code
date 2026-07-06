"""Built-in Dardcor welcome extension — demonstrates the Python extension API."""


def activate(api):
  api.register_command(
      "showInfo",
      "Show Welcome Message",
      lambda: api.show_info(
          "Dardcor Code extensions are active!\n"
          "Install more from the Extensions sidebar (Ctrl+Shift+X)."
      ),
  )
  api.add_status_bar_item(
      "welcome",
      "Dardcor",
      "Built-in welcome extension",
      "showInfo",
      priority=50,
  )


def deactivate():
  pass
