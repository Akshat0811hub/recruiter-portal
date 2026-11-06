// ==========================================================================================
// 🚀 Omnichannel Recruitment CRM - Production Server
// Features:
//  - Accurate Local System Clock (IST) & Midnight Fresh-Day Rollover
//  - Automatic Phone Call Logger (Direction, Start Time, End Time, Duration — Zero Audio/AI Bloat)
//  - Real-Time Live WhatsApp & Gmail Thread Sync with Smart Deduplication
//  - Server-Sent Events (SSE) Instant Dashboard Updates
//  - Day-Wise Filtering, Category Analytics, Follow-Up Reminders & Daily Team Scorecard
// ==========================================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const RECRUITERS_FILE = path.join(DATA_DIR, 'recruiters.json');
const CALL_LOG_FILE = path.join(DATA_DIR, 'call_logs.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

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

  // Handle "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD HH:mm" as LOCAL time (not UTC)
  const localMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localMatch) {
    const [, y, mo, da, h, mi, s] = localMatch;
    return new Date(Number(y), Number(mo) - 1, Number(da), Number(h), Number(mi), Number(s || 0));
  }

  // Handle Unix epoch string
  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    return new Date(num < 1e12 ? num * 1000 : num);
  }

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// Sortable local timestamp: "YYYY-MM-DD HH:mm:ss"
function formatLocalTimestamp(dateInput) {
  const d = parseFlexDate(dateInput);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Human-friendly 12-hour local time: "06 Nov 2026, 02:45:10 PM"
function formatDisplayDateTime(dateInput) {
  if (!dateInput || dateInput === '-') return '-';
  const d = parseFlexDate(dateInput);
  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${pad2(hours)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
}

// Local calendar date key: "YYYY-MM-DD"
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

  // Pure numeric seconds: "185"
  if (/^\d+(\.\d+)?$/.test(str)) return Math.max(0, Math.round(Number(str)));

  // HH:MM:SS or MM:SS: "00:03:15" or "03:15"
  const colonMatch = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const h = Number(colonMatch[1] || 0);
    const m = Number(colonMatch[2] || 0);
    const s = Number(colonMatch[3] || 0);
    return h * 3600 + m * 60 + s;
  }

  // Human text: "2h 15m 10s", "3m 15s", "4 min 10 sec", "45s"
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
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  const tempFile = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempFile, filePath);
}

const getUsers = () => readJsonFile(USERS_FILE, []);
const getLeads = () => readJsonFile(LEADS_FILE, []);
const getRecruiters = () => readJsonFile(RECRUITERS_FILE, []);
const getCallLogs = () => readJsonFile(CALL_LOG_FILE, []);

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

setInterval(() => {
  broadcastEvent('heartbeat', {});
}, 20000);

// =========================================================================
// DETERMINISTIC FIELD EXTRACTION (Fast, Accurate, Zero AI Bloat)
// =========================================================================

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
  'ui', 'ux', 'qa', 'support', 'admin', 'account', 'accounts', 'orbitouch', 'outsourcing'
]);

const INTERNAL_GROUP_PATTERNS = [
  /orbitouch\s*outsourcing/i,
  /daily\s*working\s*\/\s*reporting/i,
  /job\s*post\s*\/\s*response/i,
  /hr\s*agency\s*orbitouch/i,
  /team\s+(?:kajal|neetu|suhani|rahul)/i
];

function isInternalGroup(title, text) {
  const combined = `${title || ''} ${text || ''}`;
  if (INTERNAL_GROUP_PATTERNS.some(rx => rx.test(title || ''))) return true;
  if ((title || '').toLowerCase().includes('orbitouch') && !(title || '').match(/\d{8,}/)) return true;
  return false;
}

function cleanPersonName(rawCandidate) {
  if (!rawCandidate) return '';
  const parts = rawCandidate
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

function extractCandidateName(text) {
  if (!text) return '';

  // 1. Explicit self-introductions or structured "Name: ..."
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
      // Avoid picking up recruiter's own signature if inside Recruiter block
      const cleaned = cleanPersonName(match[1]);
      if (cleaned && cleaned.length >= 3) return cleaned;
    }
  }

  // 2. Extract name from shared Resume/CV filename (e.g., "Shruti_Maurya_Resume.pdf", "Arzoo Kumari Resume_.pdf")
  const fileMatch = text.match(/([A-Za-z][A-Za-z0-9_ -]{2,50}?(?:resume|cv)[A-Za-z0-9_ ()-]*)\.(?:pdf|docx?|rtf)/i) ||
                    text.match(/(?:resume|cv)[_ -]+([A-Za-z][A-Za-z_ -]{2,40})\.(?:pdf|docx?|rtf)/i);
  if (fileMatch && fileMatch[1]) {
    const fromFile = cleanPersonName(fileMatch[1]);
    if (fromFile && fromFile.length >= 3) return fromFile;
  }

  return '';
}

const COMMON_SKILLS = [
  'React', 'Next.js', 'Node.js', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'Angular', 'Vue',
  'Python', 'Django', 'FastAPI', 'Java', 'Spring Boot', 'Microservices', '.NET', 'C#', 'PHP',
  'Laravel', 'Golang', 'Flutter', 'React Native', 'Android', 'iOS', 'SQL', 'MySQL', 'PostgreSQL',
  'MongoDB', 'AWS', 'Azure', 'GCP', 'DevOps', 'Docker', 'Kubernetes', 'Data Science', 'GenAI',
  'Machine Learning', 'Power BI', 'SAP', 'Salesforce', 'Figma', 'UI/UX', 'UI Developer',
  'Frontend', 'Backend', 'Full Stack', 'QA', 'Selenium', 'Manual Testing', 'Sales',
  'Business Development', 'Telecaller', 'BPO', 'Customer Support', 'HR', 'Talent Acquisition',
  'Digital Marketing', 'SEO', 'Accounts', 'Tally', 'Finance', 'Operations', 'Admin Executive'
];

function extractSkills(text) {
  if (!text) return '';
  const matched = [];
  for (const skill of COMMON_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, 'i');
    if (rx.test(text)) matched.push(skill);
  }
  if (/(\bjs\b)/i.test(text) && !matched.includes('JavaScript')) matched.push('JavaScript');
  return matched.slice(0, 8).join(', ');
}

