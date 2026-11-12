// ==========================================================================================
// ⚡ OrbitSales CRM — Gmail Millisecond Live Thread & Inbox Syncer
// - Auto-maps Sales Team Emails:
//     * archana@orbitouch-hr.com, archana@orbitverify.com -> Archana
//     * hello@orbitouch-hr.com, hello@orbitverify.com -> Rahul
//     * vishal@orbitouch-hr.com -> Vishal
//     * jinendra@orbitouch-hr.com -> Jinendra
// - Captures 100% of post-install / today client & salesperson emails (Zero Keyword Drop!)
// -Clearly attributes every message in the thread to [Sales - <Salesperson>] vs [Client - <Client>]
// ==========================================================================================

(() => {
  if (window.__salesCrmGmailInterval) {
    clearInterval(window.__salesCrmGmailInterval);
  }
  if (window.__salesCrmGmailObserver) {
    try { window.__salesCrmGmailObserver.disconnect(); } catch (e) {}
  }

  const IGNORE_SUBJECT_WORDS = [
    "security alert", "verify your account", "password reset",
    "google workspace", "delivery status notification"
  ];

  const EMAIL_TO_SALES_MAP = {
    "archana@orbitouch-hr.com": "Archana",
    "archana@orbitverify.com": "Archana",
    "hello@orbitouch-hr.com": "Rahul",
    "hello@orbitverify.com": "Rahul",
    "rahul@orbitouch-hr.com": "Rahul",
    "vishal@orbitouch-hr.com": "Vishal",
    "jinendra@orbitouch-hr.com": "Jinendra"
  };

  const SALES_MAP = {
    "jinendra": "Jinendra",
    "vishal": "Vishal",
    "rahul": "Rahul",
    "archana": "Archana"
  };

  function normalizeSalesName(name, email = "") {
    const cleanEmail = String(email || "").toLowerCase().trim();
    if (cleanEmail && EMAIL_TO_SALES_MAP[cleanEmail]) {
      return EMAIL_TO_SALES_MAP[cleanEmail];
    }
    if (!name) return "Jinendra";
    const clean = String(name).replace(/\s*\(Alt\)$/i, "").trim();
    const lower = clean.toLowerCase();
    for (const [k, v] of Object.entries(SALES_MAP)) {
      if (lower.includes(k)) return v;
    }
    return clean;
  }

  function isSalesOrAutomatedEmail(email) {
    const e = String(email || "").toLowerCase().trim();
    if (!e || !e.includes("@")) return true;
    if (EMAIL_TO_SALES_MAP[e]) return true;
    if (e.endsWith("@orbitouch-hr.com") || e.endsWith("@orbitverify.com")) return true;
    if (/^(?:no-?reply|updates-noreply|messages-noreply|donotreply|notifications|mailer-daemon|alerts|newsletter)@/i.test(e)) return true;
    if (/@(?:google\.com|accounts\.google\.com)$/i.test(e)) return true;
    return false;
  }

  let cachedConfig = {
    recruiterName: "Jinendra",
    webhookUrl: "http://192.168.1.34:3000/api/webhook",
    autoSync: true,
    stealthMode: false
  };

  let knownCrmEmails = new Set();
  const activeEmailRegistry = new Set();
  const lastSyncedEmailHashMap = new Map();
  const lastSyncedInboxPreviewHashMap = new Map();

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
      ["recruiterName", "webhookUrl", "autoSync", "stealthMode", "knownEmails", "salesGmailSyncedHashes", "salesGmailInboxHashes", "salesGmailLeadRegistry"],
      (res) => {
        if (res.recruiterName) {
          cachedConfig.recruiterName = normalizeSalesName(res.recruiterName);
        }
        if (res.webhookUrl) cachedConfig.webhookUrl = res.webhookUrl;
        if (res.autoSync !== undefined) cachedConfig.autoSync = res.autoSync;
        if (res.stealthMode !== undefined) cachedConfig.stealthMode = res.stealthMode;
        if (Array.isArray(res.knownEmails)) knownCrmEmails = new Set(res.knownEmails);
        if (Array.isArray(res.salesGmailLeadRegistry)) res.salesGmailLeadRegistry.forEach(e => activeEmailRegistry.add(e));
        if (res.salesGmailSyncedHashes && typeof res.salesGmailSyncedHashes === "object") {
          Object.entries(res.salesGmailSyncedHashes).forEach(([k, v]) => lastSyncedEmailHashMap.set(k, v));
        }
        if (res.salesGmailInboxHashes && typeof res.salesGmailInboxHashes === "object") {
          Object.entries(res.salesGmailInboxHashes).forEach(([k, v]) => lastSyncedInboxPreviewHashMap.set(k, v));
        }
      }
    );

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.recruiterName) cachedConfig.recruiterName = normalizeSalesName(changes.recruiterName.newValue);
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
      Array.from(lastSyncedEmailHashMap.entries()).slice(-400).forEach(([k, v]) => { hashObj[k] = v; });
      const inboxHashObj = {};
      Array.from(lastSyncedInboxPreviewHashMap.entries()).slice(-400).forEach(([k, v]) => { inboxHashObj[k] = v; });
      chrome.storage.local.set({
        salesGmailSyncedHashes: hashObj,
        salesGmailInboxHashes: inboxHashObj,
        salesGmailLeadRegistry: Array.from(activeEmailRegistry).slice(-400)
      });
    }, 800);
  }

  function getSalesEmailFromDOM() {
    const accountLink = document.querySelector(
      "a[aria-label*='Google Account:'], a[aria-label*='Google-Konto'], a[href*='SignOutOptions'], a[aria-label*='@']"
    );
    if (accountLink) {
      const raw = accountLink.getAttribute("aria-label") || accountLink.title || "";
      const m = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (m) {
        const detectedEmail = m[1].toLowerCase().trim();
        const mappedSales = EMAIL_TO_SALES_MAP[detectedEmail];
        if (mappedSales && cachedConfig.recruiterName !== mappedSales) {
          cachedConfig.recruiterName = mappedSales;
          if (chrome?.storage?.local) {
            chrome.storage.local.set({ recruiterName: mappedSales });
          }
        }
        return detectedEmail;
      }
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

    const attachEls = msgEl.querySelectorAll("span.aV3, div.aQA span");
    const attachNames = [];
    attachEls.forEach(a => {
      const fn = (a.innerText || "").trim();
      if (fn && /\.(pdf|docx?|xlsx?|csv|rtf|txt|pptx?)$/i.test(fn) && !attachNames.includes(fn)) {
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

    const salesEmail = getSalesEmailFromDOM();
    const salesPerson = normalizeSalesName(cachedConfig.recruiterName, salesEmail);

    const rawContainers = Array.from(mainArea.querySelectorAll("div.adn, div.kv, div[data-message-id]"));
    const msgContainers = rawContainers.filter(el => !rawContainers.some(other => other !== el && other.contains(el)));
    if (msgContainers.length === 0) return;

    let clientEmail = "";
    let clientName = "";
    const transcriptLines = [`Subject: ${subject}`, "--------------------------------------------------"];
    const structuredMessages = [];
    const seenBlocks = new Set();
    let fullThreadText = subject;
    let clientTextOnly = "";

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

      fullThreadText += " " + bodyText;

      const timeEl = msg.querySelector("span.g3, .gH span[title]");
      const timeStr = timeEl ? (timeEl.getAttribute("title") || timeEl.innerText || "").trim() : "";

      const isFromSales =
        (salesEmail && rawEmail === salesEmail) ||
        Boolean(EMAIL_TO_SALES_MAP[rawEmail]) ||
        rawEmail.endsWith("@orbitouch-hr.com") ||
        rawEmail.endsWith("@orbitverify.com") ||
        (salesPerson && rawName.toLowerCase().includes(salesPerson.toLowerCase())) ||
        rawName.toLowerCase().includes("orbitouch") ||
        rawName.toLowerCase().includes("orbitverify");

      if (isFromSales) {
        const activeSales = EMAIL_TO_SALES_MAP[rawEmail] || salesPerson;
        transcriptLines.push(`[Sales - ${activeSales}${timeStr ? " (" + timeStr + ")" : ""}]: ${bodyText}`);
        structuredMessages.push({
          isOut: true,
          senderRole: "sales",
          salesPerson: activeSales,
          clientName: clientName || "Client",
          msgTime: timeStr,
          text: bodyText
        });
      } else {
        if (rawEmail && !clientEmail && !isSalesOrAutomatedEmail(rawEmail)) {
          clientEmail = rawEmail;
          clientName = rawName || rawEmail.split("@")[0];
        }
        clientTextOnly += "\n" + bodyText;
        const cLabel = rawName || clientName || "Client";
        transcriptLines.push(`[Client - ${cLabel}${timeStr ? " (" + timeStr + ")" : ""}]: ${bodyText}`);
        structuredMessages.push({
          isOut: false,
          senderRole: "client",
          salesPerson,
          clientName: cLabel,
          msgTime: timeStr,
          text: bodyText
        });
      }
    });

    // Outbound first-email fallback: check recipient To field
    if (!clientEmail) {
      const toEls = mainArea.querySelectorAll("span.g2 span[email], span[email]");
      for (const toEl of toEls) {
        const toEmail = (toEl.getAttribute("email") || "").toLowerCase().trim();
        if (toEmail && !isSalesOrAutomatedEmail(toEmail)) {
          clientEmail = toEmail;
          clientName = (toEl.getAttribute("name") || "").trim() || toEmail.split("@")[0];
          break;
        }
      }
    }
    if (!clientEmail) {
      const bodyEmMatches = fullThreadText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      for (const m of bodyEmMatches) {
        const cleanM = m.toLowerCase().trim();
        if (!isSalesOrAutomatedEmail(cleanM)) {
          clientEmail = cleanM;
          break;
        }
      }
    }

    if (!clientEmail || isSalesOrAutomatedEmail(clientEmail)) return;

    const clientPhone = extractPhoneNumber(clientTextOnly || fullThreadText);
    const fullTranscript = transcriptLines.join("\n").trim();

    // Sync 100% of opened client email threads — zero keyword drop!
    activeEmailRegistry.add(clientEmail);

    if (subjectEl && !subjectEl.querySelector("#crm-synced-pill")) {
      const pill = document.createElement("span");
      pill.id = "crm-synced-pill";
      pill.style.cssText = "display:inline-flex;align-items:center;gap:4px;padding:2px 9px;margin-left:10px;background:linear-gradient(135deg,#4f46e5,#059669);color:#ffffff;border-radius:12px;font-size:11px;font-weight:700;vertical-align:middle;cursor:pointer;box-shadow:0 2px 6px rgba(79,70,229,0.25);";
      pill.textContent = "⚡ OrbitSales Live";
      pill.title = "Synced with OrbitSales CRM (Click to force refresh)";
      pill.onclick = (e) => {
        e.stopPropagation();
        lastSyncedEmailHashMap.delete(clientEmail);
        scanActiveEmailThread();
      };
      subjectEl.appendChild(pill);
    }

    const currentHash = quickHash(fullTranscript);
    const prevHash = lastSyncedEmailHashMap.get(clientEmail);

    if (currentHash !== prevHash) {
      const isInitial = !prevHash;
      lastSyncedEmailHashMap.set(clientEmail, currentHash);
      persistEmailState();

      const doSync = () => {
        dispatchEmailLead({
          candidateName: clientName || clientEmail.split("@")[0],
          candidateEmail: clientEmail,
          candidatePhone: clientPhone,
          subject,
          fullTranscript,
          messages: structuredMessages,
          isInitial,
          isPreview: false
        });
      };

      if (isInitial) {
        doSync();
      } else {
        if (emailUpdateDebounceTimer) clearTimeout(emailUpdateDebounceTimer);
        emailUpdateDebounceTimer = setTimeout(doSync, 120);
      }
    }
  }

  // Inbox Row Scanner: Captures today's / unread incoming & sent emails automatically
  function scanInboxRows() {
    if (!chrome?.runtime?.id) return;
    const rows = document.querySelectorAll("div[role='main'] tr.zA, tr.zA");
    if (!rows || rows.length === 0) return;

    const salesEmail = getSalesEmailFromDOM();
    const salesPerson = normalizeSalesName(cachedConfig.recruiterName, salesEmail);
    const seenEmailsInPass = new Set();

    rows.forEach(row => {
      const isUnread = row.classList.contains("zE");
      const timeCol = row.querySelector("td.xW span")?.innerText || "";
      const isTodayRow = /\d{1,2}:\d{2}/.test(timeCol);

      if (!isUnread && !isTodayRow) return;

      const senderEls = row.querySelectorAll("span.bA4 span[email], span[email]");
      let email = "";
      let senderEl = null;
      let isFromSalesRow = false;

      for (const sEl of senderEls) {
        const em = (sEl.getAttribute("email") || "").toLowerCase().trim();
        if (em && !isSalesOrAutomatedEmail(em)) {
          email = em;
          senderEl = sEl;
          break;
        } else if (em && (EMAIL_TO_SALES_MAP[em] || em.endsWith("@orbitouch-hr.com") || em.endsWith("@orbitverify.com"))) {
          isFromSalesRow = true;
        }
      }

      if (!email) return;
      if (seenEmailsInPass.has(email)) return;
      seenEmailsInPass.add(email);

      const rawName = senderEl ? (senderEl.getAttribute("name") || senderEl.innerText || "").trim() : "";
      const subjectEl = row.querySelector("span.bqe, span.bog");
      const snippetEl = row.querySelector("span.y2");
      const subject = subjectEl ? subjectEl.innerText.trim() : "";
      const snippet = snippetEl ? snippetEl.innerText.replace(/^\s*-\s*/, "").trim() : "";

      if (!subject && !snippet) return;
      if (IGNORE_SUBJECT_WORDS.some(w => subject.toLowerCase().includes(w))) return;

      if (!row.querySelector(".crm-gmail-badge") && subjectEl && subjectEl.parentElement) {
        const badge = document.createElement("span");
        badge.className = "crm-gmail-badge";
        badge.textContent = "SALES CRM";
        subjectEl.parentElement.appendChild(badge);
      }

      const clientLabel = rawName || email.split("@")[0];
      const speakerLine = isFromSalesRow
        ? `[Sales - ${salesPerson} (${timeCol || "Today"})]: ${snippet || subject}`
        : `[Client - ${clientLabel} (${timeCol || "Today"})]: ${snippet || subject}`;

      const previewTranscript = `Subject: ${subject}\n--------------------------------------------------\n${speakerLine}`;
      const previewHash = quickHash(previewTranscript);
      const prevInboxHash = lastSyncedInboxPreviewHashMap.get(email);

      if (previewHash !== prevInboxHash) {
        const isInitial = !prevInboxHash && !lastSyncedEmailHashMap.has(email);
        activeEmailRegistry.add(email);
        lastSyncedInboxPreviewHashMap.set(email, previewHash);
        persistEmailState();

        dispatchEmailLead({
          candidateName: clientLabel,
          candidateEmail: email,
          candidatePhone: extractPhoneNumber(row.innerText),
          subject,
          fullTranscript: previewTranscript,
          messages: [{
            isOut: isFromSalesRow,
            senderRole: isFromSalesRow ? "sales" : "client",
            salesPerson,
            clientName: clientLabel,
            msgTime: timeCol || "Today",
            text: snippet || subject
          }],
          isInitial,
          isPreview: true
        });
      }
    });
  }

  function dispatchEmailLead({ candidateName, candidateEmail, candidatePhone, subject, fullTranscript, messages, isInitial, isPreview }) {
    if (!chrome?.runtime?.id) return;

    const salesEmail = getSalesEmailFromDOM();
    const salesPerson = normalizeSalesName(cachedConfig.recruiterName, salesEmail);
    const payload = {
      source: "Email",
      is_preview: Boolean(isPreview),
      sales_person: salesPerson,
      recruiter_name: salesPerson,
      recruiter_email: salesEmail,
      candidate_name: candidateName,
      candidate_email: candidateEmail,
      candidate_phone: candidatePhone || "",
      subject: subject || "Sales Enquiry",
      text: fullTranscript,
      messages: messages || []
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
              showToast("⚡ Email synced to OrbitSales CRM", "success");
            } else {
              showToast("⚡ Email thread updated in CRM", "info");
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
    }, 1800);
  }

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.action === "TRIGGER_SYNC_SCAN") {
        scanInboxRows();
        scanActiveEmailThread();
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (!cachedConfig.autoSync) return;
    const btn = e.target?.closest?.("div[role='button'], button");
    if (btn) {
      const label = (btn.getAttribute("aria-label") || btn.getAttribute("data-tooltip") || btn.innerText || "").toLowerCase();
      if (label.includes("send") || label.includes("bhejein") || btn.classList.contains("aoO")) {
        setTimeout(scanActiveEmailThread, 600);
        setTimeout(scanInboxRows, 1200);
      }
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    if (cachedConfig.autoSync && (e.ctrlKey || e.metaKey) && e.key === "Enter") {
      setTimeout(scanActiveEmailThread, 600);
      setTimeout(scanInboxRows, 1200);
    }
  }, true);

  let gmailMutationTimer = null;
  const observer = new MutationObserver(() => {
    if (!cachedConfig.autoSync) return;
    if (gmailMutationTimer) clearTimeout(gmailMutationTimer);
    gmailMutationTimer = setTimeout(() => {
      scanActiveEmailThread();
      scanInboxRows();
    }, 100);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    window.__salesCrmGmailObserver = observer;
  }

  window.__salesCrmGmailInterval = setInterval(() => {
    if (cachedConfig.autoSync) {
      scanActiveEmailThread();
      scanInboxRows();
    }
  }, 800);
})();
