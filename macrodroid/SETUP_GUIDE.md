# Android Mobile Call Sync — One-Time Configuration Guide

This guide configures automatic real-time call tracking (Incoming Ring, Live Call Stopwatch, Start Time, End Time, and Talk Duration) using **MacroDroid** over a permanent HTTPS endpoint. Once configured, it operates continuously over both Wi-Fi and mobile data without requiring IP updates.

---

## 1. Prerequisites
1. Install **MacroDroid** from the Google Play Store.
2. Open **Settings -> Apps -> MacroDroid**:
   - Grant **Phone**, **Call Logs**, **Contacts**, and **Notifications** permissions.
   - Set **Battery** usage to **Unrestricted** (disable battery optimization).

---

## 2. Webhook Endpoints

Open `http://192.168.1.34:3000/phone` on the mobile browser to select your recruiter name and copy these values with one tap.

- **Method**: `POST`
- **Server URL** (identical for all three macros):
  ```
  https://ntfy.sh/rec_crm_calls_bca2c15f978c
  ```
- **Content Type**: `text/plain`

| Macro Name | Trigger (`Any Number`) | POST Body (`text/plain`) |
| :--- | :--- | :--- |
| **CRM Ringing** | `Call Incoming` | `event=ringing&recruiter=Suhani&phone={call_number}&name={call_name}` |
| **CRM Call Start** | `Call Active` | `event=started&recruiter=Suhani&phone={call_number}&name={call_name}` |
| **CRM Call End** | `Call Ended` | `event=ended&recruiter=Suhani&phone={call_number}&name={call_name}` |

*(Tip: Create **CRM Ringing** first, then use the top-right menu `Clone Macro` option twice to create **CRM Call Start** and **CRM Call End** in seconds.)*
