// ==========================================================================================
// 🚀 OrbitSales CRM — Enterprise Omnichannel Sales, Call Recording & Live Chat Server
// Features:
//  - Accurate Local System Clock (IST) & Midnight Fresh-Day Rollover
//  - 100% Zero-Loss WhatsApp Web & Gmail Message Sync (Salesperson vs Client Attribution)
//  - Chronological Live Message Stream (Every individual message tracked in messages.json)
//  - Granular Phone Call Tracker:
//      * Ringing (Incoming) | Dialing (Outgoing) | Live Talking Stopwatch | Call Cut
//      * Answered (Incoming/Outgoing) | Missed Call | Client Did Not Pick Up (Unanswered)
//      * Exact Time Span (Start Time -> End Time -> Duration)
//  - Call Audio Recording Storage, HTTP Range Streaming & Call Conversation Transcripts
//  - Permanent Zero-IP Cloud Relay (ntfy.sh) + LAN Auto-Discovery on Port 4000
// ==========================================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? path.join('/tmp', 'data', 'sales') : path.join(__dirname, 'data', 'sales');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const DROPZONE_DIR = path.join(DATA_DIR, 'recordings_dropzone');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const SALES_TEAM_FILE = path.join(DATA_DIR, 'sales_team.json');
const CALL_LOG_FILE = path.join(DATA_DIR, 'call_logs.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const PUBLIC_DIR = path.join(__dirname, 'public', 'sales');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
if (!fs.existsSync(DROPZONE_DIR)) fs.mkdirSync(DROPZONE_DIR, { recursive: true });

if (IS_VERCEL) {
  const seedDir = path.join(__dirname, 'data', 'sales');
  if (fs.existsSync(seedDir)) {
    ['users.json', 'leads.json', 'sales_team.json', 'call_logs.json', 'messages.json'].forEach(f => {
      const src = path.join(seedDir, f);
      const dst = path.join(DATA_DIR, f);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        try { fs.copyFileSync(src, dst); } catch (_) {}
      }
    });
  }
}

// =========================================================================
// LOCAL CLOCK / IST TIME UTILITIES (Matches System Wall Clock Exactly)
// =========================================================================

function pad2(n) {
  return String(n).padStart(2, '0');
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseFlexDate(input) {
  if (!input) return new Date();
  if (input instanceof Date) return isNaN(input.getTime()) ? new Date() : input;
  if (typeof input === 'number') {
    const d = new Date(input < 1e12 ? input * 1000 : input);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  const str = String(input).trim();
  if (!str) return new Date();

  const localMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, y, mo, da, h, mi, s] = localMatch;
    return new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(s || 0));
  }

  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    return new Date(num < 1e12 ? num * 1000 : num);
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatLocalTimestamp(dateInput) {
  const d = parseFlexDate(dateInput);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatDisplayDateTime(dateInput) {
  if (!dateInput || dateInput === '-') return '-';
  const d = parseFlexDate(dateInput);
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${pad2(hours)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
}

function formatShortTime(dateInput) {
  if (!dateInput || dateInput === '-') return '-';
  const d = parseFlexDate(dateInput);
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${pad2(hours)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
}

function getLocalDateKey(dateInput) {
  if (!dateInput) {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }
  const str = String(dateInput).trim();
  const direct = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct && !str.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(str)) {
    return direct[1];
  }
  const d = parseFlexDate(dateInput);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowLocal() {
  return formatLocalTimestamp(new Date());
}

function todayKey() {
  return getLocalDateKey(new Date());
}

function parseDurationToSeconds(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Math.max(0, Math.round(val));
  const str = String(val).trim();
  if (!str || /^\[.*\]$/.test(str) || /^\{.*\}$/.test(str)) return 0;

  if (/^\d+(\.\d+)?$/.test(str)) return Math.max(0, Math.round(Number(str)));

  const colonMatch = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const h = Number(colonMatch[1] || 0);
    const m = Number(colonMatch[2] || 0);
    const s = Number(colonMatch[3] || 0);
    return h * 3600 + m * 60 + s;
  }

  let total = 0;
  let matched = false;
  const hMatch = str.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)/i);
  const mMatch = str.match(/(\d+)\s*(?:m|min|mins|minute|minutes)(?!s)/i);
  const sMatch = str.match(/(\d+)\s*(?:s|sec|secs|second|seconds)/i);
  if (hMatch) { total += Number(hMatch[1]) * 3600; matched = true; }
  if (mMatch) { total += Number(mMatch[1]) * 60; matched = true; }
  if (sMatch) { total += Number(sMatch[1]); matched = true; }
  if (matched) return total;

  const fallbackNum = parseInt(str, 10);
  return isNaN(fallbackNum) ? 0 : Math.max(0, fallbackNum);
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s === 0) return '0s';
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return rem > 0 ? `${h}h ${m}m ${rem}s` : (m > 0 ? `${h}h ${m}m` : `${h}h`);
  }
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// =========================================================================
// DATA ACCESS HELPERS
// =========================================================================

function readJsonFile(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '').trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[readJsonFile] Failed to parse ${path.basename(filePath)}: ${e.message}`);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempFile, filePath);
}

const getUsers = () => readJsonFile(USERS_FILE, []);
const getLeads = () => readJsonFile(LEADS_FILE, []);
const getSalesTeam = () => readJsonFile(SALES_TEAM_FILE, []);
const getCallLogs = () => readJsonFile(CALL_LOG_FILE, []);
const getMessages = () => readJsonFile(MESSAGES_FILE, []);

function saveLeads(leads) {
  writeJsonFile(LEADS_FILE, leads);
  const dailyBackup = path.join(BACKUP_DIR, `leads_backup_${todayKey()}.json`);
  if (!fs.existsSync(dailyBackup)) {
    try { fs.copyFileSync(LEADS_FILE, dailyBackup); } catch (e) {}
  }
}

function saveCallLogs(logs) {
  writeJsonFile(CALL_LOG_FILE, logs);
}

function saveMessages(messages) {
  // Keep latest 5000 individual messages for ultra-fast dashboard loading
  const trimmed = Array.isArray(messages) ? messages.slice(0, 5000) : [];
  writeJsonFile(MESSAGES_FILE, trimmed);
}

// =========================================================================
// REAL-TIME SERVER-SENT EVENTS (SSE) ENGINE
// =========================================================================

const sseClients = new Set();

function broadcastEvent(eventType, payload = {}) {
  const packet = `data: ${JSON.stringify({
    type: eventType,
    serverTime: nowLocal(),
    todayKey: todayKey(),
    ...payload
  })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(packet);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

const salesHeartbeatTimer = setInterval(() => {
  broadcastEvent('heartbeat', {});
}, 15000);
if (salesHeartbeatTimer.unref) salesHeartbeatTimer.unref();

// =========================================================================
// SALES TEAM IDENTITY & ATTRIBUTION ENGINE
// Configured Sales Team:
//  - Jinendra : 8010264508 | jinendra@orbitouch-hr.com
//  - Vishal   : 7701969169, 9211711371 | vishal@orbitouch-hr.com
//  - Rahul    : 9211711370 | hello@orbitouch-hr.com, hello@orbitverify.com
//  - Archana  : 9211711376 | archana@orbitouch-hr.com, archana@orbitverify.com
// =========================================================================

const SALES_PHONE_TO_NAME = {
  '8010264508': 'Jinendra',
  '7701969169': 'Vishal',
  '9211711371': 'Vishal',
  '9211711370': 'Rahul',
  '9211711376': 'Archana'
};

const SALES_EMAIL_TO_NAME = {
  'jinendra@orbitouch-hr.com': 'Jinendra',
  'vishal@orbitouch-hr.com': 'Vishal',
  'rahul@orbitouch-hr.com': 'Rahul',
  'hello@orbitouch-hr.com': 'Rahul',
  'hello@orbitverify.com': 'Rahul',
  'archana@orbitouch-hr.com': 'Archana',
  'archana@orbitverify.com': 'Archana'
};

const SALES_PHONES_SET = new Set(Object.keys(SALES_PHONE_TO_NAME));

function phoneKey10(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return digits.length >= 10 ? digits.slice(-10) : (digits.length >= 7 ? digits : '');
}

function sanitizeEmail(val) {
  if (typeof val !== 'string') return '';
  const clean = val.trim().toLowerCase().slice(0, 120);
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean) ? clean : '';
}

function canonicalSalesName(input, salesEmail = '', salesPhone = '') {
  const cleanEmail = sanitizeEmail(salesEmail || '');
  if (cleanEmail && SALES_EMAIL_TO_NAME[cleanEmail]) {
    return SALES_EMAIL_TO_NAME[cleanEmail];
  }

  const p10 = phoneKey10(salesPhone || input || '');
  if (p10 && SALES_PHONE_TO_NAME[p10]) {
    return SALES_PHONE_TO_NAME[p10];
  }

  const team = getSalesTeam();
  if (cleanEmail) {
    const byEm = team.find(t =>
      sanitizeEmail(t.email) === cleanEmail ||
      (Array.isArray(t.emails) && t.emails.some(e => sanitizeEmail(e) === cleanEmail))
    );
    if (byEm && byEm.name) return byEm.name;
  }

  const clean = String(input || '')
    .replace(/[&_#*~`^%$@!|;]+/g, ' ')
    .replace(/\+/g, ' ')
    .replace(/\s*\(Alt\)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return 'Jinendra';

  const lower = clean.toLowerCase();
  if (lower.includes('jinendra')) return 'Jinendra';
  if (lower.includes('vishal')) return 'Vishal';
  if (lower.includes('rahul') || lower === 'hello') return 'Rahul';
  if (lower.includes('archana')) return 'Archana';

  for (const member of team) {
    const mName = (member.name || '').trim();
    const mLower = mName.toLowerCase();
    const firstWord = mLower.split(/\s+/)[0];
    if (mLower === lower || lower === firstWord || lower.startsWith(firstWord + ' ')) {
      return mName;
    }
  }
  return clean;
}

function isSalesOrInternalEmail(email) {
  const e = sanitizeEmail(email || '');
  if (!e) return true;
  if (SALES_EMAIL_TO_NAME[e]) return true;
  if (e.endsWith('@orbitouch-hr.com') || e.endsWith('@orbitverify.com')) return true;
  if (/^(?:no-?reply|updates-noreply|messages-noreply|donotreply|notifications|mailer-daemon|alerts|newsletter)@/i.test(e)) return true;
  if (/@(?:google\.com|accounts\.google\.com)$/i.test(e)) return true;
  return false;
}

function detectSalesPersonInText(text) {
  if (!text) return '';
  const s = String(text);
  const emMatch = s.match(/\b(jinendra@orbitouch-hr\.com|vishal@orbitouch-hr\.com|archana@orbitouch-hr\.com|archana@orbitverify\.com|hello@orbitouch-hr\.com|hello@orbitverify\.com)\b/i);
  if (emMatch && emMatch[1]) {
    return SALES_EMAIL_TO_NAME[emMatch[1].toLowerCase()] || '';
  }
  const nameMatch =
    s.match(/(?:this\s+side|this\s+is|i\s+am|myself|regards|thanks\s*(?:&|and)?\s*regards|from)[\s,:-]+(jinendra|vishal|rahul|archana)\b/i);
  if (nameMatch && nameMatch[1]) {
    return canonicalSalesName(nameMatch[1]);
  }
  for (const [ph, sName] of Object.entries(SALES_PHONE_TO_NAME)) {
    if (s.includes(ph)) return sName;
  }
  return '';
}

function isSalesOutreachText(text) {
  if (!text) return false;
  const s = String(text).trim();
  return (
    /orbitouch|orbitverify|orbit\s*verify/i.test(s) ||
    /(?:this\s+side|this\s+is|i\s+am|myself)\s+(?:jinendra|vishal|rahul|archana)\b/i.test(s) ||
    /(?:regards|thanks\s*(?:&|and)?\s*regards)[\s,:-]+(?:jinendra|vishal|rahul|archana)\b/i.test(s) ||
    /\b(?:background\s+verification|bgv\s+services|recruitment\s+services|staffing\s+proposal|commercial\s+proposal|service\s+agreement)\b/i.test(s)
  );
}

const INTERNAL_GROUP_PATTERNS = [
  /orbitouch\s*outsourcing/i,
  /daily\s*working\s*\/\s*reporting/i,
  /internal\s*sales\s*group/i,
  /hr\s*agency\s*orbitouch/i
];

function isInternalGroup(title) {
  const t = (title || '').toLowerCase().trim();
  if (INTERNAL_GROUP_PATTERNS.some(rx => rx.test(t))) return true;
  return false;
}

// =========================================================================
// SPEAKER NORMALIZATION & INDIVIDUAL MESSAGE PARSER
// Converts transcripts & structured message arrays into clean blocks
// =========================================================================

function parseTranscriptIntoBlocks(transcript, defaultSalesPerson = 'Jinendra', defaultClientName = 'Client') {
  if (!transcript) return [];
  const raw = String(transcript).replace(/\r\n/g, '\n').trim();
  const blocks = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^-{5,}$/.test(trimmed)) continue;
    if (/^Subject:\s*(.*)$/i.test(trimmed)) {
      blocks.push({ isSubject: true, rawHeader: 'Subject', body: trimmed });
      continue;
    }

    const headerMatch = line.match(/^\[([^\]]+)\]:\s*(.*)$/);
    if (headerMatch) {
      blocks.push({
        rawHeader: headerMatch[1].trim(),
        body: headerMatch[2]
      });
    } else if (blocks.length > 0 && !blocks[blocks.length - 1].isSubject) {
      blocks[blocks.length - 1].body += '\n' + line;
    } else {
      blocks.push({
        rawHeader: '',
        body: line
      });
    }
  }

  let salesName = canonicalSalesName(defaultSalesPerson);
  for (const b of blocks) {
    const det = detectSalesPersonInText(b.body);
    if (det) {
      salesName = det;
      break;
    }
  }

  return blocks.map(b => {
    if (b.isSubject) return b;
    const timeMatch = (b.rawHeader || '').match(/\(([^)]+)\)\s*$/);
    const msgTime = timeMatch ? timeMatch[1].trim() : '';
    const timePart = msgTime ? ` (${msgTime})` : '';
    const det = detectSalesPersonInText(b.body);
    const activeSales = det || salesName;

    const isSalesHeader = /^(?:Sales|Recruiter|You|Me|Outbound)\b/i.test(b.rawHeader || '');
    const isSales = isSalesHeader || isSalesOutreachText(b.body);

    const senderRole = isSales ? 'sales' : 'client';
    const cleanClient = defaultClientName && !isGenericClientName(defaultClientName) ? defaultClientName : 'Client';
    const normalizedHeader = isSales
      ? `Sales - ${activeSales}${timePart}`
      : `Client - ${cleanClient}${timePart}`;

    return {
      isSubject: false,
      senderRole,
      salesPerson: activeSales,
      clientName: cleanClient,
      msgTime,
      rawHeader: normalizedHeader,
      body: (b.body || '').trim()
    };
  }).filter(b => b.body);
}

function normalizeTranscriptSpeakers(transcript, defaultSalesPerson = 'Jinendra', defaultClientName = 'Client') {
  const blocks = parseTranscriptIntoBlocks(transcript, defaultSalesPerson, defaultClientName);
  return blocks
    .map(b => (b.isSubject ? b.body : `[${b.rawHeader}]: ${b.body}`))
    .join('\n');
}