function extractCurrentCtc(text) {
  if (!text) return '';
  const m = text.match(/(?:current\s*(?:ctc|salary|pkg|package)?|cctc|drawing|present\s*(?:ctc|salary))\s*(?:is|around|of)?\s*[:=-]?\s*(\d+(?:\.\d+)?\s*(?:lpa|lakhs?|lac|k|pm|per\s*month)?)/i);
  return m ? m[1].trim() : '';
}

function extractExpectedCtc(text) {
  if (!text) return '';
  const m = text.match(/(?:expected\s*(?:ctc|salary|pkg|package)?|ectc|ext\b|exp\s*ctc|expecting)\s*(?:is|around|of)?\s*[:=-]?\s*(\d+(?:\.\d+)?\s*(?:lpa|lakhs?|lac|k|pm|per\s*month)?)/i);
  return m ? m[1].trim() : '';
}

function extractNoticePeriod(text) {
  if (!text) return '';
  let m = text.match(/(?:notice\s*(?:period)?|np)\s*(?:is|of)?\s*[:=-]?\s*(\d+\s*(?:days?|months?|weeks?)|immediate(?:\s*joiner)?|serving(?:\s*notice)?)/i);
  if (m) return m[1].trim();
  m = text.match(/(\d+\s*(?:days?|months?|weeks?))\s*notice/i);
  if (m) return m[1].trim();
  m = text.match(/\b(immediate\s*joiner|serving\s*notice)\b/i);
  return m ? m[1].trim() : '';
}

function classifyLead(text, explicitCategory) {
  if (explicitCategory && explicitCategory !== 'Auto') {
    return { category: explicitCategory, keywords: ['Manual'] };
  }
  if (!text) return { category: 'General Enquiry', keywords: [] };

  const lower = text.toLowerCase();
  const rules = [
    {
      category: 'Client / Employer Lead',
      keywords: ['need staff', 'requirement', 'service agreement', 'commission', 'mandate', 'vendor', 'commercials', 'replacement clause', 'hiring partner']
    },
    {
      category: 'Experienced / Job Change',
      keywords: ['job change', 'switch', 'current ctc', 'expected ctc', 'cctc', 'ectc', 'notice period', 'package', 'hike', 'lpa', 'resigned', 'serving notice', 'years experience']
    },
    {
      category: 'New Job Seeker',
      keywords: ['job', 'vacancy', 'fresher', 'apply', 'applying', 'resume', 'cv', 'interview', 'trainee', 'opening', 'hiring', 'opportunity']
    }
  ];

  for (const rule of rules) {
    const matched = rule.keywords.filter(k => lower.includes(k));
    if (matched.length > 0) return { category: rule.category, keywords: matched };
  }
  return { category: 'General Enquiry', keywords: [] };
}

function detectFollowUpSignal(text) {
  if (!text) return false;
  return /\b(call\s*back|callback|call\s*me\s*(?:tomorrow|later|evening|morning|at)|interview\s*scheduled|schedule\s*(?:a\s*)?round|follow[\s-]*up)\b/i.test(text);
}

// =========================================================================
// SANITIZATION & PHONE MATCHING HELPERS
// =========================================================================

const MAX_BODY_SIZE = 2 * 1024 * 1024;

function parseFlexiblePayload(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Smart key=value parser: preserves +91 before digits AND handles contact names containing '&' (e.g. "Rahul & Co")
    const obj = {};
    const normalized = raw.replace(/\r?\n/g, '&');
    const tokenRegex = /(?:^|&)(event|state|recruiter|recruiter_name|phone|candidate_phone|number|name|candidate_name|contact_name|dir|direction|call_type|type|duration|call_duration|call_duration_seconds|notes)=/gi;
    const matches = [...normalized.matchAll(tokenRegex)];
    if (matches.length > 0) {
      for (let i = 0; i < matches.length; i++) {
        const key = matches[i][1].trim();
        const valStart = matches[i].index + matches[i][0].length;
        const valEnd = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
        let rawVal = normalized.slice(valStart, valEnd).trim();
        try {
          rawVal = decodeURIComponent(rawVal.replace(/\+(\d)/g, '%2B$1'));
        } catch (_) {}
        obj[key] = rawVal.trim();
      }
      return obj;
    }
    const safeRaw = normalized.replace(/\+(\d)/g, '%2B$1');
    const params = new URLSearchParams(safeRaw);
    for (const [k, v] of params.entries()) obj[k.trim()] = v.trim();
    return obj;
  }
}

