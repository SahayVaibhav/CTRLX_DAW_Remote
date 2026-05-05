from __future__ import annotations

import json
import plistlib
import re
import sys
from pathlib import Path


def normalize_label(value: str) -> str:
    label = re.sub(r"\s+", " ", value).strip()
    label = label.replace("Quantze", "Quantize")
    label = label.replace("Rd/Off", "Read/Off")
    label = label.replace("Tch/Rd", "Touch/Read")
    label = label.replace("Clr ", "Clear ")
    label = label.replace("Inst", "Instrument")
    label = label.replace("Drmr", "Drummer")
    label = label.replace("Plug-ins", "Plug-Ins")
    return label


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


def categorize(label: str) -> str:
    lower = label.lower()
    if any(token in lower for token in ["tap", "repeat", "catch", "to end"]):
      return "Transport"
    if any(token in lower for token in ["quantize", "legato", "fade", "event"]):
      return "Editing"
    if any(token in lower for token in ["midi", "audio", "instrument", "drummer", "aux", "output", "track"]):
      return "Tracks"
    if any(token in lower for token in ["ruler", "global", "names", "hide", "view", "navigation"]):
      return "Navigation"
    if any(token in lower for token in ["solo", "mute", "read", "touch", "off", "plug", "prelisten"]):
      return "Mixer"
    if any(token in lower for token in ["automation"]):
      return "Automation"
    return "General"


def parse_catalog(path: Path) -> list[dict[str, object]]:
    with path.open("rb") as file:
        payload = plistlib.load(file)

    short_names = payload.get("KeyCommandShortNames")
    if not isinstance(short_names, dict):
        raise ValueError("KeyCommandShortNames not found in .logikcs file.")

    catalog: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()

    for raw_id, raw_label in sorted(short_names.items(), key=lambda item: int(item[0]) if str(item[0]).isdigit() else str(item[0])):
        if not isinstance(raw_label, str):
            continue

        label = normalize_label(raw_label)
        if not label:
            continue

        command_id = f"logic_kcs.{raw_id}.{slugify(label)}"
        dedupe_key = (str(raw_id), label.lower())
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        catalog.append(
            {
                "id": command_id,
                "logicCommandId": str(raw_id),
                "label": label,
                "shortcut": None,
                "category": categorize(label),
                "source": "logic_kcs",
            }
        )

    return catalog


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: parse_logic_kcs.py <input.logikcs> <output.json>", file=sys.stderr)
        return 1

    input_path = Path(sys.argv[1]).expanduser()
    output_path = Path(sys.argv[2]).expanduser()

    catalog = parse_catalog(input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"Wrote {len(catalog)} commands to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
