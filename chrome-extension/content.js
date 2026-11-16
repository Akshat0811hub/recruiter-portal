// ==========================================================================================
// WhatsApp Web Lead Syncer - Live End-to-End Chat Updater
// Continuously streams full conversation history to CRM for all candidate leads
// ==========================================================================================

const KEYWORDS = [
  "job", "position", "resume", "cv", "vacancy", "notice period", "ctc", "salary", 
  "interview", "fresher", "experience", "hike", "profile", "opening", "package", "lpa",
  "looking for", "hire", "hiring", "apply", "applied", "opportunity", "switch", 
  "developer", "engineer", "designer", "telecaller", "bpo", "sales", "hr"
];

const IGNORE_WORDS = [
  "search", "video call", "voice call", "menu", "more options", "attach", 
  "profile photo", "profile", "contact info", "mute", "block", "whatsapp", "chats", "status", "channels"
];

// 🤖 AI Real Name Extractor (Detects "Hi I am Rahul" -> Rahul)
const NON_NAME_WORDS = new Set([
  'interested', 'fresher', 'looking', 'developer', 'engineer', 'designer',
  'applying', 'available', 'having', 'currently', 'working', 'ready', 'graduate',
  'experienced', 'searching', 'writing', 'calling', 'here', 'sharing', 'attaching',
  'sending', 'pleased', 'excited', 'happy', 'seeking', 'qualified',
  'certified', 'passionate', 'contacting', 'reaching', 'sir', 'mam', 'maam',
  'candidate', 'job', 'applicant', 'telecaller', 'bpo', 'sales', 'hr', 'recruiter',
  'good', 'fine', 'ok', 'sure', 'well', 'from', 'with', 'new', 'an', 'the', 'a',
  'not', 'very', 'so', 'just', 'also', 'serving', 'immediate', 'this', 'that', 'there',
  'please', 'plz', 'help', 'resume', 'cv', 'profile', 'regarding', 'urgent', 'hiring'
]);

function extractCandidateNameAI(text) {
  if (!text) return '';
  const patterns = [
    /(?:(?:hi|hello|hey|namaste|dear\s+sir|dear\s+madam|dear\s+hr|dear\s+team)[,\s.-]*)?(?:i\s*am|i'm|im|my\s*name\s*is|myself|this\s*is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i,
    /(?:mera\s*naam|main|mai)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:hai|bol\s*raha|bol\s*rahi)\b/i,
    /(?:^|\n|\[Candidate\]:\s*|\.\s+)([A-Za-z]+(?:\s+[A-Za-z]+)?)\s*(?:here|this\s*side)\b/i,
    /(?:(?:regards|thanks\s*(?:&|and)?\s*regards|warm\s*regards|best|sincerely)[,\s\n]+)([A-Za-z]+(?:\s+[A-Za-z]+)?)/i,
    /(?:name|candidate\s*name)\s*[:=-]\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/i
  ];

  for (const pat of patterns) {
    const match = text.match(pat);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const parts = candidate.split(/\s+/).map(p => p.replace(/[^a-zA-Z]/g, '')).filter(p => p.length > 0);
      if (parts.length > 0) {
        const firstWord = parts[0].toLowerCase();
        if (!NON_NAME_WORDS.has(firstWord) && firstWord.length >= 2) {
          const validParts = [firstWord];
          if (parts.length > 1) {
            const secondWord = parts[1].toLowerCase();
            if (!NON_NAME_WORDS.has(secondWord) && secondWord.length >= 2) {
              validParts.push(secondWord);
            }
          }
          return validParts.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        }
      }
    }
  }
  return '';
}

let cachedConfig = {
  recruiterName: "Jinendra",
  webhookUrl: "http://DESKTOP-GLVB82A:3000/api/webhook",
  autoSync: true,
  stealthMode: false
};

// Tracks the last synced chat text per candidate to detect new incoming/outgoing messages
const lastSyncedChatMap = new Map(); // dedupeKey -> fullText
const candidateLeadRegistry = new Set(); // Candidates confirmed as leads

// Load initial config
chrome.storage.local.get(["recruiterName", "webhookUrl", "autoSync", "stealthMode"], (res) => {
  if (res.recruiterName) cachedConfig.recruiterName = res.recruiterName;
  if (res.webhookUrl) cachedConfig.webhookUrl = res.webhookUrl;
  if (res.autoSync !== undefined) cachedConfig.autoSync = res.autoSync;
  if (res.stealthMode !== undefined) cachedConfig.stealthMode = res.stealthMode;
});