function parseRequestBody(req) {
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
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return resolve({});
      try {
        resolve(parseFlexiblePayload(raw));
      } catch (err) {
        reject(new Error('Invalid payload'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeString(val, maxLen = 500) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  if (/^\[[a-z0-9_]+\]$/i.test(s) || /^\{[a-z0-9_]+\}$/i.test(s)) return '';
  return s.slice(0, maxLen);
}

function sanitizePhone(val) {
  if (val === null || val === undefined) return '';
  const raw = String(val).trim();
  if (/^\[.*\]$/.test(raw) || /^\{.*\}$/.test(raw)) return '';
  const cleaned = raw.replace(/[^0-9+\-() ]/g, '').trim().slice(0, 22);
  const digits = cleaned.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? cleaned : '';
}

function phoneKey10(phone) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  return digits.length >= 10 ? digits.slice(-10) : (digits.length >= 7 ? digits : '');
}

function sanitizeEmail(val) {
  if (typeof val !== 'string') return '';
  const clean = val.trim().toLowerCase().slice(0, 120);
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean) ? clean : '';
}

function isGenericCandidateName(name) {
  if (!name) return true;
  const lower = name.toLowerCase().trim();
  return (
    lower === 'candidate' ||
    lower === 'applicant' ||
    lower === 'unknown' ||
    lower === 'in' ||
    lower.startsWith('candidate (') ||
    lower.startsWith('unknown caller') ||
    lower.startsWith('email candidate') ||
    /^\+?\d[\d\s-]{6,}$/.test(lower)
  );
}

function normalizeForDiff(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Smart transcript merge: preserves older scrolled-out lines while appending new lines cleanly
function mergeChatTranscript(existingTranscript, incomingTranscript, isPreview = false) {
  const cleanIncoming = normalizeForDiff(incomingTranscript);
  const cleanExisting = normalizeForDiff(existingTranscript);
  if (!cleanIncoming) return { merged: cleanExisting, changed: false };
  if (!cleanExisting) return { merged: cleanIncoming, changed: true };
  if (cleanIncoming === cleanExisting) return { merged: cleanExisting, changed: false };

  // Never let a short sidebar/inbox preview overwrite an existing conversation
  if (isPreview) {
    return { merged: cleanExisting, changed: false };
  }

  // If incoming contains the entire existing transcript, incoming is strictly newer/fuller
  if (cleanIncoming.includes(cleanExisting)) {
    return { merged: cleanIncoming, changed: true };
  }

  // If existing already contains incoming (e.g. partial view), keep existing unchanged
  if (cleanExisting.includes(cleanIncoming)) {
    return { merged: cleanExisting, changed: false };
  }

  // Overlap merge: find longest suffix of existing lines matching prefix of incoming lines
  const oldLines = cleanExisting.split('\n').map(l => l.trim()).filter(Boolean);
  const newLines = cleanIncoming.split('\n').map(l => l.trim()).filter(Boolean);

  // If previous was just a 1-2 line sidebar preview, replace with full open chat transcript
  if (oldLines.length <= 2 && newLines.length >= 2) {
    return { merged: cleanIncoming, changed: true };
  }

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

  // Check if the last line of incoming is genuinely not in existing
  const unseenLines = newLines.filter(line => !oldLines.includes(line));
  if (unseenLines.length === 0) {
    return { merged: cleanExisting, changed: false };
  }

  return {
    merged: cleanExisting + '\n' + unseenLines.join('\n'),
    changed: true
  };
}

function stripSyntheticCallText(raw) {
  if (!raw) return '';
  let cleaned = String(raw).replace(/\r\n/g, '\n');
  // Remove legacy fake call recording transcript sections completely
  cleaned = cleaned.replace(
    /(?:-{10,}\s*\n)?\[Interaction Log:[^\]]*\|\s*Channel:\s*Call[^\]]*\][\s\S]*?(?=\n-{10,}\s*\n\[Interaction Log:|$)/gi,
    ''
  );
  cleaned = cleaned.replace(
    /\[Call Recording Transcript[^\]]*\][\s\S]*?(?=\n-{10,}\s*\n|$)/gi,
    ''
  );
  // Remove single-line synthetic call log summaries
  cleaned = cleaned
    .split('\n')
    .filter(line => !/^\[(Incoming|Outgoing|Missed)\s+Call\]\s*Start:/i.test(line.trim()))
    .join('\n')
    .replace(/(?:\n\s*-{10,}\s*)+$/g, '')
    .replace(/^(?:\s*-{10,}\s*\n)+/g, '')
    .trim();
  return cleaned;
}

function buildCombinedRawText(lead) {
  const sections = [];
  const wa = stripSyntheticCallText(lead.whatsappTranscript);
  const em = stripSyntheticCallText(lead.emailTranscript);
  if (wa) {
    sections.push(wa);
  }
  if (em) {
    if (sections.length > 0) sections.push('--------------------------------------------------');
    sections.push(em);
  }
  return sections.join('\n');
}

