// ==========================================================================================
// Gmail Live Thread Syncer - Zero-Touch Real-Time Email & Reply Tracker
// - Strips quoted Gmail reply history (.gmail_quote) so replies never duplicate
// - Tracks new keyword emails AND all ongoing threads with existing CRM candidates
// - Captures attachment filenames, phone numbers, CTC & Notice Period automatically
// ==========================================================================================

const KEYWORDS = [
  "job", "position", "resume", "cv", "vacancy", "notice period", "ctc", "salary",
  "interview", "fresher", "experience", "hike", "profile", "opening", "package", "lpa",
  "looking for", "hire", "hiring", "apply", "applied", "opportunity", "switch",
  "developer", "engineer", "designer", "telecaller", "bpo", "sales", "hr",
  "mandate", "recruitment", "candidate", "applicant", "curriculum vitae", "portfolio", "shortlisted"
];

const IGNORE_SUBJECT_WORDS = [
  "security alert", "verify your account", "password reset",
  "google workspace", "newsletter", "delivery status notification"
];

const NON_NAME_WORDS = new Set([
  'in', 'on', 'at', 'to', 'of', 'by', 'as', 'or', 'and', 'am', 'is', 'are', 'was', 'be',
  'for', 'from', 'with', 'new', 'an', 'the', 'a', 'not', 'very', 'so', 'just', 'also',
  'this', 'that', 'there', 'here', 'yes', 'no', 'ok', 'okay', 'sure', 'well', 'good', 'fine',
  'hi', 'hello', 'hey', 'dear', 'namaste', 'sir', 'mam', 'maam', 'madam', 'team', 'hr',
  'need', 'urgent', 'urgently', 'interested', 'fresher', 'looking', 'developer', 'engineer',
  'designer', 'manager', 'executive', 'associate', 'analyst', 'consultant', 'lead', 'senior',
  'junior', 'intern', 'trainee', 'applying', 'applied', 'available', 'having', 'currently',
  'working', 'ready', 'graduate', 'experienced', 'searching', 'writing', 'calling', 'sharing',
  'attaching', 'attached', 'sending', 'pleased', 'excited', 'happy', 'seeking', 'qualified',
  'certified', 'passionate', 'contacting', 'reaching', 'candidate', 'job', 'jobs', 'vacancy',
  'applicant', 'telecaller', 'bpo', 'sales', 'recruiter', 'recruitment', 'serving', 'immediate',
  'please', 'plz', 'kindly', 'help', 'resume', 'cv', 'curriculum', 'vitae', 'profile', 'updated',
  'professional', 'page', 'pages', 'final', 'latest', 'pdf', 'doc', 'docx', 'regarding',
  'hiring', 'software', 'frontend', 'backend', 'fullstack', 'react', 'java', 'python', 'node',
  'ui', 'ux', 'qa', 'support', 'admin', 'orbitouch', 'outsourcing'
]);

function cleanPersonName(raw) {
  if (!raw) return "";
  const parts = raw
    .trim()
    .split(/[\s_.-]+/)
    .map(p => p.replace(/[^a-zA-Z]/g, ""))
    .filter(p => p.length >= 2);

  const valid = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (NON_NAME_WORDS.has(lower)) {
      if (valid.length > 0) break;
      continue;
    }
    valid.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
    if (valid.length === 3) break;
  }
  return valid.length > 0 ? valid.join(" ") : "";
}

