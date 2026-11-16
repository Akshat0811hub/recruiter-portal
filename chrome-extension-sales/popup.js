document.addEventListener("DOMContentLoaded", () => {
  const recruiterInput = document.getElementById("recruiterName");
  const webhookInput = document.getElementById("webhookUrl");
  const saveBtn = document.getElementById("saveBtn");
  const forceScanBtn = document.getElementById("forceScanBtn");
  const connPill = document.getElementById("connPill");
  const serverInfoText = document.getElementById("serverInfoText");
  const queueRow = document.getElementById("queueRow");
  const queueCountText = document.getElementById("queueCountText");
  const toggleSettingsBtn = document.getElementById("toggleSettingsBtn");
  const settingsBox = document.getElementById("settingsBox");
  const heroIconWrap = document.getElementById("heroIconWrap");
  const heroTitle = document.getElementById("heroTitle");
  const heroSub = document.getElementById("heroSub");
  const latencyVal = document.getElementById("latencyVal");
  const activeSalesVal = document.getElementById("activeSalesVal");

  const DEFAULT_URL = "http://localhost:3000/api/sales/webhook";

  toggleSettingsBtn.addEventListener("click", () => {
    const isOpen = settingsBox.classList.toggle("open");
    toggleSettingsBtn.querySelector("span").textContent = isOpen
      ? "⚙️ Hide Salesperson Profile ▴"
      : "⚙️ Select Salesperson Profile & Server ▾";
  });

  chrome.storage.local.get(
    ["recruiterName", "webhookUrl", "workingServerUrl", "lastLatencyMs"],
    (res) => {
      const salesPerson = res.recruiterName || "Jinendra";
      recruiterInput.value = salesPerson;
      activeSalesVal.textContent = salesPerson;
      let activeUrl = res.webhookUrl || res.workingServerUrl || DEFAULT_URL;
      if (activeUrl.includes("192.168.1.34")) {
        activeUrl = DEFAULT_URL;
      }
      webhookInput.value = activeUrl;
      if (res.lastLatencyMs) {
        latencyVal.textContent = `${res.lastLatencyMs}ms`;
      }
      verifyServer(activeUrl);
    }
  );

  function setOnlineState(isOnline, res) {
    if (isOnline) {
      connPill.textContent = "Connected · Live";
      connPill.className = "badge-conn";
      heroIconWrap.textContent = "⚡";
      heroIconWrap.className = "hero-icon-wrap";
      heroTitle.textContent = "Millisecond Sync Active";
      heroTitle.style.color = "#f8fafc";
      heroSub.textContent = "Capturing 100% of post-install WhatsApp & Email messages in real time.";
      if (res && res.info && res.info.ip && res.info.port) {
        serverInfoText.textContent = `${res.info.ip}:${res.info.port}`;
      }
      if (res && res.latencyMs) {
        latencyVal.textContent = `${res.latencyMs}ms`;
      }
    } else {
      connPill.textContent = "Offline · Queuing";
      connPill.className = "badge-conn badge-offline";
      heroIconWrap.textContent = "!";
      heroIconWrap.className = "hero-icon-wrap offline";
      heroTitle.textContent = "CRM Offline · Safe Queuing";
      heroTitle.style.color = "#f87171";
      heroSub.textContent = "Every WhatsApp & Email message is queued locally and will auto-sync on reconnect.";
    }
  }

  async function verifyServer(urlToTest) {
    connPill.textContent = "Checking...";
    connPill.className = "badge-conn";

    let directOk = false;
    try {
      const u = new URL(urlToTest || DEFAULT_URL);
      const pingUrl = `${u.protocol}//${u.host}/api/ping`;
      const t0 = Date.now();
      const directRes = await fetch(pingUrl, { signal: AbortSignal.timeout(1500) });
      if (directRes.ok) {
        const info = await directRes.json();
        const latencyMs = Math.max(1, Date.now() - t0);
        directOk = true;
        setOnlineState(true, { info, latencyMs, url: urlToTest });
        chrome.storage.local.set({ webhookUrl: urlToTest, workingServerUrl: urlToTest, lastLatencyMs: latencyMs });
      }
    } catch (e) {
      console.warn("Direct popup ping failed:", e);
    }

    chrome.runtime.sendMessage(
      { action: "DISCOVER_SERVER", preferredUrl: urlToTest },
      (res) => {
        if (chrome.runtime.lastError) {
          if (!directOk) setOnlineState(false, null);
          return;
        }
        const ok = res && res.success;
        if (ok) {
          setOnlineState(true, res);
          if (res.url) {
            webhookInput.value = res.url;
            chrome.storage.local.set({ webhookUrl: res.url, workingServerUrl: res.url });
          }
        } else if (!directOk) {
          setOnlineState(false, res);
        }

        if (res && res.queueCount > 0) {
          queueRow.style.display = "flex";
          queueCountText.textContent = `${res.queueCount} pending`;
        } else {
          queueRow.style.display = "none";
        }
      }
    );
  }

  forceScanBtn.addEventListener("click", () => {
    forceScanBtn.textContent = "⚡ Scanning WhatsApp & Gmail...";
    chrome.runtime.sendMessage({ action: "FORCE_SCAN_NOW" }, () => {
      setTimeout(() => {
        forceScanBtn.textContent = "✓ Synced Active Conversations!";
        setTimeout(() => {
          forceScanBtn.textContent = "⚡ Instant Sync Active Tab Now";
        }, 1600);
      }, 250);
    });
  });

  saveBtn.addEventListener("click", () => {
    const recruiterName = recruiterInput.value.trim() || "Jinendra";
    const webhookUrl = webhookInput.value.trim() || DEFAULT_URL;
    activeSalesVal.textContent = recruiterName;

    chrome.storage.local.set(
      { recruiterName, webhookUrl, workingServerUrl: webhookUrl },
      () => {
        saveBtn.textContent = `✓ Saved (${recruiterName})`;
        setTimeout(() => { saveBtn.textContent = "Save Salesperson Profile"; }, 2200);
        verifyServer(webhookUrl);
      }
    );
  });
});