function computeCleanChannel(lead, fallbackChannel = '') {
  const parts = [];
  if (stripSyntheticCallText(lead.whatsappTranscript)) parts.push('WhatsApp');
  if (stripSyntheticCallText(lead.emailTranscript)) parts.push('Email');
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
// LEAD INGESTION (WhatsApp + Gmail + Manual + Call-Linked)
// =========================================================================

function processLeadIngest(payload) {
  // Route phone call webhooks directly to processCallLog so both Call Log & Lead stay synced!
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

  const text = sanitizeString(payload.text || payload.message || payload.notes || '', 15000);
  const channelRaw = sanitizeString(rawSource, 50) || 'WhatsApp';
  const isPreview = Boolean(payload.is_preview || payload.isPreview);
  const candidatePhone = sanitizePhone(payload.candidate_phone || payload.phone || '');
  const pKey = phoneKey10(candidatePhone);
  const candidateEmail = sanitizeEmail(
    payload.candidate_email ||
    payload.email ||
    ((text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0] || '')
  );

  let rawCandidateName = sanitizeString(payload.candidate_name || payload.name || '', 100);

  // Skip internal company HR reporting groups
  if (isInternalGroup(rawCandidateName, text)) {
    return { status: 'ignored', message: 'Internal team group skipped' };
  }

  const extractedName = extractCandidateName(text);
  let candidateName = rawCandidateName;
  if (extractedName && (isGenericCandidateName(candidateName) || candidateName === candidateEmail.split('@')[0])) {
    candidateName = extractedName;
  }
  if (!candidateName || candidateName.toLowerCase() === 'in') {
    if (pKey) candidateName = `Candidate (${pKey.slice(-4)})`;
    else if (candidateEmail) candidateName = candidateEmail.split('@')[0];
    else candidateName = 'Candidate';
  }

  const isWhatsApp = channelRaw.toLowerCase().includes('whatsapp');
  const isEmail = channelRaw.toLowerCase().includes('email') || channelRaw.toLowerCase().includes('gmail');
  const isCall = channelRaw.toLowerCase().includes('call');
  const cleanChannelLabel = isWhatsApp ? 'WhatsApp' : (isEmail ? 'Email' : (isCall ? 'Call' : channelRaw));

  // Phone calls never create or inject synthetic chat text
  const chatText = isCall ? '' : stripSyntheticCallText(text);
  const classification = classifyLead(chatText, payload.category || payload.custom_tag);
  const leads = getLeads();

  // Deduplicate by Email -> Phone (last 10 digits) -> Exact Non-Generic Name (for no-phone WhatsApp contacts)
  let existingIndex = -1;
  if (candidateEmail) {
    existingIndex = leads.findIndex(l => sanitizeEmail(l.email || '') === candidateEmail);
  }
  if (existingIndex === -1 && pKey.length >= 10) {
    existingIndex = leads.findIndex(l => phoneKey10(l.phone) === pKey);
  }
  if (existingIndex === -1 && !pKey && !candidateEmail && !isGenericCandidateName(candidateName)) {
    existingIndex = leads.findIndex(
      l => !l.phone && !l.email && (l.candidateName || '').toLowerCase().trim() === candidateName.toLowerCase().trim()
    );
  }

  const currentDay = todayKey();
  const currentTime = nowLocal();

  if (existingIndex !== -1) {
    const existing = leads[existingIndex];
    ensureActivityDates(existing);

    // Strip any legacy synthetic call text if present
    existing.whatsappTranscript = stripSyntheticCallText(existing.whatsappTranscript);
    existing.emailTranscript = stripSyntheticCallText(existing.emailTranscript);

    let hasMeaningfulUpdate = Boolean(payload._forceActivity);

    if (isWhatsApp && chatText) {
      const baseWa = existing.whatsappTranscript || ((existing.channel || '').toLowerCase().includes('whatsapp') ? stripSyntheticCallText(existing.rawText) : '');
      const merged = mergeChatTranscript(baseWa, chatText, isPreview);
      if (merged.changed) {
        existing.whatsappTranscript = merged.merged;
        hasMeaningfulUpdate = true;
      }
    } else if (isEmail && chatText) {
      const baseEm = existing.emailTranscript || ((existing.channel || '').toLowerCase().includes('email') ? stripSyntheticCallText(existing.rawText) : '');
      const merged = mergeChatTranscript(baseEm, chatText, isPreview);
      if (merged.changed) {
        existing.emailTranscript = merged.merged;
        hasMeaningfulUpdate = true;
      }
    } else if (isCall && payload.callEntry) {
      existing.callHistory = Array.isArray(existing.callHistory) ? existing.callHistory : [];
      existing.callHistory.unshift(payload.callEntry);
      existing.lastCall = payload.callEntry;
      existing.callDuration = payload.callEntry.durationFormatted;
      if (payload.callEntry.direction === 'missed') {
        existing.followUpNeeded = true;
      }
      if (payload.recruiterNotes && !existing.recruiterNotes) {
        existing.recruiterNotes = sanitizeString(payload.recruiterNotes, 2000);
      }
      hasMeaningfulUpdate = true;
    }

    // Enrich contact fields if missing
    if (!existing.phone && candidatePhone) { existing.phone = candidatePhone; hasMeaningfulUpdate = true; }
    if (!existing.email && candidateEmail) { existing.email = candidateEmail; hasMeaningfulUpdate = true; }
    if (!isGenericCandidateName(candidateName) && isGenericCandidateName(existing.candidateName)) {
      existing.candidateName = candidateName;
      hasMeaningfulUpdate = true;
    } else if (extractedName && !isCall && isGenericCandidateName(existing.candidateName)) {
      existing.candidateName = extractedName;
      hasMeaningfulUpdate = true;
    }

    const currentCtc = sanitizeString(payload.current_ctc || extractCurrentCtc(chatText), 60);
    const expectedCtc = sanitizeString(payload.expected_ctc || extractExpectedCtc(chatText), 60);
    const noticePeriod = sanitizeString(payload.notice_period || extractNoticePeriod(chatText), 60);
    const skills = sanitizeString(payload.skills || extractSkills(chatText), 250);

    if (currentCtc && currentCtc !== existing.currentCtc) { existing.currentCtc = currentCtc; hasMeaningfulUpdate = true; }
    if (expectedCtc && expectedCtc !== existing.expectedCtc) { existing.expectedCtc = expectedCtc; hasMeaningfulUpdate = true; }
    if (noticePeriod && noticePeriod !== existing.noticePeriod) { existing.noticePeriod = noticePeriod; hasMeaningfulUpdate = true; }
    if (skills && (!existing.skills || existing.skills === 'General')) { existing.skills = skills; }

    // Compute accurate channel badge strictly from real WhatsApp / Email / Call records
    const nextChannel = computeCleanChannel(existing, cleanChannelLabel);
    if (nextChannel && nextChannel !== existing.channel) {
      existing.channel = nextChannel;
      hasMeaningfulUpdate = true;
    }

    const CATEGORY_RANK = {
      'General Enquiry': 0,
      'New Job Seeker': 1,
      'Experienced / Job Change': 2,
      'Client / Employer Lead': 3
    };
    const newRank = CATEGORY_RANK[classification.category] ?? 0;
    const oldRank = CATEGORY_RANK[existing.category] ?? 0;
    if (newRank > oldRank || payload.category || payload.custom_tag) {
      existing.category = classification.category;
    }
    if (classification.keywords.length > 0) {
      existing.keywords = [...new Set([...(existing.keywords || []), ...classification.keywords])];
    }

    if (chatText && detectFollowUpSignal(chatText)) {
      existing.followUpNeeded = true;
    }

    // Remove any legacy bloat fields if present
    delete existing.recordingUrl;
    delete existing.summary;

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

    if (payload.recruiter_name || payload.recruiter) {
      const rec = sanitizeString(payload.recruiter_name || payload.recruiter, 100);
      if (rec && rec !== 'Unknown' && (!existing.recruiter || existing.recruiter === 'Unknown')) {
        existing.recruiter = rec;
      }
    }

    // Move recently updated lead to top
    leads.splice(existingIndex, 1);
    leads.unshift(existing);
    saveLeads(leads);

    broadcastEvent('lead_updated', { leadId: existing.id, candidateName: existing.candidateName, channel: existing.channel });
    return { status: 'success', action: 'updated', lead: existing };
  }

  // CREATE BRAND NEW LEAD
  const recruiterName = sanitizeString(payload.recruiter_name || payload.recruiter || 'Suhani', 100);
  const currentCtc = sanitizeString(payload.current_ctc || extractCurrentCtc(chatText), 60);
  const expectedCtc = sanitizeString(payload.expected_ctc || extractExpectedCtc(chatText), 60);
  const noticePeriod = sanitizeString(payload.notice_period || extractNoticePeriod(chatText), 60);
  const skills = sanitizeString(payload.skills || extractSkills(chatText) || 'General', 250);
  const createdTs = payload._eventTimestamp || currentTime;
  const createdDay = payload._eventDateKey || getLocalDateKey(createdTs);

  const newLead = {
    id: 'LEAD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10),
    timestamp: createdTs,
    lastUpdated: createdTs,
    dateKey: createdDay,
    activityDates: [createdDay],
    recruiter: recruiterName,
    channel: cleanChannelLabel,
    category: classification.category,
    candidateName,
    phone: candidatePhone,
    email: candidateEmail,
    currentCtc,
    expectedCtc,
    noticePeriod,
    skills,
    keywords: classification.keywords,
    whatsappTranscript: isWhatsApp ? chatText : '',
    emailTranscript: isEmail ? chatText : '',
    callHistory: payload.callEntry ? [payload.callEntry] : [],
    lastCall: payload.callEntry || null,
    callDuration: payload.callEntry ? payload.callEntry.durationFormatted : '',
    rawText: (isWhatsApp || isEmail) ? chatText : '',
    followUpNeeded: Boolean((chatText && detectFollowUpSignal(chatText)) || (payload.callEntry && payload.callEntry.direction === 'missed')),
    followUpDate: sanitizeString(payload.followUpDate || '', 40),
    recruiterNotes: sanitizeString(payload.recruiterNotes || '', 2000),
    status: 'New Lead'
  };
  newLead.channel = computeCleanChannel(newLead, cleanChannelLabel);

  leads.unshift(newLead);
  saveLeads(leads);

  broadcastEvent('lead_created', { leadId: newLead.id, candidateName: newLead.candidateName, channel: newLead.channel });
  return { status: 'success', action: 'created', lead: newLead };
}

// =========================================================================
// PHONE CALL LOGGER (Start Time, End Time, Duration, Direction — Zero Audio/AI)
// =========================================================================

function processCallLog(data) {
  const phone = sanitizePhone(
    data.candidate_phone || data.phone || data.number || data.phone_number || data.caller || ''
  );
  if (!phone) {
    return {
      status: 'error',
      message: 'Valid phone number is required. In MacroDroid use {call_number} instead of [call_number].'
    };
  }

  const pKey = phoneKey10(phone);
  const recruiterName = sanitizeString(data.recruiter_name || data.recruiter || 'Suhani', 100);
  const recruiterPhone = sanitizePhone(data.recruiter_phone || '');
  let candidateName = sanitizeString(data.candidate_name || data.name || data.contact_name || '', 100);

  // Enrich candidate name automatically if this number already exists in CRM Leads!
  const leads = getLeads();
  const matchedLead = pKey.length >= 10 ? leads.find(l => phoneKey10(l.phone) === pKey) : null;
  if (isGenericCandidateName(candidateName) && matchedLead && !isGenericCandidateName(matchedLead.candidateName)) {
    candidateName = matchedLead.candidateName;
  }
  if (!candidateName || isGenericCandidateName(candidateName)) {
    candidateName = `Candidate (${pKey.slice(-4) || 'Call'})`;
  }

  const rawDir = sanitizeString(
    data.call_direction || data.direction || data.call_type || data.type || 'outgoing',
    40
  ).toLowerCase();

  let durationSec = parseDurationToSeconds(
    data.call_duration_seconds ?? data.duration_seconds ?? data.call_duration ?? data.duration ?? 0
  );

  // Accurate Start & End Time Computation in Local Wall-Clock Time:
  // - If Android "Call Ended" webhook fires (no explicit start time), NOW is Call End Time, and Start = End - Duration!
  // - If manual/explicit start & end are provided, honour them directly.
  const hasStart = Boolean(data.call_start_time || data.start_time);
  const hasEnd = Boolean(data.call_end_time || data.end_time);

  let startDate;
  let endDate;

  const isExplicitZeroTalk =
    rawDir.includes('miss') ||
    rawDir.includes('reject') ||
    rawDir.includes('unanswer') ||
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
    // Default for Phone "Call Ended" webhook: call just ended right now!
    endDate = hasEnd ? parseFlexDate(data.call_end_time || data.end_time) : new Date();
    startDate = new Date(endDate.getTime() - durationSec * 1000);
  }

  let direction = 'outgoing';
  if (rawDir.includes('miss') || rawDir.includes('reject') || rawDir.includes('unanswer')) {
    direction = 'missed';
  } else if (rawDir.includes('in') || rawDir === '1') {
    direction = durationSec === 0 && rawDir.includes('miss') ? 'missed' : 'incoming';
  } else if (rawDir.includes('out') || rawDir === '2') {
    direction = 'outgoing';
  }
  if (direction === 'incoming' && durationSec === 0 && !hasStart) {
    direction = 'missed';
  }

  let notes = sanitizeString(data.notes || '', 1000);
  // Strip auto-generated MacroDroid template boilerplate if present
  if (/^call ended\.\s*type:/i.test(notes)) notes = '';

  const startLocal = formatLocalTimestamp(startDate);
  const endLocal = formatLocalTimestamp(endDate);
  const dateKey = getLocalDateKey(startDate);
  const logs = getCallLogs();

  // Prevent accidental duplicate double-fire from mobile network retry within 10s
  const recentDup = logs.find(l => {
    if (phoneKey10(l.candidatePhone) !== pKey) return false;
    if (l.durationSeconds !== durationSec) return false;
    const prevEnd = parseFlexDate(l.callEndTime).getTime();
    return Math.abs(endDate.getTime() - prevEnd) < 10000;
  });
  if (recentDup) {
    return { status: 'success', action: 'deduplicated', callLog: recentDup };
  }

  const callLog = {
    id: 'CALL-' + Date.now().toString().slice(-8),
    dateKey,
    recruiterName,
    recruiterPhone,
    candidateName,
    candidatePhone: phone,
    direction,
    callStartTime: startLocal,
    callEndTime: endLocal,
    callStartDisplay: formatDisplayDateTime(startDate),
    callEndDisplay: formatDisplayDateTime(endDate),
    durationSeconds: durationSec,
    durationFormatted: formatDuration(durationSec),
    notes,
    loggedAt: nowLocal()
  };

  logs.unshift(callLog);
  saveCallLogs(logs);

  // Sync into Leads so candidate has unified Call + WhatsApp + Email timeline (zero synthetic chat text)
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
      direction,
      callStartTime: startLocal,
      callEndTime: endLocal,
      callStartDisplay: callLog.callStartDisplay,
      callEndDisplay: callLog.callEndDisplay,
      durationSeconds: durationSec,
      durationFormatted: callLog.durationFormatted,
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
    durationFormatted: callLog.durationFormatted,
    recruiterName: callLog.recruiterName
  });

  return { status: 'success', action: 'logged', callLog };
}