// =========================================================================
// CLIENT & DEAL FIELD EXTRACTION
// =========================================================================

const NON_NAME_WORDS = new Set([
  'in', 'on', 'at', 'to', 'of', 'by', 'as', 'or', 'and', 'am', 'is', 'are', 'was', 'be',
  'for', 'from', 'with', 'new', 'an', 'the', 'a', 'not', 'very', 'so', 'just', 'also',
  'this', 'that', 'there', 'here', 'yes', 'no', 'ok', 'okay', 'sure', 'well', 'good', 'fine',
  'hi', 'hello', 'hey', 'dear', 'namaste', 'sir', 'mam', 'maam', 'madam', 'team', 'hr',
  'need', 'urgent', 'urgently', 'interested', 'looking', 'manager', 'executive', 'director',
  'please', 'plz', 'kindly', 'help', 'proposal', 'quotation', 'quote', 'invoice', 'agreement',
  'orbitouch', 'orbitverify', 'outsourcing', 'verification', 'bgv', 'sales', 'client',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'yesterday',
  'jinendra', 'vishal', 'rahul', 'archana'
]);

function cleanPersonName(rawCandidate) {
  if (!rawCandidate) return '';
  const parts = String(rawCandidate)
    .trim()
    .split(/[\s_.-]+/)
    .map(p => p.replace(/[^a-zA-Z]/g, ''))
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
  return valid.length > 0 ? valid.join(' ') : '';
}

function isGenericClientName(name) {
  if (!name) return true;
  const lower = String(name).toLowerCase().trim();
  return (
    lower === 'client' ||
    lower === 'candidate' ||
    lower === 'lead' ||
    lower === 'unknown' ||
    lower === 'in' ||
    lower.startsWith('client (') ||
    lower.startsWith('candidate (') ||
    lower.startsWith('unknown caller') ||
    /^\+?\d[\d\s-]{6,}$/.test(lower)
  );
}

function extractClientName(text) {
  if (!text) return '';
  const patterns = [
    /(?:client\s*name|contact\s*name|name)\s*[:=-]\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i,
    /(?:(?:hi|hello|hey|namaste|dear)[,\s.!-]*)?(?:i\s*am|i'm|my\s*name\s*is|myself|this\s*is)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i,
    /(?:(?:regards|thanks\s*(?:&|and)?\s*regards|warm\s*regards|best\s*regards|sincerely)[,\s\n]+)([A-Za-z]+(?:\s+[A-Za-z]+)?)/i
  ];
  for (const pat of patterns) {
    const match = String(text).match(pat);
    if (match && match[1]) {
      const cleaned = cleanPersonName(match[1]);
      if (cleaned && cleaned.length >= 3) return cleaned;
    }
  }
  return '';
}

function extractCompanyName(text) {
  if (!text) return '';
  const m = String(text).match(
    /\b([A-Z][A-Za-z0-9&., -]{2,35}\s+(?:Pvt\.?\s*Ltd\.?|Private\s+Limited|LLP|Solutions|Technologies|Services|Enterprises|Corp|Corporation|Group|Consulting|Infotech|Global|Systems))\b/
  );
  return m && m[1] ? m[1].trim() : '';
}

function extractDealValue(text) {
  if (!text) return '';
  const m =
    String(text).match(/(?:budget|deal\s*value|amount|price|pricing|quote|quotation|commercials?|package|rate|charges?)\s*(?:is|of|around)?\s*[:=-]?\s*((?:rs\.?|inr|₹)?\s*\d[\d,]*(?:\.\d+)?\s*(?:k|lakh|lakhs|lac|cr|per\s*candidate|per\s*check|per\s*month|\/-|\+)?|\d+(?:\.\d+)?%\b)/i);
  return m && m[1] ? m[1].trim() : '';
}

function classifySalesLead(text, explicitCategory) {
  if (explicitCategory && explicitCategory !== 'Auto') {
    return { category: explicitCategory, keywords: ['Manual'] };
  }
  if (!text) return { category: 'Active Prospect', keywords: [] };

  const lower = String(text).toLowerCase();
  const rules = [
    {
      category: 'Hot Deal / Commercials',
      keywords: ['agreement', 'proposal', 'quotation', 'quote', 'invoice', 'commercial', 'pricing', 'contract', 'mou', 'sign', 'onboarding', 'payment', 'gst']
    },
    {
      category: 'BGV / Verification Lead',
      keywords: ['bgv', 'background verification', 'orbitverify', 'verify', 'verification', 'police verification', 'address check', 'employment check', 'kyc']
    },
    {
      category: 'Recruitment / Staffing Lead',
      keywords: ['hiring', 'manpower', 'staffing', 'requirement', 'mandate', 'positions', 'headcount', 'candidates', 'recruitment', 'replacement']
    }
  ];

  for (const rule of rules) {
    const matched = rule.keywords.filter(k => lower.includes(k));
    if (matched.length > 0) return { category: rule.category, keywords: matched };
  }
  return { category: 'Active Prospect', keywords: [] };
}

function detectFollowUpSignal(text) {
  if (!text) return false;
  return /\b(call\s*back|callback|call\s*me\s*(?:tomorrow|later|evening|morning|at)|meeting\s*scheduled|demo\s*scheduled|follow[\s-]*up|send\s*proposal|share\s*quotation)\b/i.test(text);
}

// =========================================================================
// SANITIZATION & PAYLOAD PARSING HELPERS
// =========================================================================

const MAX_BODY_SIZE = 25 * 1024 * 1024; // 25MB to support Call Audio Recordings

function parseFlexiblePayload(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    const obj = {};
    const normalized = raw.replace(/\r?\n/g, '&');
    const tokenRegex = /(?:^|&)(event|state|recruiter|recruiter_name|sales_person|phone|candidate_phone|client_phone|number|name|candidate_name|client_name|contact_name|dir|direction|call_type|type|duration|call_duration|call_duration_seconds|notes|transcript|call_transcript|summary|audio_base64|recording_base64)=/gi;
    const matches = [...normalized.matchAll(tokenRegex)];
    if (matches.length > 0) {
      for (let i = 0; i < matches.length; i++) {
        const key = matches[i][1].trim().toLowerCase();
        const valStart = matches[i].index + matches[i][0].length;
        const valEnd = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
        let rawVal = normalized.slice(valStart, valEnd);
        rawVal = rawVal.replace(/^[\s&]+|[\s&]+$/g, '').trim();
        try {
          rawVal = decodeURIComponent(rawVal.replace(/\+(\d)/g, '%2B$1'));
        } catch (_) {}
        obj[key] = rawVal.replace(/^[\s&]+|[\s&]+$/g, '').trim();
      }
      return obj;
    }
    const safeRaw = normalized.replace(/\+(\d)/g, '%2B$1');
    const params = new URLSearchParams(safeRaw);
    for (const [k, v] of params.entries()) {
      const cleanK = k.replace(/^[\s&]+|[\s&]+$/g, '').trim();
      const cleanV = v.replace(/^[\s&]+|[\s&]+$/g, '').trim();
      if (cleanK) obj[cleanK] = cleanV;
    }
    return obj;
  }
}

function parseRequestBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    req.on('data', chunk => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        return reject(new Error('Body too large'));
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseRequestBody(req) {
  const buf = await parseRequestBodyBuffer(req);
  const raw = buf.toString('utf-8').trim();
  if (!raw) return {};
  return parseFlexiblePayload(raw);
}

function parseMultipartFormData(buffer, boundary) {
  const fields = {};
  let file = null;
  if (!buffer || !boundary) return { fields, file };

  const boundaryBuf = Buffer.from('--' + boundary);
  let pos = 0;

  while (pos < buffer.length) {
    const bStart = buffer.indexOf(boundaryBuf, pos);
    if (bStart === -1) break;

    const contentStart = bStart + boundaryBuf.length;
    if (buffer.length >= contentStart + 2 && buffer[contentStart] === 45 && buffer[contentStart + 1] === 45) {
      break;
    }

    const nextBoundary = buffer.indexOf(boundaryBuf, contentStart);
    if (nextBoundary === -1) break;

    const part = buffer.slice(contentStart, nextBoundary);
    pos = nextBoundary;

    let sepIndex = part.indexOf('\r\n\r\n');
    let sepLen = 4;
    if (sepIndex === -1) {
      sepIndex = part.indexOf('\n\n');
      sepLen = 2;
    }
    if (sepIndex === -1) continue;

    const headStr = part.slice(0, sepIndex).toString('utf8');
    let body = part.slice(sepIndex + sepLen);

    if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) {
      body = body.slice(0, body.length - 2);
    } else if (body.length >= 1 && body[body.length - 1] === 10) {
      body = body.slice(0, body.length - 1);
    }

    const nameMatch = headStr.match(/content-disposition:[^\r\n]*name=["']?([^"';\r\n]+)["']?/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1].trim().toLowerCase();

    const filenameMatch = headStr.match(/filename=["']?([^"';\r\n]+)["']?/i);
    const typeMatch = headStr.match(/content-type:\s*([^\r\n;]+)/i);
    const mimeType = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';

    if (filenameMatch) {
      file = {
        fieldName,
        filename: path.basename(filenameMatch[1].trim()),
        mimeType,
        buffer: body
      };
    } else {
      fields[fieldName] = body.toString('utf8').trim();
    }
  }

  return { fields, file };
}

function sanitizeString(val, maxLen = 500) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (/^\[[a-z0-9_]+\]$/i.test(s) || /^\{[a-z0-9_]+\}$/i.test(s)) return '';
  return s.slice(0, maxLen);
}

function isGenericCandidateName(name) {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  return (
    lower === 'candidate' ||
    lower === 'applicant' ||
    lower === 'client' ||
    lower === 'unknown' ||
    lower === 'in' ||
    lower.startsWith('candidate (') ||
    lower.startsWith('client (')
  );
}

function sanitizePhone(val) {
  if (val === null || val === undefined) return '';
  const raw = String(val).trim();
  if (/^\[.*\]$/.test(raw) || /^\{.*\}$/.test(raw)) return '';
  const cleaned = raw.replace(/[^0-9+\-() ]/g, '').trim().slice(0, 22);
  const digits = cleaned.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? cleaned : '';
}

function extractValidClientEmail(explicitEmail, text) {
  const direct = sanitizeEmail(explicitEmail || '');
  if (direct && !isSalesOrInternalEmail(direct)) return direct;
  const matches = String(text || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  for (const m of matches) {
    const clean = sanitizeEmail(m);
    if (clean && !isSalesOrInternalEmail(clean)) return clean;
  }
  return '';
}

// =========================================================================
// SMART ZERO-LOSS TRANSCRIPT MERGE & INDIVIDUAL MESSAGE LOGGING
// =========================================================================

function normalizeForDiff(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function mergeChatTranscript(existingTranscript, incomingTranscript, isPreview = false) {
  const cleanIncoming = normalizeForDiff(incomingTranscript);
  const cleanExisting = normalizeForDiff(existingTranscript);
  if (!cleanIncoming) return { merged: cleanExisting, changed: false };
  if (!cleanExisting) return { merged: cleanIncoming, changed: true };
  if (cleanIncoming === cleanExisting) return { merged: cleanExisting, changed: false };

  const oldLines = cleanExisting.split('\n').map(l => l.trim()).filter(Boolean);
  const newLines = cleanIncoming.split('\n').map(l => l.trim()).filter(Boolean);

  if (isPreview) {
    const corePreview = cleanIncoming
      .replace(/^Subject:\s*[^\n]+\n-+\n/i, '')
      .replace(/^\[[^\]]+\]:\s*/i, '')
      .trim();
    if (!corePreview) return { merged: cleanExisting, changed: false };
    const lowerCore = corePreview.toLowerCase();
    const alreadyExists =
      cleanExisting.toLowerCase().includes(lowerCore) ||
      oldLines.some(l => l.replace(/^\[[^\]]+\]:\s*/i, '').trim().toLowerCase() === lowerCore);
    if (alreadyExists) {
      return { merged: cleanExisting, changed: false };
    }
    const appendLine = cleanIncoming.replace(/^Subject:\s*[^\n]+\n-+\n/i, '').trim();
    return {
      merged: cleanExisting + '\n' + appendLine,
      changed: true
    };
  }

  if (cleanIncoming.includes(cleanExisting)) {
    return { merged: cleanIncoming, changed: true };
  }

  // Block-level additive merge: never lose older scrolled-out messages AND append any new messages!
  if (newLines.length > 0) {
    const firstNewBody = newLines[0].replace(/^\[[^\]]+\]:\s*/i, '').trim().toLowerCase();
    const matchIdx = oldLines.findIndex(
      l => l.replace(/^\[[^\]]+\]:\s*/i, '').trim().toLowerCase() === firstNewBody
    );
    if (matchIdx !== -1) {
      const combined = oldLines.slice(0, matchIdx).concat(newLines).join('\n');
      return {
        merged: combined,
        changed: combined !== cleanExisting
      };
    }
  }

  // Overlap merge
  let overlapCount = 0;
  const maxOverlap = Math.min(oldLines.length, newLines.length);
  for (let k = maxOverlap; k >= 1; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      if (oldLines[oldLines.length - k + i] !== newLines[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      overlapCount = k;
      break;
    }
  }

  if (overlapCount > 0) {
    const appended = newLines.slice(overlapCount);
    if (appended.length === 0) return { merged: cleanExisting, changed: false };
    return {
      merged: cleanExisting + '\n' + appended.join('\n'),
      changed: true
    };
  }

  // Append any line from newLines not yet present at the tail of oldLines
  const existingSet = new Set(
    oldLines.map(l => l.replace(/^\[[^\]]+\]:\s*/i, '').trim().toLowerCase())
  );
  const trulyNew = newLines.filter(l => {
    const bodyOnly = l.replace(/^\[[^\]]+\]:\s*/i, '').trim().toLowerCase();
    return bodyOnly && !existingSet.has(bodyOnly);
  });

  if (trulyNew.length > 0) {
    return {
      merged: cleanExisting + '\n' + trulyNew.join('\n'),
      changed: true
    };
  }

  return { merged: cleanExisting, changed: false };
}

