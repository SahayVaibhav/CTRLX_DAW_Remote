from __future__ import annotations

import json
import sys
from pathlib import Path


KNOWN_EXECUTION_MAP = {
    "create session": {
        "ctrlxCommandId": "session.open_logic",
        "executionType": "applescript",
        "shortcut": None,
    },
    "open logic": {
        "ctrlxCommandId": "session.open_logic",
        "executionType": "applescript",
        "shortcut": None,
    },
    "play / stop": {
        "ctrlxCommandId": "transport.play_stop",
        "executionType": "keystroke",
        "shortcut": "Space",
    },
    "play stop": {
        "ctrlxCommandId": "transport.play_stop",
        "executionType": "keystroke",
        "shortcut": "Space",
    },
    "save": {
        "ctrlxCommandId": "session.save",
        "executionType": "keystroke",
        "shortcut": "Cmd+S",
    },
    "save project": {
        "ctrlxCommandId": "session.save",
        "executionType": "keystroke",
        "shortcut": "Cmd+S",
    },
    "undo": {
        "ctrlxCommandId": "edit.undo",
        "executionType": "keystroke",
        "shortcut": "Cmd+Z",
    },
    "mute selected track": {
        "ctrlxCommandId": "track.mute_selected",
        "executionType": "keystroke",
        "shortcut": "M",
    },
    "solo selected track": {
        "ctrlxCommandId": "track.solo_selected",
        "executionType": "keystroke",
        "shortcut": "S",
    },
    "arm selected track": {
        "ctrlxCommandId": "track.arm_selected",
        "executionType": "keystroke",
        "shortcut": "R",
    },
    "bounce project": {
        "ctrlxCommandId": "session.bounce",
        "executionType": "keystroke",
        "shortcut": "Cmd+B",
    },
}


def normalize(value: str) -> str:
    return " ".join(value.lower().strip().replace("/", " / ").split())


def map_catalog(input_path: Path, output_path: Path) -> list[dict[str, object]]:
    items = json.loads(input_path.read_text(encoding="utf-8"))
    mapped: list[dict[str, object]] = []

    for item in items:
        label = str(item.get("label", "")).strip()
        shortcut = item.get("shortcut")
        entry = KNOWN_EXECUTION_MAP.get(normalize(label))

        mapped.append(
            {
                "id": item["id"],
                "logicCommandId": item.get("logicCommandId"),
                "label": label,
                "shortcut": shortcut if shortcut is not None else (entry["shortcut"] if entry else None),
                "category": item.get("category"),
                "source": item.get("source", "logic_kcs"),
                "executable": bool(entry),
                "executionType": entry["executionType"] if entry else "unknown",
                "ctrlxCommandId": entry["ctrlxCommandId"] if entry else None,
            }
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(mapped, indent=2), encoding="utf-8")
    return mapped


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: map_logic_kcs_to_ctrlx.py <catalog.json> <output.json>", file=sys.stderr)
        return 1

    input_path = Path(sys.argv[1]).expanduser()
    output_path = Path(sys.argv[2]).expanduser()
    mapped = map_catalog(input_path, output_path)
    executable_count = sum(1 for item in mapped if item["executable"])
    print(f"Wrote {len(mapped)} mapped commands to {output_path} ({executable_count} executable)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
