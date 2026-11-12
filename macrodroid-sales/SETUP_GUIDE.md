# 100% Zero-Touch Automatic Call Recording & Upload Guide

> **Important**: This guide is configured so that **your sales team (Jinendra, Vishal, Rahul, Archana) does NOT have to touch anything, click any button, or open any app during or after a call**. Every call is automatically recorded by the phone, and the audio recording is automatically uploaded directly to the **OrbitSales CRM Dashboard** with live stopwatch duration and conversation summary!

---

## 🎯 How It Works Without Any Salesperson Interaction

```
Salesperson makes/receives call on Android phone
                   │
                   ▼
Native Phone Dialer records audio automatically to /Recordings/Call/
                   │
                   ▼ (Call ends)
MacroDroid detects Call Ended ──▶ Waits 4s ──▶ Automatically POSTs latest audio file
                   │
                   ▼
Server receives audio, attaches player, auto-generates conversation summary
                   │
                   ▼
Admin Dashboard plays recording instantly + displays "Call Par Kya Baat Hui"
```

---

## 📱 One-Time Setup on Each Salesperson's Phone (Takes 2 Minutes Once)

Team Member Mapping:
- **Jinendra**: `8010264508`
- **Vishal**: `7701969169` / `9211711371`
- **Rahul**: `9211711370`
- **Archana**: `9211711376`

---

### Step 1: Turn ON Native Auto Call Recording (10 Seconds)
1. Open the **Phone / Dialer** app on the Android phone.
2. Tap **Settings (⚙️)** (or three dots at top right).
3. Tap **Call Recording** (or Record Calls).
4. Turn **ON** **"Record calls automatically"** (Set to **All Numbers**).
   - *Result*: The phone will now silently record 100% of calls into the phone's storage (e.g. `/Recordings/Call/` or `MIUI/sound_recorder/call_rec`). The salesperson never has to press record!

---

### Step 2: Install MacroDroid (Free on Google Play Store)
1. Install **MacroDroid** from Google Play Store.
2. Grant permissions:
   - **Phone & Call Logs**
   - **Contacts**
   - **Files / Storage Access** (to read recording files)
   - Set **Battery** to **Unrestricted** (so Android never closes MacroDroid in the background).

---

### Step 3: Create the 100% Automatic Upload Macro in MacroDroid

Open MacroDroid -> Tap **Add Macro (+)**:

1. **Trigger (Red +)**:
   - Tap `Call / SMS` ➔ `Call Ended` ➔ Select `Any Number`.

2. **Actions (Blue +)**:
   - **Action 1 (Wait)**:
     - Tap `MacroDroid Specific` ➔ `Wait Before Next Action` ➔ Set to **4 seconds** *(this gives the phone dialer time to finish saving the audio file)*.
   - **Action 2 (Automatic Upload)**:
     - Tap `Connectivity` ➔ `HTTP Request`.
     - **Request Method**: `POST`
     - **URL**:
       ```
       https://ntfy.sh/sales_crm_calls_9f8a7b6c5d4e
       ```
       *(Note: This permanent cloud URL works everywhere — over 4G/5G mobile data on the road, as well as office Wi-Fi!)*
     - **Request Content / Body**:
       - Select **File Upload / Binary**
       - Pick File: Select folder `/storage/emulated/0/Recordings/Call/` (or phone's call recording folder) ➔ Choose **Most Recent File**.
     - **Header**:
       - Header Name: `Filename`
       - Header Value: `[SalespersonName]_{call_number}_{call_duration}.m4a`
         *(Example for Jinendra: `Jinendra_{call_number}_{call_duration}.m4a`)*
       - Add second Header: `Title` with Value: `Call Recording`
   
3. **Save Macro**: Name it **"Auto Upload Call Recording"** and turn it ON.

✅ **Done! That is literally all.** 
Now, whenever Jinendra, Vishal, Rahul, or Archana talks to a client:
- The phone records the call automatically.
- 4 seconds after the call disconnects, MacroDroid silently sends the recording to the CRM server in the background.
- The salesperson does **ZERO** taps!

---

### Step 4: Real-Time Call Event Tracking Macros (Call Ring, Dial, Stopwatch)

To also see live **Incoming Ringing**, **Outgoing Dialing**, and the **Live Talking Stopwatch**:

Add 4 quick macros in MacroDroid (HTTP Request `POST`, Content-Type: `text/plain`):
**Target URL (Permanent Cloud)**: `https://ntfy.sh/sales_crm_calls_9f8a7b6c5d4e`

| Macro | Trigger | POST Body (`text/plain`) | Dashboard Feature |
| :--- | :--- | :--- | :--- |
| **1. Ringing** | `Call Incoming` | `event=ringing&dir=incoming&recruiter=[Name]&phone={call_number}&name={call_name}` | Live Ring alert + detects Missed Calls |
| **2. Outgoing** | `Call Outgoing` | `event=dialing&dir=outgoing&recruiter=[Name]&phone={call_number}&name={call_name}` | Live Dial alert + detects Unanswered Calls |
| **3. Answered** | `Call Active` | `event=started&recruiter=[Name]&phone={call_number}&name={call_name}` | Starts live Talking Stopwatch |
| **4. Ended** | `Call Ended` | `event=ended&recruiter=[Name]&phone={call_number}&name={call_name}` | Logs Call Cut time & exact talk duration |

*(Replace `[Name]` with Jinendra, Vishal, Rahul, or Archana).*

---

## ⚡ Alternative Zero-Touch Option: FolderSync App (Even Simpler!)

If you prefer a 1-click folder sync tool instead of MacroDroid:
1. Install **FolderSync** from Google Play Store on the salesperson's phone.
2. In FolderSync:
   - Add Account: Direct HTTP / WebDAV / Google Drive.
   - Folderpair:
     - Local folder: `/Recordings/Call/`
     - Remote folder: CRM `recordings_dropzone/`
     - Sync type: **Instant Sync** (triggers automatically whenever a new audio file is created).
     - Allowed connection: **Wi-Fi & 3G/4G/5G**.
3. Whenever a call ends, FolderSync detects the new audio file in under 3 seconds and syncs it directly into the CRM server dropzone.
4. The CRM server automatically extracts the salesperson and phone number, attaches the audio player to the call, and creates the conversation brief!

---

## 🎧 What You See on the OrbitSales CRM Admin Dashboard

1. **Call Activity & Recordings Tab**:
   - Every call shows:
     - Direction Pill (**Incoming Answered**, **Outgoing Answered**, **Missed Call**, **Client Did Not Pick Up**).
     - Client Name & Phone Number (with 1-click WhatsApp and Copy buttons).
     - Salesperson Name (Jinendra, Vishal, Rahul, Archana).
     - Start Time, End Time & Talk Duration.
     - **Inline Audio Player**: Click **Play (▶)** to listen to the call recording immediately in your browser!
     - **Download Button (⬇)**: Download the audio file (`.m4a` / `.mp3`).
     - **"Baat Kya Hui" Badge**: Click the green conversation chip to view the conversation briefing, dialogue summary, and add private CRM notes!