function extractCandidateName(text) {
  if (!text) return "";
  const patterns = [
    /(?:name|candidate\s*name|full\s*name)\s*[:=-]\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i,
    /(?:(?:hi|hello|hey|namaste|dear\s+(?:sir|madam|mam|ma'am|hr|team))[,\s.!-]*)?(?:i\s*am|i'm|im|my\s*name\s*is|myself|this\s*is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i,
    /(?:mera\s*naam|main|mai)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:hai|bol\s*raha|bol\s*rahi|hu|hoon)\b/i,
    /(?:(?:regards|thanks\s*(?:&|and)?\s*regards|warm\s*regards|best\s*regards|sincerely)[,\s\n]+)([A-Za-z]+(?:\s+[A-Za-z]+)?)/i
  ];
  for (const pat of patterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      const cleaned = cleanPersonName(match[1]);
      if (cleaned && cleaned.length >= 3) return cleaned;
    }
  }
  const fileMatch = text.match(/([A-Za-z][A-Za-z0-9_ -]{2,50}?(?:resume|cv)[A-Za-z0-9_ ()-]*)\.(?:pdf|docx?|rtf)/i);
  if (fileMatch && fileMatch[1]) {
    const fromFile = cleanPersonName(fileMatch[1]);
    if (fromFile && fromFile.length >= 3) return fromFile;
  }
  return "";
}

let cachedConfig = {
  recruiterName: "Suhani",
  webhookUrl: "http://192.168.1.34:3000/api/webhook",
  autoSync: true,
  stealthMode: false
};

let knownCrmEmails = new Set();
const candidateEmailRegistry = new Set();
const lastSyncedEmailHashMap = new Map();

function quickHash(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `${s.length}:${h}`;
}

if (chrome?.storage?.local) {
  chrome.storage.local.get(
    ["recruiterName", "webhookUrl", "autoSync", "stealthMode", "knownEmails", "gmailSyncedHashes", "gmailLeadRegistry"],
    (res) => {
      if (res.recruiterName) cachedConfig.recruiterName = res.recruiterName;
      if (res.webhookUrl) cachedConfig.webhookUrl = res.webhookUrl;
      if (res.autoSync !== undefined) cachedConfig.autoSync = res.autoSync;
      if (res.stealthMode !== undefined) cachedConfig.stealthMode = res.stealthMode;
      if (Array.isArray(res.knownEmails)) knownCrmEmails = new Set(res.knownEmails);
      if (Array.isArray(res.gmailLeadRegistry)) res.gmailLeadRegistry.forEach(e => candidateEmailRegistry.add(e));
      if (res.gmailSyncedHashes && typeof res.gmailSyncedHashes === "object") {
        Object.entries(res.gmailSyncedHashes).forEach(([k, v]) => lastSyncedEmailHashMap.set(k, v));
      }
    }
  );

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.recruiterName) cachedConfig.recruiterName = changes.recruiterName.newValue;
    if (changes.webhookUrl) cachedConfig.webhookUrl = changes.webhookUrl.newValue;
    if (changes.autoSync !== undefined) cachedConfig.autoSync = changes.autoSync.newValue;
    if (changes.stealthMode !== undefined) cachedConfig.stealthMode = changes.stealthMode.newValue;
    if (changes.knownEmails && Array.isArray(changes.knownEmails.newValue)) {
      knownCrmEmails = new Set(changes.knownEmails.newValue);
    }
  });
}

let persistEmailTimer = null;
function persistEmailState() {
  if (persistEmailTimer) clearTimeout(persistEmailTimer);
  persistEmailTimer = setTimeout(() => {
    if (!chrome?.runtime?.id) return;
    const hashObj = {};
    Array.from(lastSyncedEmailHashMap.entries()).slice(-300).forEach(([k, v]) => { hashObj[k] = v; });
    chrome.storage.local.set({
      gmailSyncedHashes: hashObj,
      gmailLeadRegistry: Array.from(candidateEmailRegistry).slice(-300)
    });
  }, 1500);
}

function getRecruiterEmailFromDOM() {
  const accountLink = document.querySelector(
    "a[aria-label*='Google Account:'], a[aria-label*='Google-Konto'], a[href*='SignOutOptions'], a[aria-label*='@']"
  );
  if (accountLink) {
    const raw = accountLink.getAttribute("aria-label") || accountLink.title || "";
    const m = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (m) return m[1].toLowerCase().trim();
  }
  return "";
}

function extractPhoneNumber(text) {
  if (!text) return "";
  const phoneMatches = text.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g) ||
                       text.match(/\+?\d{1,3}[\s-]?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,5}[\s-]?\d{3,5}/g);
  if (phoneMatches) {
    for (const pm of phoneMatches) {
      const clean = pm.replace(/[^0-9]/g, "");
      if (clean.length >= 10 && clean.length <= 13) return pm.trim();
    }
  }
  return "";
}

