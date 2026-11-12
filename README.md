# TalentFlow & OrbitSales CRM — Unified Enterprise Omnichannel Platform

A unified, real-time platform integrating both **Recruiter CRM (TalentFlow)** and **Sales CRM (OrbitSales)** into a single, high-performance engine with 100% data and call isolation.

---

## 🌟 Dual Portal Overview

| Portal | URL Path | Target Team | Description |
| :--- | :--- | :--- | :--- |
| **Recruiter CRM** | `http://localhost:3000/` | Recruiters (`Suhani`, `Pooja`, `Amit`, `Rahul`, `Neha`, etc.) & TLs | Candidate hiring pipeline, resume detection, keyword-filtered WhatsApp/Email sync, and phone call logging. |
| **Sales CRM** | `http://localhost:3000/sales` | Sales Executives (`Jinendra`, `Vishal`, `Rahul`, `Archana`) | Client deals & BGV pipeline, **100% zero-loss message sync** (no keyword drop), call recording audio & transcripts. |
| **Admin Dual Dashboard** | Both `/` and `/sales` | Super Admin (`admin`) | Full visibility across both portals with a 1-click **Admin Switcher** in the topbar and sidebar with Single Sign-On. |

---

## 🔒 Strict Separation & Isolation Guarantee

1. **Role & Login Boundary**:
   - **Recruiter Team Members** can **only** log into the Recruiter Portal (`/`). Attempting to log into Sales (`/sales`) is blocked with an explicit Access Denied alert.
   - **Sales Team Members** can **only** log into the Sales Portal (`/sales`). Attempting to log into Recruiter (`/`) is blocked with an explicit Access Denied alert.
   - Recruiter Rahul (`rahul@123`) and Sales Rahul (`Rahul@123`) have independent authentication and strictly separate workspaces.
   - Super Admin can access and switch between both dashboards seamlessly.

2. **Call & Activity Isolation**:
   - Recruiter calls route exclusively to `data/call_logs.json` and broadcast only on `/api/events` (Cloud Relay Topic: `rec_crm_calls_bca2c15f978c`).
   - Sales calls route exclusively to `data/sales/call_logs.json` and broadcast only on `/api/sales/events` (Cloud Relay Topic: `sales_crm_calls_9f8a7b6c5d4e`).
   - Active call stopwatches and call logs **never** cross over between portals.

3. **Message Sync Behavior**:
   - **Recruiter Extension**: Captures candidate conversations only when recruitment triggers/keywords (`job`, `resume`, `ctc`, `notice period`, `salary`, etc.) are detected.
   - **Sales Extension**: Captures **100% of every WhatsApp message and Email** without any keyword gate, attributing messages to `[Sales - Name]` vs `[Client - Name]` and streaming them into `data/sales/messages.json`.

---

## 🚀 Quick Access

- **Recruiter Web Workspace**: `http://localhost:3000` (or `http://192.168.1.34:3000`)
- **Recruiter Phone Companion**: `http://localhost:3000/phone`
- **Sales Web Workspace**: `http://localhost:3000/sales` (or `http://192.168.1.34:3000/sales`)
- **Sales Phone Companion**: `http://localhost:3000/sales/phone`
- **Sales Chrome Extension**: Download via `http://localhost:3000/download/sales-extension` or load unpacked from `chrome-extension-sales/`
- **Sales Android APK**: Download via `http://localhost:3000/download/apk`

---

## 👥 Credentials Quick Reference

### Super Admin (Both Portals)
- **Username**: `admin`
- **Password**: `admin@123` or `Akshat@123#`

### Recruiter Team (Recruiter Portal Only — `/`)
- `suhani` / `suhani@123`
- `rahul` / `rahul@123`
- `pooja` / `pooja@123`
- `amit` / `amit@123`
- `neha` / `neha@123`
- `tl` / `tl@123`

### Sales Team (Sales Portal Only — `/sales`)
- `jinendra` / `Jinendra@123` (Phone: `8010264508`)
- `vishal` / `Vishal@123` (Phones: `7701969169`, `9211711371`)
- `rahul` / `Rahul@123` (Phone: `9211711370`)
- `archana` / `Archana@123` (Phone: `9211711376`)
