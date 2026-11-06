// ==========================================================================================
// 🚀 OMNICHANNEL RECRUITMENT CRM - GOOGLE APPS SCRIPT BACKEND
// Handles Phone Call Timings (Start, End, Duration), WhatsApp & Gmail Leads
// Zero AI Bloat — Fast, Deterministic Rule Engine + Dual-Layer Sheet Logging
// ==========================================================================================

const CONFIG = {
  MASTER_LEADS_SHEET: "Master_Leads",
  CALL_LOGS_SHEET: "Call_Logs",
  RECRUITERS_SHEET: "Recruiters",
  GMAIL_SEARCH_QUERY: "label:inbox -label:crm_processed (job OR resume OR CV OR vacancy OR \"notice period\" OR ctc OR hiring OR interview OR apply)",
  GMAIL_PROCESSED_LABEL: "crm_processed"
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: "error", message: "No data payload received" });
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      payload = e.parameter || {};
    }

    const source = (payload.source || payload.channel || "").toString().toLowerCase();
    if (source === "call" || payload.call_duration !== undefined || payload.call_duration_seconds !== undefined) {
      const callResult = processCallWebhook(payload);
      return jsonResponse({ status: "success", result: callResult });
    }

    const result = processIncomingLead(payload);
    return jsonResponse({ status: "success", result: result });
  } catch (err) {
    Logger.log("Error in doPost: " + err.toString());
    return jsonResponse({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return jsonResponse({
    status: "online",
    message: "Omnichannel Recruitment CRM Webhook is active!",
    timestamp: Utilities.formatDate(new Date(), "GMT+5:30", "yyyy-MM-dd HH:mm:ss")
  });
}

// 1. PURE PHONE CALL TIMING LOGGER (Start Time, End Time, Duration)
function processCallWebhook(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let callSheet = ss.getSheetByName(CONFIG.CALL_LOGS_SHEET);
  if (!callSheet) {
    callSheet = ss.insertSheet(CONFIG.CALL_LOGS_SHEET);
    const headers = ["Call ID", "Date", "Recruiter", "Direction", "Candidate Name", "Phone", "Call Start Time", "Call End Time", "Duration"];
    callSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeaderRow(callSheet, headers.length, "#1E40AF");
    callSheet.setFrozenRows(1);
  }

  const recruiter = data.recruiter_name || data.recruiter || "Suhani";
  const phone = cleanPhone(data.candidate_phone || data.phone || data.number || "");
  const name = data.candidate_name || data.name || (phone ? "Candidate (" + phone.slice(-4) + ")" : "Unknown");
  const direction = (data.call_direction || data.call_type || "outgoing").toString();
  const durationSec = parseInt(data.call_duration_seconds || data.call_duration || data.duration || "0", 10) || 0;

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - durationSec * 1000);

  const dateStr = Utilities.formatDate(startDate, "GMT+5:30", "yyyy-MM-dd");
  const startStr = Utilities.formatDate(startDate, "GMT+5:30", "dd-MMM-yyyy hh:mm:ss a");
  const endStr = Utilities.formatDate(endDate, "GMT+5:30", "dd-MMM-yyyy hh:mm:ss a");
  const durFormatted = durationSec < 60 ? durationSec + "s" : Math.floor(durationSec / 60) + "m " + (durationSec % 60) + "s";
  const callId = "CALL-" + Utilities.formatDate(endDate, "GMT+5:30", "yyMMdd-HHmmss");

  callSheet.appendRow([callId, dateStr, recruiter, direction, name, phone, startStr, endStr, durFormatted]);

  return { callId: callId, start: startStr, end: endStr, duration: durFormatted };
}

// 2. CORE LEAD PROCESSOR (WhatsApp + Email)
function processIncomingLead(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let masterSheet = ss.getSheetByName(CONFIG.MASTER_LEADS_SHEET);
  if (!masterSheet) {
    setupSheets();
    masterSheet = ss.getSheetByName(CONFIG.MASTER_LEADS_SHEET);
  }

  const rawText = data.text || data.message || data.body || data.notes || "";
  const source = data.source || data.channel || "WhatsApp";
  const recruiterName = data.recruiter_name || data.recruiter || "Suhani";
  const candidatePhone = cleanPhone(data.candidate_phone || data.phone || "");
  const candidateEmail = data.candidate_email || data.email || extractEmailFromText(rawText);
  let candidateName = data.candidate_name || data.name || "";

  if (!candidateName) {
    candidateName = candidatePhone ? "Candidate (" + candidatePhone.slice(-4) + ")" : "Candidate";
  }

  const ruleResult = classifyByKeywords(rawText);
  const category = data.category || ruleResult.category;

  const leadId = "LEAD-" + Utilities.formatDate(new Date(), "GMT+5:30", "yyMMdd-HHmmss");
  const timestamp = Utilities.formatDate(new Date(), "GMT+5:30", "dd-MMM-yyyy hh:mm:ss a");

  const rowData = [
    leadId,
    timestamp,
    recruiterName,
    source,
    category,
    candidateName,
    candidatePhone,
    candidateEmail,
    data.current_ctc || "",
    data.expected_ctc || "",
    data.notice_period || "",
    data.skills || "",
    rawText,
    "New Lead"
  ];

  masterSheet.appendRow(rowData);
  routeToRecruiterPersonalSheet(ss, recruiterName, rowData);

  return { leadId: leadId, recruiter: recruiterName, channel: source, category: category };
}

function classifyByKeywords(text) {
  if (!text) return { category: "General Enquiry", keywordsMatched: [] };
  const lower = text.toLowerCase();

  const clientKeywords = ["need staff", "requirement", "agreement", "commission", "mandate", "vendor", "commercials"];
  const jobChangeKeywords = ["job change", "switch", "current ctc", "expected ctc", "notice period", "package", "hike", "lpa", "resigned"];
  const jobSeekerKeywords = ["job", "vacancy", "fresher", "apply", "resume", "cv", "interview", "opening", "hiring"];

  const matchedClient = clientKeywords.filter(k => lower.includes(k));
  if (matchedClient.length > 0) return { category: "Client / Employer Lead", keywordsMatched: matchedClient };

  const matchedChange = jobChangeKeywords.filter(k => lower.includes(k));
  if (matchedChange.length > 0) return { category: "Experienced / Job Change", keywordsMatched: matchedChange };

  const matchedSeeker = jobSeekerKeywords.filter(k => lower.includes(k));
  if (matchedSeeker.length > 0) return { category: "New Job Seeker", keywordsMatched: matchedSeeker };

  return { category: "General Enquiry", keywordsMatched: [] };
}

function routeToRecruiterPersonalSheet(ss, recruiterName, rowData) {
  try {
    const recruitersSheet = ss.getSheetByName(CONFIG.RECRUITERS_SHEET);
    if (!recruitersSheet) return;

    const data = recruitersSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const name = (data[i][0] || "").toString().trim().toLowerCase();
      if (name === recruiterName.toLowerCase()) {
        const targetTabName = (data[i][4] || "").toString().trim();
        if (!targetTabName) break;

        let tab = ss.getSheetByName(targetTabName);
        if (!tab) {
          tab = ss.insertSheet(targetTabName);
          applySheetHeaders(tab);
        }
        tab.appendRow(rowData);
        break;
      }
    }
  } catch (err) {
    Logger.log("Routing error: " + err.toString());
  }
}

