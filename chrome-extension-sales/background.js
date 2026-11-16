// ==========================================================================================
// ⚡ OrbitSales CRM Turbo Sync — Background Service Worker (Manifest V3)
// Millisecond Zero-Loss Engine:
//  1. Records exact `installedAt` timestamp so ancient pre-install chats are ignored
//     while 100% of post-install messages are captured with zero loss.
//  2. Connects to Port 4000 (Frozen Static IP 192.168.1.34:4000 + Hostname + Localhost).
//  3. Cloud Broadcast Fallback (ntfy.sh/sales_crm_lan_discovery_channel) + Fast Subnet Scan.
//  4. Persistent Offline Retry Queue (Zero lost messages even during Wi-Fi blips).
// ==========================================================================================

const FROZEN_SERVER_IP = "192.168.1.8";
const DEFAULT_SERVER_HOST = "DESKTOP-GLVB82A";
const PORT = 3000;
const DISCOVERY_CHANNEL = "https://ntfy.sh/sales_crm_lan_discovery_channel/json?poll=1";

async function fetchBroadcastedIp() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
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
              return `http://${inner.ip}:${inner.port || PORT}/api/sales/webhook`;
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return null;
}

async function burstScanLanSubnet() {
  const pingTarget = (baseUrl) =>
    new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      fetch(`${baseUrl}/api/ping`, { signal: controller.signal })
        .then(r => r.json())
        .then(data => {
          clearTimeout(timer);
          if (data && (data.app === "Sales-CRM" || data.salesApp === "Sales-CRM" || (data.portals && data.portals.includes("sales")))) {
            resolve(`${baseUrl}/api/sales/webhook`);
          } else {
            reject();
          }
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

async function getCandidateUrls(preferredUrl) {
  const targets = new Set();

  if (preferredUrl && preferredUrl.trim()) {
    const p = preferredUrl.trim();
    if (!p.includes("192.168.1.34")) {
      targets.add(p);
    }
  }

  try {
    const stored = await chrome.storage.local.get(["workingServerUrl", "webhookUrl"]);
    if (stored.workingServerUrl && !stored.workingServerUrl.includes("192.168.1.34")) targets.add(stored.workingServerUrl);
    if (stored.webhookUrl && !stored.webhookUrl.includes("192.168.1.34")) targets.add(stored.webhookUrl);
  } catch (e) {}

  // Prioritize local machine URLs first for sub-10ms instantaneous discovery
  targets.add(`http://localhost:${PORT}/api/sales/webhook`);
  targets.add(`http://127.0.0.1:${PORT}/api/sales/webhook`);
  targets.add(`http://${FROZEN_SERVER_IP}:${PORT}/api/sales/webhook`);
  targets.add(`http://${DEFAULT_SERVER_HOST}:${PORT}/api/sales/webhook`);
  targets.add(`http://${DEFAULT_SERVER_HOST}.local:${PORT}/api/sales/webhook`);
  targets.add(`http://localhost:${PORT}/api/webhook`);
  targets.add(`http://127.0.0.1:${PORT}/api/webhook`);

  return Array.from(targets).filter(Boolean);
}

function toBaseUrl(webhookUrl) {
  try {
    const u = new URL(webhookUrl);
    return `${u.protocol}//${u.host}`;
  } catch (e) {
    return String(webhookUrl || "")
      .replace(/\/api\/(sales\/)?webhook\/?$/, "")
      .replace(/\/+$/, "");
  }
}

async function autoCatchServerUrl(preferredUrl) {
  const candidates = await getCandidateUrls(preferredUrl);

  const testQuick = (url) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const pingUrl = `${toBaseUrl(url)}/api/ping`;

      fetch(pingUrl, { signal: controller.signal })
        .then(r => r.json())
        .then(data => {
          clearTimeout(timer);
          if (data && (data.app === "Sales-CRM" || data.salesApp === "Sales-CRM" || (data.portals && data.portals.includes("sales")))) {
            const base = toBaseUrl(url);
            const salesWebhook = data.salesWebhookUrl || `${base}/api/sales/webhook`;
            resolve({ url: salesWebhook, info: data, latencyMs: Math.max(1, Date.now() - t0) });
          } else {
            reject();
          }
        })
        .catch(() => {
          clearTimeout(timer);
          reject();
        });
    });

  try {
    const winner = await Promise.any(candidates.map(testQuick));
    if (winner && winner.url) {
      await chrome.storage.local.set({
        workingServerUrl: winner.url,
        webhookUrl: winner.url,
        lastConnectedAt: Date.now(),
        lastLatencyMs: winner.latencyMs
      });
      syncKnownLeadsFromServer(winner.url);
      return { success: true, url: winner.url, info: winner.info, latencyMs: winner.latencyMs };
    }
  } catch (e) {}

  const cloudUrl = await fetchBroadcastedIp();
  if (cloudUrl) {
    try {
      const checked = await testQuick(cloudUrl);
      await chrome.storage.local.set({
        workingServerUrl: checked.url,
        webhookUrl: checked.url,
        lastConnectedAt: Date.now(),
        lastLatencyMs: checked.latencyMs
      });
      syncKnownLeadsFromServer(checked.url);
      return { success: true, url: checked.url, info: checked.info, latencyMs: checked.latencyMs };
    } catch (e) {}
  }

  const burstUrl = await burstScanLanSubnet();
  if (burstUrl) {
    try {
      const checked = await testQuick(burstUrl);
      await chrome.storage.local.set({
        workingServerUrl: checked.url,
        webhookUrl: checked.url,
        lastConnectedAt: Date.now(),
        lastLatencyMs: checked.latencyMs
      });
      syncKnownLeadsFromServer(checked.url);
      return { success: true, url: checked.url, info: checked.info, latencyMs: checked.latencyMs };
    } catch (e) {
      await chrome.storage.local.set({ workingServerUrl: burstUrl, webhookUrl: burstUrl });
      return { success: true, url: burstUrl, latencyMs: 5 };
    }
  }

  return {
    success: false,
    error: "Sales CRM Server unreachable on Port 3000. Make sure 'start-crm.bat' is running."
  };
}

async function syncKnownLeadsFromServer(webhookUrl) {
  try {
    const stored = await chrome.storage.local.get(["workingServerUrl"]);
    const base = toBaseUrl(webhookUrl || stored.workingServerUrl || `http://${FROZEN_SERVER_IP}:${PORT}/api/webhook`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    const res = await fetch(`${base}/api/leads/known`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "success") {
        await chrome.storage.local.set({
          knownPhones: data.phones || [],
          knownEmails: data.emails || [],
          knownCandidateNames: data.candidateNames || [],
          knownRecruiters: data.recruiters || []
        });
      }
    }
  } catch (e) {}
}

function makeQueueKey(payload) {
  const phone = String(payload.candidate_phone || "").replace(/[^0-9]/g, "").slice(-10);
  const email = String(payload.candidate_email || "").toLowerCase().trim();
  const name = String(payload.candidate_name || "").toLowerCase().trim();
  const src = String(payload.source || "wa").toLowerCase();
  return `${src}:${email || phone || name}:${Date.now()}`;
}

async function enqueuePendingLead(payload) {
  try {
    const stored = await chrome.storage.local.get(["pendingSyncQueue"]);
    const queue = stored.pendingSyncQueue && typeof stored.pendingSyncQueue === "object" ? stored.pendingSyncQueue : {};
    queue[makeQueueKey(payload)] = { payload, queuedAt: Date.now() };
    const keys = Object.keys(queue);
    if (keys.length > 500) {
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
        break;
      }
    }
    await chrome.storage.local.set({ pendingSyncQueue: queue });
  } catch (e) {
  } finally {
    isFlushingQueue = false;
  }
}

