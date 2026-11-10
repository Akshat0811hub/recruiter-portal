// ==========================================================================================
// WhatsApp Web Live Chat Syncer - Zero-Touch Real-Time Conversation Tracker
// - Wrapped in IIFE so live re-injection on extension reload never throws SyntaxError
// - Syncs new recruitment chats AND all ongoing chats with existing CRM candidates (by phone or name)
// - Skips 1-2 letter avatar initials ("O", "OA") when reading contact titles & sidebar previews
// - Captures bubble timestamps, PDF/DOCX resume names, latest CTC & Notice Period
// ==========================================================================================

(() => {
  if (window.__crmWaInterval) {
    clearInterval(window.__crmWaInterval);
  }
  if (window.__crmWaObserver) {
    try { window.__crmWaObserver.disconnect(); } catch (e) {}
  }

  const KEYWORDS = [
    "job", "position", "resume", "cv", "vacancy", "notice", "ctc", "salary",
    "interview", "fresher", "experience", "hike", "profile", "opening", "package", "lpa",
    "looking for", "hire", "hiring", "apply", "applied", "opportunity", "switch",
    "developer", "engineer", "designer", "telecaller", "bpo", "sales", "hr",
    "shortlisted", "joining", "relocate", "immediate", "mandate", ".pdf", ".docx",
    "expected", "current", "work", "qualification", "graduate", "location", "company", "interested"
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
    'ui', 'ux', 'qa', 'support', 'admin', 'orbitouch', 'outsourcing', 'unread', 'messages',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'yesterday',
    'suhani', 'sisodiya', 'pooja', 'jyoti', 'akshay', 'munisha', 'sakshi', 'akshita', 'divanshi',
    'gunjan', 'kamakshi', 'manshi', 'shriparna', 'neetu', 'kajal'
  ]);

  const RECRUITER_MAP = {
    "pooja": "Pooja Singh",
    "pooja singh": "Pooja Singh",
    "jyoti": "Jyoti Shah",
    "jyoti shah": "Jyoti Shah",
    "suhani": "Suhani Sisodiya",
    "suhani sisodiya": "Suhani Sisodiya",
    "akshay": "Akshay Pandey",
    "akshay pandey": "Akshay Pandey",
    "munisha": "Munisha Thakur",
    "munisha thakur": "Munisha Thakur",
    "sakshi": "Sakshi Kaur",
    "sakshi kaur": "Sakshi Kaur",
    "akshita": "Akshita Nayal",
    "akshita nayal": "Akshita Nayal",
    "divanshi": "Divanshi Gupta",
    "divanshi gupta": "Divanshi Gupta",
    "gunjan": "Gunjan Sharma",
    "gunjan sharma": "Gunjan Sharma",
    "kamakshi": "Kamakshi Kaushik",
    "kamakshi kaushik": "Kamakshi Kaushik",
    "manshi": "Manshi Agnihotri",
    "manshi agnihotri": "Manshi Agnihotri",
    "shriparna": "Shriparna Acharya",
    "shriparna acharya": "Shriparna Acharya",
    "neetu": "Neetu Sharma",
    "neetu sharma": "Neetu Sharma"
  };

  const RECRUITER_PHONES = new Set([
    "9211711379", "9211711373", "7428890976", "9211711369", "9211711367",
    "9266128957", "7303439933", "9289321002", "9266128964", "9211711372",
    "9266128961", "9211711378", "9289321004", "9773895027"
  ]);

  function normalizeRecruiterName(name) {
    if (!name) return "Suhani Sisodiya";
    const clean = String(name).replace(/\s*\(Alt\)$/i, "").trim();
    return RECRUITER_MAP[clean.toLowerCase()] || clean;
  }

  function detectRecruiterInText(text) {
    if (!text) return "";
    const m =
      String(text).match(/(?:this\s+side|this\s+is|i\s+am|myself)\s+(pooja|jyoti|suhani|akshay|munisha|sakshi|akshita|divanshi|gunjan|kamakshi|manshi|shriparna|neetu)\b/i) ||
      String(text).match(/(?:regards|thanks\s*(?:&|and)?\s*regards)[\s,:-]+(pooja|jyoti|suhani|akshay|munisha|sakshi|akshita|divanshi|gunjan|kamakshi|manshi|shriparna|neetu)\b/i) ||
      String(text).match(/\b(pooja|jyoti\.shah|suhani|akshay|munisha|sakshi|akshita|divanshi|gunjan|kamakshi|manshi|shriparna|neetu(?:\.sharma)?)@orbitouch-hr\.com/i);
    if (m && m[1]) {
      const key = m[1].toLowerCase().replace(".shah", "").replace(".sharma", "");
      return RECRUITER_MAP[key] || "";
    }
    return "";
  }

  function isRecruiterOutreachText(text) {
    if (!text) return false;
    const s = String(text).trim();
    return (
      /orbitouch/i.test(s) ||
      /(?:this\s+side|this\s+is|i\s+am|myself)\s+(?:pooja|jyoti|suhani|akshay|munisha|sakshi|akshita|divanshi|gunjan|kamakshi|manshi|shriparna|neetu)\b/i.test(s) ||
      /(?:this\s+side|this\s+is|i\s+am|myself)\s+[a-z]+\s*\(\s*hr\s*\)/i.test(s) ||
      /got\s+your\s+(?:profile|resume|cv|number|contact|reference)\s+from\s+(?:naukri|shine|linkedin|indeed|apna|workindia|foundit|monster|portal)/i.test(s) ||
      /\bwe\s+are\s+hiring\s+for\b/i.test(s) ||
      /\blet\s+me\s+know\s+if\s+you\s+are\s+(?:looking\s+for\s+(?:a\s+)?job\s+change|interested)/i.test(s) ||
      /\bas\s+per\s+our\s+(?:telephonic\s+conversation|discussion\s+on\s+call|conversation)/i.test(s) ||
      /\bshared\s+a\s+job\s+description\b/i.test(s) ||
      /\bplease\s+go\s+through\s+it\s+and\s+revert\b/i.test(s) ||
      /\brevert\s+(?:me\s+)?back\s+(?:along\s+)?with\s+your\s+updated\s+(?:resume|cv)\b/i.test(s) ||
      /\binterview\s+has\s+been\s+scheduled\b/i.test(s) ||
      /\bkindly\s+share\s+your\s+(?:updated\s+)?(?:resume|cv|current\s+ctc)\b/i.test(s) ||
      /(?:regards|thanks\s*(?:&|and)?\s*regards)[\s,:-]+(?:pooja|jyoti|suhani|akshay|munisha|sakshi|akshita|divanshi|gunjan|kamakshi|manshi|shriparna|neetu)\b/i.test(s)
    );
  }

  function extractRecruiterGreetingCandidateName(bodyText) {
    if (!bodyText) return "";
    const clean = String(bodyText).trim();
    const m = clean.match(/^(?:h+i+|hello|hey|dear|good\s+(?:morning|afternoon|evening))[,!\s\n]+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){0,3})[?.,!\s]*$/i);
    if (m && m[1]) {
      const candidate = cleanPersonName(m[1]);
      if (candidate && candidate.length >= 3) return candidate;
    }
    return "";
  }

  function matchesRecruitmentKeyword(text) {
    const lower = String(text || "").toLowerCase();
    return KEYWORDS.some(k => {
      if (k === "hr" || k === "cv") {
        return new RegExp(`\\b${k}\\b`, "i").test(lower);
      }
      return lower.includes(k);
    });
  }

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

    // 1. Check if Recruiter greeted the candidate by name (e.g., "Hii\n\nPrashant Ravindra Chaudhari")
    const greetingMatches = [
      ...String(text).matchAll(/(?:^|\n)(?:\[(?:Recruiter|Candidate)[^\]]*\]:\s*)?(?:h+i+|hello|hey|dear)[,!\s]+(?:\n+\s*)?([A-Za-z]{3,}(?:[ \t]+[A-Za-z]{2,}){1,2})\s*(?:\n|$)/gi)
    ];
    for (const gm of greetingMatches) {
      if (gm && gm[1]) {
        const cleaned = cleanPersonName(gm[1]);
        if (cleaned && cleaned.split(" ").length >= 2) return cleaned;
      }
    }

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

    const fileMatch = text.match(/([A-Za-z][A-Za-z0-9_ -]{2,50}?(?:resume|cv)[A-Za-z0-9_ ()-]*)\.(?:pdf|docx?|rtf)/i) ||
                      text.match(/(?:resume|cv)[_ -]+([A-Za-z][A-Za-z_ -]{2,40})\.(?:pdf|docx?|rtf)/i);
    if (fileMatch && fileMatch[1]) {
      const fromFile = cleanPersonName(fileMatch[1]);
      if (fromFile && fromFile.length >= 3) return fromFile;
    }

    return "";
  }

  let cachedConfig = {
    recruiterName: "Suhani Sisodiya",
    webhookUrl: "http://192.168.1.34:3000/api/webhook",
    autoSync: true,
    stealthMode: false
  };

  let knownCrmPhones = new Set();
  let knownCrmNames = new Set(["orbit akshat singh"]);
  const candidateLeadRegistry = new Set(["orbitakshatsingh"]);
  const lastSyncedHashMap = new Map(); // dedupeKey -> simple hash of last synced open transcript
  const lastSyncedSidebarHashMap = new Map(); // dedupeKey -> simple hash of last synced sidebar preview

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
      [
        "recruiterName",
        "webhookUrl",
        "autoSync",
        "stealthMode",
        "knownPhones",
        "knownCandidateNames",
        "waSyncedHashes",
        "waSidebarHashes",
        "waLeadRegistry",
        "waSyncSchemaVersion"
      ],
      (res) => {
        if (res.recruiterName) {
          cachedConfig.recruiterName = normalizeRecruiterName(res.recruiterName);
          if (cachedConfig.recruiterName !== res.recruiterName) {
            chrome.storage.local.set({ recruiterName: cachedConfig.recruiterName });
          }
        }
        if (res.webhookUrl) cachedConfig.webhookUrl = res.webhookUrl;
        if (res.autoSync !== undefined) cachedConfig.autoSync = res.autoSync;
        if (res.stealthMode !== undefined) cachedConfig.stealthMode = res.stealthMode;
        if (Array.isArray(res.knownPhones)) {
          knownCrmPhones = new Set(res.knownPhones);
        }
        if (Array.isArray(res.knownCandidateNames)) {
          res.knownCandidateNames.forEach(n => knownCrmNames.add(String(n).toLowerCase().trim()));
        }
        if (Array.isArray(res.waLeadRegistry)) {
          res.waLeadRegistry.forEach(k => candidateLeadRegistry.add(k));
        }

        // Only restore old hashes if schema version matches v5 (clears stale speaker hashes once)
        if (res.waSyncSchemaVersion === 5) {
          if (res.waSyncedHashes && typeof res.waSyncedHashes === "object") {
            Object.entries(res.waSyncedHashes).forEach(([k, v]) => lastSyncedHashMap.set(k, v));
          }
          if (res.waSidebarHashes && typeof res.waSidebarHashes === "object") {
            Object.entries(res.waSidebarHashes).forEach(([k, v]) => lastSyncedSidebarHashMap.set(k, v));
          }
        } else {
          chrome.storage.local.set({ waSyncSchemaVersion: 5, waSyncedHashes: {}, waSidebarHashes: {} });
        }

        // Trigger immediate scan once config is loaded
        setTimeout(() => {
          scanActiveChatContinuous();
          scanSidebarChats();
        }, 250);
      }
    );

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.recruiterName) cachedConfig.recruiterName = normalizeRecruiterName(changes.recruiterName.newValue);
      if (changes.webhookUrl) cachedConfig.webhookUrl = changes.webhookUrl.newValue;
      if (changes.autoSync !== undefined) cachedConfig.autoSync = changes.autoSync.newValue;
      if (changes.stealthMode !== undefined) cachedConfig.stealthMode = changes.stealthMode.newValue;
      if (changes.knownPhones && Array.isArray(changes.knownPhones.newValue)) {
        knownCrmPhones = new Set(changes.knownPhones.newValue);
      }
      if (changes.knownCandidateNames && Array.isArray(changes.knownCandidateNames.newValue)) {
        changes.knownCandidateNames.newValue.forEach(n => knownCrmNames.add(String(n).toLowerCase().trim()));
      }
    });
  }

  let persistTimer = null;
  function persistSyncState() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (!chrome?.runtime?.id) return;
      const hashObj = {};
      Array.from(lastSyncedHashMap.entries()).slice(-300).forEach(([k, v]) => { hashObj[k] = v; });
      const sidebarHashObj = {};
      Array.from(lastSyncedSidebarHashMap.entries()).slice(-300).forEach(([k, v]) => { sidebarHashObj[k] = v; });
      chrome.storage.local.set({
        waSyncSchemaVersion: 5,
        waSyncedHashes: hashObj,
        waSidebarHashes: sidebarHashObj,
        waLeadRegistry: Array.from(candidateLeadRegistry).slice(-300)
      });
    }, 1000);
  }

  function phoneKey10(raw) {
    const d = String(raw || "").replace(/[^0-9]/g, "");
    return d.length >= 10 ? d.slice(-10) : "";
  }

  function isGroupOrInternalHeader(headerEl, title) {
    if (!title) return true;
    if (INTERNAL_GROUP_REGEX.some(rx => rx.test(title))) return true;
    if (/orbitouch\s*(?:outsourcing|team|reporting|agency|internal|management)/i.test(title)) return true;

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

  function isNoiseHeaderText(val) {
    if (!val) return true;
    const lower = val.toLowerCase().trim();
    if (IGNORE_HEADER_WORDS.some(w => lower.includes(w))) return true;
    if (/^(?:online|typing\.*|last seen.*|click here.*|business account|select messages|default-user|ic-.*)$/i.test(lower)) return true;
    if (/^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(lower)) return true;
    if (/^(?:yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(lower)) return true;
    return false;
  }

  function extractSidebarRowTitle(row, rawRowText) {
    if (!row) return "";
    // 1. First check span[title] (Contact name or phone always has a title attribute; 1-letter avatars do NOT!)
    const titledSpans = row.querySelectorAll("span[title]");
    for (const sp of titledSpans) {
      const t = (sp.getAttribute("title") || "").trim();
      if (t && t.length >= 2 && !isNoiseHeaderText(t) && !/unread message/i.test(t)) {
        return t;
      }
    }

    // 2. Check phone number in row text
    const pm = rawRowText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) || rawRowText.match(/\+?\d[\d\s-]{9,}\d/);
    if (pm) return pm[0].trim();

    // 3. Fallback to span[dir='auto'], explicitly skipping 1-2 character avatar initials ("O", "OA")
    const autoSpans = row.querySelectorAll("span[dir='auto']");
    for (const sp of autoSpans) {
      const t = (sp.innerText || "").trim();
      if (t && t.length >= 3 && !isNoiseHeaderText(t) && !/unread message/i.test(t)) {
        return t;
      }
    }
    return "";
  }

  function getHeaderCandidateTitle(headerEl) {
    if (headerEl) {
      // 1. Check explicit title span or span[title] first (never matches 1-letter avatar initial!)
      const titledEls = headerEl.querySelectorAll(
        "span[data-testid='conversation-info-header-chat-title'], span[title]"
      );
      for (const el of titledEls) {
        const val = (el.getAttribute("title") || el.innerText || "").trim();
        if (val && val.length >= 2 && !isNoiseHeaderText(val)) return val;
      }

      // 2. Check phone number inside header text
      const allHeaderText = headerEl.innerText || "";
      const phoneMatch = allHeaderText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) ||
                         allHeaderText.match(/\+?\d[\d\s-]{9,}\d/);
      if (phoneMatch) return phoneMatch[0].trim();

      // 3. Check span[dir='auto'], skipping 1-2 character avatar initials ("O", "OA")
      const autoEls = headerEl.querySelectorAll("span[dir='auto']");
      for (const el of autoEls) {
        const val = (el.innerText || "").trim();
        if (val && val.length >= 3 && !isNoiseHeaderText(val)) return val;
      }

      // 4. Fallback to lines of headerEl.innerText with length >= 3
      const lines = allHeaderText
        .split("\n")
        .map(s => s.trim())
        .filter(s => s && s.length >= 3 && !isNoiseHeaderText(s));
      if (lines[0]) return lines[0];
    }

    // 5. Fallback: check active selected row in sidebar (#pane-side)
    const activeRow = document.querySelector("#pane-side [aria-selected='true'], div[aria-label='Chat list'] [aria-selected='true']");
    if (activeRow) {
      return extractSidebarRowTitle(activeRow, activeRow.innerText || "");
    }
    return "";
  }

  function extractPhoneFromDOM(containerEl, headerEl) {
    if (headerEl) {
      const hText = headerEl.innerText || "";
      const pm = hText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) || hText.match(/\+?\d[\d\s-]{9,}\d/);
      if (pm && phoneKey10(pm[0]).length === 10) return pm[0].trim();
    }
    if (containerEl) {
      const idEls = containerEl.querySelectorAll("[data-id*='@c.us']");
      for (const el of idEls) {
        const did = el.getAttribute("data-id") || "";
        const m = did.match(/(?:true|false)_(\d{10,15})@c\.us/);
        if (m && m[1]) {
          return "+" + m[1];
        }
      }
    }
    return "";
  }

  function extractCompensationDetails(text) {
    let currentCtc = "";
    let expectedCtc = "";
    let noticePeriod = "";

    const ctcAll = [
      ...String(text || "").matchAll(/(?:current\s*(?:ctc|salary|pkg|package)?|cctc|drawing|present\s*(?:ctc|salary))\s*(?:is|around|of)?\s*[:=-]?\s*(\d+(?:\.\d+)?\s*(?:lpa|lakhs?|lac|k|pm)?)/gi),
      ...String(text || "").matchAll(/(?:^|\n|\b)(?<!expected\s)(?<!exp\s)ctc\s*(?:is|around|of)?\s*[:=-]\s*(\d+(?:\.\d+)?\s*(?:lpa|lakhs?|lac|k|pm)?)/gi)
    ];
    if (ctcAll.length > 0) currentCtc = ctcAll[ctcAll.length - 1][1].trim();

    const expAll = [
      ...String(text || "").matchAll(/(?:expected\s*(?:ctc|salary|pkg|package)?|ectc|ext\b|exp\s*ctc|expecting)\s*(?:is|around|of)?\s*[:=-]?\s*(\d+(?:\.\d+)?\s*(?:lpa|lakhs?|lac|k|pm)?)/gi)
    ];
    if (expAll.length > 0) expectedCtc = expAll[expAll.length - 1][1].trim();

    const npAll = [
      ...String(text || "").matchAll(/(?:notice\s*(?:period)?|np)\s*(?:is|of)?\s*[:=-]?\s*(\d+\s*(?:days?|months?|weeks?)|immediate(?:\s*joiner)?|serving(?:\s*notice)?)/gi),
      ...String(text || "").matchAll(/(\d+\s*(?:days?|months?|weeks?))\s*notice/gi),
      ...String(text || "").matchAll(/\b(immediate\s*joiner|serving\s*notice)\b/gi)
    ];
    if (npAll.length > 0) noticePeriod = npAll[npAll.length - 1][1].trim();

    return { currentCtc, expectedCtc, noticePeriod };
  }

  function extractFullChatTranscript(mainArea, rawTitle = "") {
    if (!mainArea) return "";

    let rawEls = Array.from(mainArea.querySelectorAll("div.message-in, div.message-out"));
    if (rawEls.length === 0) {
      rawEls = Array.from(mainArea.querySelectorAll("div[data-testid='msg-container']"));
    }
    if (rawEls.length === 0) {
      rawEls = Array.from(mainArea.querySelectorAll("div[data-id^='true_'], div[data-id^='false_']"));
    }
    if (rawEls.length === 0) {
      rawEls = Array.from(mainArea.querySelectorAll("div[role='row']"));
    }

    const msgEls = rawEls.filter(el => !rawEls.some(other => other !== el && other.contains(el)));
    let defaultRecruiter = normalizeRecruiterName(cachedConfig.recruiterName || "Suhani Sisodiya");
    const mainRect = mainArea.getBoundingClientRect();
    const headerPKey = phoneKey10(rawTitle);
    const headerNorm = String(rawTitle || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const parsedMessages = [];

    msgEls.forEach(container => {
      const dataId =
        container.getAttribute("data-id") ||
        container.closest("[data-id]")?.getAttribute("data-id") ||
        container.querySelector("[data-id]")?.getAttribute("data-id") ||
        "";
      let isOut = false;

      // Signal 1: Explicit data-id or message-out class
      if (dataId.startsWith("true_")) {
        isOut = true;
      } else if (dataId.startsWith("false_")) {
        isOut = false;
      } else {
        isOut =
          container.classList.contains("message-out") ||
          (container.className && String(container.className).includes("message-out")) ||
          !!container.closest(".message-out, [class*='message-out']") ||
          !!container.querySelector(".message-out, [class*='message-out']");
      }

      // Signal 2: Outgoing delivery status checkmarks / aria-labels
      if (
        !isOut &&
        container.querySelector(
          "span[data-icon*='check'], span[data-icon*='dblcheck'], span[data-icon='msg-time'], [aria-label*='Delivered'], [aria-label*='Read'], [aria-label*='Sent']"
        )
      ) {
        isOut = true;
      }

      let msgTime = "";
      let preSender = "";
      const copyable = container.querySelector(".copyable-text[data-pre-plain-text]");
      if (copyable) {
        const pre = copyable.getAttribute("data-pre-plain-text") || "";
        const tm = pre.match(/\[([^\]]+)\]/);
        if (tm) msgTime = tm[1].trim();
        const sm = pre.match(/\]\s*([^:]+):/);
        if (sm) preSender = sm[1].trim();
      }
      if (!msgTime) {
        const metaEl = container.querySelector("div[data-testid='msg-meta'] span, span.x1rg5ohu");
        if (metaEl && /\d{1,2}:\d{2}/.test(metaEl.innerText || "")) {
          msgTime = metaEl.innerText.trim();
        }
      }

      // Signal 3: Compare data-pre-plain-text Sender against Header Candidate Title / Recruiter identity
      if (!isOut && preSender && !dataId.startsWith("false_")) {
        const senderPKey = phoneKey10(preSender);
        const senderNorm = preSender.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
          /orbitouch|^(?:you|suhani|neetu|shriparna|pooja|jyoti|akshay|munisha|sakshi|akshita|divanshi|gunjan|kamakshi|manshi)\b/i.test(preSender) ||
          (senderPKey && RECRUITER_PHONES.has(senderPKey))
        ) {
          isOut = true;
        } else if (headerPKey && senderPKey && headerPKey !== senderPKey) {
          isOut = true;
        } else if (headerNorm && senderNorm && headerNorm !== senderNorm && !headerNorm.includes(senderNorm) && !senderNorm.includes(headerNorm)) {
          isOut = true;
        }
      }

      const rawSelectableEls = Array.from(container.querySelectorAll(".selectable-text"));
      const selectableEls = rawSelectableEls.filter(
        el => !rawSelectableEls.some(other => other !== el && other.contains(el))
      );
      let bodyText = "";
      if (selectableEls.length > 0) {
        bodyText = selectableEls.map(el => (el.innerText || "").trim()).filter(Boolean).join("\n");
      } else if (copyable) {
        bodyText = (copyable.innerText || "").trim();
      } else {
        bodyText = (container.innerText || "").trim();
      }

      const docEl = container.querySelector("span[title*='.pdf'], span[title*='.doc'], div[data-testid='document-thumb']");
      if (docEl) {
        const docName = (docEl.getAttribute("title") || docEl.innerText || "").trim();
        if (docName && !bodyText.includes(docName)) {
          bodyText = bodyText ? `📄 ${docName}\n${bodyText}` : `📄 ${docName}`;
        }
      }

      bodyText = bodyText
        .replace(/(?:\s*\bEdited\s*)?\n?\d{1,2}:\d{2}\s*(?:am|pm)?$/i, "")
        .replace(/\bEdited\s*$/i, "")
        .trim();

      // Signal 4: Geometric Right-Alignment Check on the bubble element inside #main
      if (!isOut && !dataId.startsWith("false_") && mainRect && mainRect.width > 240) {
        const bubbleProbe = copyable || selectableEls[0] || container.querySelector("div[data-testid='msg-container']");
        if (bubbleProbe) {
          const bRect = bubbleProbe.getBoundingClientRect();
          if (bRect.width > 0) {
            const leftGap = bRect.left - mainRect.left;
            const rightGap = mainRect.right - bRect.right;
            if (leftGap > rightGap + 25 && leftGap > 95) {
              isOut = true;
            }
          }
        }
      }

      // Signal 5: Linguistic Recruiter Outreach Detection
      if (isRecruiterOutreachText(bodyText)) {
        isOut = true;
        const detectedRec = detectRecruiterInText(bodyText);
        if (detectedRec) defaultRecruiter = detectedRec;
      }

      if (
        bodyText &&
        !bodyText.includes("Messages and calls are end-to-end") &&
        !bodyText.includes("Type a message") &&
        !bodyText.includes("This message was deleted") &&
        !/^\d+\s+unread\s+messages?$/i.test(bodyText) &&
        !/^(?:today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(bodyText) &&
        bodyText.length > 0
      ) {
        parsedMessages.push({ isOut, msgTime, bodyText });
      }
    });

    // Greeting Adjacency Pass: if a bubble is "Hii\n\n<Candidate Name>" right before a Recruiter outreach bubble (or at the same timestamp),
    // it was also sent by the Recruiter!
    for (let i = 0; i < parsedMessages.length; i++) {
      if (!parsedMessages[i].isOut) {
        const greetName = extractRecruiterGreetingCandidateName(parsedMessages[i].bodyText);
        const nextMsg = parsedMessages[i + 1];
        if (
          greetName &&
          nextMsg &&
          (nextMsg.isOut || (parsedMessages[i].msgTime && parsedMessages[i].msgTime === nextMsg.msgTime))
        ) {
          parsedMessages[i].isOut = true;
        }
      }
    }

    return parsedMessages
      .map(m => {
        const sender = m.isOut ? `Recruiter - ${defaultRecruiter}` : "Candidate";
        const label = m.msgTime ? `[${sender} (${m.msgTime})]` : `[${sender}]`;
        return `${label}: ${m.bodyText}`;
      })
      .join("\n");
  }

  let updateDebounceTimer = null;

  function scanActiveChatContinuous(forceRegister = false) {
    if (!chrome?.runtime?.id) return;
    const mainArea = document.querySelector("#main, div[data-testid='conversation-panel-wrapper']");
    if (!mainArea) return;

    const header = mainArea.querySelector("header, div[data-testid='conversation-header'], [role='banner']") || document.querySelector("#main header");
    const rawTitle = getHeaderCandidateTitle(header);
    if (!rawTitle || isGroupOrInternalHeader(header, rawTitle)) return;

    let phone = "";
    let name = "";
    const phoneClean = rawTitle.replace(/[^0-9+]/g, "");
    let pKey = phoneKey10(phoneClean);

    if (pKey.length >= 10) {
      phone = rawTitle;
      name = `Candidate (${pKey.slice(-4)})`;
    } else {
      name = rawTitle;
      const domPhone = extractPhoneFromDOM(mainArea, header);
      if (domPhone) {
        phone = domPhone;
        pKey = phoneKey10(domPhone);
      }
    }

    const nameKey = name.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const dedupeKey = pKey || nameKey;
    if (!dedupeKey || dedupeKey.length < 2) return;

    const fullTranscript = extractFullChatTranscript(mainArea, rawTitle);
    if (!fullTranscript) return;

    const extractedName = extractCandidateName(fullTranscript);
    if (extractedName && (!name || name.startsWith("Candidate ("))) name = extractedName;

    const hasKeyword = matchesRecruitmentKeyword(fullTranscript);
    const isKnownInCrm =
      Boolean(pKey && knownCrmPhones.has(pKey)) ||
      Boolean(name && knownCrmNames.has(name.toLowerCase().trim())) ||
      candidateLeadRegistry.has(dedupeKey) ||
      candidateLeadRegistry.has(nameKey);

    if (hasKeyword || isKnownInCrm || forceRegister) {
      candidateLeadRegistry.add(dedupeKey);
      if (nameKey) candidateLeadRegistry.add(nameKey);
    }

    if (candidateLeadRegistry.has(dedupeKey) || candidateLeadRegistry.has(nameKey)) {
      const currentHash = quickHash(fullTranscript);
      const prevHash = lastSyncedHashMap.get(dedupeKey);

      if (currentHash !== prevHash) {
        const isInitial = !prevHash;
        lastSyncedHashMap.set(dedupeKey, currentHash);
        persistSyncState();

        const doSync = () => {
          dispatchLead(name, phone, fullTranscript, isInitial, false);
        };

        if (isInitial || forceRegister) {
          doSync();
        } else {
          if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
          updateDebounceTimer = setTimeout(doSync, 400);
        }
      }
    }
  }

  // Sidebar Scanner: Captures unread / today's new incoming leads & ongoing sidebar updates
  function scanSidebarChats() {
    if (!chrome?.runtime?.id) return;
    const sidebar = document.querySelector("#pane-side, div[aria-label='Chat list'], div[data-testid='chat-list']");
    if (!sidebar) return;

    const chatRows = sidebar.querySelectorAll("div[role='listitem'], div[data-testid='cell-frame-container']");

    chatRows.forEach(row => {
      const rawRowText = (row.innerText || "").trim();
      if (!rawRowText) return;

      const hasTodayTime = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(rawRowText);
      const hasUnread = !!row.querySelector("span[aria-label*='unread']");
      const hasRecentDate = /(?:yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.test(rawRowText);

      const rawTitle = extractSidebarRowTitle(row, rawRowText);
      if (!rawTitle || isNoiseHeaderText(rawTitle)) return;
      if (INTERNAL_GROUP_REGEX.some(rx => rx.test(rawTitle)) || /orbitouch\s*(?:outsourcing|team|reporting|agency|internal|management)/i.test(rawTitle)) return;

      let phone = "";
      let name = "";
      let pKey = phoneKey10(rawTitle);
      if (pKey.length >= 10) {
        phone = rawTitle;
        name = `Candidate (${pKey.slice(-4)})`;
      } else {
        name = rawTitle;
        const rowDomPhone = extractPhoneFromDOM(row, null);
        if (rowDomPhone) {
          phone = rowDomPhone;
          pKey = phoneKey10(rowDomPhone);
        }
      }

      const nameKey = name.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
      const dedupeKey = pKey || nameKey;
      const isKnown =
        Boolean(pKey && knownCrmPhones.has(pKey)) ||
        Boolean(name && knownCrmNames.has(name.toLowerCase().trim())) ||
        Boolean(dedupeKey && candidateLeadRegistry.has(dedupeKey)) ||
        Boolean(nameKey && candidateLeadRegistry.has(nameKey));
      const hasKeyword = matchesRecruitmentKeyword(rawRowText);

      if (!hasKeyword && !isKnown) return;
      if (!hasTodayTime && !hasUnread && !hasRecentDate && !isKnown) return;

      const cleanLines = rawRowText
        .split("\n")
        .map(s => s.trim())
        .filter((s, idx) => {
          if (!s || s === rawTitle) return false;
          if (idx === 0 && /^[A-Z]{1,2}$/.test(s)) return false; // Skip 1-2 letter avatar initial ("O", "OA")
          if (/^\d+$/.test(s)) return false;
          if (/unread message/i.test(s)) return false;
          if (/^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(s)) return false;
          if (/^(?:yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/i.test(s)) return false;
          return true;
        });

      const previewBody = cleanLines
        .join(" ")
        .replace(/(?:\s*\bEdited\s*)?\n?\d{1,2}:\d{2}\s*(?:am|pm)?$/i, "")
        .slice(0, 350)
        .trim();
      if (!previewBody) return;

      const extracted = extractCandidateName(previewBody);
      if (extracted && (!name || name.startsWith("Candidate ("))) name = extracted;

      const hasOutCheckmark = !!row.querySelector(
        "span[data-icon*='check'], span[data-icon*='dblcheck'], span[data-icon='status-check'], span[data-icon='status-dblcheck'], [aria-label*='Delivered'], [aria-label*='Read'], [aria-label*='Sent']"
      );
      const isRecruiterPreview = !hasUnread && (hasOutCheckmark || isRecruiterOutreachText(previewBody));
      const detectedRec = detectRecruiterInText(previewBody) || normalizeRecruiterName(cachedConfig.recruiterName || "Suhani Sisodiya");
      const previewTranscript = isRecruiterPreview
        ? `[Recruiter - ${detectedRec}]: ${previewBody}`
        : `[Candidate]: ${previewBody}`;

      const previewHash = quickHash(previewTranscript);
      const prevSidebarHash = lastSyncedSidebarHashMap.get(dedupeKey);

      if (dedupeKey && previewHash !== prevSidebarHash) {
        const isInitial = !prevSidebarHash && !lastSyncedHashMap.has(dedupeKey);
        candidateLeadRegistry.add(dedupeKey);
        if (nameKey) candidateLeadRegistry.add(nameKey);
        lastSyncedSidebarHashMap.set(dedupeKey, previewHash);
        persistSyncState();
        dispatchLead(name, phone, previewTranscript, isInitial, true);
      }
    });
  }

  function dispatchLead(candidateName, candidatePhone, fullTranscriptText, isInitial = false, isPreview = false) {
    if (!chrome?.runtime?.id) return;

    const extracted = extractCandidateName(fullTranscriptText);
    const finalName = (extracted && (!candidateName || candidateName.startsWith("Candidate ("))) ? extracted : candidateName;

    let candidateEmail = "";
    const emailMatches = fullTranscriptText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const em of emailMatches) {
      const cleanEm = em.toLowerCase().trim();
      if (!cleanEm.endsWith("@orbitouch-hr.com")) {
        candidateEmail = cleanEm;
        break;
      }
    }

    const comp = extractCompensationDetails(fullTranscriptText);
    const recruiter = normalizeRecruiterName(cachedConfig.recruiterName || "Suhani Sisodiya");

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
            if (finalName) knownCrmNames.add(finalName.toLowerCase().trim());
            if (isInitial || action === "created") {
              showToast("Synced to CRM", "success");
            } else {
              showToast("Conversation updated", "info");
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
    }, 2200);
  }

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.action === "TRIGGER_SYNC_SCAN") {
        scanSidebarChats();
        scanActiveChatContinuous();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && cachedConfig.autoSync) {
      setTimeout(() => scanActiveChatContinuous(true), 400);
    }
  }, true);

  document.addEventListener("click", (e) => {
    if (!cachedConfig.autoSync) return;
    const sendBtn = e.target?.closest?.("button[aria-label*='Send'], span[data-icon='send'], [data-testid='send']");
    if (sendBtn) {
      setTimeout(() => scanActiveChatContinuous(true), 400);
    }
  }, true);

  // Instant DOM MutationObserver so new incoming/outgoing bubbles trigger within 350ms
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    if (!cachedConfig.autoSync) return;
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      scanActiveChatContinuous();
      scanSidebarChats();
    }, 350);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__crmWaObserver = observer;
  }

  // Continuous Live Scanner every 1.0s
  window.__crmWaInterval = setInterval(() => {
    if (cachedConfig.autoSync) {
      scanActiveChatContinuous();
      scanSidebarChats();
    }
  }, 1000);
})();
