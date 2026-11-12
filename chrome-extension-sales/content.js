// ==========================================================================================
// ⚡ OrbitSales CRM — WhatsApp Web Millisecond 100% Zero-Loss Live Chat Syncer
// - Captures EVERY SINGLE message sent or received after extension install (Zero Keyword Drop!)
// - Skips ancient pre-install history ("bhut purane pehle ke") using install-time baseline
//   and date-stamp gating, while catching 100% of new/today/active messages in ~60ms!
// - Clearly attributes every message to [Sales - <Salesperson>] vs [Client - <Client Name>]
// ==========================================================================================

(() => {
  if (window.__salesCrmWaInterval) {
    clearInterval(window.__salesCrmWaInterval);
  }
  if (window.__salesCrmWaObserver) {
    try { window.__salesCrmWaObserver.disconnect(); } catch (e) {}
  }

  const IGNORE_HEADER_WORDS = [
    "search", "video call", "voice call", "menu", "more options", "attach",
    "profile photo", "contact info", "mute", "block", "whatsapp", "chats",
    "status", "channels", "communities", "click here for"
  ];

  const INTERNAL_GROUP_REGEX = [
    /orbitouch\s*outsourcing/i,
    /daily\s*working\s*\/\s*reporting/i,
    /internal\s*sales\s*group/i,
    /hr\s*agency\s*orbitouch/i
  ];

  const SALES_MAP = {
    "jinendra": "Jinendra",
    "vishal": "Vishal",
    "rahul": "Rahul",
    "archana": "Archana"
  };

  const PHONE_TO_SALES_MAP = {
    "8010264508": "Jinendra",
    "7701969169": "Vishal",
    "9211711371": "Vishal",
    "9211711370": "Rahul",
    "9211711376": "Archana"
  };

  const SALES_PHONES = new Set(Object.keys(PHONE_TO_SALES_MAP));

  function normalizeSalesName(name) {
    if (!name) return "Jinendra";
    const clean = String(name).replace(/\s*\(Alt\)$/i, "").trim();
    const lower = clean.toLowerCase();
    for (const [k, v] of Object.entries(SALES_MAP)) {
      if (lower.includes(k)) return v;
    }
    const p10 = phoneKey10(clean);
    if (p10 && PHONE_TO_SALES_MAP[p10]) return PHONE_TO_SALES_MAP[p10];
    return clean;
  }

  function detectSalesPersonInText(text) {
    if (!text) return "";
    const s = String(text);
    const m =
      s.match(/(?:this\s+side|this\s+is|i\s+am|myself|regards|thanks\s*(?:&|and)?\s*regards)[\s,:-]+(jinendra|vishal|rahul|archana)\b/i) ||
      s.match(/\b(jinendra|vishal|archana)@(?:orbitouch-hr|orbitverify)\.com/i);
    if (m && m[1]) {
      return SALES_MAP[m[1].toLowerCase()] || "";
    }
    for (const [ph, sName] of Object.entries(PHONE_TO_SALES_MAP)) {
      if (s.includes(ph)) return sName;
    }
    return "";
  }

  function isSalesOutreachText(text) {
    if (!text) return false;
    const s = String(text).trim();
    return (
      /orbitouch|orbitverify|orbit\s*verify/i.test(s) ||
      /(?:this\s+side|this\s+is|i\s+am|myself)\s+(?:jinendra|vishal|rahul|archana)\b/i.test(s) ||
      /(?:regards|thanks\s*(?:&|and)?\s*regards)[\s,:-]+(?:jinendra|vishal|rahul|archana)\b/i.test(s)
    );
  }

  let cachedConfig = {
    recruiterName: "Jinendra",
    webhookUrl: "http://192.168.1.34:3000/api/webhook",
    autoSync: true,
    stealthMode: false
  };

  let knownCrmPhones = new Set();
  let knownCrmNames = new Set();
  const activeTrackedLeads = new Set();
  const lastSyncedHashMap = new Map();
  const lastSyncedSidebarHashMap = new Map();
  const preInstallOldSidebarKeys = new Set();
  let initialBaselineCaptured = false;

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
        "salesWaSyncedHashes",
        "salesWaSidebarHashes",
        "salesWaLeadRegistry"
      ],
      (res) => {
        if (res.recruiterName) {
          cachedConfig.recruiterName = normalizeSalesName(res.recruiterName);
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
        if (Array.isArray(res.salesWaLeadRegistry)) {
          res.salesWaLeadRegistry.forEach(k => activeTrackedLeads.add(k));
        }
        if (res.salesWaSyncedHashes && typeof res.salesWaSyncedHashes === "object") {
          Object.entries(res.salesWaSyncedHashes).forEach(([k, v]) => lastSyncedHashMap.set(k, v));
        }
        if (res.salesWaSidebarHashes && typeof res.salesWaSidebarHashes === "object") {
          Object.entries(res.salesWaSidebarHashes).forEach(([k, v]) => lastSyncedSidebarHashMap.set(k, v));
        }

        setTimeout(() => {
          scanActiveChatContinuous();
          scanSidebarChats();
        }, 120);
      }
    );

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.recruiterName) cachedConfig.recruiterName = normalizeSalesName(changes.recruiterName.newValue);
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
      Array.from(lastSyncedHashMap.entries()).slice(-400).forEach(([k, v]) => { hashObj[k] = v; });
      const sidebarHashObj = {};
      Array.from(lastSyncedSidebarHashMap.entries()).slice(-400).forEach(([k, v]) => { sidebarHashObj[k] = v; });
      chrome.storage.local.set({
        salesWaSyncedHashes: hashObj,
        salesWaSidebarHashes: sidebarHashObj,
        salesWaLeadRegistry: Array.from(activeTrackedLeads).slice(-400)
      });
    }, 600);
  }

  function phoneKey10(raw) {
    const d = String(raw || "").replace(/[^0-9]/g, "");
    return d.length >= 10 ? d.slice(-10) : "";
  }

  function isGroupOrInternalHeader(headerEl, title) {
    if (!title) return true;
    if (INTERNAL_GROUP_REGEX.some(rx => rx.test(title))) return true;
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
    const titledSpans = row.querySelectorAll("span[title]");
    for (const sp of titledSpans) {
      const t = (sp.getAttribute("title") || "").trim();
      if (t && t.length >= 2 && !isNoiseHeaderText(t) && !/unread message/i.test(t)) {
        return t;
      }
    }

    const pm = rawRowText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) || rawRowText.match(/\+?\d[\d\s-]{9,}\d/);
    if (pm) return pm[0].trim();

    const autoSpans = row.querySelectorAll("span[dir='auto']");
    for (const sp of autoSpans) {
      const t = (sp.innerText || "").trim();
      if (t && t.length >= 3 && !isNoiseHeaderText(t) && !/unread message/i.test(t)) {
        return t;
      }
    }
    return "";
  }

  function getHeaderClientTitle(headerEl) {
    if (headerEl) {
      const titledEls = headerEl.querySelectorAll(
        "span[data-testid='conversation-info-header-chat-title'], span[title]"
      );
      for (const el of titledEls) {
        const val = (el.getAttribute("title") || el.innerText || "").trim();
        if (val && val.length >= 2 && !isNoiseHeaderText(val)) return val;
      }

      const allHeaderText = headerEl.innerText || "";
      const phoneMatch = allHeaderText.match(/\+?\d{1,3}[\s-]?\d{4,5}[\s-]?\d{4,5}/) ||
                         allHeaderText.match(/\+?\d[\d\s-]{9,}\d/);
      if (phoneMatch) return phoneMatch[0].trim();

      const autoEls = headerEl.querySelectorAll("span[dir='auto']");
      for (const el of autoEls) {
        const val = (el.innerText || "").trim();
        if (val && val.length >= 3 && !isNoiseHeaderText(val)) return val;
      }

      const lines = allHeaderText
        .split("\n")
        .map(s => s.trim())
        .filter(s => s && s.length >= 3 && !isNoiseHeaderText(s));
      if (lines[0]) return lines[0];
    }

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

  // Extract full chat transcript + structured messages array with Sales vs Client attribution
  function extractChatMessagesAndTranscript(mainArea, rawTitle = "", clientLabel = "Client") {
    if (!mainArea) return { transcript: "", messages: [], hasTodayActivity: false };

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
    let defaultSales = normalizeSalesName(cachedConfig.recruiterName || "Jinendra");
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

      if (!isOut && preSender && !dataId.startsWith("false_")) {
        const senderPKey = phoneKey10(preSender);
        const senderNorm = preSender.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
          /orbitouch|orbitverify|^(?:you|jinendra|vishal|rahul|archana)\b/i.test(preSender) ||
          (senderPKey && SALES_PHONES.has(senderPKey))
        ) {
          isOut = true;
          if (senderPKey && PHONE_TO_SALES_MAP[senderPKey]) {
            defaultSales = PHONE_TO_SALES_MAP[senderPKey];
          }
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

      const docEl = container.querySelector("span[title*='.pdf'], span[title*='.doc'], span[title*='.xls'], div[data-testid='document-thumb']");
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

      if (isSalesOutreachText(bodyText)) {
        isOut = true;
        const detectedSales = detectSalesPersonInText(bodyText);
        if (detectedSales) defaultSales = detectedSales;
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
        parsedMessages.push({
          isOut,
          senderRole: isOut ? "sales" : "client",
          salesPerson: defaultSales,
          clientName: clientLabel || "Client",
          msgTime,
          text: bodyText
        });
      }
    });

    const transcript = parsedMessages
      .map(m => {
        const sender = m.isOut ? `Sales - ${m.salesPerson}` : `Client - ${m.clientName}`;
        const label = m.msgTime ? `[${sender} (${m.msgTime})]` : `[${sender}]`;
        return `${label}: ${m.text}`;
      })
      .join("\n");

    return {
      transcript,
      messages: parsedMessages
    };
  }

  let updateDebounceTimer = null;

  function scanActiveChatContinuous(forceRegister = false) {
    if (!chrome?.runtime?.id) return;
    const mainArea = document.querySelector("#main, div[data-testid='conversation-panel-wrapper']");
    if (!mainArea) return;

    const header = mainArea.querySelector("header, div[data-testid='conversation-header'], [role='banner']") || document.querySelector("#main header");
    const rawTitle = getHeaderClientTitle(header);
    if (!rawTitle || isGroupOrInternalHeader(header, rawTitle)) return;

    let phone = "";
    let name = "";
    const phoneClean = rawTitle.replace(/[^0-9+]/g, "");
    let pKey = phoneKey10(phoneClean);

    if (pKey.length >= 10) {
      phone = rawTitle;
      name = `Client (${pKey.slice(-4)})`;
    } else {
      name = rawTitle;
      const domPhone = extractPhoneFromDOM(mainArea, header);
      if (domPhone) {
        phone = domPhone;
        pKey = phoneKey10(domPhone);
      }
    }

    // Skip if the contact is one of our own sales persons
    if (pKey && SALES_PHONES.has(pKey)) return;

    const nameKey = name.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    const dedupeKey = pKey || nameKey;
    if (!dedupeKey || dedupeKey.length < 2) return;

    // Check if this open chat has today's activity or is not an untouched ancient pre-install chat
    const activeSidebarRow = document.querySelector("#pane-side [aria-selected='true'], div[aria-label='Chat list'] [aria-selected='true']");
    const activeRowText = activeSidebarRow ? (activeSidebarRow.innerText || "") : "";
    const hasOldSidebarDateOnly =
      activeRowText &&
      !(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(activeRowText)) &&
      /(?:yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.test(activeRowText);

    const hasTodayDividerInMain = /\bToday\b/i.test(mainArea.innerText || "");
    const isAlreadyTracked =
      activeTrackedLeads.has(dedupeKey) ||
      activeTrackedLeads.has(nameKey) ||
      (pKey && knownCrmPhones.has(pKey)) ||
      (name && knownCrmNames.has(name.toLowerCase().trim()));

    // If chat is from an old date ("bhut purane pehle ke") and has no Today divider and wasn't messaged today, skip unless forceRegister
    if (hasOldSidebarDateOnly && !hasTodayDividerInMain && !isAlreadyTracked && !forceRegister) {
      return;
    }

    const { transcript, messages } = extractChatMessagesAndTranscript(mainArea, rawTitle, name);
    if (!transcript) return;

    // Register 100% of active post-install / today chats — ZERO keyword filtering!
    activeTrackedLeads.add(dedupeKey);
    if (nameKey) activeTrackedLeads.add(nameKey);

    const currentHash = quickHash(transcript);
    const prevHash = lastSyncedHashMap.get(dedupeKey);

    if (currentHash !== prevHash) {
      const isInitial = !prevHash;
      lastSyncedHashMap.set(dedupeKey, currentHash);
      persistSyncState();

      const doSync = () => {
        dispatchLead(name, phone, transcript, messages, isInitial, false);
      };

      if (isInitial || forceRegister) {
        doSync();
      } else {
        if (updateDebounceTimer) clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(doSync, 80); // 80ms millisecond-grade sync!
      }
    }
  }

  // Sidebar Scanner: Captures 100% of unread / today's incoming & outgoing messages without needing keywords!
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
      const hasOldDate = /(?:yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.test(rawRowText);

      const rawTitle = extractSidebarRowTitle(row, rawRowText);
      if (!rawTitle || isNoiseHeaderText(rawTitle)) return;
      if (INTERNAL_GROUP_REGEX.some(rx => rx.test(rawTitle))) return;

      let phone = "";
      let name = "";
      let pKey = phoneKey10(rawTitle);
      if (pKey.length >= 10) {
        phone = rawTitle;
        name = `Client (${pKey.slice(-4)})`;
      } else {
        name = rawTitle;
        const rowDomPhone = extractPhoneFromDOM(row, null);
        if (rowDomPhone) {
          phone = rowDomPhone;
          pKey = phoneKey10(rowDomPhone);
        }
      }

      if (pKey && SALES_PHONES.has(pKey)) return;

      const nameKey = name.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
      const dedupeKey = pKey || nameKey;
      if (!dedupeKey) return;

      // On first pass after extension load, record old-date rows so ancient chats ("bhut purane pehle ke") are skipped
      if (!initialBaselineCaptured && hasOldDate && !hasTodayTime && !hasUnread) {
        preInstallOldSidebarKeys.add(dedupeKey);
        return;
      }

      // Skip ancient chats that only have an old date and no today time / unread badge
      if (hasOldDate && !hasTodayTime && !hasUnread) return;
      if (!hasTodayTime && !hasUnread && preInstallOldSidebarKeys.has(dedupeKey)) return;

      const cleanLines = rawRowText
        .split("\n")
        .map(s => s.trim())
        .filter((s, idx) => {
          if (!s || s === rawTitle) return false;
          if (idx === 0 && /^[A-Z]{1,2}$/.test(s)) return false;
          if (/^\d+$/.test(s)) return false;
          if (/unread message/i.test(s)) return false;
          if (/^\d{1,2}:\d{2}\s*(?:am|pm)?$/i.test(s)) return false;
          if (/^(?:yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/i.test(s)) return false;
          return true;
        });

      const previewBody = cleanLines
        .join(" ")
        .replace(/(?:\s*\bEdited\s*)?\n?\d{1,2}:\d{2}\s*(?:am|pm)?$/i, "")
        .slice(0, 400)
        .trim();
      if (!previewBody) return;

      const timeMatch = rawRowText.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i);
      const rowTime = timeMatch ? timeMatch[1].trim() : "";

      const hasOutCheckmark = !!row.querySelector(
        "span[data-icon*='check'], span[data-icon*='dblcheck'], span[data-icon='status-check'], span[data-icon='status-dblcheck'], [aria-label*='Delivered'], [aria-label*='Read'], [aria-label*='Sent']"
      );
      const isSalesPreview = !hasUnread && (hasOutCheckmark || isSalesOutreachText(previewBody));
      const detectedSales = detectSalesPersonInText(previewBody) || normalizeSalesName(cachedConfig.recruiterName || "Jinendra");

      const previewTranscript = isSalesPreview
        ? `[Sales - ${detectedSales}${rowTime ? " (" + rowTime + ")" : ""}]: ${previewBody}`
        : `[Client - ${name}${rowTime ? " (" + rowTime + ")" : ""}]: ${previewBody}`;

      const previewMessages = [{
        isOut: isSalesPreview,
        senderRole: isSalesPreview ? "sales" : "client",
        salesPerson: detectedSales,
        clientName: name,
        msgTime: rowTime,
        text: previewBody
      }];

      const previewHash = quickHash(previewTranscript);
      const prevSidebarHash = lastSyncedSidebarHashMap.get(dedupeKey);

      if (previewHash !== prevSidebarHash) {
        const isInitial = !prevSidebarHash && !lastSyncedHashMap.has(dedupeKey);
        activeTrackedLeads.add(dedupeKey);
        if (nameKey) activeTrackedLeads.add(nameKey);
        lastSyncedSidebarHashMap.set(dedupeKey, previewHash);
        persistSyncState();
        dispatchLead(name, phone, previewTranscript, previewMessages, isInitial, true);
      }
    });

    initialBaselineCaptured = true;
  }

  function dispatchLead(clientName, clientPhone, fullTranscriptText, messagesArray = [], isInitial = false, isPreview = false) {
    if (!chrome?.runtime?.id) return;

    let clientEmail = "";
    const emailMatches = fullTranscriptText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const em of emailMatches) {
      const cleanEm = em.toLowerCase().trim();
      if (!cleanEm.endsWith("@orbitouch-hr.com") && !cleanEm.endsWith("@orbitverify.com")) {
        clientEmail = cleanEm;
        break;
      }
    }

    const salesPerson = normalizeSalesName(cachedConfig.recruiterName || "Jinendra");

    const payload = {
      source: "WhatsApp",
      is_preview: isPreview,
      sales_person: salesPerson,
      recruiter_name: salesPerson,
      candidate_name: clientName,
      candidate_phone: clientPhone || "",
      candidate_email: clientEmail,
      text: fullTranscriptText,
      messages: messagesArray
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
            const pKey = phoneKey10(clientPhone);
            if (pKey) knownCrmPhones.add(pKey);
            if (clientName) knownCrmNames.add(clientName.toLowerCase().trim());
            const ms = response.latencyMs ? ` (${response.latencyMs}ms)` : "";
            if (isInitial || action === "created") {
              showToast(`⚡ Synced to OrbitSales CRM${ms}`, "success");
            } else {
              showToast(`⚡ Live message synced${ms}`, "info");
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
        scanSidebarChats();
        scanActiveChatContinuous();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && cachedConfig.autoSync) {
      setTimeout(() => scanActiveChatContinuous(true), 60);
      setTimeout(() => scanActiveChatContinuous(true), 300);
    }
  }, true);

  document.addEventListener("click", (e) => {
    if (!cachedConfig.autoSync) return;
    const sendBtn = e.target?.closest?.("button[aria-label*='Send'], span[data-icon='send'], [data-testid='send']");
    if (sendBtn) {
      setTimeout(() => scanActiveChatContinuous(true), 60);
      setTimeout(() => scanActiveChatContinuous(true), 300);
    }
  }, true);

  // Millisecond DOM MutationObserver (60ms response time!)
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    if (!cachedConfig.autoSync) return;
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      scanActiveChatContinuous();
      scanSidebarChats();
    }, 60);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__salesCrmWaObserver = observer;
  }

  // Continuous 450ms High-Frequency Scanner
  window.__salesCrmWaInterval = setInterval(() => {
    if (cachedConfig.autoSync) {
      scanActiveChatContinuous();
      scanSidebarChats();
    }
  }, 450);
})();