// Extract clean body text WITHOUT quoted Gmail reply chains (.gmail_quote)
function extractCleanEmailBody(msgEl) {
  const bodyEl = msgEl.querySelector("div.a3s.aiL, div.a3s");
  let text = "";
  if (bodyEl) {
    const clone = bodyEl.cloneNode(true);
    clone.querySelectorAll(".gmail_quote, blockquote, .yj6qo, .adL").forEach(q => q.remove());
    text = (clone.innerText || "").trim();
  }
  if (!text) {
    const snippetEl = msgEl.querySelector("span.y2, .hx .kv");
    if (snippetEl) text = (snippetEl.innerText || "").trim();
  }

  // Append attachment filenames if present (e.g. Resume PDF)
  const attachEls = msgEl.querySelectorAll("span.aV3, div.aQA span");
  const attachNames = [];
  attachEls.forEach(a => {
    const fn = (a.innerText || "").trim();
    if (fn && /\.(pdf|docx?|rtf|txt)$/i.test(fn) && !attachNames.includes(fn)) {
      attachNames.push(fn);
    }
  });
  if (attachNames.length > 0) {
    text = (text ? `${text}\n` : "") + attachNames.map(f => `📎 Attachment: ${f}`).join("\n");
  }

  return text.trim();
}

let emailUpdateDebounceTimer = null;