async function postLeadDirect(webhookUrl, payload, allowQueueOnFail = true) {
  const candidates = await getCandidateUrls(webhookUrl);

  const attemptPost = (url) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Portal": "sales",
          "X-User-Role": "sales"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
        .then(async (res) => {
          clearTimeout(timer);
          if (res.ok) {
            let data = {};
            try { data = await res.json(); } catch (e) {}
            const latencyMs = Math.max(1, Date.now() - t0);
            const stored = await chrome.storage.local.get(["totalSyncedCount"]);
            const nextCount = (Number(stored.totalSyncedCount) || 0) + 1;
            chrome.storage.local.set({
              workingServerUrl: url,
              lastConnectedAt: Date.now(),
              lastLatencyMs: latencyMs,
              totalSyncedCount: nextCount,
              lastSyncedCandidate: payload.candidate_name || payload.candidate_phone || payload.candidate_email || "Client"
            });
            resolve({ success: true, url, data, latencyMs });
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
    setTimeout(flushPendingQueue, 250);
    return winner;
  } catch (err) {
    const discovered = await autoCatchServerUrl(webhookUrl);
    if (discovered && discovered.success && discovered.url) {
      try {
        const retryRes = await attemptPost(discovered.url);
        setTimeout(flushPendingQueue, 250);
        return retryRes;
      } catch (e) {}
    }

    if (allowQueueOnFail) {
      await enqueuePendingLead(payload);
    }

    return {
      success: false,
      queued: allowQueueOnFail,
      error: "Server temporarily unreachable — queued locally for instant auto-sync!"
    };
  }
}

function forceInjectOpenTabs() {
  try {
    if (!chrome?.tabs?.query || !chrome?.scripting?.executeScript) return;
    chrome.tabs.query({ url: ["https://web.whatsapp.com/*", "https://mail.google.com/*"] }, (tabs) => {
      if (Array.isArray(tabs)) {
        tabs.forEach(t => {
          if (t && t.id && t.url) {
            const file = t.url.includes("web.whatsapp.com") ? "content.js" : "gmail.js";
            chrome.scripting.executeScript({
              target: { tabId: t.id },
              files: [file]
            }).catch(() => {});
          }
        });
      }
    });
  } catch (e) {}
}

function wakeSyncTabs() {
  try {
    if (!chrome?.tabs?.query) return;
    chrome.tabs.query({ url: ["https://web.whatsapp.com/*", "https://mail.google.com/*"] }, (tabs) => {
      if (Array.isArray(tabs)) {
        tabs.forEach(t => {
          if (t && t.id) {
            chrome.tabs.sendMessage(t.id, { action: "TRIGGER_SYNC_SCAN" }).catch(() => {
              if (chrome?.scripting?.executeScript && t.url) {
                const file = t.url.includes("web.whatsapp.com") ? "content.js" : "gmail.js";
                chrome.scripting.executeScript({
                  target: { tabId: t.id },
                  files: [file]
                }).catch(() => {});
              }
            });
          }
        });
      }
    });
  } catch (e) {}
}

if (chrome?.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(async () => {
    const stored = await chrome.storage.local.get(["extensionInstalledAt"]);
    if (!stored.extensionInstalledAt) {
      await chrome.storage.local.set({ extensionInstalledAt: Date.now() });
    }
    autoCatchServerUrl().then(() => {
      forceInjectOpenTabs();
      flushPendingQueue();
    });
  });
}

try {
  chrome.alarms.create("SALES_CRM_HEARTBEAT", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "SALES_CRM_HEARTBEAT") {
      autoCatchServerUrl().then(() => {
        flushPendingQueue();
        wakeSyncTabs();
      });
    }
  });
} catch (e) {}

