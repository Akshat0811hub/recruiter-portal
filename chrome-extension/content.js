// ==========================================================================================
// WhatsApp Web Live Chat Syncer - Zero-Touch Real-Time Conversation Tracker
// - Syncs new recruitment chats AND all ongoing chats with existing CRM candidates
// - Captures bubble timestamps, PDF/DOCX resume names, CTC & Notice Period
// - Persists sync state across reloads so old inactive sidebar chats never pollute Today's view
// ==========================================================================================

const KEYWORDS = [
  "job", "position", "resume", "cv", "vacancy", "notice period", "ctc", "salary",
  "interview", "fresher", "experience", "hike", "profile", "opening", "package", "lpa",
  "looking for", "hire", "hiring", "apply", "applied", "opportunity", "switch",
  "developer", "engineer", "designer", "telecaller", "bpo", "sales", "hr",
  "shortlisted", "joining", "relocate", "immediate joiner", "mandate", ".pdf", ".docx"
];

const IGNORE_HEADER_WORDS = [
  "search", "video call", "voice call", "menu", "more options", "attach",
  "profile photo", "contact info", "mute", "block", "whatsapp", "chats",
  "status", "channels", "communities", "click here for"
];

const INTERNAL_GROUP_REGEX = [
  /orbitouch\s*outsourcing/i,
  /daily\s*working\s*\/\s*reporting/i,
  /job\s*post\s*\/\s*response/i,
  /hr\s*agency\s*orbitouch/i,
  /team\s+(?:kajal|neetu|suhani|rahul)/i
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
  'ui', 'ux', 'qa', 'support', 'admin', 'orbitouch', 'outsourcing', 'unread', 'messages'
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
    /(?:^|\n|\[Candidate[^\]]*\]:\s*|\.\s+)([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:here|this\s*side)\b/i,
    /(?:(?:regards|thanks\s*(?:&|and)?\s*regards|warm\s*regards|best\s*regards|sincerely)[,\s\n]+)([A-Za-z]+(?:\s+[A-Za-z]+)?)/i
  ];

  for (const pat of patterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      const cleaned = cleanPersonName(match[1]);
      if (cleaned && cleaned.length >= 3) return cleaned;
    }
  }

  // Extract from PDF/DOCX resume filename (e.g. "Shruti_Maurya_Resume.pdf")
  const fileMatch = text.match(/([A-Za-z][A-Za-z0-9_ -]{2,50}?(?:resume|cv)[A-Za-z0-9_ ()-]*)\.(?:pdf|docx?|rtf)/i) ||
                    text.match(/(?:resume|cv)[_ -]+([A-Za-z][A-Za-z_ -]{2,40})\.(?:pdf|docx?|rtf)/i);
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

let knownCrmPhones = new Set();
const candidateLeadRegistry = new Set();
const lastSyncedHashMap = new Map(); // dedupeKey -> simple hash of last synced transcript

function quickHash(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `${s.length}:${h}`;
}

// Load saved config, known CRM phones, and persisted sync hashes
if (chrome?.storage?.local) {
  chrome.storage.local.get(
    ["recruiterName", "webhookUrl", "autoSync", "stealthMode", "knownPhones", "waSyncedHashes", "waLeadRegistry"],
    (res) => {
      if (res.recruiterName) cachedConfig.recruiterName = res.recruiterName;
      if (res.webhookUrl) cachedConfig.webhookUrl = res.webhookUrl;
      if (res.autoSync !== undefined) cachedConfig.autoSync = res.autoSync;
      if (res.stealthMode !== undefined) cachedConfig.stealthMode = res.stealthMode;
      if (Array.isArray(res.knownPhones)) {
        knownCrmPhones = new Set(res.knownPhones);
      }
      if (Array.isArray(res.waLeadRegistry)) {
        res.waLeadRegistry.forEach(k => candidateLeadRegistry.add(k));
      }
      if (res.waSyncedHashes && typeof res.waSyncedHashes === "object") {
        Object.entries(res.waSyncedHashes).forEach(([k, v]) => lastSyncedHashMap.set(k, v));
      }
    }
  );

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.recruiterName) cachedConfig.recruiterName = changes.recruiterName.newValue;
    if (changes.webhookUrl) cachedConfig.webhookUrl = changes.webhookUrl.newValue;
    if (changes.autoSync !== undefined) cachedConfig.autoSync = changes.autoSync.newValue;
    if (changes.stealthMode !== undefined) cachedConfig.stealthMode = changes.stealthMode.newValue;
    if (changes.knownPhones && Array.isArray(changes.knownPhones.newValue)) {
      knownCrmPhones = new Set(changes.knownPhones.newValue);
    }
  });
}

