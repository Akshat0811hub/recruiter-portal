// ==========================================================================================
// Recruitment CRM Auto-Syncer - Background Service Worker (Manifest V3)
// Zero-Touch Permanent Connection Engine:
//  1. Frozen Static IP (192.168.1.34:3000) + Permanent Hostname (DESKTOP-GLVB82A:3000)
//  2. Cloud Broadcast Fallback (Proper NDJSON parser for ntfy.sh)
//  3. Full LAN Subnet Scan (192.168.1.1-254)
//  4. Persistent Offline Retry Queue (Zero lost chats/emails even if Wi-Fi blips)
//  5. Known CRM Leads Sync (Auto-tracks ongoing chats for call/existing candidates)
// ==========================================================================================

const FROZEN_SERVER_IP = "192.168.1.34";
const DEFAULT_SERVER_HOST = "DESKTOP-GLVB82A";
const PORT = 3000;
const DISCOVERY_CHANNEL = "https://ntfy.sh/recruiter_crm_lan_discovery_channel/json?poll=1";

// 1. Parse NDJSON feed from ntfy.sh properly (latest message last)
async function fetchBroadcastedIp() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(DISCOVERY_CHANNEL, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const rawText = await res.text();
      const lines = rawText.trim().split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const outer = JSON.parse(lines[i]);
          if (outer && outer.message) {
            const inner = JSON.parse(outer.message);
            if (inner && inner.ip && !inner.ip.startsWith("169.254.")) {
              return `http://${inner.ip}:${inner.port || PORT}/api/webhook`;
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return null;
}

// 2. Full LAN Subnet Scan in Fast Parallel Batches (1..254)
async function burstScanLanSubnet() {
  const pingTarget = (baseUrl) =>
    new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      fetch(`${baseUrl}/api/ping`, { signal: controller.signal })
        .then(r => r.json())
        .then(data => {
          clearTimeout(timer);
          if (data && data.app === "Recruiter-CRM") resolve(`${baseUrl}/api/webhook`);
          else reject();
        })
        .catch(() => {
          clearTimeout(timer);
          reject();
        });
    });

  const subnets = ["192.168.1", "192.168.0", "192.168.29"];
  for (const subnet of subnets) {
    const batchSize = 64;
    for (let start = 1; start <= 254; start += batchSize) {
      const batch = [];
      for (let i = start; i < start + batchSize && i <= 254; i++) {
        batch.push(`http://${subnet}.${i}:${PORT}`);
      }
      try {
        const winner = await Promise.any(batch.map(pingTarget));
        if (winner) return winner;
      } catch (e) {}
    }
  }
  return null;
}

// 3. Candidate URLs in Priority Order (Frozen IP + Hostname + Saved URL + Localhost)
async function getCandidateUrls(preferredUrl) {
  const targets = new Set();

  if (preferredUrl && preferredUrl.trim()) {
    targets.add(preferredUrl.trim());
  }

  try {
    const stored = await chrome.storage.local.get(["workingServerUrl", "webhookUrl"]);
    if (stored.workingServerUrl) targets.add(stored.workingServerUrl);
    if (stored.webhookUrl) targets.add(stored.webhookUrl);
  } catch (e) {}

  // Frozen IP & Hostname always included so recruiters never have to edit IP manually
  targets.add(`http://${FROZEN_SERVER_IP}:${PORT}/api/webhook`);
  targets.add(`http://${DEFAULT_SERVER_HOST}:${PORT}/api/webhook`);
  targets.add(`http://${DEFAULT_SERVER_HOST}.local:${PORT}/api/webhook`);
  targets.add(`http://localhost:${PORT}/api/webhook`);
  targets.add(`http://127.0.0.1:${PORT}/api/webhook`);

  return Array.from(targets).filter(Boolean);
}

function toBaseUrl(webhookUrl) {
  return String(webhookUrl || "").replace(/\/api\/webhook\/?$/, "");
}