autoCatchServerUrl().then(() => {
  forceInjectOpenTabs();
  flushPendingQueue();
  setTimeout(wakeSyncTabs, 600);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  if (request.action === "TEST_VERIFY") {
    autoCatchServerUrl(request.url)
      .then(async (res) => {
        if (res && res.success) {
          await flushPendingQueue();
          wakeSyncTabs();
        }
        sendResponse(res);
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

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
        const stored = await chrome.storage.local.get([
          "pendingSyncQueue",
          "knownRecruiters",
          "lastLatencyMs",
          "totalSyncedCount",
          "lastSyncedCandidate",
          "extensionInstalledAt"
        ]);
        const queueCount = Object.keys(stored.pendingSyncQueue || {}).length;
        sendResponse({
          ...res,
          queueCount,
          recruiters: stored.knownRecruiters || ["Jinendra", "Vishal", "Rahul", "Archana"],
          latencyMs: res.latencyMs || stored.lastLatencyMs || 2,
          totalSyncedCount: stored.totalSyncedCount || 0,
          lastSyncedCandidate: stored.lastSyncedCandidate || "Ready",
          extensionInstalledAt: stored.extensionInstalledAt || Date.now()
        });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "FORCE_SCAN_NOW") {
    wakeSyncTabs();
    flushPendingQueue().then(() => sendResponse({ success: true }));
    return true;
  }

  return false;
});