// Listen for config changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.recruiterName) cachedConfig.recruiterName = changes.recruiterName.newValue;
  if (changes.webhookUrl) cachedConfig.webhookUrl = changes.webhookUrl.newValue;
  if (changes.autoSync !== undefined) cachedConfig.autoSync = changes.autoSync.newValue;
  if (changes.stealthMode !== undefined) cachedConfig.stealthMode = changes.stealthMode.newValue;
});

// Helper: Extract valid phone or name from conversation header
function getHeaderCandidateTitle(headerEl) {
  if (!headerEl) return "";
  const allHeaderText = headerEl.innerText || "";

  // 1. Phone number match in header
  const phoneMatch = allHeaderText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) || allHeaderText.match(/\+?\d[\d\s-]{9,}\d/);
  if (phoneMatch) return phoneMatch[0].trim();

  // 2. Clickable contact title
  const titleEl = headerEl.querySelector(
    "span[data-testid='conversation-info-header-chat-title'], div[role='button'] span[dir='auto'], span[title]"
  );
  if (titleEl) {
    const val = (titleEl.getAttribute("title") || titleEl.innerText || "").trim();
    if (val && !IGNORE_WORDS.some(w => val.toLowerCase().includes(w))) return val;
  }

  // 3. Fallback text lines
  const lines = allHeaderText.split("\n").map(s => s.trim()).filter(s => s && !IGNORE_WORDS.some(w => s.toLowerCase().includes(w)));
  return lines[0] || "";
}

// Extract Full End-to-End Chat History from the open conversation DOM
function extractFullChatTranscript(mainArea) {
  if (!mainArea) return "";

  // Find all message bubbles in conversation
  const msgEls = mainArea.querySelectorAll("div.message-in, div.message-out, div[data-testid='msg-container'], div[class*='message-in'], div[class*='message-out']");
  const transcript = [];

  msgEls.forEach(container => {
    // Check direction: message-out is recruiter, message-in is candidate
    const isOut = container.classList.contains("message-out") || container.className.includes("message-out");
    const sender = isOut ? "Recruiter" : "Candidate";

    const textEl = container.querySelector(".selectable-text, .copyable-text, span[dir='ltr']") || container;
    const raw = (textEl.innerText || "").trim();

    if (raw && !raw.includes("Messages and calls are end-to-end") && !raw.includes("Type a message") && raw.length > 0) {
      transcript.push(`[${sender}]: ${raw}`);
    }
  });

  return transcript.join("\n");
}

// Debounce timer for smooth updates
let updateDebounceTimer = null;

// Scan Active Open Chat: Detects leads AND continuously updates end-to-end chat!
function scanActiveChatContinuous() {
  const mainArea = document.querySelector("#main, div[data-testid='conversation-panel-wrapper']");
  if (!mainArea) return;

  const header = mainArea.querySelector("header, div[data-testid='conversation-header']") || document.querySelector("#main header");
  if (!header) return;

  const rawTitle = getHeaderCandidateTitle(header);
  if (!rawTitle) return;

  let phone = "";
  let name = "";
  const phoneClean = rawTitle.replace(/[^0-9+]/g, "");
  if (phoneClean.length >= 10) {
    phone = rawTitle;
    name = "Candidate (" + phoneClean.slice(-4) + ")";
  } else {
    name = rawTitle;
  }

  const dedupeKey = (phone || name).replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  if (!dedupeKey || dedupeKey.length < 3) return;

  // Extract entire conversation history currently loaded
  const fullTranscript = extractFullChatTranscript(mainArea);
  const fullChatLower = (fullTranscript + " " + mainArea.innerText).toLowerCase();

  // 🤖 AI Real Name Detection ("Hi I am Rahul" -> Name becomes Rahul!)
  const aiCandidateName = extractCandidateNameAI(fullTranscript || mainArea.innerText);
  if (aiCandidateName) {
    name = aiCandidateName;
  }

  // Check if keywords exist anywhere in this chat
  const hasKeyword = KEYWORDS.some(k => fullChatLower.includes(k));

  // If this chat has recruitment keywords, register as a tracked lead
  if (hasKeyword) {
    candidateLeadRegistry.add(dedupeKey);
  }

  // If this candidate is a registered lead, monitor for live conversation changes
  if (candidateLeadRegistry.has(dedupeKey)) {
    const previousSyncedText = lastSyncedChatMap.get(dedupeKey) || "";

    // If chat content has changed (new message received or sent by recruiter!)
    if (fullTranscript && fullTranscript !== previousSyncedText) {
      const isInitial = !previousSyncedText;
      // Immediately register in map so subsequent scan interval doesn't re-trigger or cancel
      lastSyncedChatMap.set(dedupeKey, fullTranscript);

      const doSync = () => {
        dispatchLead(name, phone, fullTranscript, isInitial);
      };

      if (isInitial) {
        // Instant sync for brand-new lead (Zero delay!)
        doSync();
      } else {
        // Debounce live ongoing chat additions
        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(doSync, 800);
      }
    }
  }
}