function syncGmailLeads() {
  const currentEmail = Session.getActiveUser().getEmail();
  let processedLabel = GmailApp.getUserLabelByName(CONFIG.GMAIL_PROCESSED_LABEL);
  if (!processedLabel) processedLabel = GmailApp.createLabel(CONFIG.GMAIL_PROCESSED_LABEL);

  const threads = GmailApp.search(CONFIG.GMAIL_SEARCH_QUERY, 0, 15);
  threads.forEach(thread => {
    const messages = thread.getMessages();
    const lastMsg = messages[messages.length - 1];
    const sender = lastMsg.getFrom();
    const subject = lastMsg.getSubject();
    const body = lastMsg.getPlainBody() || "";
    const senderEmail = extractEmailFromText(sender);
    let senderName = sender.split("<")[0].replace(/"/g, "").trim() || "Email Candidate";

    processIncomingLead({
      source: "Email",
      recruiter_name: getRecruiterNameFromEmail(currentEmail),
      candidate_name: senderName,
      candidate_email: senderEmail,
      candidate_phone: extractPhoneFromText(body),
      text: "Subject: " + subject + "\n\n" + body.substring(0, 1000)
    });

    thread.addLabel(processedLabel);
  });
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let masterSheet = ss.getSheetByName(CONFIG.MASTER_LEADS_SHEET);
  if (!masterSheet) masterSheet = ss.insertSheet(CONFIG.MASTER_LEADS_SHEET, 0);
  applySheetHeaders(masterSheet);

  let recSheet = ss.getSheetByName(CONFIG.RECRUITERS_SHEET);
  if (!recSheet) {
    recSheet = ss.insertSheet(CONFIG.RECRUITERS_SHEET, 1);
    const recHeaders = ["Recruiter Name", "Office Mobile", "WhatsApp ID", "Work Email", "Personal Tab Name", "Status"];
    recSheet.getRange(1, 1, 1, recHeaders.length).setValues([recHeaders]);
    styleHeaderRow(recSheet, recHeaders.length, "#1B365D");
  }
}

function applySheetHeaders(sheet) {
  const headers = [
    "Lead ID", "Date-Time (IST)", "Recruiter", "Channel", "Category",
    "Candidate Name", "Phone", "Email", "Current CTC", "Expected CTC",
    "Notice Period", "Skills / Role", "Conversation / Notes", "Status"
  ];
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleHeaderRow(sheet, headers.length, "#0F52BA");
  sheet.setFrozenRows(1);
}

function styleHeaderRow(sheet, colCount, hexColor) {
  const headerRange = sheet.getRange(1, 1, 1, colCount);
  headerRange.setBackground(hexColor);
  headerRange.setFontColor("#FFFFFF");
  headerRange.setFontWeight("bold");
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function cleanPhone(raw) {
  return raw ? raw.toString().replace(/[^0-9+]/g, "").trim() : "";
}

function extractEmailFromText(text) {
  if (!text) return "";
  const match = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return match ? match[1] : "";
}

function extractPhoneFromText(text) {
  if (!text) return "";
  const match = text.match(/(?:\+91|91|0)?[6-9]\d{9}/);
  return match ? match[0] : "";
}

function getRecruiterNameFromEmail(email) {
  if (!email) return "Recruiter";
  const namePart = email.split("@")[0].replace(/[._]/g, " ");
  return namePart.charAt(0).toUpperCase() + namePart.slice(1);
}