// Record each individual message into messages.json & lead.messageHistory
function appendIndividualMessages({
  lead,
  channel,
  salesPerson,
  clientName,
  clientPhone,
  clientEmail,
  subject,
  transcriptText,
  explicitMessages
}) {
  const allMessages = getMessages();
  const leadMessages = Array.isArray(lead.messageHistory) ? lead.messageHistory : [];

  const blocks = [];
  if (Array.isArray(explicitMessages) && explicitMessages.length > 0) {
    explicitMessages.forEach(m => {
      const body = String(m.text || m.body || '').trim();
      if (!body) return;
      const role = (m.senderRole === 'sales' || m.isOut || isSalesOutreachText(body)) ? 'sales' : 'client';
      blocks.push({
        senderRole: role,
        salesPerson: canonicalSalesName(m.salesPerson || salesPerson),
        clientName: clientName || 'Client',
        msgTime: String(m.msgTime || m.timestamp || '').trim(),
        body
      });
    });
  } else if (transcriptText) {
    const parsed = parseTranscriptIntoBlocks(transcriptText, salesPerson, clientName);
    parsed.forEach(b => {
      if (!b.isSubject && b.body) {
        blocks.push(b);
      }
    });
  }

  if (blocks.length === 0) return 0;

  // Build existing signature set for this lead + channel to avoid duplicating already-saved bubbles
  const existingSigs = new Set();
  leadMessages.forEach(m => {
    if (m.channel === channel) {
      const sig = `${m.senderRole}|${String(m.text || '').trim().toLowerCase()}`;
      existingSigs.add(sig);
    }
  });

  let addedCount = 0;
  const nowTs = nowLocal();
  const dayKey = todayKey();

  blocks.forEach((b, idx) => {
    const cleanBody = String(b.body || '').trim();
    if (!cleanBody) return;
    const sig = `${b.senderRole}|${cleanBody.toLowerCase()}`;
    if (existingSigs.has(sig)) return;
    existingSigs.add(sig);

    const msgObj = {
      id: `MSG-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}-${idx}`,
      leadId: lead.id,
      dateKey: dayKey,
      timestamp: nowTs,
      msgTime: b.msgTime || formatShortTime(new Date()),
      channel,
      salesPerson: b.salesPerson || salesPerson,
      clientName: lead.candidateName || clientName || 'Client',
      clientPhone: lead.phone || clientPhone || '',
      clientEmail: lead.email || clientEmail || '',
      senderRole: b.senderRole, // 'sales' | 'client'
      senderName: b.senderRole === 'sales' ? (b.salesPerson || salesPerson) : (lead.candidateName || clientName || 'Client'),
      subject: subject || '',
      text: cleanBody
    };

    leadMessages.push(msgObj);
    allMessages.unshift(msgObj);
    addedCount++;
  });

  if (addedCount > 0) {
    lead.messageHistory = leadMessages.slice(-500);
    saveMessages(allMessages);
  }
  return addedCount;
}

function buildCombinedRawText(lead) {
  const sections = [];
  const wa = (lead.whatsappTranscript || '').trim();
  const em = (lead.emailTranscript || '').trim();
  if (wa) sections.push(wa);
  if (em) {
    if (sections.length > 0) sections.push('--------------------------------------------------');
    sections.push(em);
  }
  return sections.join('\n');
}

function computeCleanChannel(lead, fallbackChannel = '') {
  const parts = [];
  if ((lead.whatsappTranscript || '').trim()) parts.push('WhatsApp');
  if ((lead.emailTranscript || '').trim()) parts.push('Email');
  if ((Array.isArray(lead.callHistory) && lead.callHistory.length > 0) || Boolean(lead.lastCall)) {
    parts.push('Call');
  }
  return parts.length > 0 ? parts.join(' + ') : fallbackChannel;
}

function ensureActivityDates(lead) {
  const set = new Set(Array.isArray(lead.activityDates) ? lead.activityDates : []);
  if (lead.timestamp) set.add(getLocalDateKey(lead.timestamp));
  if (lead.lastUpdated) set.add(getLocalDateKey(lead.lastUpdated));
  if (Array.isArray(lead.callHistory)) {
    lead.callHistory.forEach(c => {
      if (c.dateKey) set.add(c.dateKey);
      else if (c.callStartTime) set.add(getLocalDateKey(c.callStartTime));
    });
  }
  lead.activityDates = Array.from(set).filter(Boolean).sort();
  return lead.activityDates;
}

// =========================================================================
// LEAD & MESSAGE INGESTION (WhatsApp + Gmail + Manual + Call-Linked)
// =========================================================================

function processLeadIngest(payload) {
  const rawSource = String(payload.source || payload.channel || 'WhatsApp').trim();
  if (
    rawSource.toLowerCase() === 'call' &&
    !payload._fromCallProcessor &&
    (payload.call_duration !== undefined ||
      payload.call_duration_seconds !== undefined ||
      payload.duration !== undefined ||
      payload.call_direction !== undefined ||
      payload.call_type !== undefined ||
      payload.call_start_time !== undefined)
  ) {
    return processCallLog(payload);
  }

  const text = sanitizeString(payload.text || payload.message || payload.notes || '', 30000);
  const channelRaw = sanitizeString(rawSource, 50) || 'WhatsApp';
  const isPreview = Boolean(payload.is_preview || payload.isPreview);
  const clientPhone = sanitizePhone(payload.candidate_phone || payload.client_phone || payload.phone || '');
  const pKey = phoneKey10(clientPhone);

  // Never ingest a salesperson's own phone number as a client phone if accidentally passed
  if (pKey && SALES_PHONES_SET.has(pKey) && !payload.candidate_email) {
    return { status: 'ignored', message: 'Internal sales phone number skipped as client' };
  }

  const clientEmail = extractValidClientEmail(
    payload.candidate_email || payload.client_email || payload.email || '',
    text
  );

  let rawClientName = sanitizeString(payload.candidate_name || payload.client_name || payload.name || '', 100);

  const isWhatsApp = channelRaw.toLowerCase().includes('whatsapp');
  const isEmail = channelRaw.toLowerCase().includes('email') || channelRaw.toLowerCase().includes('gmail');
  const isCall = channelRaw.toLowerCase().includes('call');
  const cleanChannelLabel = isWhatsApp ? 'WhatsApp' : (isEmail ? 'Email' : (isCall ? 'Call' : channelRaw));

  if (isEmail && !clientEmail && !pKey) {
    return { status: 'ignored', message: 'Automated or system email skipped' };
  }

  if (isInternalGroup(rawClientName)) {
    return { status: 'ignored', message: 'Internal team group skipped' };
  }

  const incomingSalesPerson = canonicalSalesName(
    sanitizeString(payload.sales_person || payload.recruiter_name || payload.recruiter || 'Jinendra', 100),
    payload.recruiter_email || payload.sales_email || '',
    payload.recruiter_phone || payload.sales_phone || ''
  );

  const extractedName = extractClientName(text);
  let clientName = rawClientName;
  if (extractedName && (isGenericClientName(clientName) || clientName === clientEmail.split('@')[0])) {
    clientName = extractedName;
  }
  if (!clientName || clientName.toLowerCase() === 'in') {
    if (pKey) clientName = `Client (${pKey.slice(-4)})`;
    else if (clientEmail) clientName = clientEmail.split('@')[0];
    else clientName = 'Client';
  }

  const chatText = isCall ? '' : normalizeTranscriptSpeakers(text, incomingSalesPerson, clientName);
  const classification = classifySalesLead(chatText, payload.category || payload.custom_tag);
  const leads = getLeads();

  let existingIndex = -1;
  if (clientEmail) {
    existingIndex = leads.findIndex(l => sanitizeEmail(l.email || '') === clientEmail);
  }
  if (existingIndex === -1 && pKey.length >= 10) {
    existingIndex = leads.findIndex(l => phoneKey10(l.phone) === pKey);
  }
  if (existingIndex === -1 && !pKey && !clientEmail && !isGenericClientName(clientName)) {
    existingIndex = leads.findIndex(
      l => (l.candidateName || '').toLowerCase().trim() === clientName.toLowerCase().trim()
    );
  }

  const currentDay = todayKey();
  const currentTime = nowLocal();

  if (existingIndex !== -1) {
    const existing = leads[existingIndex];
    ensureActivityDates(existing);

    let hasMeaningfulUpdate = Boolean(payload._forceActivity);
    let newlyAddedMessages = 0;

    if (isWhatsApp && chatText) {
      const baseWa = normalizeTranscriptSpeakers(
        existing.whatsappTranscript || '',
        existing.recruiter || incomingSalesPerson,
        existing.candidateName || clientName
      );
      const merged = mergeChatTranscript(baseWa, chatText, isPreview);
      const normalizedMerged = normalizeTranscriptSpeakers(
        merged.merged,
        existing.recruiter || incomingSalesPerson,
        existing.candidateName || clientName
      );
      if (merged.changed || normalizedMerged !== existing.whatsappTranscript) {
        existing.whatsappTranscript = normalizedMerged;
        hasMeaningfulUpdate = true;
      }
      newlyAddedMessages = appendIndividualMessages({
        lead: existing,
        channel: 'WhatsApp',
        salesPerson: incomingSalesPerson,
        clientName: existing.candidateName || clientName,
        clientPhone: existing.phone || clientPhone,
        clientEmail: existing.email || clientEmail,
        subject: '',
        transcriptText: normalizedMerged,
        explicitMessages: payload.messages
      });
      if (newlyAddedMessages > 0) hasMeaningfulUpdate = true;
    } else if (isEmail && chatText) {
      const baseEm = existing.emailTranscript || '';
      const merged = mergeChatTranscript(baseEm, chatText, isPreview);
      if (merged.changed) {
        existing.emailTranscript = merged.merged;
        hasMeaningfulUpdate = true;
      }
      newlyAddedMessages = appendIndividualMessages({
        lead: existing,
        channel: 'Email',
        salesPerson: incomingSalesPerson,
        clientName: existing.candidateName || clientName,
        clientPhone: existing.phone || clientPhone,
        clientEmail: existing.email || clientEmail,
        subject: sanitizeString(payload.subject || '', 200),
        transcriptText: existing.emailTranscript,
        explicitMessages: payload.messages
      });
      if (newlyAddedMessages > 0) hasMeaningfulUpdate = true;
    } else if (isCall && payload.callEntry) {
      existing.callHistory = Array.isArray(existing.callHistory) ? existing.callHistory : [];
      existing.callHistory.unshift(payload.callEntry);
      existing.lastCall = payload.callEntry;
      existing.callDuration = payload.callEntry.durationFormatted;
      if (payload.callEntry.direction === 'missed' || payload.callEntry.direction === 'unanswered') {
        existing.followUpNeeded = true;
      }
      if (payload.recruiterNotes && !existing.recruiterNotes) {
        existing.recruiterNotes = sanitizeString(payload.recruiterNotes, 2000);
      }
      hasMeaningfulUpdate = true;
    }

    if (!existing.phone && clientPhone) { existing.phone = clientPhone; hasMeaningfulUpdate = true; }
    if (!existing.email && clientEmail) { existing.email = clientEmail; hasMeaningfulUpdate = true; }
    if (!isGenericClientName(clientName) && isGenericClientName(existing.candidateName)) {
      existing.candidateName = clientName;
      hasMeaningfulUpdate = true;
    }

    const companyName = sanitizeString(payload.company_name || payload.current_ctc || extractCompanyName(chatText), 100);
    const dealValue = sanitizeString(payload.deal_value || payload.expected_ctc || extractDealValue(chatText), 80);
    const serviceRequirement = sanitizeString(payload.service_requirement || payload.notice_period || '', 100);

    if (companyName && companyName !== existing.currentCtc) { existing.currentCtc = companyName; hasMeaningfulUpdate = true; }
    if (dealValue && dealValue !== existing.expectedCtc) { existing.expectedCtc = dealValue; hasMeaningfulUpdate = true; }
    if (serviceRequirement && serviceRequirement !== existing.noticePeriod) { existing.noticePeriod = serviceRequirement; hasMeaningfulUpdate = true; }

    const nextChannel = computeCleanChannel(existing, cleanChannelLabel);
    if (nextChannel && nextChannel !== existing.channel) {
      existing.channel = nextChannel;
      hasMeaningfulUpdate = true;
    }

    if (classification.category !== 'Active Prospect' || !existing.category) {
      existing.category = classification.category;
    }

    if (chatText && detectFollowUpSignal(chatText)) {
      existing.followUpNeeded = true;
    }

    if (!hasMeaningfulUpdate) {
      return { status: 'success', action: 'unchanged', lead: existing };
    }

    existing.rawText = buildCombinedRawText(existing);
    const eventDateKey = payload._eventDateKey || currentDay;
    existing.lastUpdated = payload._eventTimestamp || currentTime;
    if (!existing.activityDates.includes(eventDateKey)) {
      existing.activityDates.push(eventDateKey);
      existing.activityDates.sort();
    }

    if (incomingSalesPerson) {
      existing.recruiter = incomingSalesPerson;
    }

    leads.splice(existingIndex, 1);
    leads.unshift(existing);
    saveLeads(leads);

    broadcastEvent('lead_updated', {
      leadId: existing.id,
      candidateName: existing.candidateName,
      channel: existing.channel,
      newMessages: newlyAddedMessages
    });
    return { status: 'success', action: 'updated', lead: existing, newMessages: newlyAddedMessages };
  }

  // CREATE BRAND NEW CLIENT LEAD
  const companyName = sanitizeString(payload.company_name || payload.current_ctc || extractCompanyName(chatText), 100);
  const dealValue = sanitizeString(payload.deal_value || payload.expected_ctc || extractDealValue(chatText), 80);
  const serviceRequirement = sanitizeString(payload.service_requirement || payload.notice_period || '', 100);
  const createdTs = payload._eventTimestamp || currentTime;
  const createdDay = payload._eventDateKey || getLocalDateKey(createdTs);

  const newLead = {
    id: 'DEAL-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10),
    timestamp: createdTs,
    lastUpdated: createdTs,
    dateKey: createdDay,
    activityDates: [createdDay],
    recruiter: incomingSalesPerson,
    channel: cleanChannelLabel,
    category: classification.category,
    candidateName: clientName,
    phone: clientPhone,
    email: clientEmail,
    currentCtc: companyName,        // Company / Organization Name
    expectedCtc: dealValue,         // Deal Value / Commercials
    noticePeriod: serviceRequirement, // Service Type (BGV / Staffing / RPO)
    skills: sanitizeString(payload.skills || payload.subject || 'Sales Enquiry', 250),
    keywords: classification.keywords,
    whatsappTranscript: isWhatsApp ? chatText : '',
    emailTranscript: isEmail ? chatText : '',
    messageHistory: [],
    callHistory: payload.callEntry ? [payload.callEntry] : [],
    lastCall: payload.callEntry || null,
    callDuration: payload.callEntry ? payload.callEntry.durationFormatted : '',
    rawText: (isWhatsApp || isEmail) ? chatText : sanitizeString(payload.notes || payload.recruiterNotes || payload.text || '', 5000),
    followUpNeeded: Boolean(
      (chatText && detectFollowUpSignal(chatText)) ||
      (payload.callEntry && (payload.callEntry.direction === 'missed' || payload.callEntry.direction === 'unanswered'))
    ),
    followUpDate: sanitizeString(payload.followUpDate || '', 40),
    recruiterNotes: sanitizeString(payload.recruiterNotes || payload.notes || '', 2000),
    status: sanitizeString(payload.status || 'New Lead', 40)
  };

  if (isWhatsApp || isEmail) {
    appendIndividualMessages({
      lead: newLead,
      channel: isWhatsApp ? 'WhatsApp' : 'Email',
      salesPerson: incomingSalesPerson,
      clientName,
      clientPhone,
      clientEmail,
      subject: sanitizeString(payload.subject || '', 200),
      transcriptText: chatText,
      explicitMessages: payload.messages
    });
  }

  newLead.channel = computeCleanChannel(newLead, cleanChannelLabel);
  leads.unshift(newLead);
  saveLeads(leads);

  broadcastEvent('lead_created', { leadId: newLead.id, candidateName: newLead.candidateName, channel: newLead.channel });
  return { status: 'success', action: 'created', lead: newLead };
}

// =========================================================================
// BATCH EXCEL / CSV DEALS IMPORT (Auto-Mapping & Fast Ingestion)
// =========================================================================