// 4. Verify & Discover Active CRM Server
async function autoCatchServerUrl(preferredUrl) {
  const candidates = await getCandidateUrls(preferredUrl);

  const testQuick = (url) =>
    new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1600);
      const pingUrl = `${toBaseUrl(url)}/api/ping`;

      fetch(pingUrl, { signal: controller.signal })
        .then(r => r.json())
        .then(data => {
          clearTimeout(timer);
          if (data && data.app === "Recruiter-CRM") resolve({ url, info: data });
          else reject();
        })
        .catch(() => {
          clearTimeout(timer);
          reject();
        });
    });

  // Step A: Race known targets (Frozen IP 192.168.1.34 + Hostname + Localhost)
  try {
    const winner = await Promise.any(candidates.map(testQuick));
    if (winner && winner.url) {
      await chrome.storage.local.set({ workingServerUrl: winner.url, lastConnectedAt: Date.now() });
      syncKnownLeadsFromServer(winner.url);
      return { success: true, url: winner.url, info: winner.info };
    }
  } catch (e) {}

  // Step B: Check cloud broadcast feed (in case router changed IP)
  const cloudUrl = await fetchBroadcastedIp();
  if (cloudUrl) {
    try {
      const checked = await testQuick(cloudUrl);
      await chrome.storage.local.set({ workingServerUrl: checked.url, webhookUrl: checked.url, lastConnectedAt: Date.now() });
      syncKnownLeadsFromServer(checked.url);
      return { success: true, url: checked.url, info: checked.info };
    } catch (e) {}
  }

  // Step C: Full LAN Subnet Scan
  const burstUrl = await burstScanLanSubnet();
  if (burstUrl) {
    try {
      const checked = await testQuick(burstUrl);
      await chrome.storage.local.set({ workingServerUrl: checked.url, webhookUrl: checked.url, lastConnectedAt: Date.now() });
      syncKnownLeadsFromServer(checked.url);
      return { success: true, url: checked.url, info: checked.info };
    } catch (e) {
      await chrome.storage.local.set({ workingServerUrl: burstUrl, webhookUrl: burstUrl });
      return { success: true, url: burstUrl };
    }
  }

  return {
    success: false,
    error: "CRM Server unreachable. Make sure 'start-crm.bat' is running on DESKTOP-GLVB82A (192.168.1.34)."
  };
}