let persistTimer = null;
function persistSyncState() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!chrome?.runtime?.id) return;
    const hashObj = {};
    // Keep latest 300 entries
    const entries = Array.from(lastSyncedHashMap.entries()).slice(-300);
    entries.forEach(([k, v]) => { hashObj[k] = v; });
    chrome.storage.local.set({
      waSyncedHashes: hashObj,
      waLeadRegistry: Array.from(candidateLeadRegistry).slice(-300)
    });
  }, 1500);
}

function phoneKey10(raw) {
  const d = String(raw || "").replace(/[^0-9]/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

function isGroupOrInternalHeader(headerEl, title) {
  if (!title) return true;
  if (INTERNAL_GROUP_REGEX.some(rx => rx.test(title))) return true;
  if (title.toLowerCase().includes("orbitouch") && !/\d{8,}/.test(title)) return true;

  // Detect multi-member WhatsApp group subtitle (comma-separated participant list)
  if (headerEl) {
    const headerText = (headerEl.innerText || "").split("\n").slice(1).join(" ");
    const commaCount = (headerText.match(/,/g) || []).length;
    if (commaCount >= 2 && !/online|last seen|typing|business account/i.test(headerText)) {
      return true;
    }
  }
  return false;
}

function getHeaderCandidateTitle(headerEl) {
  if (!headerEl) return "";
  const allHeaderText = headerEl.innerText || "";

  const phoneMatch = allHeaderText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) ||
                     allHeaderText.match(/\+?\d[\d\s-]{9,}\d/);
  if (phoneMatch) return phoneMatch[0].trim();

  const titleEl = headerEl.querySelector(
    "span[data-testid='conversation-info-header-chat-title'], div[role='button'] span[dir='auto'], span[title]"
  );
  if (titleEl) {
    const val = (titleEl.getAttribute("title") || titleEl.innerText || "").trim();
    if (val && !IGNORE_HEADER_WORDS.some(w => val.toLowerCase().includes(w))) return val;
  }

  const lines = allHeaderText
    .split("\n")
    .map(s => s.trim())
    .filter(s => s && !IGNORE_HEADER_WORDS.some(w => s.toLowerCase().includes(w)));
  return lines[0] || "";
}

function extractCompensationDetails(text) {
  let currentCtc = "";
  let expectedCtc = "";
  let noticePeriod = "";

  const ctcMatch = text.match(/(?:current\s*(?:ctc|salary|pkg|package)?|cctc|drawing|present\s*ctc)\s*(?:is|around|of)?\s*[:=-]?\s*(\d+(?:\.\d+)?\s*(?:lpa|lakhs?|lac|k|pm)?)/i);
  if (ctcMatch) currentCtc = ctcMatch[1].trim();

  const expMatch = text.match(/(?:expected\s*(?:ctc|salary|pkg|package)?|ectc|ext\b|exp\s*ctc|expecting)\s*(?:is|around|of)?\s*[:=-]?\s*(\d+(?:\.\d+)?\s*(?:lpa|lakhs?|lac|k|pm)?)/i);
  if (expMatch) expectedCtc = expMatch[1].trim();

  let npMatch = text.match(/(?:notice\s*(?:period)?|np)\s*(?:is|of)?\s*[:=-]?\s*(\d+\s*(?:days?|months?|weeks?)|immediate(?:\s*joiner)?|serving(?:\s*notice)?)/i);
  if (npMatch) noticePeriod = npMatch[1].trim();
  else {
    npMatch = text.match(/(\d+\s*(?:days?|months?|weeks?))\s*notice/i) || text.match(/\b(immediate\s*joiner|serving\s*notice)\b/i);
    if (npMatch) noticePeriod = npMatch[1].trim();
  }

  return { currentCtc, expectedCtc, noticePeriod };
}

function extractFullChatTranscript(mainArea) {
  if (!mainArea) return "";

  let msgEls = Array.from(mainArea.querySelectorAll("div.message-in, div.message-out"));
  if (msgEls.length === 0) {
    msgEls = Array.from(mainArea.querySelectorAll("div[data-testid='msg-container']"));
  }
  if (msgEls.length === 0) {
    msgEls = Array.from(mainArea.querySelectorAll("div[role='row']"));
  }

  const recruiter = cachedConfig.recruiterName || "Suhani";
  const transcript = [];

  msgEls.forEach(container => {
    const dataId = container.getAttribute("data-id") || container.closest("[data-id]")?.getAttribute("data-id") || "";
    let isOut = false;

    if (dataId.startsWith("true_")) {
      isOut = true;
    } else if (dataId.startsWith("false_")) {
      isOut = false;
    } else {
      isOut = container.classList.contains("message-out") ||
              (container.className && String(container.className).includes("message-out")) ||
              !!container.closest(".message-out, [class*='message-out']") ||
              !!container.querySelector(".message-out, [class*='message-out']");
      if (!isOut && container.querySelector("span[data-icon*='check'], span[data-icon*='dblcheck'], span[data-icon='msg-time']")) {
        isOut = true;
      }
    }

    // Extract WhatsApp bubble timestamp if present
    let msgTime = "";
    const copyable = container.querySelector(".copyable-text[data-pre-plain-text]");
    if (copyable) {
      const pre = copyable.getAttribute("data-pre-plain-text") || "";
      const tm = pre.match(/\[([^\]]+)\]/);
      if (tm) msgTime = tm[1].trim();
    }
    if (!msgTime) {
      const metaEl = container.querySelector("div[data-testid='msg-meta'] span, span.x1rg5ohu");
      if (metaEl && /\d{1,2}:\d{2}/.test(metaEl.innerText || "")) {
        msgTime = metaEl.innerText.trim();
      }
    }

    // Extract text + any attached PDF/DOCX resume filename
    const textEl = container.querySelector(".selectable-text") || copyable || container;
    let bodyText = (textEl.innerText || "").trim();

    const docEl = container.querySelector("span[title*='.pdf'], span[title*='.doc'], div[data-testid='document-thumb']");
    if (docEl) {
      const docName = (docEl.getAttribute("title") || docEl.innerText || "").trim();
      if (docName && !bodyText.includes(docName)) {
        bodyText = bodyText ? `📄 ${docName}\n${bodyText}` : `📄 ${docName}`;
      }
    }

    // Strip trailing standalone timestamp line if duplicated inside innerText
    bodyText = bodyText.replace(/\n\d{1,2}:\d{2}\s*(?:am|pm)?$/i, "").trim();

    if (
      bodyText &&
      !bodyText.includes("Messages and calls are end-to-end") &&
      !bodyText.includes("Type a message") &&
      !bodyText.includes("This message was deleted") &&
      bodyText.length > 0
    ) {
      const sender = isOut ? `Recruiter - ${recruiter}` : "Candidate";
      const label = msgTime ? `[${sender} (${msgTime})]` : `[${sender}]`;
      transcript.push(`${label}: ${bodyText}`);
    }
  });

  return transcript.join("\n");
}