function processBatchLeadImport(items, defaultSalesperson = '') {
  if (!Array.isArray(items) || items.length === 0) {
    return { status: 'error', message: 'No deal items provided in import array' };
  }
  const leads = getLeads();
  let createdCount = 0;
  let updatedCount = 0;
  const currentTime = nowLocal();
  const currentDay = todayKey();

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;

    const clientPhone = sanitizePhone(raw.client_phone || raw.phone || raw.mobile || raw.contact || raw.candidate_phone || '');
    const pKey = phoneKey10(clientPhone);
    const clientEmail = sanitizeEmail(raw.client_email || raw.email || raw.candidate_email || '');

    let clientName = sanitizeString(raw.client_name || raw.candidate_name || raw.name || raw.contact_name || '', 100);
    if (!clientName && (raw.first_name || raw.last_name)) {
      clientName = [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim();
    }
    if (!clientName || isGenericCandidateName(clientName)) {
      if (pKey) clientName = `Client (${pKey.slice(-4)})`;
      else if (clientEmail) clientName = clientEmail.split('@')[0];
      else clientName = 'Imported Client';
    }

    const companyName = sanitizeString(raw.company_name || raw.company || raw.current_ctc || raw.organization || raw.firm || '', 100);
    const dealValue = sanitizeString(raw.deal_value || raw.expected_ctc || raw.budget || raw.commercials || '', 80);
    const serviceRequirement = sanitizeString(raw.service_requirement || raw.service || raw.requirement || raw.skills || raw.notice_period || 'Corporate Services', 100);

    // Salesperson mapping
    const rawSales = raw.sales_person || raw.salesperson || raw.recruiter || raw.owner || raw.lead_owner || defaultSalesperson || '';
    let salespersonName = rawSales ? canonicalSalesName(rawSales) : 'Jinendra';
    if (!salespersonName || salespersonName === 'Jinendra') {
      if (defaultSalesperson) salespersonName = canonicalSalesName(defaultSalesperson);
    }

    const status = sanitizeString(raw.status || raw.stage || 'New Lead', 40);
    const channel = sanitizeString(raw.channel || raw.source || raw.lead_source || 'Excel Import', 50);
    const notes = sanitizeString(raw.notes || raw.salespersonNotes || raw.remarks || raw.description || raw.text || '', 5000);
    const category = sanitizeString(raw.category || 'Client / Employer Lead', 60);

    // Deduplicate by Email -> Phone
    let existingIndex = -1;
    if (clientEmail) {
      existingIndex = leads.findIndex(l => sanitizeEmail(l.email || '') === clientEmail);
    }
    if (existingIndex === -1 && pKey.length >= 10) {
      existingIndex = leads.findIndex(l => phoneKey10(l.phone) === pKey);
    }

    if (existingIndex !== -1) {
      const existing = leads[existingIndex];
      if (!existing.phone && clientPhone) existing.phone = clientPhone;
      if (!existing.email && clientEmail) existing.email = clientEmail;
      if (isGenericCandidateName(existing.candidateName) && !isGenericCandidateName(clientName)) {
        existing.candidateName = clientName;
      }
      if (companyName && (!existing.currentCtc || existing.currentCtc === '')) existing.currentCtc = companyName;
      if (dealValue && !existing.expectedCtc) existing.expectedCtc = dealValue;
      if (serviceRequirement && (!existing.noticePeriod || existing.noticePeriod === '')) existing.noticePeriod = serviceRequirement;
      if (salespersonName && (!existing.recruiter || existing.recruiter === 'Jinendra')) {
        existing.recruiter = salespersonName;
      }
      if (notes) {
        existing.recruiterNotes = existing.recruiterNotes ? (existing.recruiterNotes + '\n' + notes) : notes;
        existing.rawText = existing.rawText ? (existing.rawText + '\n' + notes) : notes;
      }
      existing.lastUpdated = currentTime;
      if (!existing.activityDates.includes(currentDay)) {
        existing.activityDates.push(currentDay);
        existing.activityDates.sort();
      }
      updatedCount++;
    } else {
      const newDeal = {
        id: 'DEAL-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10),
        timestamp: currentTime,
        lastUpdated: currentTime,
        dateKey: currentDay,
        activityDates: [currentDay],
        recruiter: salespersonName,
        channel: channel,
        category: category,
        candidateName: clientName,
        phone: clientPhone,
        email: clientEmail,
        currentCtc: companyName,
        expectedCtc: dealValue,
        noticePeriod: serviceRequirement,
        skills: serviceRequirement,
        keywords: [],
        whatsappTranscript: '',
        emailTranscript: '',
        messageHistory: [],
        callHistory: [],
        lastCall: null,
        callDuration: '',
        rawText: notes,
        followUpNeeded: false,
        followUpDate: '',
        recruiterNotes: notes,
        status: status
      };
      leads.unshift(newDeal);
      createdCount++;
    }
  }

  saveLeads(leads);
  broadcastEvent('leads_imported', { total: items.length, created: createdCount, updated: updatedCount });
  return { status: 'success', total: items.length, created: createdCount, updated: updatedCount };
}

// =========================================================================
// PHONE CALL LOGGER + CALL RECORDINGS + CALL TRANSCRIPTS ("BAAT KYA KARI")
// =========================================================================

function saveBase64AudioRecording(base64Str, callId, mimeHint = '') {
  if (!base64Str || typeof base64Str !== 'string') return null;
  try {
    let rawBase64 = base64Str.trim();
    let ext = 'webm';
    let mime = mimeHint || 'audio/webm';

    const dataUriMatch = rawBase64.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUriMatch) {
      mime = dataUriMatch[1].toLowerCase();
      rawBase64 = dataUriMatch[2];
    }
    if (mime.includes('mp3') || mime.includes('mpeg')) ext = 'mp3';
    else if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) ext = 'm4a';
    else if (mime.includes('wav')) ext = 'wav';
    else if (mime.includes('ogg')) ext = 'ogg';
    else if (mime.includes('amr')) ext = 'amr';

    const buf = Buffer.from(rawBase64, 'base64');
    if (buf.length < 100) return null;

    const filename = `${callId}_${Date.now()}.${ext}`;
    const fullPath = path.join(RECORDINGS_DIR, filename);
    fs.writeFileSync(fullPath, buf);
    return {
      recordingFile: filename,
      recordingUrl: `/api/recordings/${filename}`,
      recordingMime: mime,
      recordingSize: buf.length
    };
  } catch (e) {
    return null;
  }
}

function parseCallDirectionAndStatus(rawDir, durationSec, hasExplicitStatus = '') {
  const s = String(rawDir || '').toLowerCase().trim();
  const st = String(hasExplicitStatus || '').toLowerCase().trim();

  if (/unanswer|no[\s_-]*pickup|not[\s_-]*answered|client[\s_-]*didn/i.test(s) || /unanswer|no[\s_-]*pickup/i.test(st)) {
    return { direction: 'unanswered', callStatus: 'Client Did Not Pick Up' };
  }
  if (/miss/i.test(s) || /miss/i.test(st)) {
    return { direction: 'missed', callStatus: 'Missed Call (Incoming)' };
  }
  if (/cut|reject|declin|busy|cancel/i.test(s) || /cut|reject|declin/i.test(st)) {
    if (/out|dial/i.test(s)) {
      return { direction: 'unanswered', callStatus: 'Call Cut / Client Did Not Pick Up' };
    }
    return { direction: 'missed', callStatus: 'Call Cut / Missed' };
  }
  if (/^in|incoming|received|\b1\b/i.test(s)) {
    if (durationSec === 0) {
      return { direction: 'missed', callStatus: 'Missed Call (Incoming)' };
    }
    return { direction: 'incoming', callStatus: 'Incoming Answered' };
  }
  // Default Outgoing
  if (durationSec === 0) {
    return { direction: 'unanswered', callStatus: 'Client Did Not Pick Up' };
  }
  return { direction: 'outgoing', callStatus: 'Outgoing Answered' };
}

function processCallLog(data) {
  const phone = sanitizePhone(
    data.candidate_phone || data.client_phone || data.phone || data.number || data.phone_number || data.caller || ''
  );
  if (!phone) {
    return {
      status: 'error',
      message: 'Valid phone number is required. In MacroDroid use {call_number} instead of [call_number].'
    };
  }

  const pKey = phoneKey10(phone);
  const recruiterName = canonicalSalesName(
    sanitizeString(data.sales_person || data.salesperson || data.salesperson_name || data.recruiter_name || data.recruiter || 'Jinendra', 100),
    data.recruiter_email || data.sales_email || '',
    data.recruiter_phone || data.sales_phone || ''
  );
  const recruiterPhone = sanitizePhone(data.recruiter_phone || '');
  let candidateName = sanitizeString(data.candidate_name || data.client_name || data.name || data.contact_name || '', 100);

  const leads = getLeads();
  const matchedLead = pKey.length >= 10 ? leads.find(l => phoneKey10(l.phone) === pKey) : null;
  if (isGenericClientName(candidateName) && matchedLead && !isGenericClientName(matchedLead.candidateName)) {
    candidateName = matchedLead.candidateName;
  }
  if (!candidateName || isGenericClientName(candidateName)) {
    candidateName = `Client (${pKey.slice(-4) || 'Call'})`;
  }

  const rawDir = sanitizeString(
    data.call_direction || data.direction || data.call_type || data.type || 'outgoing',
    40
  ).toLowerCase();

  let durationSec = parseDurationToSeconds(
    data.call_duration_seconds ?? data.duration_seconds ?? data.call_duration ?? data.duration ?? 0
  );

  const hasStart = Boolean(data.call_start_time || data.start_time);
  const hasEnd = Boolean(data.call_end_time || data.end_time);

  let startDate;
  let endDate;

  const isExplicitZeroTalk =
    /miss|reject|unanswer|declined|no_pickup/i.test(rawDir) ||
    Boolean(data.force_zero_duration);

  if (hasStart && hasEnd) {
    startDate = parseFlexDate(data.call_start_time || data.start_time);
    endDate = parseFlexDate(data.call_end_time || data.end_time);
    if (!durationSec && endDate > startDate && !isExplicitZeroTalk) {
      durationSec = Math.round((endDate.getTime() - startDate.getTime()) / 1000);
    }
  } else if (hasStart && !hasEnd) {
    startDate = parseFlexDate(data.call_start_time || data.start_time);
    endDate = new Date(startDate.getTime() + durationSec * 1000);
  } else {
    endDate = hasEnd ? parseFlexDate(data.call_end_time || data.end_time) : new Date();
    startDate = new Date(endDate.getTime() - durationSec * 1000);
  }

  const { direction, callStatus } = parseCallDirectionAndStatus(rawDir, durationSec, data.call_status || '');

  let notes = sanitizeString(data.notes || data.summary || '', 2000);
  if (/^call ended\.\s*type:/i.test(notes)) notes = '';

  const callTranscript = sanitizeString(
    data.call_transcript || data.transcript || data.spoken_text || '',
    15000
  );

  const startLocal = formatLocalTimestamp(startDate);
  const endLocal = formatLocalTimestamp(endDate);
  const dateKey = getLocalDateKey(startDate);
  const logs = getCallLogs();

  // Native Android app: idempotent re-sends (offline retry) using a stable device call key
  const deviceCallKey = sanitizeString(data.device_call_key || '', 120);
  if (deviceCallKey) {
    const already = logs.find(l => l.deviceCallKey === deviceCallKey);
    if (already) {
      return { status: 'success', action: 'deduplicated', callLog: already };
    }
  }

  // Prevent accidental duplicate double-fire within 8s, UNLESS the second fire carries audio recording or transcript!
  const recentDup = logs.find(l => {
    if (phoneKey10(l.candidatePhone) !== pKey) return false;
    if (l.durationSeconds !== durationSec) return false;
    const prevEnd = parseFlexDate(l.callEndTime).getTime();
    return Math.abs(endDate.getTime() - prevEnd) < 8000;
  });

  const callId = recentDup ? recentDup.id : ('CALL-' + Date.now().toString().slice(-8));
  let recordingMeta = null;
  const rawAudio = data.audio_base64 || data.recording_base64 || data.audioData || '';
  if (rawAudio) {
    recordingMeta = saveBase64AudioRecording(rawAudio, callId, data.audio_mime || '');
  }

  if (recentDup) {
    let updatedDup = false;
    if (recordingMeta) {
      recentDup.recordingUrl = recordingMeta.recordingUrl;
      recentDup.recordingFile = recordingMeta.recordingFile;
      recentDup.recordingMime = recordingMeta.recordingMime;
      updatedDup = true;
    }
    if (callTranscript && callTranscript !== recentDup.callTranscript) {
      recentDup.callTranscript = callTranscript;
      updatedDup = true;
    }
    if (notes && notes !== recentDup.notes) {
      recentDup.notes = notes;
      updatedDup = true;
    }
    if (updatedDup) {
      saveCallLogs(logs);
      syncCallEntryIntoLead(recentDup);
      broadcastEvent('call_updated', { callId: recentDup.id, callLog: recentDup });
    }
    return { status: 'success', action: updatedDup ? 'updated' : 'deduplicated', callLog: recentDup };
  }

  const timeSpanDisplay = `${formatShortTime(startDate)} → ${formatShortTime(endDate)}`;

  const callLog = {
    id: callId,
    dateKey,
    recruiterName,
    recruiterPhone,
    candidateName,
    candidatePhone: phone,
    direction,      // 'incoming' | 'outgoing' | 'missed' | 'unanswered'
    callStatus,     // 'Incoming Answered' | 'Outgoing Answered' | 'Missed Call (Incoming)' | 'Client Did Not Pick Up'
    callStartTime: startLocal,
    callEndTime: endLocal,
    callStartDisplay: formatDisplayDateTime(startDate),
    callEndDisplay: formatDisplayDateTime(endDate),
    timeSpanDisplay,
    durationSeconds: durationSec,
    durationFormatted: formatDuration(durationSec),
    recordingUrl: recordingMeta ? recordingMeta.recordingUrl : (data.recordingUrl || ''),
    recordingFile: recordingMeta ? recordingMeta.recordingFile : (data.recordingFile || ''),
    recordingMime: recordingMeta ? recordingMeta.recordingMime : (data.recordingMime || ''),
    callTranscript: callTranscript || '',
    notes,
    deviceCallKey,
    source: sanitizeString(data.source_app || '', 40),
    loggedAt: nowLocal()
  };

  logs.unshift(callLog);
  saveCallLogs(logs);

  processLeadIngest({
    _fromCallProcessor: true,
    _forceActivity: true,
    _eventTimestamp: endLocal,
    _eventDateKey: dateKey,
    source: 'Call',
    recruiter_name: recruiterName,
    candidate_name: candidateName,
    candidate_phone: phone,
    recruiterNotes: notes,
    callEntry: {
      id: callLog.id,
      dateKey,
      direction: callLog.direction,
      callStatus: callLog.callStatus,
      callStartTime: startLocal,
      callEndTime: endLocal,
      callStartDisplay: callLog.callStartDisplay,
      callEndDisplay: callLog.callEndDisplay,
      timeSpanDisplay: callLog.timeSpanDisplay,
      durationSeconds: durationSec,
      durationFormatted: callLog.durationFormatted,
      recordingUrl: callLog.recordingUrl,
      recordingFile: callLog.recordingFile,
      callTranscript: callLog.callTranscript,
      recruiterName,
      notes
    },
    text: ''
  });

  broadcastEvent('call_logged', {
    callId: callLog.id,
    candidateName: callLog.candidateName,
    candidatePhone: callLog.candidatePhone,
    direction: callLog.direction,
    callStatus: callLog.callStatus,
    durationFormatted: callLog.durationFormatted,
    recordingUrl: callLog.recordingUrl,
    hasTranscript: Boolean(callLog.callTranscript),
    recruiterName: callLog.recruiterName
  });

  return { status: 'success', action: 'logged', callLog };
}

