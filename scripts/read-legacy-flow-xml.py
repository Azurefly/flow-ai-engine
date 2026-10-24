"""Read legacy flow data for the isolated acceptance runner; never execute XML content."""
from pathlib import Path
import hashlib
import json
import sys
import xml.etree.ElementTree as ET


def read_flow(filename):
    path = Path(filename)
    if not path.is_file() or path.stat().st_size > 1_048_576:
        raise ValueError("Flow XML must be a file no larger than 1 MiB")
    data = path.read_bytes()
    text = data.decode("utf-8-sig")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("DTD and entity declarations are not supported")
    root = ET.fromstring(text)
    if root.tag != "flow":
        raise ValueError("Expected a flow document")
    commands = []
    for command in root.findall("./commands/command"):
        commands.append({
            "code": command.get("code"), "name": command.get("name"),
            "targetStatus": command.get("targetstatus"),
            "bindCommands": command.get("bindcommand", "").split(",") if command.get("bindcommand") else [],
            "upperVisible": command.get("upperVisible"),
            "children": [{"flowId": child.get("id"), "inStatus": child.get("instatus"), "targetStatus": child.get("targetstatus"),
                          "outcomes": [dict(item.attrib) for item in child.findall("./outStatus")]}
                         for child in command.findall("./childflow")],
        })
    states = [{"id": state.get("ID"), "name": state.get("name"), "flowStatus": state.get("flowstatus"),
               "views": [{"kind": item.tag, **item.attrib, "commands": [c.get("code") for c in item.findall("./command")]}
                         for item in state if item.tag in ("relation", "assign")]}
              for state in root.findall("./status")]
    if not commands or not states or len({c["code"] for c in commands}) != len(commands) or len({s["id"] for s in states}) != len(states):
        raise ValueError("Missing or duplicate workflow command/state definitions")
    return {"fileName": path.name, "sourceSha256": hashlib.sha256(data).hexdigest(), "sourceBytes": len(data),
            "id": root.get("ID"), "name": root.get("name"), "initialStatus": root.get("defaultStatus"),
            "mWay": root.get("mWay"), "commands": commands, "states": states}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python scripts/read-legacy-flow-xml.py <main.xml> <police.xml>")
    try:
        # ASCII JSON keeps Windows pipe encoding independent of the source document's Chinese text.
        print(json.dumps({"sources": [read_flow(filename) for filename in sys.argv[1:]]}, ensure_ascii=True))
    except (OSError, ValueError, ET.ParseError) as error:
        raise SystemExit(str(error)) from error