let updateDebounceTimer = null;

function scanActiveChatContinuous() {
  if (!chrome?.runtime?.id) return;
  const mainArea = document.querySelector("#main, div[data-testid='conversation-panel-wrapper']");
  if (!mainArea) return;

  const header = mainArea.querySelector("header, div[data-testid='conversation-header']") || document.querySelector("#main header");
  if (!header) return;

  const rawTitle = getHeaderCandidateTitle(header);
  if (!rawTitle || isGroupOrInternalHeader(header, rawTitle)) return;

  let phone = "";
  let name = "";
  const phoneClean = rawTitle.replace(/[^0-9+]/g, "");
  const pKey = phoneKey10(phoneClean);

  if (pKey.length >= 10) {
    phone = rawTitle;
    name = `Candidate (${pKey.slice(-4)})`;
  } else {
    name = rawTitle;
  }

  const dedupeKey = pKey || name.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  if (!dedupeKey || dedupeKey.length < 3) return;

  const fullTranscript = extractFullChatTranscript(mainArea);
  if (!fullTranscript) return;

  const extractedName = extractCandidateName(fullTranscript);
  if (extractedName) name = extractedName;

  const lowerChat = fullTranscript.toLowerCase();
  const hasKeyword = KEYWORDS.some(k => lowerChat.includes(k));
  const isKnownInCrm = pKey && knownCrmPhones.has(pKey);

  if (hasKeyword || isKnownInCrm) {
    candidateLeadRegistry.add(dedupeKey);
  }

  if (candidateLeadRegistry.has(dedupeKey)) {
    const currentHash = quickHash(fullTranscript);
    const prevHash = lastSyncedHashMap.get(dedupeKey);

    if (currentHash !== prevHash) {
      const isInitial = !prevHash;
      lastSyncedHashMap.set(dedupeKey, currentHash);
      persistSyncState();

      const doSync = () => {
        dispatchLead(name, phone, fullTranscript, isInitial, false);
      };

      if (isInitial) {
        doSync();
      } else {
        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(doSync, 600);
      }
    }
  }
}