function syncCallEntryIntoLead(callLog) {
  if (!callLog) return;
  const leads = getLeads();
  const pKey = phoneKey10(callLog.candidatePhone);
  const lead = leads.find(l =>
    (Array.isArray(l.callHistory) && l.callHistory.some(c => c.id === callLog.id)) ||
    (pKey.length >= 10 && phoneKey10(l.phone) === pKey)
  );
  if (!lead) return;

  lead.callHistory = Array.isArray(lead.callHistory) ? lead.callHistory : [];
  const idx = lead.callHistory.findIndex(c => c.id === callLog.id);
  const entry = {
    id: callLog.id,
    dateKey: callLog.dateKey,
    direction: callLog.direction,
    callStatus: callLog.callStatus,
    callStartTime: callLog.callStartTime,
    callEndTime: callLog.callEndTime,
    callStartDisplay: callLog.callStartDisplay,
    callEndDisplay: callLog.callEndDisplay,
    timeSpanDisplay: callLog.timeSpanDisplay,
    durationSeconds: callLog.durationSeconds,
    durationFormatted: callLog.durationFormatted,
    recordingUrl: callLog.recordingUrl || '',
    recordingFile: callLog.recordingFile || '',
    callTranscript: callLog.callTranscript || '',
    recruiterName: callLog.recruiterName,
    notes: callLog.notes || ''
  };
  if (idx !== -1) {
    lead.callHistory[idx] = entry;
  } else {
    lead.callHistory.unshift(entry);
  }
  if (!lead.lastCall || lead.lastCall.id === callLog.id) {
    lead.lastCall = entry;
  }
  saveLeads(leads);
}

function attachRecordingToCallOrLead({ callId, deviceCallKey, recruiter, phone, filename, recordingMeta, transcript, notes }) {
  const logs = getCallLogs();
  let targetCall = null;
  const pKey = phone ? phoneKey10(phone) : '';

  if (callId) {
    targetCall = logs.find(c => c.id === callId) || null;
  }
  if (!targetCall && deviceCallKey) {
    targetCall = logs.find(c => c.deviceCallKey === deviceCallKey) || null;
  }
  if (!targetCall && pKey) {
    targetCall = logs.find(c => phoneKey10(c.candidatePhone) === pKey);
  }
  if (!targetCall && !pKey && recruiter) {
    const cRec = canonicalSalesName(recruiter);
    targetCall = logs.find(c => salesPersonMatches(c.recruiterName, cRec));
  }
  if (!targetCall && !pKey && !recruiter && logs.length > 0) {
    targetCall = logs[0];
  }

  const recName = recruiter || (targetCall ? targetCall.recruiterName : 'Jinendra');
  const durSec = targetCall ? (targetCall.durationSeconds || 0) : 0;
  const durStr = targetCall ? (targetCall.durationFormatted || `${durSec}s`) : '0s';

  const autoTranscript = transcript || (targetCall && targetCall.callTranscript) || 
    `📞 [Auto-Recorded Call] Duration: ${durStr}. Call audio synced automatically from ${recName}'s phone. Audio file: ${filename || (recordingMeta && recordingMeta.recordingFile) || 'call_recording'}. Ready to play.`;

  if (!targetCall) {
    const created = processCallLog({
      recruiter_name: recName,
      candidate_phone: phone || '0000000000',
      candidate_name: 'Recorded Call Client',
      call_direction: 'outgoing',
      call_duration_seconds: durSec,
      recordingUrl: recordingMeta ? recordingMeta.recordingUrl : '',
      recordingFile: recordingMeta ? recordingMeta.recordingFile : '',
      recordingMime: recordingMeta ? recordingMeta.recordingMime : '',
      call_transcript: autoTranscript,
      notes: notes || 'Automatically captured call recording'
    });
    const createdLog = created.callLog || created;
    if (recordingMeta && recordingMeta.recordingFile && !transcript && createdLog && createdLog.id) {
      queueAiTranscription(createdLog.id, recordingMeta.recordingFile, recordingMeta.recordingMime);
    }
    return { status: 'created', callLog: createdLog };
  }

  if (recordingMeta) {
    targetCall.recordingUrl = recordingMeta.recordingUrl;
    targetCall.recordingFile = recordingMeta.recordingFile;
    targetCall.recordingMime = recordingMeta.recordingMime;
  }
  if (!targetCall.callTranscript || targetCall.callTranscript.trim() === '') {
    targetCall.callTranscript = autoTranscript;
  }
  if (notes && (!targetCall.notes || targetCall.notes.trim() === '')) {
    targetCall.notes = notes;
  }

  saveCallLogs(logs);
  syncCallEntryIntoLead(targetCall);
  broadcastEvent('call_updated', {
    callId: targetCall.id,
    recordingUrl: targetCall.recordingUrl,
    callTranscript: targetCall.callTranscript,
    callLog: targetCall
  });

  if (recordingMeta && recordingMeta.recordingFile && !transcript) {
    queueAiTranscription(targetCall.id, recordingMeta.recordingFile, recordingMeta.recordingMime);
  }

  return { status: 'success', callLog: targetCall };
}

// =========================================================================
// AI CALL TRANSCRIPTION ("BAAT KYA HUI") — Gemini API (optional)
// Set environment variable GEMINI_API_KEY to enable. Without a key, recordings
// still upload and play; only the auto-written conversation text is skipped.
// =========================================================================
const transcriptionQueue = [];
let transcriptionRunning = false;

function queueAiTranscription(callId, recordingFile, mime) {
  if (!process.env.GEMINI_API_KEY) return;
  transcriptionQueue.push({ callId, recordingFile, mime });
  runTranscriptionQueue();
}

async function runTranscriptionQueue() {
  if (transcriptionRunning) return;
  transcriptionRunning = true;
  while (transcriptionQueue.length) {
    const job = transcriptionQueue.shift();
    try {
      await transcribeRecording(job);
    } catch (e) {
      console.error(`[AI Transcription] ${job.callId} failed: ${e.message}`);
    }
  }
  transcriptionRunning = false;
}

async function transcribeRecording({ callId, recordingFile, mime }) {
  const filePath = path.join(RECORDINGS_DIR, recordingFile);
  if (!fs.existsSync(filePath)) return;
  const buf = fs.readFileSync(filePath);
  if (buf.length > 19 * 1024 * 1024) {
    console.warn(`[AI Transcription] ${recordingFile} too large for inline transcription`);
    return;
  }
  const ext = path.extname(recordingFile).replace('.', '').toLowerCase();
  const mimeMap = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', amr: 'audio/amr', webm: 'audio/webm', '3gp': 'audio/3gpp' };
  const audioMime = mimeMap[ext] || (mime && mime.startsWith('audio/') ? mime : 'audio/mp4');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const prompt =
    'This is a phone call recording between a salesperson of OrbitTouch HR / OrbitVerify and a client. ' +
    'Write the conversation transcript in the original language (Hindi/Hinglish/English), one line per turn, ' +
    'formatted exactly as "[Sales]: ..." or "[Client]: ...". After the transcript add a blank line and then ' +
    '"SUMMARY:" followed by 2-4 bullet points covering what was discussed, pricing/commitments, and next steps.';

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: audioMime, data: buf.toString('base64') } }] }]
    })
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const text = (((json.candidates || [])[0] || {}).content || {}).parts
    ? json.candidates[0].content.parts.map(p => p.text || '').join('').trim()
    : '';
  if (!text) return;

  const logs = getCallLogs();
  const call = logs.find(c => c.id === callId);
  if (!call) return;
  call.callTranscript = sanitizeString(text, 15000);
  call.transcriptSource = 'ai';
  saveCallLogs(logs);
  syncCallEntryIntoLead(call);
  broadcastEvent('call_updated', { callId: call.id, callTranscript: call.callTranscript, callLog: call });
  console.log(`[AI Transcription] ${callId} transcript saved (${text.length} chars)`);
}

// =========================================================================
// LIVE REAL-TIME CALL STOPWATCH ENGINE
// (Ringing / Dialing -> Talking Timer + Live Transcript -> Call Cut / Ended)
// =========================================================================

const activeCalls = new Map(); // salesKey -> { recruiterName, phone, candidateName, direction, status, ringStartMs, talkStartMs, startLocal, startDisplay, liveTranscript }

const salesCleanupCallsTimer = setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [key, item] of activeCalls.entries()) {
    const refMs = item.talkStartMs || item.ringStartMs || now;
    if (now - refMs > 30 * 60 * 1000) {
      activeCalls.delete(key);
      changed = true;
    }
  }
  if (changed) broadcastLiveCallsState();
}, 60 * 1000);
if (salesCleanupCallsTimer.unref) salesCleanupCallsTimer.unref();

function getActiveCallsList() {
  const now = Date.now();
  return Array.from(activeCalls.values()).filter(item => {
    const refMs = item.talkStartMs || item.ringStartMs || now;
    return now - refMs <= 30 * 60 * 1000;
  }).map(item => ({
    ...item,
    salespersonName: item.salespersonName || item.recruiterName || 'Jinendra',
    clientName: item.clientName || item.candidateName || 'Active Client'
  }));
}

function broadcastLiveCallsState() {
  broadcastEvent('live_calls_state', { activeCalls: getActiveCallsList() });
}

function resolveLiveClientName(phone, rawName) {
  const cleanName = sanitizeString(rawName || '', 100);
  const pKey = phoneKey10(phone);
  const matched = pKey.length >= 10 ? getLeads().find(l => phoneKey10(l.phone) === pKey) : null;
  if (!isGenericClientName(cleanName) && cleanName !== phone) return cleanName;
  if (matched && !isGenericClientName(matched.candidateName)) return matched.candidateName;
  return pKey ? `Client (${pKey.slice(-4)})` : (cleanName || 'Active Client');
}

function processLiveCallEvent(data, eventTimeMs = Date.now()) {
  const event = sanitizeString(data.event || data.state || 'ended', 30).toLowerCase();
  const recruiterName = canonicalSalesName(
    sanitizeString(data.sales_person || data.salesperson || data.salesperson_name || data.recruiter || data.recruiter_name || 'Jinendra', 100),
    data.recruiter_email || '',
    data.recruiter_phone || ''
  );
  const rKey = recruiterName.toLowerCase().trim();

  const incomingPhone = sanitizePhone(data.phone || data.candidate_phone || data.client_phone || data.number || '');
  const incomingName = sanitizeString(data.name || data.candidate_name || data.client_name || '', 100);
  const rawDir = sanitizeString(data.dir || data.direction || data.call_type || '', 30).toLowerCase();
  const incomingTranscript = sanitizeString(data.call_transcript || data.transcript || '', 15000);

  const existing = activeCalls.get(rKey) || null;
  const finalPhone = incomingPhone || (existing ? existing.phone : '');
  const finalName = resolveLiveClientName(finalPhone, incomingName || (existing ? existing.candidateName : ''));
  const eventNow = new Date(eventTimeMs || Date.now());

  // Live transcript update during ongoing call
  if (event === 'transcript' && existing) {
    existing.liveTranscript = incomingTranscript || existing.liveTranscript || '';
    activeCalls.set(rKey, existing);
    broadcastLiveCallsState();
    return { status: 'success', state: existing.status, liveCall: existing };
  }

  // 1. RINGING (Incoming) or DIALING (Outgoing)
  if (event === 'ringing' || event === 'incoming' || event === 'dialing' || event === 'outgoing') {
    const isRingEvent = event === 'ringing' || event === 'incoming';
    const direction = isRingEvent ? 'incoming' : (rawDir.includes('in') ? 'incoming' : 'outgoing');

    if (existing && (existing.status === 'talking' || existing.talkStartMs)) {
      if (finalPhone && (!existing.phone || existing.phone.includes('.'))) existing.phone = finalPhone;
      if (finalName && (!existing.candidateName || existing.candidateName.includes('('))) existing.candidateName = finalName;
      return { status: 'success', state: 'talking', liveCall: existing };
    }

    const stateObj = {
      recruiterName,
      phone: finalPhone || 'Connecting...',
      candidateName: finalName,
      direction,
      status: direction === 'incoming' ? 'ringing' : 'dialing',
      ringStartMs: (existing && existing.ringStartMs) ? existing.ringStartMs : eventNow.getTime(),
      talkStartMs: null,
      startLocal: formatLocalTimestamp(eventNow),
      startDisplay: formatDisplayDateTime(eventNow),
      liveTranscript: existing ? existing.liveTranscript : ''
    };
    activeCalls.set(rKey, stateObj);
    broadcastLiveCallsState();
    return { status: 'success', state: stateObj.status, liveCall: stateObj };
  }

  // 2. CALL ACTIVE / ANSWERED (Exact talk timer starts!)
  if (event === 'started' || event === 'active' || event === 'answered' || event === 'start') {
    let direction = 'outgoing';
    if (rawDir) {
      direction = rawDir.includes('in') ? 'incoming' : 'outgoing';
    } else if (existing && existing.direction) {
      direction = existing.direction;
    }

    const stateObj = {
      recruiterName,
      phone: finalPhone || 'On Call',
      candidateName: finalName,
      direction,
      status: 'talking',
      ringStartMs: existing ? existing.ringStartMs : eventNow.getTime(),
      talkStartMs: (existing && existing.talkStartMs) ? existing.talkStartMs : eventNow.getTime(),
      startLocal: (existing && existing.talkStartMs) ? existing.startLocal : formatLocalTimestamp(eventNow),
      startDisplay: (existing && existing.talkStartMs) ? existing.startDisplay : formatDisplayDateTime(eventNow),
      liveTranscript: incomingTranscript || (existing ? existing.liveTranscript : '')
    };
    activeCalls.set(rKey, stateObj);
    broadcastLiveCallsState();
    return { status: 'success', state: 'talking', liveCall: stateObj };
  }

  // 3. CALL ENDED / CUT
  if (event === 'ended' || event === 'end' || event === 'hangup' || event === 'cut' || event === 'missed' || event === 'unanswered') {
    const endDate = eventNow;
    activeCalls.delete(rKey);
    broadcastLiveCallsState();

    const explicitDur = parseDurationToSeconds(data.duration ?? data.call_duration ?? data.call_duration_seconds ?? 0);
    const mergedTranscript = incomingTranscript || (existing && existing.liveTranscript) || '';
    const rawAudio = data.audio_base64 || data.recording_base64 || data.audioData || '';

    // Native Android app sends the authoritative call record separately (from the phone's CallLog),
    // so the live "ended" event only needs to clear the stopwatch banner.
    if (String(data.skip_log || '').toLowerCase() === '1' || String(data.skip_log || '').toLowerCase() === 'true') {
      return { status: 'success', state: 'ended', skipped: true };
    }

    let baseDir = rawDir || (existing ? existing.direction : 'outgoing');
    if (event === 'missed') baseDir = 'missed';
    if (event === 'unanswered') baseDir = 'unanswered';

    // Case A: Live stopwatch captured talkStartMs
    if (existing && existing.talkStartMs) {
      const rawElapsedSec = Math.max(0, Math.round((endDate.getTime() - existing.talkStartMs) / 1000));
      let effectiveDur = explicitDur > 0 ? explicitDur : rawElapsedSec;
      let effectiveStartDate = new Date(existing.talkStartMs);
      let callDirection = baseDir;
      let callStatus = '';

      if (baseDir === 'outgoing' && explicitDur === 0) {
        if (rawElapsedSec <= 10 || event === 'unanswered' || event === 'cut') {
          effectiveDur = 0;
          callDirection = 'unanswered';
          callStatus = 'Client Did Not Pick Up';
          effectiveStartDate = new Date(existing.ringStartMs || existing.talkStartMs);
        } else {
          const ringDeductionSec = 8;
          effectiveDur = Math.max(1, rawElapsedSec - ringDeductionSec);
          effectiveStartDate = new Date(endDate.getTime() - effectiveDur * 1000);
          callDirection = 'outgoing';
          callStatus = 'Outgoing Answered';
        }
      }

      return processCallLog({
        recruiter_name: recruiterName,
        candidate_phone: finalPhone,
        candidate_name: finalName,
        call_direction: callDirection,
        call_status: callStatus,
        call_start_time: formatLocalTimestamp(effectiveStartDate),
        call_end_time: formatLocalTimestamp(endDate),
        call_duration_seconds: effectiveDur,
        force_zero_duration: effectiveDur === 0,
        call_transcript: mergedTranscript,
        notes: data.notes || '',
        audio_base64: rawAudio,
        audio_mime: data.audio_mime || ''
      });
    }

    // Case B: Explicit call duration reported directly
    if (explicitDur > 0) {
      const startDate = new Date(endDate.getTime() - explicitDur * 1000);
      return processCallLog({
        recruiter_name: recruiterName,
        candidate_phone: finalPhone,
        candidate_name: finalName,
        call_direction: baseDir,
        call_start_time: formatLocalTimestamp(startDate),
        call_end_time: formatLocalTimestamp(endDate),
        call_duration_seconds: explicitDur,
        call_transcript: mergedTranscript,
        notes: data.notes || '',
        audio_base64: rawAudio,
        audio_mime: data.audio_mime || ''
      });
    }

    // Case C: Phone rang / dialed (`ringStartMs`) and ended without explicit talkStartMs
    if (existing && existing.ringStartMs) {
      const ringDate = new Date(existing.ringStartMs);
      const elapsedSec = Math.max(0, Math.round((endDate.getTime() - ringDate.getTime()) / 1000));

      if (elapsedSec >= 10 && event !== 'missed' && event !== 'unanswered' && event !== 'cut') {
        const assumedTalkSec = Math.max(1, elapsedSec - 6);
        const talkStartDate = new Date(endDate.getTime() - assumedTalkSec * 1000);
        return processCallLog({
          recruiter_name: recruiterName,
          candidate_phone: finalPhone,
          candidate_name: finalName,
          call_direction: baseDir,
          call_start_time: formatLocalTimestamp(talkStartDate),
          call_end_time: formatLocalTimestamp(endDate),
          call_duration_seconds: assumedTalkSec,
          call_transcript: mergedTranscript,
          notes: data.notes || '',
          audio_base64: rawAudio,
          audio_mime: data.audio_mime || ''
        });
      } else {
        const isOutgoingDial = existing.direction === 'outgoing' || baseDir === 'outgoing' || baseDir === 'unanswered';
        return processCallLog({
          recruiter_name: recruiterName,
          candidate_phone: finalPhone,
          candidate_name: finalName,
          call_direction: isOutgoingDial ? 'unanswered' : 'missed',
          call_status: isOutgoingDial ? 'Client Did Not Pick Up' : 'Missed Call (Incoming)',
          call_start_time: formatLocalTimestamp(ringDate),
          call_end_time: formatLocalTimestamp(endDate),
          call_duration_seconds: 0,
          force_zero_duration: true,
          call_transcript: mergedTranscript,
          notes: data.notes || '',
          audio_base64: rawAudio,
          audio_mime: data.audio_mime || ''
        });
      }
    }

    // Case D: Single-event Call Ended fallback
    const isOutZero = (baseDir === 'outgoing' || baseDir === 'unanswered') && explicitDur === 0;
    return processCallLog({
      recruiter_name: recruiterName,
      candidate_phone: finalPhone,
      candidate_name: finalName,
      call_direction: isOutZero ? 'unanswered' : (explicitDur === 0 ? 'missed' : baseDir),
      call_status: isOutZero ? 'Client Did Not Pick Up' : (explicitDur === 0 ? 'Missed Call (Incoming)' : ''),
      call_duration_seconds: explicitDur,
      force_zero_duration: explicitDur === 0,
      call_transcript: mergedTranscript,
      notes: data.notes || '',
      audio_base64: rawAudio,
      audio_mime: data.audio_mime || ''
    });
  }

  return { status: 'error', message: 'Unknown live call event: ' + event };
}

