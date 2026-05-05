# Logic Shortcuts Reference

This file keeps a lightweight reference of Logic Pro shortcuts that are useful to CTRLX.
It is intended as a future implementation note for host automation and later AI-driven flows.

## Active Shortcuts For Current CTRLX Import Flow

These are the shortcuts we should actively rely on for the current import workflow:

- `Cmd + Option + N` -> Create a new audio track
- `Cmd + Shift + I` -> Import the extracted audio file
- `Shift + Return` -> Rename the selected track
- `Option + C` -> Open track color controls

## Additional Logic Shortcuts To Keep For Later

- `Cmd + D` -> Duplicate track
- `Cmd + Shift + D` -> Create Track Stack
- `Cmd + Up / Down` -> Open/Close Stack
- `Cmd + Delete` -> Delete track
- `Cmd + T` -> Split region at playhead
- `Cmd + J` -> Join regions
- `Cmd + G` -> Snap on/off
- `Q` -> Quantize selected
- `Cmd + R` -> Repeat region
- `Ctrl + Left / Right` -> Move region fine
- `X` -> Open mixer
- `I` -> Show/Hide Inspector
- `Y` -> Show Library
- `Cmd + click on send` -> Create aux track from send
- `Space` -> Play/Stop
- `R` -> Record
- `Return` -> Go to beginning
- `C` -> Cycle mode on/off
- `U` -> Set cycle to selection
- `K` -> Metronome on/off
- `P` -> Open Piano Roll
- `Cmd + A` -> Select all notes
- `Option + Up / Down` -> Transpose notes
- `Ctrl + R` -> Quick Punch In/Out
- `Ctrl + Z` -> Zoom to fit project
- `B` -> Open Smart Controls

## Notes

- For the current CTRLX batch import flow, only the four shortcuts in "Active Shortcuts For Current CTRLX Import Flow" should be treated as in-scope.
- `Create Track Stack` requires selecting the target tracks first.
- Rename was confirmed by the user as `Shift + Return`.
