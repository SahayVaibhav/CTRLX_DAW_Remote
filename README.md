# CTRLX

CTRLX is a real-time remote control and automation system for Logic Pro, turning any phone or tablet into a touch-driven control surface with live monitoring and intelligent session workflows.

---

## 🚀 Overview

CTRLX enables remote interaction with Logic Pro through a distributed architecture:

- Electron-based host application (macOS)
- React + TypeScript web client (mobile/tablet friendly)
- WebSocket-based communication layer

It combines:
- live screen streaming
- touch-based control
- structured command execution
- session automation

---

## ✨ Features

### 🎥 Live DAW Monitoring
- Real-time Logic Pro screen streaming
- Fullscreen viewing on mobile devices

### 🖱️ Remote Control
- Cursor movement via touch
- Tap, drag, and gesture interaction
- Phone/tablet as control surface

### ⚙️ Command System
- Structured command registry
- Macro support
- Host-side execution
- AppleScript-based Logic control

### 🎛️ Touch Interface
- Mobile-first UI built with React + Tailwind
- Fast, responsive interaction over LAN

### 📦 Import Automation (In Progress)
- Host-side file selection (zip/audio)
- File discovery + categorization
- Client-side review workflow
- Automated:
  - track creation
  - renaming
  - color coding
  - session organization

---

## 🏗️ Architecture

### Host (macOS)
- Electron + TypeScript
- Handles:
  - DAW automation (AppleScript)
  - screen capture/streaming
  - command execution
  - file system access

### Client (Web)
- React + TypeScript + Tailwind
- Handles:
  - UI interaction
  - gesture input
  - live video display
  - command triggering

### Communication
- WebSocket-based session pairing
- One active client per host
- Session-code authentication

---

## 🧪 Current Status

### ✅ Working
- Client ↔ Host connection
- Live Logic screen streaming
- Fullscreen mobile viewer
- Command execution system
- Basic touch interaction (tap/drag)
- Import planning + review flow
- Track rename + color execution

### ⚠️ In Progress
- Reliable audio import into Logic
- Gesture expansion (pinch, multi-touch)
- Improved stream latency
- Full touchscreen parity with mouse

---

## 🖥️ Requirements

### macOS (Required for full functionality)
- Logic Pro
- Node.js
- Electron environment

### Windows
- Client UI works
- Host runs partially
- Logic control NOT supported (AppleScript dependency)

---

## ⚙️ Setup

### 1. Clone the repo
```bash
git clone https://github.com/your-username/ctrlx.git
cd ctrlx