// Scan Sidebar for Unread Messages
function scanSidebarChats() {
  const sidebar = document.querySelector("#pane-side, div[aria-label='Chat list'], div[data-testid='chat-list']");
  if (!sidebar) return;

  const chatRows = sidebar.querySelectorAll("div[role='listitem'], div[data-testid='cell-frame-container'], div[class*='_ak72'], div[class*='_ak73']");
  
  chatRows.forEach(row => {
    const rowText = (row.innerText || "").toLowerCase();
    const hasKeyword = KEYWORDS.some(k => rowText.includes(k));
    if (!hasKeyword) return;

    -const titleEl = row.querySelector("span[title], span[dir='auto']");
    let rawTitle = titleEl ? (titleEl.getAttribute("title") || titleEl.innerText || "").trim() : "";
    if (!rawTitle) {
      const phoneMatch = row.innerText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) || row.innerText.match(/\+?\d[\d\s-]{9,}\d/);
      if (phoneMatch) rawTitle = phoneMatch[0].trim();
    }

    if (!rawTitle || IGNORE_WORDS.some(w => rawTitle.toLowerCase().includes(w))) return;

    let phone = "";
    let name = "";
    const phoneClean = rawTitle.replace(/[^0-9+]/g, "");
    if (phoneClean.length >= 10) {
      phone = rawTitle;
      name = "Candidate (" + phoneClean.slice(-4) + ")";
    } else {
      name = rawTitle;
    }

    // 🤖 AI Real Name Detection in preview
    const aiSidebarName = extractCandidateNameAI(row.innerText);
    if (aiSidebarName) name = aiSidebarName;

    const dedupeKey = (phone || name).replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    if (dedupeKey && !candidateLeadRegistry.has(dedupeKey)) {
      candidateLeadRegistry.add(dedupeKey);
      lastSyncedChatMap.set(dedupeKey, row.innerText.slice(0, 300));
      dispatchLead(name, phone, `[Candidate]: ${row.innerText.slice(0, 300)}`, true);
    }
  });
}

// Dispatch Lead to CRM (Backend automatically handles in-place updates vs initial creation!)
function dispatchLead(candidateName, candidatePhone, fullTranscriptText, isInitial = false) {
  // 🤖 AI Real Name Extraction ("Hi I am Rahul" -> Name becomes Rahul!)
  const aiName = extractCandidateNameAI(fullTranscriptText);
  const finalName = aiName || candidateName;

  // Extract candidate email if shared in WhatsApp chat
  let candidateEmail = "";
  const emailMatch = fullTranscriptText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    candidateEmail = emailMatch[0].toLowerCase().trim();
  }

  const payload = {
    source: "WhatsApp (Auto)",
    recruiter_name: cachedConfig.recruiterName || "",
    candidate_name: finalName,
    candidate_phone: candidatePhone || "",
    candidate_email: candidateEmail,
    text: fullTranscriptText
  };

  chrome.runtime.sendMessage({
    action: "SYNC_LEAD",
    webhookUrl: cachedConfig.webhookUrl || "http://DESKTOP-GLVB82A:3000/api/webhook",
    payload: payload
  }, (response) => {
    if (response && response.success) {
      console.log(`[Auto-CRM] 🚀 Synced (${isInitial ? 'New Lead' : 'Live Chat Update'}):`, candidateName, candidatePhone);
      const title = candidatePhone || candidateName;
      if (isInitial) {
        showToast(`⚡ New Lead Saved: ${title} -> CRM!`, "success");
      } else {
        showToast(`🔄 Chat Updated: ${title} -> CRM Transcript Live!`, "info");
      }
    } else {
      console.warn(`[Auto-CRM] Sync error:`, response ? response.error : chrome.runtime.lastError);
    }
  });
}

// In-app Toast Notification
function showToast(message, type = "info") {
  let toast = document.getElementById("wa-crm-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "wa-crm-toast";
    (document.body || document.documentElement).appendChild(toast);
  }

  toast.textContent = message;
  toast.className = `wa-crm-toast wa-crm-toast-${type} wa-crm-toast-visible`;

  setTimeout(() => {
    toast.className = toast.className.replace("wa-crm-toast-visible", "");
  }, 4000);
}

// Continuous Scanner: Runs every 1 second
setInterval(() => {
  if (cachedConfig.autoSync) {
    scanActiveChatContinuous();
    scanSidebarChats();
  }
}, 1000);