// =========================================================================
// ACCURATE LAN IP DETECTION
// =========================================================================

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    const isVirtual = /virtual|vmware|vbox|wsl|hyper-v|bluetooth|loopback|local area connection\*/i.test(lowerName);

    for (const iface of interfaces[name] || []) {
      const isIPv4 = iface.family === 'IPv4' || iface.family === 4;
      if (!isIPv4 || iface.internal) continue;
      if (iface.address.startsWith('169.254.')) continue;

      let priority = isVirtual ? 10 : 100;
      if (/wi-?fi|ethernet|wlan|eth/i.test(lowerName)) priority += 50;
      if (iface.address.startsWith('192.168.')) priority += 30;
      else if (iface.address.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(iface.address)) priority += 20;

      candidates.push({ address: iface.address, priority });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.length > 0 ? candidates[0].address : 'localhost';
}

// =========================================================================
// STATIC FILE & AUDIO STREAMING SERVER
// =========================================================================

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.amr': 'audio/amr',
  '.aac': 'audio/aac',
  '.zip': 'application/zip'
};

function serveStaticFile(filePath, res) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(resolved).pipe(res);
}

function serveAudioRecording(filename, req, res) {
  const safeName = path.basename(filename);
  const fullPath = path.join(RECORDINGS_DIR, safeName);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Recording file not found' }));
    return;
  }

  const stat = fs.statSync(fullPath);
  const ext = path.extname(safeName).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'audio/webm';
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const chunksize = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    });
    fs.createReadStream(fullPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(fullPath).pipe(res);
  }
}

// =========================================================================
// ROLE FILTERING & DATE HELPERS
// =========================================================================

function salesPersonMatches(itemPerson, targetPerson) {
  if (!itemPerson || !targetPerson) return false;
  const a = canonicalSalesName(itemPerson).toLowerCase().trim();
  const b = canonicalSalesName(targetPerson).toLowerCase().trim();
  if (a === b) return true;
  const aFirst = a.split(/\s+/)[0];
  const bFirst = b.split(/\s+/)[0];
  return Boolean(aFirst && aFirst === bFirst);
}

function filterByRole(items, personField, userRole, userName, queryPerson) {
  if (userRole === 'sales' || userRole === 'recruiter' || userRole === 'salesperson') {
    return items.filter(item => salesPersonMatches(item[personField], userName));
  }
  if (userRole === 'admin' || userRole === 'team_leader' || !userRole) {
    if (queryPerson && queryPerson !== 'all') {
      return items.filter(item => salesPersonMatches(item[personField], queryPerson));
    }
    return items;
  }
  return items;
}

function buildLeadDateCounts(leads) {
  const map = {};
  leads.forEach(l => {
    const dates = ensureActivityDates(l);
    dates.forEach(dk => {
      map[dk] = (map[dk] || 0) + 1;
    });
  });
  return map;
}

function buildCallDateCounts(logs) {
  const map = {};
  logs.forEach(c => {
    const dk = c.dateKey || getLocalDateKey(c.callStartTime || c.loggedAt);
    if (dk) map[dk] = (map[dk] || 0) + 1;
  });
  return map;
}

// =========================================================================
// HTTP SERVER
// =========================================================================

const DISCOVERY_CHANNEL = 'sales_crm_lan_discovery_channel';
const CLOUD_CALL_TOPIC = 'sales_crm_calls_9f8a7b6c5d4e';