// Sidebar Scanner: Only captures genuinely unread / today's new incoming leads (never overwrites full chats!)
function scanSidebarChats() {
  if (!chrome?.runtime?.id) return;
  const sidebar = document.querySelector("#pane-side, div[aria-label='Chat list'], div[data-testid='chat-list']");
  if (!sidebar) return;

  const chatRows = sidebar.querySelectorAll("div[role='listitem'], div[data-testid='cell-frame-container']");

  chatRows.forEach(row => {
    const rawRowText = (row.innerText || "").trim();
    if (!rawRowText) return;

    // Only auto-trigger sidebar preview if row shows a TODAY clock time (e.g. "2:35 pm" or "14:35") or unread badge
    const hasTodayTime = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(rawRowText);
    const hasUnread = !!row.querySelector("span[aria-label*='unread']");
    if (!hasTodayTime && !hasUnread) return;

    const lower = rawRowText.toLowerCase();
    const titleEl = row.querySelector("span[title], span[dir='auto']");
    let rawTitle = titleEl ? (titleEl.getAttribute("title") || titleEl.innerText || "").trim() : "";
    if (!rawTitle) {
      const pm = rawRowText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) || rawRowText.match(/\+?\d[\d\s-]{9,}\d/);
      if (pm) rawTitle = pm[0].trim();
    }

    if (!rawTitle || IGNORE_HEADER_WORDS.some(w => rawTitle.toLowerCase().includes(w))) return;
    if (INTERNAL_GROUP_REGEX.some(rx => rx.test(rawTitle)) || rawTitle.toLowerCase().includes("orbitouch")) return;

    let phone = "";
    let name = "";
    const pKey = phoneKey10(rawTitle);
    if (pKey.length >= 10) {
      phone = rawTitle;
      name = `Candidate (${pKey.slice(-4)})`;
    } else {
      name = rawTitle;
    }

    const isKnown = pKey && knownCrmPhones.has(pKey);
    const hasKeyword = KEYWORDS.some(k => lower.includes(k));
    if (!hasKeyword && !isKnown) return;

    // Clean WhatsApp sidebar UI noise ("2 unread messages", timestamps, etc.)
    const cleanLines = rawRowText
      .split("\n")
      .map(s => s.trim())
      .filter(s => s && s !== rawTitle && !/^\d+$/.test(s) && !/unread message/i.test(s) && !/^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(s));
    const previewBody = cleanLines.join(" ").slice(0, 300);
    if (!previewBody) return;

    const extracted = extractCandidateName(previewBody);
    if (extracted) name = extracted;

    const dedupeKey = pKey || name.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const previewTranscript = `[Candidate]: ${previewBody}`;
    const previewHash = quickHash(previewTranscript);

    if (dedupeKey && !lastSyncedHashMap.has(dedupeKey)) {
      candidateLeadRegistry.add(dedupeKey);
      lastSyncedHashMap.set(dedupeKey, previewHash);
      persistSyncState();
      dispatchLead(name, phone, previewTranscript, true, true);
    }
  });
}

function dispatchLead(candidateName, candidatePhone, fullTranscriptText, isInitial = false, isPreview = false) {
  if (!chrome?.runtime?.id) return;

  const extracted = extractCandidateName(fullTranscriptText);
  const finalName = extracted || candidateName;

  let candidateEmail = "";
  const emailMatch = fullTranscriptText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) candidateEmail = emailMatch[0].toLowerCase().trim();

  const comp = extractCompensationDetails(fullTranscriptText);
  const recruiter = cachedConfig.recruiterName || "Suhani";

  const payload = {
    source: "WhatsApp",
    is_preview: isPreview,
    recruiter_name: recruiter,
    candidate_name: finalName,
    candidate_phone: candidatePhone || "",
    candidate_email: candidateEmail,
    current_ctc: comp.currentCtc,
    expected_ctc: comp.expectedCtc,
    notice_period: comp.noticePeriod,
    text: fullTranscriptText
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
          const pKey = phoneKey10(candidatePhone);
          if (pKey) knownCrmPhones.add(pKey);
          const displayTarget = finalName || candidatePhone;
          if (isInitial || action === "created") {
            showToast(`Synced to CRM · ${displayTarget}`, "success");
          } else {
            showToast(`Conversation updated · ${displayTarget}`, "info");
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

// Instant trigger when Recruiter sends a WhatsApp message (Enter key or Send button)
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && cachedConfig.autoSync) {
    setTimeout(scanActiveChatContinuous, 450);
  }
}, true);

document.addEventListener("click", (e) => {
  if (!cachedConfig.autoSync) return;
  const sendBtn = e.target?.closest?.("button[aria-label*='Send'], span[data-icon='send']");
  if (sendBtn) {
    setTimeout(scanActiveChatContinuous, 450);
  }
}, true);

// Continuous Live Scanner every 1.2s
setInterval(() => {
  if (cachedConfig.autoSync) {
    scanActiveChatContinuous();
    scanSidebarChats();
  }
}, 1200);