// =========================================================================
// LIVE REAL-TIME CALL STOPWATCH ENGINE (Ringing -> Talking Timer -> Ended)
// Solves Android Call-Duration restriction by tracking live Start-to-End span!
// =========================================================================

const activeCalls = new Map(); // recruiterKey -> { recruiterName, phone, candidateName, direction, status, ringStartMs, talkStartMs, startLocal, startDisplay }

// Auto-cleanup any orphaned live call older than 30 minutes
setInterval(() => {
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

function getActiveCallsList() {
  const now = Date.now();
  return Array.from(activeCalls.values()).filter(item => {
    const refMs = item.talkStartMs || item.ringStartMs || now;
    return now - refMs <= 30 * 60 * 1000;
  });
}

function broadcastLiveCallsState() {
  broadcastEvent('live_calls_state', { activeCalls: getActiveCallsList() });
}

function resolveLiveCandidateName(phone, rawName) {
  const cleanName = sanitizeString(rawName || '', 100);
  const pKey = phoneKey10(phone);
  const matched = pKey.length >= 10 ? getLeads().find(l => phoneKey10(l.phone) === pKey) : null;
  if (!isGenericCandidateName(cleanName) && cleanName !== phone) return cleanName;
  if (matched && !isGenericCandidateName(matched.candidateName)) return matched.candidateName;
  return pKey ? `Candidate (${pKey.slice(-4)})` : (cleanName || 'Active Caller');
}

function processLiveCallEvent(data, eventTimeMs = Date.now()) {
  const event = sanitizeString(data.event || data.state || 'ended', 30).toLowerCase();
  const recruiterName = sanitizeString(data.recruiter || data.recruiter_name || 'Suhani', 100);
  const rKey = recruiterName.toLowerCase().trim();

  const incomingPhone = sanitizePhone(data.phone || data.candidate_phone || data.number || '');
  const incomingName = sanitizeString(data.name || data.candidate_name || '', 100);
  const rawDir = sanitizeString(data.dir || data.direction || data.call_type || '', 30).toLowerCase();

  const existing = activeCalls.get(rKey) || null;
  const finalPhone = incomingPhone || (existing ? existing.phone : '');
  const finalName = resolveLiveCandidateName(finalPhone, incomingName || (existing ? existing.candidateName : ''));
  const eventNow = new Date(eventTimeMs || Date.now());

  // 1. RINGING / DIALING (Before call is answered)
  if (event === 'ringing' || event === 'incoming' || event === 'dialing' || event === 'outgoing') {
    const direction = (event === 'ringing' || event === 'incoming' || rawDir.includes('in')) ? 'incoming' : 'outgoing';
    const stateObj = {
      recruiterName,
      phone: finalPhone || 'Connecting...',
      candidateName: finalName,
      direction,
      status: direction === 'incoming' ? 'ringing' : 'dialing',
      ringStartMs: eventNow.getTime(),
      talkStartMs: null,
      startLocal: formatLocalTimestamp(eventNow),
      startDisplay: formatDisplayDateTime(eventNow)
    };
    activeCalls.set(rKey, stateObj);
    broadcastLiveCallsState();
    return { status: 'success', state: stateObj.status, liveCall: stateObj };
  }

  // 2. CALL ACTIVE / ANSWERED (Exact millisecond talk timer starts!)
  if (event === 'started' || event === 'active' || event === 'answered' || event === 'start') {
    const direction = rawDir.includes('in')
      ? 'incoming'
      : (rawDir.includes('out') ? 'outgoing' : (existing ? existing.direction : 'outgoing'));

    const stateObj = {
      recruiterName,
      phone: finalPhone || 'On Call',
      candidateName: finalName,
      direction,
      status: 'talking',
      ringStartMs: existing ? existing.ringStartMs : eventNow.getTime(),
      talkStartMs: (existing && existing.talkStartMs) ? existing.talkStartMs : eventNow.getTime(),
      startLocal: (existing && existing.talkStartMs) ? existing.startLocal : formatLocalTimestamp(eventNow),
      startDisplay: (existing && existing.talkStartMs) ? existing.startDisplay : formatDisplayDateTime(eventNow)
    };
    activeCalls.set(rKey, stateObj);
    broadcastLiveCallsState();
    return { status: 'success', state: 'talking', liveCall: stateObj };
  }

  // 3. CALL ENDED (Stop stopwatch & save exact Start Time -> End Time -> Duration!)
  if (event === 'ended' || event === 'end' || event === 'hangup') {
    const endDate = eventNow;
    activeCalls.delete(rKey);
    broadcastLiveCallsState();

    const explicitDur = parseDurationToSeconds(data.duration ?? data.call_duration ?? data.call_duration_seconds ?? 0);

    // Case A: Live stopwatch captured exact talkStartMs!
    if (existing && existing.talkStartMs) {
      const startDate = new Date(existing.talkStartMs);
      const liveDurationSec = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 1000));
      return processCallLog({
        recruiter_name: recruiterName,
        candidate_phone: finalPhone,
        candidate_name: finalName,
        call_direction: existing.direction || (rawDir.includes('in') ? 'incoming' : 'outgoing'),
        call_start_time: formatLocalTimestamp(startDate),
        call_end_time: formatLocalTimestamp(endDate),
        call_duration_seconds: explicitDur > 0 ? explicitDur : liveDurationSec
      });
    }

    // Case B: Phone rang/dialed (`ringStartMs`) and cut BEFORE `Call Active` -> Missed / Unanswered (0s)!
    if (existing && existing.ringStartMs && !existing.talkStartMs && explicitDur === 0) {
      const ringDate = new Date(existing.ringStartMs);
      return processCallLog({
        recruiter_name: recruiterName,
        candidate_phone: finalPhone,
        candidate_name: finalName,
        call_direction: existing.direction === 'incoming' ? 'missed' : 'outgoing',
        call_start_time: formatLocalTimestamp(ringDate),
        call_end_time: formatLocalTimestamp(endDate),
        call_duration_seconds: 0,
        force_zero_duration: true
      });
    }

    // Case C: Fallback single-event Call Ended
    return processCallLog({
      recruiter_name: recruiterName,
      candidate_phone: finalPhone,
      candidate_name: finalName,
      call_direction: rawDir || 'outgoing',
      call_duration_seconds: explicitDur
    });
  }

  return { status: 'error', message: 'Unknown live call event: ' + event };
}

