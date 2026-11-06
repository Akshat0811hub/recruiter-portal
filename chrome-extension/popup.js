document.addEventListener("DOMContentLoaded", () => {
  const recruiterInput = document.getElementById("recruiterName");
  const recruiterDatalist = document.getElementById("recruiterList");
  const webhookInput = document.getElementById("webhookUrl");
  const autoSyncInput = document.getElementById("autoSync");
  const stealthModeInput = document.getElementById("stealthMode");
  const saveBtn = document.getElementById("saveBtn");
  const detectBtn = document.getElementById("detectBtn");
  const statusDiv = document.getElementById("status");
  const connPill = document.getElementById("connPill");
  const serverInfoText = document.getElementById("serverInfoText");
  const queueRow = document.getElementById("queueRow");
  const queueCountText = document.getElementById("queueCountText");

  const DEFAULT_URL = "http://192.168.1.34:3000/api/webhook";

  chrome.storage.local.get(
    ["recruiterName", "webhookUrl", "workingServerUrl", "autoSync", "stealthMode", "knownRecruiters"],
    (res) => {
      recruiterInput.value = res.recruiterName || "Suhani";
      const activeUrl = res.webhookUrl || res.workingServerUrl || DEFAULT_URL;
      webhookInput.value = activeUrl;
      autoSyncInput.checked = res.autoSync !== undefined ? res.autoSync : true;
      stealthModeInput.checked = res.stealthMode !== undefined ? res.stealthMode : false;

      if (Array.isArray(res.knownRecruiters) && res.knownRecruiters.length > 0) {
        populateRecruiters(res.knownRecruiters);
      }

      verifyServerConnection(activeUrl);
    }
  );

  function populateRecruiters(names) {
    recruiterDatalist.innerHTML = "";
    names.forEach(n => {
      const opt = document.createElement("option");
      opt.value = n;
      recruiterDatalist.appendChild(opt);
    });
  }

  function verifyServerConnection(urlToTest) {
    connPill.textContent = "Checking...";
    connPill.className = "badge-conn";
    chrome.runtime.sendMessage(
      { action: "DISCOVER_SERVER", preferredUrl: urlToTest },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          connPill.textContent = "Offline · Queuing";
          connPill.className = "badge-conn badge-offline";
          showStatus("Server unreachable. Updates will queue automatically.", "#dc2626");
          return;
        }
        connPill.textContent = "Connected";
        connPill.className = "badge-conn";
        if (res.url) {
          webhookInput.value = res.url;
          chrome.storage.local.set({ webhookUrl: res.url, workingServerUrl: res.url });
        }
        if (res.info) {
          serverInfoText.textContent = `${res.info.ip}:${res.info.port}`;
        }
        if (Array.isArray(res.recruiters) && res.recruiters.length > 0) {
          populateRecruiters(res.recruiters);
        }
        if (res.queueCount > 0) {
          queueRow.style.display = "flex";
          queueCountText.textContent = String(res.queueCount);
        } else {
          queueRow.style.display = "none";
        }
      }
    );
  }

  detectBtn.addEventListener("click", () => {
    showStatus("Verifying endpoint...", "#4f46e5");
    verifyServerConnection(webhookInput.value.trim() || DEFAULT_URL);
  });

  saveBtn.addEventListener("click", () => {
    const recruiterName = recruiterInput.value.trim() || "Suhani";
    const webhookUrl = webhookInput.value.trim() || DEFAULT_URL;
    const autoSync = autoSyncInput.checked;
    const stealthMode = stealthModeInput.checked;

    chrome.storage.local.set(
      { recruiterName, webhookUrl, workingServerUrl: webhookUrl, autoSync, stealthMode },
      () => {
        showStatus(`Preferences saved (${recruiterName})`, "#047857");
        verifyServerConnection(webhookUrl);
      }
    );
  });

  function showStatus(text, color) {
    statusDiv.textContent = text;
    statusDiv.style.color = color;
    setTimeout(() => {
      if (statusDiv.textContent === text) statusDiv.textContent = "";
    }, 4500);
  }
});
