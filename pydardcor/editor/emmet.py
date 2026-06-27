"""Emmet Abbreviation Support - Expand HTML/CSS abbreviations."""

import re
from typing import Optional


# Common Emmet abbreviations
EMMET_EXPANSIONS = {
    # HTML shortcuts
    "!": '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>Document</title>\n</head>\n<body>\n\t\n</body>\n</html>',
    "html:5": '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>Document</title>\n</head>\n<body>\n\t\n</body>\n</html>',
    "a": '<a href=""></a>',
    "a:link": '<a href="http://"></a>',
    "a:mail": '<a href="mailto:"></a>',
    "abbr": "<abbr title=\"\"></abbr>",
    "br": "<br />",
    "btn": '<button type="button"></button>',
    "btn:s": '<button type="submit"></button>',
    "btn:r": '<button type="reset"></button>',
    "div": "<div></div>",
    "footer": "<footer></footer>",
    "form": '<form action=""></form>',
    "form:get": '<form action="" method="get"></form>',
    "form:post": '<form action="" method="post"></form>',
    "h1": "<h1></h1>",
    "h2": "<h2></h2>",
    "h3": "<h3></h3>",
    "h4": "<h4></h4>",
    "h5": "<h5></h5>",
    "h6": "<h6></h6>",
    "header": "<header></header>",
    "hr": "<hr />",
    "img": '<img src="" alt="" />',
    "input": '<input type="text" />',
    "input:t": '<input type="text" name="" id="" />',
    "input:p": '<input type="password" name="" id="" />',
    "input:c": '<input type="checkbox" name="" id="" />',
    "input:r": '<input type="radio" name="" id="" />',
    "input:h": '<input type="hidden" name="" />',
    "label": '<label for=""></label>',
    "link": '<link rel="stylesheet" href="" />',
    "link:css": '<link rel="stylesheet" href="style.css" />',
    "main": "<main></main>",
    "meta": '<meta />',
    "meta:utf": '<meta charset="UTF-8" />',
    "meta:vp": '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "nav": "<nav></nav>",
    "ol": "<ol>\n\t<li></li>\n</ol>",
    "p": "<p></p>",
    "script": "<script></script>",
    "script:src": '<script src=""></script>',
    "section": "<section></section>",
    "select": "<select name=\"\" id=\"\">\n\t<option value=\"\"></option>\n</select>",
    "span": "<span></span>",
    "strong": "<strong></strong>",
    "style": "<style></style>",
    "table": "<table>\n\t<tr>\n\t\t<td></td>\n\t</tr>\n</table>",
    "textarea": '<textarea name="" id="" cols="30" rows="10"></textarea>',
    "ul": "<ul>\n\t<li></li>\n</ul>",
    "video": '<video src="" controls></video>',
    # CSS shortcuts
    "pos": "position: ;",
    "pos:r": "position: relative;",
    "pos:a": "position: absolute;",
    "pos:f": "position: fixed;",
    "pos:s": "position: sticky;",
    "d:n": "display: none;",
    "d:b": "display: block;",
    "d:f": "display: flex;",
    "d:g": "display: grid;",
    "d:i": "display: inline;",
    "d:ib": "display: inline-block;",
    "m": "margin: ;",
    "m:0": "margin: 0;",
    "mt": "margin-top: ;",
    "mr": "margin-right: ;",
    "mb": "margin-bottom: ;",
    "ml": "margin-left: ;",
    "p": "padding: ;",
    "pt": "padding-top: ;",
    "pr": "padding-right: ;",
    "pb": "padding-bottom: ;",
    "pl": "padding-left: ;",
    "w": "width: ;",
    "h": "height: ;",
    "bg": "background: ;",
    "bgc": "background-color: ;",
    "c": "color: ;",
    "fz": "font-size: ;",
    "fw": "font-weight: ;",
    "ff": "font-family: ;",
    "ta:c": "text-align: center;",
    "ta:l": "text-align: left;",
    "ta:r": "text-align: right;",
    "jc:c": "justify-content: center;",
    "jc:sb": "justify-content: space-between;",
    "ai:c": "align-items: center;",
    "fd:c": "flex-direction: column;",
    "fw:w": "flex-wrap: wrap;",
    "bd": "border: ;",
    "bdr": "border-radius: ;",
    "bs": "box-shadow: ;",
    "op": "opacity: ;",
    "trf": "transform: ;",
    "trn": "transition: ;",
    "ov:h": "overflow: hidden;",
    "ov:a": "overflow: auto;",
    "cur:p": "cursor: pointer;",
}


def expand_emmet(abbreviation: str, language: str = "html") -> Optional[str]:
    """Expand an Emmet abbreviation to HTML/CSS."""
    abbr = abbreviation.strip()
    if not abbr:
        return None

    # Direct match
    if abbr in EMMET_EXPANSIONS:
        return EMMET_EXPANSIONS[abbr]

    # Tag with class: div.classname
    match = re.match(r'^(\w+)\.(\S+)$', abbr)
    if match:
        tag, cls = match.groups()
        classes = cls.replace(".", " ")
        return f'<{tag} class="{classes}"></{tag}>'

    # Tag with id: div#idname
    match = re.match(r'^(\w+)#(\S+)$', abbr)
    if match:
        tag, id_name = match.groups()
        return f'<{tag} id="{id_name}"></{tag}>'

    # Tag with id and class: div#id.class
    match = re.match(r'^(\w+)#(\w+)\.(\S+)$', abbr)
    if match:
        tag, id_name, cls = match.groups()
        classes = cls.replace(".", " ")
        return f'<{tag} id="{id_name}" class="{classes}"></{tag}>'

    # Multiplication: li*5
    match = re.match(r'^(\w+)\*(\d+)$', abbr)
    if match:
        tag, count = match.groups()
        count = int(count)
        lines = [f"<{tag}></{tag}>" for _ in range(count)]
        return "\n".join(lines)

    # Child: div>p
    match = re.match(r'^(\w+)>(\w+)$', abbr)
    if match:
        parent, child = match.groups()
        return f"<{parent}>\n\t<{child}></{child}>\n</{parent}>"

    # Sibling: div+p
    match = re.match(r'^(\w+)\+(\w+)$', abbr)
    if match:
        first, second = match.groups()
        return f"<{first}></{first}>\n<{second}></{second}>"

    # Simple unknown tag
    if re.match(r'^[a-z][a-z0-9]*$', abbr):
        return f"<{abbr}></{abbr}>"

    return None
