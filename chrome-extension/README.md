# TalentFlow CRM — Browser Sync Extension

Real-time Chrome Extension that synchronizes **WhatsApp Web** conversations and **Gmail** threads directly with TalentFlow CRM.

## Key Features
- **Static IP & Automatic Failover**: Pre-configured with `http://192.168.1.34:3000/api/webhook` and hostname `DESKTOP-GLVB82A` plus automatic LAN discovery and an offline retry queue.
- **Continuous Thread Continuity**: Merges ongoing candidate replies, recruiter messages, and shared resume filenames into a unified candidate record.
- **Clean Gmail Parsing**: Strips quoted email history (`.gmail_quote`) to maintain clean chronological threads.

## Installation
1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select the `chrome-extension` directory (or click **Reload** if already installed).
3. Open the **TalentFlow Sync** extension icon, select the assigned recruiter profile, and click **Save Preferences**.