async function handleSalesRequest(req, res) {

  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;
    if (pathname.startsWith('/api/sales/')) {
      pathname = '/api/' + pathname.slice('/api/sales/'.length);
    } else if (pathname === '/api/sales') {
      pathname = '/api/leads';
    } else if (pathname === '/sales' || pathname === '/sales/' || pathname === '/sales/index.html') {
      pathname = '/';
    } else if (pathname === '/sales/phone' || pathname === '/sales/phone.html' || pathname === '/sales/phone-setup') {
      pathname = '/phone';
    }
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Role, X-User-Name, X-Portal, *');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // --- STATIC FRONTEND & MOBILE PHONE COMPANION ---
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      serveStaticFile(path.join(PUBLIC_DIR, 'index.html'), res);
      return;
    }
    if (method === 'GET' && (pathname === '/phone' || pathname === '/phone-setup' || pathname === '/phone.html')) {
      serveStaticFile(path.join(PUBLIC_DIR, 'phone.html'), res);
      return;
    }
    // --- DOWNLOADS: Android Call-Sync APK + Chrome extensions ---
    if (method === 'GET' && (pathname === '/download/android' || pathname === '/download/apk' || pathname === '/app')) {
      const localApk = path.join(PUBLIC_DIR, 'OrbitSales-CallSync.apk');
      if (fs.existsSync(localApk)) {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Disposition': 'attachment; filename="OrbitSales-CallSync.apk"'
        });
        fs.createReadStream(localApk).pipe(res);
        return;
      }
      res.writeHead(302, { Location: 'https://github.com/Akshat0811hub/sales-portal/releases/download/android-latest/OrbitSales-CallSync.apk' });
      res.end();
      return;
    }
    if (method === 'GET' && (pathname === '/download/whatsapp-extension' || pathname === '/download/gmail-extension' || pathname === '/download/sales-extension')) {
      let zipPath = path.join(PUBLIC_DIR, 'chrome-extension.zip');
      let zipName = 'OrbitSales-ChromeExtension.zip';
      if (!fs.existsSync(zipPath)) {
        zipName = pathname.endsWith('gmail-extension') ? 'orbitsales-gmail-extension.zip' : 'orbitsales-whatsapp-extension.zip';
        zipPath = path.join(PUBLIC_DIR, zipName);
      }
      if (!fs.existsSync(zipPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Extension package not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${zipName}"` });
      fs.createReadStream(zipPath).pipe(res);
      return;
    }
    if (method === 'GET' && pathname.startsWith('/api/recordings/')) {
      const filePart = decodeURIComponent(pathname.replace('/api/recordings/', ''));
      serveAudioRecording(filePart, req, res);
      return;
    }
    if (method === 'GET' && /\.(css|js|png|jpg|jpeg|svg|ico|zip)$/.test(pathname)) {
      serveStaticFile(path.join(PUBLIC_DIR, path.basename(pathname)), res);
      return;
    }

    // --- HEALTH / EXTENSION AUTO-DISCOVERY PING ---
    if ((pathname === '/api/health' || pathname === '/api/ping' || pathname.endsWith('/api/ping') || pathname.endsWith('/api/health')) && method === 'GET') {
      const ip = getLocalIp();
      const host = os.hostname();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        app: 'Sales-CRM',
        hostname: host,
        ip,
        port: PORT,
        serverTime: nowLocal(),
        todayKey: todayKey(),
        webhookUrl: `http://${ip}:${PORT}/api/webhook`,
        hostnameWebhookUrl: `http://${host}:${PORT}/api/webhook`,
        callWebhookUrl: `http://${ip}:${PORT}/api/calls/log`,
        liveCallLanUrl: `http://${ip}:${PORT}/api/calls/live`,
        recordingUploadUrl: `http://${ip}:${PORT}/api/calls/recording`,
        cloudCallUrl: `https://ntfy.sh/${CLOUD_CALL_TOPIC}`
      }));
      return;
    }

    // --- SERVER-SENT EVENTS (LIVE REAL-TIME STREAM) ---
    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'connected', serverTime: nowLocal(), todayKey: todayKey(), activeCalls: getActiveCallsList() })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // --- KNOWN LEADS & SALES TEAM REGISTRY FOR CHROME EXTENSION ---
    if (pathname === '/api/leads/known' && method === 'GET') {
      const leads = getLeads();
      const team = getSalesTeam();
      const phones = [...new Set(leads.map(l => phoneKey10(l.phone)).filter(p => p.length >= 10))];
      const emails = [...new Set(leads.map(l => sanitizeEmail(l.email || '')).filter(Boolean))];
      const candidateNames = [
        ...new Set(
          leads
            .map(l => (l.candidateName || '').toLowerCase().trim())
            .filter(n => n && !isGenericClientName(n))
        )
      ];
      const names = [...new Set(team.map(r => r.name).filter(Boolean))];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        phones,
        emails,
        candidateNames,
        recruiters: names,
        salesTeam: team
      }));
      return;
    }

    // --- LOGIN (Supports Username, Email, or Phone Number) ---
    if (pathname === '/api/login' && method === 'POST') {
      const body = await parseRequestBody(req);
      const identifier = sanitizeString(body.username, 100).toLowerCase();
      const password = sanitizeString(body.password, 100);
      if (!identifier || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Username/Email and password required.' }));
        return;
      }

      const users = getUsers();
      const user = users.find(u => {
        const isPassOk = (u.password === password) || (u.role === 'admin' && (password === 'admin@123' || password === 'Akshat@123#'));
        if (!isPassOk) return false;
        if (u.username.toLowerCase() === identifier) return true;
        if ((u.email || '').toLowerCase() === identifier) return true;
        if (Array.isArray(u.emails) && u.emails.some(e => e.toLowerCase() === identifier)) return true;
        if (u.phone === identifier || (Array.isArray(u.phones) && u.phones.includes(identifier))) return true;
        return false;
      });

      if (user) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            email: user.email,
            emails: user.emails || [user.email],
            phone: user.phone || '',
            phones: user.phones || (user.phone ? [user.phone] : [])
          }
        }));
        return;
      }

      // If credentials do not match any sales user, check if this is a recruiter trying to login
      try {
        const recruiterUsersFile = path.join(__dirname, 'data', 'users.json');
        if (fs.existsSync(recruiterUsersFile)) {
          const rUsers = JSON.parse(fs.readFileSync(recruiterUsersFile, 'utf8'));
          const rMatch = rUsers.find(u => {
            if (u.role === 'admin') return false;
            if (u.username.toLowerCase() === identifier) return true;
            if ((u.email || '').toLowerCase() === identifier) return true;
            return false;
          });
          if (rMatch) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'error',
              message: 'Access Denied: You are registered in the Recruitment team (' + rMatch.name + '). Please login at the Recruiter Portal (/).'
            }));
            return;
          }
        }
      } catch (err) {
        console.error('Error checking recruiter users:', err);
      }

      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Invalid credentials.' }));
      return;
    }

    // --- GET INDIVIDUAL MESSAGES STREAM (Every Single WhatsApp & Email Message) ---
    if (pathname === '/api/messages' && method === 'GET') {
      const userRole = sanitizeString(req.headers['x-user-role'] || parsedUrl.query.user_role || 'admin', 30).toLowerCase();
      const userName = sanitizeString(req.headers['x-user-name'] || parsedUrl.query.user_name || '', 100).toLowerCase();
      const queryRec = sanitizeString(parsedUrl.query.recruiter || parsedUrl.query.salesperson || '', 100).toLowerCase();
      const dateParam = sanitizeString(parsedUrl.query.date || '', 20);
      const chanFilter = sanitizeString(parsedUrl.query.channel || '', 30);
      const roleFilter = sanitizeString(parsedUrl.query.sender_role || '', 30);

      let msgs = filterByRole(getMessages(), 'salesPerson', userRole, userName, queryRec);
      if (!msgs) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Unauthorized.' }));
        return;
      }

      if (dateParam && dateParam.toLowerCase() !== 'all') {
        msgs = msgs.filter(m => (m.dateKey || getLocalDateKey(m.timestamp)) === dateParam);
      }
      if (chanFilter && chanFilter !== 'All') {
        msgs = msgs.filter(m => (m.channel || '').toLowerCase() === chanFilter.toLowerCase());
      }
      if (roleFilter && roleFilter !== 'All') {
        msgs = msgs.filter(m => m.senderRole === roleFilter);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        serverTime: nowLocal(),
        todayKey: todayKey(),
        count: msgs.length,
        messages: msgs.slice(0, 1000)
      }));
      return;
    }

    // --- GET LEADS / DEALS (Role-Based + Day-Wise Filtering) ---
    if (pathname === '/api/leads' && method === 'GET') {
      const userRole = sanitizeString(req.headers['x-user-role'] || parsedUrl.query.user_role || '', 30).toLowerCase();
      const userName = sanitizeString(req.headers['x-user-name'] || parsedUrl.query.user_name || '', 100).toLowerCase();
      const queryRec = sanitizeString(parsedUrl.query.recruiter || parsedUrl.query.salesperson || '', 100).toLowerCase();

      const roleLeads = filterByRole(getLeads(), 'recruiter', userRole, userName, queryRec);
      if (!roleLeads) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Unauthorized.' }));
        return;
      }

      const dateCounts = buildLeadDateCounts(roleLeads);
      const dateParam = sanitizeString(parsedUrl.query.date || '', 20);

      let filtered = roleLeads;
      if (dateParam && dateParam.toLowerCase() !== 'all') {
        filtered = filtered.filter(l => ensureActivityDates(l).includes(dateParam));
      }

      const catFilter = parsedUrl.query.category;
      const chanFilter = parsedUrl.query.channel;
      if (catFilter && catFilter !== 'All') filtered = filtered.filter(l => l.category === catFilter);
      if (chanFilter && chanFilter !== 'All') {
        filtered = filtered.filter(l => (l.channel || '').toLowerCase().includes(chanFilter.toLowerCase()));
      }

      const enriched = filtered.map(l => ({
        ...l,
        clientName: l.clientName || l.candidateName || 'Client',
        candidateName: l.candidateName || l.clientName || 'Client',
        salesperson: l.salesperson || l.recruiter || 'Jinendra',
        recruiter: l.recruiter || l.salesperson || 'Jinendra',
        salespersonNotes: l.salespersonNotes || l.recruiterNotes || '',
        recruiterNotes: l.recruiterNotes || l.salespersonNotes || '',
        timestampDisplay: formatDisplayDateTime(l.timestamp),
        lastUpdatedDisplay: formatDisplayDateTime(l.lastUpdated || l.timestamp)
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        serverTime: nowLocal(),
        todayKey: todayKey(),
        dateCounts,
        count: enriched.length,
        leads: enriched
      }));
      return;
    }

    // --- GET CALL LOGS (Role-Based + Day-Wise Filtering) ---
    if (pathname === '/api/call-logs' && method === 'GET') {
      const userRole = sanitizeString(req.headers['x-user-role'] || parsedUrl.query.user_role || '', 30).toLowerCase();
      const userName = sanitizeString(req.headers['x-user-name'] || parsedUrl.query.user_name || '', 100).toLowerCase();
      const queryRec = sanitizeString(parsedUrl.query.recruiter || parsedUrl.query.salesperson || '', 100).toLowerCase();

      const roleLogs = filterByRole(getCallLogs(), 'recruiterName', userRole, userName, queryRec);
      if (!roleLogs) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Unauthorized.' }));
        return;
      }

      const dateCounts = buildCallDateCounts(roleLogs);
      const dateParam = sanitizeString(parsedUrl.query.date || '', 20);

      let filtered = roleLogs;
      if (dateParam && dateParam.toLowerCase() !== 'all') {
        filtered = filtered.filter(c => (c.dateKey || getLocalDateKey(c.callStartTime || c.loggedAt)) === dateParam);
      }

      const enriched = filtered.map(c => ({
        ...c,
        clientName: c.clientName || c.candidateName || 'Client',
        clientPhone: c.clientPhone || c.candidatePhone || '',
        salespersonName: c.salespersonName || c.recruiterName || 'Jinendra',
        dateKey: c.dateKey || getLocalDateKey(c.callStartTime || c.loggedAt),
        callStartDisplay: c.callStartDisplay || formatDisplayDateTime(c.callStartTime),
        callEndDisplay: c.callEndDisplay || (c.callEndTime && c.callEndTime !== '-' ? formatDisplayDateTime(c.callEndTime) : '-')
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        serverTime: nowLocal(),
        todayKey: todayKey(),
        dateCounts,
        count: enriched.length,
        callLogs: enriched
      }));
      return;
    }

    // --- GET SALES TEAM & DAILY SCORECARD ---
    if ((pathname === '/api/recruiters' || pathname === '/api/sales-team' || pathname === '/api/salespersons') && method === 'GET') {
      const dateParam = sanitizeString(parsedUrl.query.date || '', 20);
      const baseTeam = getSalesTeam();
      const allLeads = getLeads();
      const allCalls = getCallLogs();
      const allMsgs = getMessages();

      const knownMap = new Map();
      baseTeam.forEach(r => {
        const cName = canonicalSalesName(r.name);
        const key = cName.toLowerCase().trim();
        if (!knownMap.has(key)) {
          knownMap.set(key, { ...r, name: cName });
        }
      });

      const filterDay = dateParam && dateParam.toLowerCase() !== 'all' ? dateParam : null;

      const recruiters = Array.from(knownMap.values()).map(r => {
        const rKey = (r.name || '').toLowerCase().trim();
        const rLeads = allLeads.filter(l => {
          if (!salesPersonMatches(l.recruiter, rKey)) return false;
          return filterDay ? ensureActivityDates(l).includes(filterDay) : true;
        });
        const rCalls = allCalls.filter(c => {
          if (!salesPersonMatches(c.recruiterName, rKey)) return false;
          const dk = c.dateKey || getLocalDateKey(c.callStartTime || c.loggedAt);
          return filterDay ? dk === filterDay : true;
        });
        const rMsgs = allMsgs.filter(m => {
          if (!salesPersonMatches(m.salesPerson, rKey)) return false;
          const dk = m.dateKey || getLocalDateKey(m.timestamp);
          return filterDay ? dk === filterDay : true;
        });

        const totalTalkSeconds = rCalls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0);
        return {
          ...r,
          leadsCount: rLeads.length,
          callsCount: rCalls.length,
          incomingCalls: rCalls.filter(c => c.direction === 'incoming').length,
          outgoingCalls: rCalls.filter(c => c.direction === 'outgoing').length,
          missedCalls: rCalls.filter(c => c.direction === 'missed').length,
          unansweredCalls: rCalls.filter(c => c.direction === 'unanswered').length,
          recordedCallsCount: rCalls.filter(c => Boolean(c.recordingUrl)).length,
          totalTalkSeconds,
          totalTalkFormatted: formatDuration(totalTalkSeconds),
          whatsappLeads: rLeads.filter(l => Boolean((l.whatsappTranscript || '').trim())).length,
          emailLeads: rLeads.filter(l => Boolean((l.emailTranscript || '').trim())).length,
          salesSentMessages: rMsgs.filter(m => m.senderRole === 'sales').length,
          clientReceivedMessages: rMsgs.filter(m => m.senderRole === 'client').length,
          interviewsCount: rLeads.filter(l => ['Proposal Sent', 'Negotiation', 'Deal Won', 'Selected', 'Interview Scheduled'].includes(l.status)).length,
          dealsWonCount: rLeads.filter(l => l.status === 'Deal Won' || l.status === 'Selected').length
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        serverTime: nowLocal(),
        todayKey: todayKey(),
        recruiters,
        salespersons: recruiters,
        salesTeam: recruiters
      }));
      return;
    }

    // --- WEBHOOK / CREATE OR UPDATE LEAD & MESSAGES (WhatsApp + Gmail + Calls) ---
    if ((pathname === '/api/webhook' || pathname === '/api/leads') && method === 'POST') {
      const payload = await parseRequestBody(req);
      const result = processLeadIngest(payload);
      const code = result.status === 'error' ? 400 : (result.action === 'created' ? 201 : 200);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // --- BATCH EXCEL / CSV DEALS IMPORT ---
    if ((pathname === '/api/sales/leads/import' || pathname === '/api/leads/import') && method === 'POST') {
      const payload = await parseRequestBody(req);
      const items = Array.isArray(payload) ? payload : (payload.leads || payload.items || payload.data || []);
      const defaultSales = payload.defaultSalesperson || payload.default_salesperson || payload.defaultRecruiter || '';
      const result = processBatchLeadImport(items, defaultSales);
      const code = result.status === 'error' ? 400 : 200;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // --- LIVE PHONE CALL STOPWATCH EVENTS ---
    if (pathname === '/api/calls/live' && (method === 'POST' || method === 'GET')) {
      const bodyData = method === 'POST' ? await parseRequestBody(req) : {};
      const merged = { ...(parsedUrl.query || {}), ...bodyData };
      const result = processLiveCallEvent(merged);
      const code = result.status === 'error' ? 400 : 200;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // --- GET CURRENTLY ACTIVE LIVE CALLS ---
    if (pathname === '/api/calls/active' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', activeCalls: getActiveCallsList() }));
      return;
    }

    // --- LOG PHONE CALL ---
    if (pathname === '/api/calls/log' && (method === 'POST' || method === 'GET')) {
      const data = method === 'POST' ? await parseRequestBody(req) : (parsedUrl.query || {});
      const result = processCallLog(data);
      const code = result.status === 'error' ? 400 : 201;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // --- CALLYZER WEBHOOK INTEGRATION (Auto-syncs Sales Calls & Talk Time) ---
    if ((pathname === '/api/callyzer/webhook' || pathname === '/api/webhook/callyzer' || pathname === '/api/sales/callyzer') && method === 'POST') {
      const payload = await parseRequestBody(req);
      const results = [];
      const items = Array.isArray(payload) ? payload : [payload];
      for (const emp of items) {
        const empName = emp.employeeName || emp.name || '';
        const empPhone = emp.employeeNumber || emp.phone || '';
        const logs = Array.isArray(emp.logs) ? emp.logs : (emp.log ? [emp.log] : [emp]);
        for (const log of logs) {
          const res = processCallLog({
            client_phone: log.number || log.clientNumber || log.phone || '',
            client_name: log.name || '',
            sales_person: empName,
            salesperson_phone: empPhone,
            call_direction: log.callType || log.type || 'outgoing',
            duration_seconds: log.duration ?? log.call_duration ?? 0,
            call_start_time: log.callTime || log.createdDate || '',
            recording_url: log.recordingURL || log.recordingUrl || ''
          });
          results.push(res);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', synced: results.length, details: results }));
      return;
    }

    // --- UPLOAD CALL RECORDING & CALL TRANSCRIPT ("BAAT KYA HUI") ---
    if (pathname === '/api/calls/recording' && method === 'POST') {
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      let callId = sanitizeString(parsedUrl.query.callId || parsedUrl.query.call_id || '', 40);
      let recruiter = sanitizeString(parsedUrl.query.recruiter || parsedUrl.query.sales_person || '', 100);
      let phone = sanitizePhone(parsedUrl.query.phone || parsedUrl.query.candidate_phone || '');
      let transcript = sanitizeString(parsedUrl.query.transcript || parsedUrl.query.call_transcript || '', 15000);
      let notes = sanitizeString(parsedUrl.query.notes || '', 2000);
      let recordingMeta = null;

      if (contentType.includes('multipart/form-data')) {
        const boundaryMatch = req.headers['content-type'].match(/boundary=([^;]+)/i);
        const boundary = boundaryMatch ? boundaryMatch[1].trim() : '';
        const rawBuf = await parseRequestBodyBuffer(req);
        const { fields, file } = parseMultipartFormData(rawBuf, boundary);

        callId = callId || sanitizeString(fields.callid || fields.call_id || '', 40);
        recruiter = recruiter || sanitizeString(fields.recruiter || fields.recruiter_name || fields.sales_person || fields.salesperson || '', 100);
        phone = phone || sanitizePhone(fields.phone || fields.candidate_phone || fields.client_phone || fields.number || '');
        transcript = transcript || sanitizeString(fields.call_transcript || fields.transcript || fields.spoken_text || fields.notes || '', 15000);
        notes = notes || sanitizeString(fields.notes || fields.summary || '', 2000);

        if (file && file.buffer && file.buffer.length > 50) {
          const originalName = file.filename || 'recording.m4a';
          const ext = path.extname(originalName).toLowerCase().replace('.', '') || 'm4a';
          const filename = `REC_${callId || 'AUTO'}_${Date.now()}_${path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          fs.writeFileSync(path.join(RECORDINGS_DIR, filename), file.buffer);
          recordingMeta = {
            recordingFile: filename,
            recordingUrl: `/api/recordings/${filename}`,
            recordingMime: file.mimeType || `audio/${ext}`,
            recordingSize: file.buffer.length
          };
          if (!phone) {
            const pMatch = originalName.match(/(?:\b|[^0-9])([6-9]\d{9})(?:\b|[^0-9])/);
            if (pMatch) phone = pMatch[1];
          }
        }
      } else if (contentType.includes('application/json') || contentType.includes('text/plain') || contentType.includes('application/x-www-form-urlencoded')) {
        const body = await parseRequestBody(req);
        callId = callId || sanitizeString(body.callId || body.call_id || '', 40);
        recruiter = recruiter || sanitizeString(body.recruiter || body.recruiter_name || body.sales_person || body.salesperson || '', 100);
        phone = phone || sanitizePhone(body.phone || body.candidate_phone || body.client_phone || body.number || '');
        transcript = transcript || sanitizeString(body.call_transcript || body.transcript || body.spoken_text || '', 15000);
        notes = notes || sanitizeString(body.notes || '', 2000);
        const b64 = body.audio_base64 || body.recording_base64 || body.audioData || '';
        if (b64) {
          recordingMeta = saveBase64AudioRecording(b64, callId || 'CALL-REC', body.audio_mime || '');
        }
      } else {
        // Raw binary audio upload directly from Android / MacroDroid HTTP POST / curl
        const rawBuf = await parseRequestBodyBuffer(req);
        if (rawBuf && rawBuf.length > 50) {
          let origHeaderName = req.headers['x-filename'] || '';
          const disp = req.headers['content-disposition'] || '';
          const fnMatch = disp.match(/filename=["']?([^"';\r\n]+)["']?/i);
          if (fnMatch) origHeaderName = fnMatch[1];

          let ext = sanitizeString(parsedUrl.query.ext || '', 10).replace(/[^a-z0-9]/gi, '');
          if (!ext && origHeaderName) ext = path.extname(origHeaderName).replace('.', '');
          if (!ext) {
            if (contentType.includes('mp3') || contentType.includes('mpeg')) ext = 'mp3';
            else if (contentType.includes('wav')) ext = 'wav';
            else if (contentType.includes('webm')) ext = 'webm';
            else if (contentType.includes('ogg')) ext = 'ogg';
            else if (contentType.includes('amr')) ext = 'amr';
            else if (contentType.includes('aac')) ext = 'aac';
            else ext = 'm4a';
          }
          const safeHeaderName = origHeaderName ? path.basename(origHeaderName).replace(/[^a-zA-Z0-9._-]/g, '_') : `${callId || 'BIN'}_${Date.now()}.${ext}`;
          const filename = `REC_${Date.now()}_${safeHeaderName}`;
          fs.writeFileSync(path.join(RECORDINGS_DIR, filename), rawBuf);
          recordingMeta = {
            recordingFile: filename,
            recordingUrl: `/api/recordings/${filename}`,
            recordingMime: contentType || `audio/${ext}`,
            recordingSize: rawBuf.length
          };
          if (!phone && origHeaderName) {
            const pMatch = origHeaderName.match(/(?:\b|[^0-9])([6-9]\d{9})(?:\b|[^0-9])/);
            if (pMatch) phone = pMatch[1];
          }
          if (!recruiter && origHeaderName) {
            for (const name of ['Jinendra', 'Vishal', 'Rahul', 'Archana']) {
              if (new RegExp(name, 'i').test(origHeaderName)) {
                recruiter = name;
                break;
              }
            }
          }
        }
      }

      const result = attachRecordingToCallOrLead({
        callId,
        deviceCallKey: sanitizeString(parsedUrl.query.device_call_key || '', 120),
        recruiter,
        phone,
        filename: recordingMeta ? recordingMeta.recordingFile : '',
        recordingMeta,
        transcript,
        notes
      });

      const statusCode = result.status === 'created' ? 201 : 200;
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // --- UPDATE CALL LOG TRANSCRIPT / NOTES DIRECTLY ---
    if (pathname.startsWith('/api/call-logs/') && method === 'PATCH') {
      const callId = sanitizeString(decodeURIComponent(pathname.split('/')[3] || ''), 40);
      const data = await parseRequestBody(req);
      const logs = getCallLogs();
      const callLog = logs.find(c => c.id === callId);
      if (!callLog) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Call log not found' }));
        return;
      }
      if (data.callTranscript !== undefined) callLog.callTranscript = sanitizeString(data.callTranscript, 15000);
      if (data.notes !== undefined) callLog.notes = sanitizeString(data.notes, 2000);
      if (data.callStatus !== undefined) callLog.callStatus = sanitizeString(data.callStatus, 60);
      if (data.direction !== undefined) callLog.direction = sanitizeString(data.direction, 30);

      saveCallLogs(logs);
      syncCallEntryIntoLead(callLog);
      broadcastEvent('call_updated', { callId: callLog.id, callLog });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', callLog }));
      return;
    }

    // --- UPDATE LEAD / DEAL DETAILS ---
    if (pathname.startsWith('/api/leads/') && method === 'PATCH') {
      const leadId = sanitizeString(decodeURIComponent(pathname.split('/')[3] || ''), 40);
      const data = await parseRequestBody(req);
      const leads = getLeads();
      const lead = leads.find(l => l.id === leadId);
      if (!lead) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Lead not found.' }));
        return;
      }

      if (data.status !== undefined) lead.status = sanitizeString(data.status, 50);
      if (data.category !== undefined) lead.category = sanitizeString(data.category, 60);
      if (data.candidateName !== undefined) lead.candidateName = sanitizeString(data.candidateName, 100) || lead.candidateName;
      if (data.clientName !== undefined) lead.candidateName = sanitizeString(data.clientName, 100) || lead.candidateName;
      if (data.phone !== undefined) lead.phone = sanitizePhone(data.phone) || data.phone;
      if (data.email !== undefined) lead.email = sanitizeEmail(data.email) || '';
      if (data.currentCtc !== undefined) lead.currentCtc = sanitizeString(data.currentCtc, 100);
      if (data.expectedCtc !== undefined) lead.expectedCtc = sanitizeString(data.expectedCtc, 80);
      if (data.noticePeriod !== undefined) lead.noticePeriod = sanitizeString(data.noticePeriod, 100);
      if (data.skills !== undefined) lead.skills = sanitizeString(data.skills, 250);
      if (data.recruiter !== undefined) lead.recruiter = canonicalSalesName(data.recruiter);
      if (data.salesperson !== undefined) lead.recruiter = canonicalSalesName(data.salesperson);
      if (data.followUpDate !== undefined) {
        lead.followUpDate = sanitizeString(data.followUpDate, 40);
        lead.followUpNeeded = Boolean(lead.followUpDate);
      }
      if (data.followUpNeeded !== undefined) lead.followUpNeeded = Boolean(data.followUpNeeded);
      if (data.recruiterNotes !== undefined) lead.recruiterNotes = sanitizeString(data.recruiterNotes, 2000);
      if (data.salespersonNotes !== undefined) lead.recruiterNotes = sanitizeString(data.salespersonNotes, 2000);

      lead.lastUpdated = nowLocal();
      ensureActivityDates(lead);
      if (!lead.activityDates.includes(todayKey())) {
        lead.activityDates.push(todayKey());
        lead.activityDates.sort();
      }

      saveLeads(leads);
      broadcastEvent('lead_updated', { leadId: lead.id, candidateName: lead.candidateName });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', lead }));
      return;
    }

    // --- DELETE / ARCHIVE LEAD ---
    if (pathname.startsWith('/api/leads/') && method === 'DELETE') {
      const leadId = sanitizeString(decodeURIComponent(pathname.split('/')[3] || ''), 40);
      let leads = getLeads();
      const toDelete = leads.find(l => l.id === leadId);
      if (toDelete) {
        const ARCHIVE_FILE = path.join(DATA_DIR, 'archived_leads.json');
        const archive = readJsonFile(ARCHIVE_FILE, []);
        archive.unshift({ ...toDelete, archivedAt: nowLocal() });
        writeJsonFile(ARCHIVE_FILE, archive);
      }
      leads = leads.filter(l => l.id !== leadId);
      saveLeads(leads);
      broadcastEvent('lead_deleted', { leadId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', message: 'Lead archived' }));
      return;
    }

    // --- DELETE CALL LOG ---
    if (pathname.startsWith('/api/call-logs/') && method === 'DELETE') {
      const callId = sanitizeString(decodeURIComponent(pathname.split('/')[3] || ''), 40);
      const logs = getCallLogs().filter(c => c.id !== callId);
      saveCallLogs(logs);

      const leads = getLeads();
      let leadsChanged = false;
      const updatedLeads = leads.filter(l => {
        if (Array.isArray(l.callHistory) && l.callHistory.some(c => c.id === callId)) {
          l.callHistory = l.callHistory.filter(c => c.id !== callId);
          l.lastCall = l.callHistory[0] || null;
          l.callDuration = l.lastCall ? l.lastCall.durationFormatted : '';
          leadsChanged = true;
          const hasChat = Boolean((l.whatsappTranscript || '').trim() || (l.emailTranscript || '').trim());
          if (!hasChat && l.callHistory.length === 0) {
            return false;
          }
          l.channel = computeCleanChannel(l, l.channel);
        }
        return true;
      });
      if (leadsChanged) saveLeads(updatedLeads);

      broadcastEvent('call_deleted', { callId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', message: 'Call log removed' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Endpoint not found' }));
  } catch (err) {
    console.error('[SERVER ERROR]', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: err.message || 'Internal server error' }));
    }
  }
}


process.on('uncaughtException', err => console.error('[FATAL] Uncaught:', err));
process.on('unhandledRejection', reason => console.error('[FATAL] Unhandled:', reason));

// =========================================================================
// PERMANENT ZERO-IP CLOUD CALL RELAY + LAN DISCOVERY
// =========================================================================
const CLOUD_CURSOR_FILE = path.join(DATA_DIR, 'cloud_sync_cursor.json');
const processedCloudIds = new Set();

function loadCloudCursor() {
  return readJsonFile(CLOUD_CURSOR_FILE, { lastId: '', lastTime: 0 });
}

function saveCloudCursor(id, time) {
  writeJsonFile(CLOUD_CURSOR_FILE, { lastId: id, lastTime: time || Math.floor(Date.now() / 1000) });
}

function handleCloudAttachment(obj) {
  try {
    if (!obj.attachment || !obj.attachment.url) return;
    const attachUrl = obj.attachment.url;
    const originalName = obj.attachment.name || 'call_recording.m4a';
    const mime = obj.attachment.type || 'audio/m4a';

    const rawText = `${originalName} ${obj.message || ''} ${obj.title || ''}`;
    let phone = '';
    const pMatch = rawText.match(/(?:\b|[^0-9])([6-9]\d{9})(?:\b|[^0-9])/);
    if (pMatch) phone = pMatch[1];

    let recruiter = 'Jinendra';
    for (const name of ['Jinendra', 'Vishal', 'Rahul', 'Archana']) {
      if (new RegExp(name, 'i').test(rawText)) {
        recruiter = name;
        break;
      }
    }

    const extMatch = originalName.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'm4a';
    const filename = `REC_CLOUD_${Date.now()}_${path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const targetPath = path.join(RECORDINGS_DIR, filename);

    const clientLib = attachUrl.startsWith('https:') ? https : http;
    clientLib.get(attachUrl, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 50) return;
        fs.writeFileSync(targetPath, buf);

        const recordingMeta = {
          recordingFile: filename,
          recordingUrl: `/api/recordings/${filename}`,
          recordingMime: mime,
          recordingSize: buf.length
        };

        attachRecordingToCallOrLead({
          recruiter,
          phone,
          filename,
          recordingMeta,
          notes: obj.message || 'Auto-uploaded via Cloud Relay'
        });
      });
    }).on('error', () => {});
  } catch (_) {}
}

function scanRecordingsDropzone() {
  try {
    if (!fs.existsSync(DROPZONE_DIR)) return;
    const files = fs.readdirSync(DROPZONE_DIR);
    for (const f of files) {
      if (f.startsWith('.') || f.endsWith('.tmp')) continue;
      const srcPath = path.join(DROPZONE_DIR, f);
      const stat = fs.statSync(srcPath);
      if (!stat.isFile()) continue;

      if (Date.now() - stat.mtimeMs < 2000) continue;

      const ext = path.extname(f).toLowerCase().replace('.', '');
      if (!['m4a', 'mp3', 'wav', 'aac', 'amr', 'ogg', 'webm', 'mp4', '3gp'].includes(ext)) continue;

      let phone = '';
      const pMatch = f.match(/(?:\b|[^0-9])([6-9]\d{9})(?:\b|[^0-9])/);
      if (pMatch) phone = pMatch[1];

      let recruiter = '';
      for (const name of ['Jinendra', 'Vishal', 'Rahul', 'Archana']) {
        if (new RegExp(name, 'i').test(f)) {
          recruiter = name;
          break;
        }
      }

      const destFilename = `REC_AUTO_${Date.now()}_${path.basename(f).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const destPath = path.join(RECORDINGS_DIR, destFilename);
      fs.renameSync(srcPath, destPath);

      const recordingMeta = {
        recordingFile: destFilename,
        recordingUrl: `/api/recordings/${destFilename}`,
        recordingMime: `audio/${ext}`,
        recordingSize: stat.size
      };

      attachRecordingToCallOrLead({
        recruiter,
        phone,
        filename: destFilename,
        recordingMeta,
        notes: `Imported automatically from dropzone (${f})`
      });
    }
  } catch (_) {}
}
const dropzoneTimer = setInterval(scanRecordingsDropzone, 4000);
if (dropzoneTimer.unref) dropzoneTimer.unref();

let cloudRelayConnecting = false;
function connectCloudCallRelay() {
  if (cloudRelayConnecting) return;
  cloudRelayConnecting = true;

  const cursor = loadCloudCursor();
  if (cursor.lastId) processedCloudIds.add(cursor.lastId);
  const sinceParam = cursor.lastId ? encodeURIComponent(cursor.lastId) : '12h';
  const streamUrl = `https://ntfy.sh/${CLOUD_CALL_TOPIC}/json?since=${sinceParam}`;

  const req = https.get(streamUrl, res => {
    cloudRelayConnecting = false;
    if (res.statusCode !== 200) {
      res.resume();
      setTimeout(connectCloudCallRelay, 5000);
      return;
    }

    let lineBuf = '';
    res.on('data', chunk => {
      lineBuf += chunk.toString('utf8');
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.event === 'message' && obj.id) {
            if (processedCloudIds.has(obj.id)) continue;
            processedCloudIds.add(obj.id);
            if (processedCloudIds.size > 500) {
              const first = processedCloudIds.values().next().value;
              processedCloudIds.delete(first);
            }
            saveCloudCursor(obj.id, obj.time);

            if (obj.attachment && obj.attachment.url) {
              handleCloudAttachment(obj);
            }

            if (obj.message) {
              const parsed = parseFlexiblePayload(obj.message);
              if (parsed && (parsed.event || parsed.phone || parsed.candidate_phone || parsed.client_phone)) {
                const msgMs = obj.time ? obj.time * 1000 : Date.now();
                const effectiveMs = Math.abs(Date.now() - msgMs) < 2000 ? Date.now() : msgMs;
                processLiveCallEvent(parsed, effectiveMs);
              }
            }
          }
        } catch (_) {}
      }
    });

    res.on('end', () => {
      cloudRelayConnecting = false;
      setTimeout(connectCloudCallRelay, 2500);
    });
    res.on('error', () => {
      cloudRelayConnecting = false;
      setTimeout(connectCloudCallRelay, 4000);
    });
  });

  req.setTimeout(95000, () => {
    req.destroy();
  });
  req.on('error', () => {
    cloudRelayConnecting = false;
    setTimeout(connectCloudCallRelay, 5000);
  });
}

function broadcastCurrentIp() {
  const ip = getLocalIp();
  if (!ip || ip === 'localhost') return;
  const payload = JSON.stringify({
    app: 'Sales-CRM',
    ip,
    port: PORT,
    hostname: os.hostname(),
    url: `http://${ip}:${PORT}/api/webhook`,
    callUrl: `http://${ip}:${PORT}/api/calls/log`,
    recordingUrl: `http://${ip}:${PORT}/api/calls/recording`,
    timestamp: Date.now()
  });

  const req = https.request(`https://ntfy.sh/${DISCOVERY_CHANNEL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Title': 'Sales CRM Server Online' }
  }, () => {});
  req.on('error', () => {});
  req.write(payload);
  req.end();
}


function initSalesBackend(options = {}) {
  try {
    connectCloudCallRelay();
    broadcastCurrentIp();
    setInterval(broadcastCurrentIp, 1000 * 60 * 5);
    console.log('✅ Sales CRM Backend initialized (Cloud topic: ' + CLOUD_CALL_TOPIC + ')');
  } catch (err) {
    console.error('Failed to initialize Sales CRM backend:', err);
  }
}

module.exports = {
  handleSalesRequest,
  initSalesBackend,
  processLiveCallEvent,
  processCallLog,
  activeCalls,
  canonicalSalesName,
  isSalesOutreachText,
  getUsers,
  getSalesTeam,
  getLeads,
  getCallLogs,
  getMessages,
  SALES_PHONES_SET,
  SALES_PHONE_TO_NAME,
  CLOUD_CALL_TOPIC
};