function scanActiveEmailThread() {
  if (!chrome?.runtime?.id) return;
  const mainArea = document.querySelector("div[role='main']");
  if (!mainArea) return;

  const subjectEl = mainArea.querySelector("h2.hP, div[role='main'] h2, span.hP, [data-legacy-thread-id] h2, .ha h2");
  if (!subjectEl) return;

  const subjectClone = subjectEl.cloneNode(true);
  const existingPill = subjectClone.querySelector("#crm-synced-pill");
  if (existingPill) existingPill.remove();
  const subject = (subjectClone.innerText || "").replace(/External/gi, "").trim();
  if (!subject || IGNORE_SUBJECT_WORDS.some(w => subject.toLowerCase().includes(w))) return;

  const recruiterEmail = getRecruiterEmailFromDOM();
  const recruiterName = cachedConfig.recruiterName || "Suhani";

  // Target individual message items in Gmail thread without nested duplicates
  const rawContainers = Array.from(mainArea.querySelectorAll("div.adn, div.kv, div[data-message-id]"));
  let msgContainers = rawContainers.filter(el => !rawContainers.some(other => other !== el && other.contains(el)));
  if (msgContainers.length === 0) return;

  let candidateEmail = "";
  let candidateName = "";
  const transcriptLines = [`Subject: ${subject}`, "--------------------------------------------------"];
  const seenBlocks = new Set();
  let fullThreadTextForKeywords = subject;
  let candidateTextOnly = "";

  msgContainers.forEach(msg => {
    const senderEl = msg.querySelector("span.gD, span[email], div.gE span[email], [data-hovercard-id]");
    let rawEmail = senderEl ? (senderEl.getAttribute("email") || senderEl.getAttribute("data-hovercard-id") || "").toLowerCase().trim() : "";
    let rawName = senderEl ? (senderEl.getAttribute("name") || senderEl.innerText || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";

    if (!rawEmail) {
      const headerArea = msg.querySelector(".gE, .gD, div.gK") || msg;
      const emMatch = (headerArea.innerText || "").match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emMatch) rawEmail = emMatch[1].toLowerCase().trim();
    }

    const bodyText = extractCleanEmailBody(msg);
    if (!bodyText && !rawEmail) return;

    const dedupeSig = `${rawEmail}|${bodyText.slice(0, 200)}`;
    if (seenBlocks.has(dedupeSig)) return;
    seenBlocks.add(dedupeSig);

    fullThreadTextForKeywords += " " + bodyText;

    const timeEl = msg.querySelector("span.g3, .gH span[title]");
    const timeStr = timeEl ? (timeEl.getAttribute("title") || timeEl.innerText || "").trim() : "";

    const isFromRecruiter =
      (recruiterEmail && rawEmail === recruiterEmail) ||
      (recruiterName && rawName.toLowerCase().includes(recruiterName.toLowerCase())) ||
      rawName.toLowerCase().includes("orbitouch") ||
      bodyText.toLowerCase().includes("orbitouch outsourcing");

    if (isFromRecruiter) {
      transcriptLines.push(`[Recruiter - ${rawName || recruiterName}${timeStr ? " (" + timeStr + ")" : ""}]: ${bodyText}`);
    } else {
      if (rawEmail && !candidateEmail) {
        candidateEmail = rawEmail;
        candidateName = cleanPersonName(rawName) || rawName || rawEmail.split("@")[0];
      }
      candidateTextOnly += "\n" + bodyText;
      transcriptLines.push(`[Candidate - ${rawName || candidateName || "Applicant"}${timeStr ? " (" + timeStr + ")" : ""}]: ${bodyText}`);
    }
  });

  // Outbound first-email fallback: check recipient To field
  if (!candidateEmail) {
    const toEl = mainArea.querySelector("span.g2 span[email], span[email]");
    if (toEl) {
      const toEmail = (toEl.getAttribute("email") || "").toLowerCase().trim();
      if (toEmail && toEmail !== recruiterEmail) {
        candidateEmail = toEmail;
        candidateName = cleanPersonName(toEl.getAttribute("name") || "") || toEmail.split("@")[0];
      }
    }
  }

  if (!candidateEmail || !candidateEmail.includes("@")) return;

  const extractedName = extractCandidateName(candidateTextOnly || fullThreadTextForKeywords);
  if (extractedName) candidateName = extractedName;

  const candidatePhone = extractPhoneNumber(candidateTextOnly || fullThreadTextForKeywords);
  const fullTranscript = transcriptLines.join("\n").trim();
  const lowerThread = fullThreadTextForKeywords.toLowerCase();

  const hasKeyword = KEYWORDS.some(k => lowerThread.includes(k));
  const isKnownInCrm = knownCrmEmails.has(candidateEmail);

  if (hasKeyword || isKnownInCrm) {
    candidateEmailRegistry.add(candidateEmail);

    // Subtle visual pill on Gmail thread header
    if (subjectEl && !subjectEl.querySelector("#crm-synced-pill")) {
      const pill = document.createElement("span");
      pill.id = "crm-synced-pill";
      pill.style.cssText = "display:inline-flex;align-items:center;gap:4px;padding:2px 8px;margin-left:10px;background:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:12px;font-size:11px;font-weight:700;vertical-align:middle;cursor:pointer;";
      pill.textContent = "✓ CRM Live";
      pill.title = "Synced with Recruitment CRM (Click to force refresh)";
      pill.onclick = (e) => {
        e.stopPropagation();
        lastSyncedEmailHashMap.delete(candidateEmail);
        scanActiveEmailThread();
      };
      subjectEl.appendChild(pill);
    }
  }

  if (candidateEmailRegistry.has(candidateEmail)) {
    const currentHash = quickHash(fullTranscript);
    const prevHash = lastSyncedEmailHashMap.get(candidateEmail);

    if (currentHash !== prevHash) {
      const isInitial = !prevHash;
      lastSyncedEmailHashMap.set(candidateEmail, currentHash);
      persistEmailState();

      const doSync = () => {
        dispatchEmailLead({
          candidateName: candidateName || candidateEmail.split("@")[0],
          candidateEmail,
          candidatePhone,
          subject,
          fullTranscript,
          isInitial,
          isPreview: false
        });
      };

      if (isInitial) {
        doSync();
      } else {
        if (emailUpdateDebounceTimer) clearTimeout(emailUpdateDebounceTimer);
        emailUpdateDebounceTimer = setTimeout(doSync, 700);
      }
    }
  }
}