// =========================================================================
// ACCURATE LAN IP DETECTION (Skips 169.254.x.x APIPA & Virtual Adapters)
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
      if (iface.address.startsWith('169.254.')) continue; // Skip dead APIPA addresses!

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
// STATIC FILE SERVER
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
  '.ico': 'image/x-icon'
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

// =========================================================================
// ROLE FILTERING & DATE HELPERS
// =========================================================================

function filterByRole(items, recruiterField, userRole, userName, queryRecruiter) {
  if (userRole === 'recruiter') {
    return items.filter(item => (item[recruiterField] || '').toLowerCase().trim() === userName);
  }
  if (userRole === 'admin' || userRole === 'team_leader') {
    if (queryRecruiter && queryRecruiter !== 'all') {
      return items.filter(item => (item[recruiterField] || '').toLowerCase().trim() === queryRecruiter);
    }
    return items;
  }
  return null;
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Role, X-User-Name');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // --- STATIC FRONTEND & MOBILE PHONE SYNC WIZARD ---
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      serveStaticFile(path.join(PUBLIC_DIR, 'index.html'), res);
      return;
    }
    if (method === 'GET' && (pathname === '/phone' || pathname === '/phone-setup' || pathname === '/phone.html')) {
      serveStaticFile(path.join(PUBLIC_DIR, 'phone.html'), res);
      return;
    }
    if (method === 'GET' && /\.(css|js|png|jpg|jpeg|svg|ico)$/.test(pathname)) {
      serveStaticFile(path.join(PUBLIC_DIR, path.basename(pathname)), res);
      return;
    }

    // --- HEALTH / EXTENSION AUTO-DISCOVERY PING ---
    if ((pathname === '/api/health' || pathname === '/api/ping') && method === 'GET') {
      const ip = getLocalIp();
      const host = os.hostname();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        app: 'Recruiter-CRM',
        hostname: host,
        ip,
        port: PORT,
        serverTime: nowLocal(),
        todayKey: todayKey(),
        webhookUrl: `http://${ip}:${PORT}/api/webhook`,
        hostnameWebhookUrl: `http://${host}:${PORT}/api/webhook`,
        callWebhookUrl: `http://${ip}:${PORT}/api/calls/log`,
        liveCallLanUrl: `http://${ip}:${PORT}/api/calls/live`,
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

    // --- KNOWN LEADS REGISTRY FOR CHROME EXTENSION LIVE CHAT SYNC ---
    if (pathname === '/api/leads/known' && method === 'GET') {
      const leads = getLeads();
      const recruiters = getRecruiters();
      const phones = [...new Set(leads.map(l => phoneKey10(l.phone)).filter(p => p.length >= 10))];
      const emails = [...new Set(leads.map(l => sanitizeEmail(l.email || '')).filter(Boolean))];
      const names = [...new Set(recruiters.map(r => r.name).filter(Boolean))];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', phones, emails, recruiters: names }));
      return;
    }

    // --- LOGIN ---
    if (pathname === '/api/login' && method === 'POST') {
      const body = await parseRequestBody(req);
      const username = sanitizeString(body.username, 50);
      const password = sanitizeString(body.password, 100);
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Username and password required.' }));
        return;
      }
      const users = getUsers();
      const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
      if (user) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          user: { id: user.id, username: user.username, name: user.name, role: user.role, email: user.email }
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid credentials.' }));
      }
      return;
    }

    // --- GET LEADS (Role-Based + Day-Wise Filtering) ---
    if (pathname === '/api/leads' && method === 'GET') {
      const userRole = sanitizeString(req.headers['x-user-role'] || parsedUrl.query.user_role || '', 30).toLowerCase();
      const userName = sanitizeString(req.headers['x-user-name'] || parsedUrl.query.user_name || '', 100).toLowerCase();
      const queryRec = sanitizeString(parsedUrl.query.recruiter || '', 100).toLowerCase();

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
      const queryRec = sanitizeString(parsedUrl.query.recruiter || '', 100).toLowerCase();

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

    // --- GET RECRUITERS & DAILY TEAM SCORECARD ---
    if (pathname === '/api/recruiters' && method === 'GET') {
      const dateParam = sanitizeString(parsedUrl.query.date || '', 20);
      const baseRecruiters = getRecruiters();
      const allLeads = getLeads();
      const allCalls = getCallLogs();

      // Dynamically include any recruiter name seen in leads or calls
      const knownMap = new Map();
      baseRecruiters.forEach(r => {
        knownMap.set(r.name.toLowerCase().trim(), { ...r });
      });
      allLeads.forEach(l => {
        const key = (l.recruiter || '').toLowerCase().trim();
        if (key && key !== 'unknown' && !knownMap.has(key)) {
          knownMap.set(key, { id: 'REC-DYN-' + knownMap.size, name: l.recruiter.trim(), status: 'Active' });
        }
      });
      allCalls.forEach(c => {
        const key = (c.recruiterName || '').toLowerCase().trim();
        if (key && key !== 'unknown' && !knownMap.has(key)) {
          knownMap.set(key, { id: 'REC-DYN-' + knownMap.size, name: c.recruiterName.trim(), status: 'Active' });
        }
      });

      const filterDay = dateParam && dateParam.toLowerCase() !== 'all' ? dateParam : null;

      const recruiters = Array.from(knownMap.values()).map(r => {
        const rKey = (r.name || '').toLowerCase().trim();
        const rLeads = allLeads.filter(l => {
          if ((l.recruiter || '').toLowerCase().trim() !== rKey) return false;
          return filterDay ? ensureActivityDates(l).includes(filterDay) : true;
        });
        const rCalls = allCalls.filter(c => {
          if ((c.recruiterName || '').toLowerCase().trim() !== rKey) return false;
          const dk = c.dateKey || getLocalDateKey(c.callStartTime || c.loggedAt);
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
          totalTalkSeconds,
          totalTalkFormatted: formatDuration(totalTalkSeconds),
          whatsappLeads: rLeads.filter(l => Boolean(stripSyntheticCallText(l.whatsappTranscript))).length,
          emailLeads: rLeads.filter(l => Boolean(stripSyntheticCallText(l.emailTranscript))).length,
          interviewsCount: rLeads.filter(l => ['Interview Scheduled', 'Shortlisted', 'Selected'].includes(l.status)).length
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', serverTime: nowLocal(), todayKey: todayKey(), recruiters }));
      return;
    }

    // --- WEBHOOK / CREATE OR UPDATE LEAD (WhatsApp + Gmail + Calls) ---
    if ((pathname === '/api/webhook' || pathname === '/api/leads') && method === 'POST') {
      const payload = await parseRequestBody(req);
      const result = processLeadIngest(payload);
      const code = result.status === 'error' ? 400 : (result.action === 'created' ? 201 : 200);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // --- LIVE PHONE CALL STOPWATCH EVENTS (Ringing / Started / Ended) ---
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

    // --- LOG PHONE CALL (Supports POST JSON/Form & GET Query Webhook for Android Apps) ---
    if (pathname === '/api/calls/log' && (method === 'POST' || method === 'GET')) {
      const data = method === 'POST' ? await parseRequestBody(req) : (parsedUrl.query || {});
      const result = processCallLog(data);
      const code = result.status === 'error' ? 400 : 201;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // --- UPDATE LEAD DETAILS / STATUS / FOLLOW-UP / NOTES ---
    if (pathname.startsWith('/api/leads/') && method === 'PATCH') {
      const leadId = sanitizeString(decodeURIComponent(pathname.split('/')[3] || ''), 40);
      if (!leadId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Lead ID required.' }));
        return;
      }
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
      if (data.phone !== undefined) lead.phone = sanitizePhone(data.phone) || data.phone;
      if (data.email !== undefined) lead.email = sanitizeEmail(data.email) || '';
      if (data.currentCtc !== undefined) lead.currentCtc = sanitizeString(data.currentCtc, 60);
      if (data.expectedCtc !== undefined) lead.expectedCtc = sanitizeString(data.expectedCtc, 60);
      if (data.noticePeriod !== undefined) lead.noticePeriod = sanitizeString(data.noticePeriod, 60);
      if (data.skills !== undefined) lead.skills = sanitizeString(data.skills, 250);
      if (data.followUpDate !== undefined) {
        lead.followUpDate = sanitizeString(data.followUpDate, 40);
        lead.followUpNeeded = Boolean(lead.followUpDate);
      }
      if (data.followUpNeeded !== undefined) lead.followUpNeeded = Boolean(data.followUpNeeded);
      if (data.recruiterNotes !== undefined) lead.recruiterNotes = sanitizeString(data.recruiterNotes, 2000);

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

      // Sync removal into linked lead callHistory as well
      const leads = getLeads();
      let leadsChanged = false;
      const updatedLeads = leads.filter(l => {
        if (Array.isArray(l.callHistory) && l.callHistory.some(c => c.id === callId)) {
          l.callHistory = l.callHistory.filter(c => c.id !== callId);
          l.lastCall = l.callHistory[0] || null;
          l.callDuration = l.lastCall ? l.lastCall.durationFormatted : '';
          leadsChanged = true;
          const hasChat = Boolean(stripSyntheticCallText(l.whatsappTranscript) || stripSyntheticCallText(l.emailTranscript));
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
});

// Global process resilience
process.on('uncaughtException', err => console.error('[FATAL] Uncaught:', err));
process.on('unhandledRejection', reason => console.error('[FATAL] Unhandled:', reason));
if (process.stdin.isTTY === false) process.stdin.resume();
setInterval(() => {}, 1000 * 60 * 60);

// =========================================================================
// PERMANENT ZERO-IP CLOUD CALL RELAY + LAN DISCOVERY
// Allows Android MacroDroid to sync 24/7 over Wi-Fi OR 4G/5G Mobile Data
// with ZERO IP changes ever required!
// =========================================================================
const DISCOVERY_CHANNEL = 'recruiter_crm_lan_discovery_channel';
const CLOUD_CALL_TOPIC = 'rec_crm_calls_bca2c15f978c';
const CLOUD_CURSOR_FILE = path.join(DATA_DIR, 'cloud_sync_cursor.json');
const processedCloudIds = new Set();

function loadCloudCursor() {
  return readJsonFile(CLOUD_CURSOR_FILE, { lastId: '', lastTime: 0 });
}

function saveCloudCursor(id, time) {
  writeJsonFile(CLOUD_CURSOR_FILE, { lastId: id, lastTime: time || Math.floor(Date.now() / 1000) });
}

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
          if (obj.event === 'message' && obj.message && obj.id) {
            if (processedCloudIds.has(obj.id)) continue;
            processedCloudIds.add(obj.id);
            if (processedCloudIds.size > 500) {
              const first = processedCloudIds.values().next().value;
              processedCloudIds.delete(first);
            }
            saveCloudCursor(obj.id, obj.time);

            const parsed = parseFlexiblePayload(obj.message);
            if (parsed && (parsed.event || parsed.phone || parsed.candidate_phone)) {
              const msgMs = obj.time ? obj.time * 1000 : Date.now();
              const effectiveMs = Math.abs(Date.now() - msgMs) < 2000 ? Date.now() : msgMs;
              processLiveCallEvent(parsed, effectiveMs);
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
    ip,
    port: PORT,
    hostname: os.hostname(),
    url: `http://${ip}:${PORT}/api/webhook`,
    callUrl: `http://${ip}:${PORT}/api/calls/log`,
    timestamp: Date.now()
  });

  const req = https.request(`https://ntfy.sh/${DISCOVERY_CHANNEL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Title': 'CRM Server Online' }
  }, () => {});
  req.on('error', () => {});
  req.write(payload);
  req.end();
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  const host = os.hostname();
  console.log('===============================================================');
  console.log('🚀 Recruitment CRM Server Online (Local IST Clock Active)');
  console.log(`🕒 Server Time:           ${formatDisplayDateTime(new Date())}`);
  console.log(`🌐 Local Host PC:         http://localhost:${PORT}`);
  console.log(`🌐 Fixed IP URL:          http://${ip}:${PORT}`);
  console.log(`🌐 Hostname URL:          http://${host}:${PORT}`);
  console.log(`🔗 Extension Webhook:     http://${ip}:${PORT}/api/webhook`);
  console.log(`☁️  Permanent Cloud Sync:  https://ntfy.sh/${CLOUD_CALL_TOPIC}`);
  console.log('===============================================================');

  connectCloudCallRelay();
  broadcastCurrentIp();
  setInterval(broadcastCurrentIp, 1000 * 60 * 5);
});