// 5. Sync Known CRM Phones/Emails & Recruiter List (Enables keyword-free live chat updates for existing candidates)
async function syncKnownLeadsFromServer(webhookUrl) {
  try {
    const stored = await chrome.storage.local.get(["workingServerUrl"]);
    const base = toBaseUrl(webhookUrl || stored.workingServerUrl || `http://${FROZEN_SERVER_IP}:${PORT}/api/webhook`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${base}/api/leads/known`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "success") {
        await chrome.storage.local.set({
          knownPhones: data.phones || [],
          knownEmails: data.emails || [],
          knownRecruiters: data.recruiters || []
        });
      }
    }
  } catch (e) {}
}

// 6. Persistent Offline Queue (Guarantees zero lost leads if Wi-Fi drops briefly)
function makeQueueKey(payload) {
  const phone = String(payload.candidate_phone || "").replace(/[^0-9]/g, "").slice(-10);
  const email = String(payload.candidate_email || "").toLowerCase().trim();
  const name = String(payload.candidate_name || "").toLowerCase().trim();
  const src = String(payload.source || "wa").toLowerCase();
  return `${src}:${email || phone || name || Date.now()}`;
}

async function enqueuePendingLead(payload) {
  try {
    const stored = await chrome.storage.local.get(["pendingSyncQueue"]);
    const queue = stored.pendingSyncQueue && typeof stored.pendingSyncQueue === "object" ? stored.pendingSyncQueue : {};
    queue[makeQueueKey(payload)] = { payload, queuedAt: Date.now() };
    // Cap queue at 200 items
    const keys = Object.keys(queue);
    if (keys.length > 200) {
      delete queue[keys[0]];
    }
    await chrome.storage.local.set({ pendingSyncQueue: queue });
  } catch (e) {}
}

let isFlushingQueue = false;
async function flushPendingQueue() {
  if (isFlushingQueue) return;
  isFlushingQueue = true;
  try {
    const stored = await chrome.storage.local.get(["pendingSyncQueue", "workingServerUrl", "webhookUrl"]);
    const queue = stored.pendingSyncQueue || {};
    const keys = Object.keys(queue);
    if (keys.length === 0) return;

    const targetUrl = stored.workingServerUrl || stored.webhookUrl || `http://${FROZEN_SERVER_IP}:${PORT}/api/webhook`;
    for (const key of keys) {
      const item = queue[key];
      if (!item || !item.payload) {
        delete queue[key];
        continue;
      }
      const res = await postLeadDirect(targetUrl, item.payload, false);
      if (res && res.success) {
        delete queue[key];
      } else {
        break; // Server still unreachable; retry next cycle
      }
    }
    await chrome.storage.local.set({ pendingSyncQueue: queue });
  } catch (e) {
  } finally {
    isFlushingQueue = false;
  }
}

// 7. Fast Lead Dispatch with Self-Healing + Offline Queue Fallback
async function postLeadDirect(webhookUrl, payload, allowQueueOnFail = true) {
  const candidates = await getCandidateUrls(webhookUrl);

  const attemptPost = (url) =>
    new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);

      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
        .then(async (res) => {
          clearTimeout(timer);
          if (res.ok) {
            let data = {};
            try { data = await res.json(); } catch (e) {}
            chrome.storage.local.set({ workingServerUrl: url, lastConnectedAt: Date.now() });
            resolve({ success: true, url, data });
          } else {
            reject(new Error(`HTTP ${res.status}`));
          }
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });

  try {
    const winner = await Promise.any(candidates.map(attemptPost));
    // Trigger background flush of any older queued items
    setTimeout(flushPendingQueue, 500);
    return winner;
  } catch (err) {
    const discovered = await autoCatchServerUrl(webhookUrl);
    if (discovered && discovered.success && discovered.url) {
      try {
        const retryRes = await attemptPost(discovered.url);
        setTimeout(flushPendingQueue, 500);
        return retryRes;
      } catch (e) {}
    }

    if (allowQueueOnFail) {
      await enqueuePendingLead(payload);
    }

    return {
      success: false,
      queued: allowQueueOnFail,
      error: "Server temporarily unreachable — saved to local queue & will auto-sync as soon as CRM reconnects!"
    };
  }
}

// Background Alarms: Keep connection warm, sync known leads, and flush offline queue every 1 minute
try {
  chrome.alarms.create("CRM_HEARTBEAT", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "CRM_HEARTBEAT") {
      autoCatchServerUrl().then(() => flushPendingQueue());
    }
  });
} catch (e) {}

// Startup hook
autoCatchServerUrl().then(() => flushPendingQueue());

// Message Dispatcher
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  if (request.action === "SYNC_LEAD") {
    postLeadDirect(request.webhookUrl, request.payload, true)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "DISCOVER_SERVER") {
    autoCatchServerUrl(request.preferredUrl)
      .then(async (res) => {
        if (res && res.success) await flushPendingQueue();
        const stored = await chrome.storage.local.get(["pendingSyncQueue", "knownRecruiters"]);
        const queueCount = Object.keys(stored.pendingSyncQueue || {}).length;
        sendResponse({ ...res, queueCount, recruiters: stored.knownRecruiters || [] });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "FLUSH_QUEUE") {
    flushPendingQueue()
      .then(async () => {
        const stored = await chrome.storage.local.get(["pendingSyncQueue"]);
        sendResponse({ success: true, queueCount: Object.keys(stored.pendingSyncQueue || {}).length });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});