// Inbox Row Scanner: Captures unread / today's incoming emails without even opening them
function scanInboxRows() {
  if (!chrome?.runtime?.id) return;
  const rows = document.querySelectorAll("div[role='main'] tr.zA, tr.zA");
  if (!rows || rows.length === 0) return;

  rows.forEach(row => {
    // Only auto-capture unread rows or rows showing today's clock time (e.g. "2:15 PM" / "14:15")
    const isUnread = row.classList.contains("zE");
    const timeCol = row.querySelector("td.xW span")?.innerText || "";
    const isTodayRow = /\d{1,2}:\d{2}/.test(timeCol);
    if (!isUnread && !isTodayRow) return;

    const rowText = (row.innerText || "").toLowerCase();
    const senderEl = row.querySelector("span.bA4 span[email], span[email]");
    const email = senderEl ? (senderEl.getAttribute("email") || "").toLowerCase().trim() : "";
    if (!email || !email.includes("@")) return;

    const hasKeyword = KEYWORDS.some(k => rowText.includes(k));
    const isKnown = knownCrmEmails.has(email);
    if (!hasKeyword && !isKnown) return;

    const rawName = senderEl ? (senderEl.getAttribute("name") || senderEl.innerText || "").trim() : "";
    const subjectEl = row.querySelector("span.bqe, span.bog");
    const snippetEl = row.querySelector("span.y2");
    const subject = subjectEl ? subjectEl.innerText.trim() : "";
    const snippet = snippetEl ? snippetEl.innerText.replace(/^\s*-\s*/, "").trim() : "";

    if (IGNORE_SUBJECT_WORDS.some(w => subject.toLowerCase().includes(w))) return;

    if (!row.querySelector(".crm-gmail-badge") && subjectEl && subjectEl.parentElement) {
      const badge = document.createElement("span");
      badge.className = "crm-gmail-badge";
      badge.textContent = "CRM";
      subjectEl.parentElement.appendChild(badge);
    }

    if (!lastSyncedEmailHashMap.has(email)) {
      const previewTranscript = `Subject: ${subject}\n--------------------------------------------------\n[Candidate - ${rawName || email}]: ${snippet}`;
      candidateEmailRegistry.add(email);
      lastSyncedEmailHashMap.set(email, quickHash(previewTranscript));
      persistEmailState();

      dispatchEmailLead({
        candidateName: cleanPersonName(rawName) || rawName || email.split("@")[0],
        candidateEmail: email,
        candidatePhone: extractPhoneNumber(row.innerText),
        subject,
        fullTranscript: previewTranscript,
        isInitial: true,
        isPreview: true
      });
    }
  });
}

function dispatchEmailLead({ candidateName, candidateEmail, candidatePhone, subject, fullTranscript, isInitial, isPreview }) {
  if (!chrome?.runtime?.id) return;

  const recruiter = cachedConfig.recruiterName || "Suhani";
  const payload = {
    source: "Email",
    is_preview: Boolean(isPreview),
    recruiter_name: recruiter,
    candidate_name: candidateName,
    candidate_email: candidateEmail,
    candidate_phone: candidatePhone || "",
    subject: subject || "Job Application",
    text: fullTranscript
  };

  try {
    chrome.runtime.sendMessage(
      {
        action: "SYNC_LEAD",
        webhookUrl: cachedConfig.webhookUrl || "http://192.168.1.34:3000/api/webhook",
        payload
      },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.success) {
          const action = response.data && response.data.action;
          if (action === "unchanged" || action === "ignored") return;
          knownCrmEmails.add(candidateEmail);
          if (isInitial || action === "created") {
            showToast(`Email synced · ${candidateName}`, "success");
          } else {
            showToast(`Thread updated · ${candidateName}`, "info");
          }
        }
      }
    );
  } catch (e) {}
}

function showToast(message, type = "info") {
  if (cachedConfig.stealthMode) return;
  let toast = document.getElementById("wa-crm-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "wa-crm-toast";
    (document.body || document.documentElement).appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `wa-crm-toast wa-crm-toast-${type} wa-crm-toast-visible`;
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.className = toast.className.replace("wa-crm-toast-visible", "").trim();
  }, 3200);
}

// Instant trigger when Recruiter sends an email reply
document.addEventListener("click", (e) => {
  if (!cachedConfig.autoSync) return;
  const btn = e.target?.closest?.("div[role='button'], button");
  if (btn) {
    const label = (btn.getAttribute("aria-label") || btn.getAttribute("data-tooltip") || btn.innerText || "").toLowerCase();
    if (label.includes("send") || label.includes("bhejein") || btn.classList.contains("aoO")) {
      setTimeout(scanActiveEmailThread, 1600);
    }
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (cachedConfig.autoSync && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
    setTimeout(scanActiveEmailThread, 1600);
  }
}, true);

setInterval(() => {
  if (cachedConfig.autoSync) {
    scanActiveEmailThread();
    scanInboxRows();
  }
}, 1500);
