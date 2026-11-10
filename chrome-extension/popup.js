document.addEventListener("DOMContentLoaded", () => {
  const recruiterInput = document.getElementById("recruiterName");
  const recruiterDatalist = document.getElementById("recruiterList");
  const webhookInput = document.getElementById("webhookUrl");
  const saveBtn = document.getElementById("saveBtn");
  const connPill = document.getElementById("connPill");
  const serverInfoText = document.getElementById("serverInfoText");
  const queueRow = document.getElementById("queueRow");
  const queueCountText = document.getElementById("queueCountText");
  const toggleSettingsBtn = document.getElementById("toggleSettingsBtn");
  const settingsBox = document.getElementById("settingsBox");
  const heroIconWrap = document.getElementById("heroIconWrap");
  const heroTitle = document.getElementById("heroTitle");
  const heroSub = document.getElementById("heroSub");

  const DEFAULT_URL = "http://192.168.1.34:3000/api/webhook";

  // Toggle settings panel
  toggleSettingsBtn.addEventListener("click", () => {
    const isOpen = settingsBox.classList.toggle("open");
    toggleSettingsBtn.querySelector("span").textContent = isOpen
      ? "⚙️ Hide Preferences ▴"
      : "⚙️ Preferences & Recruiter Profile ▾";
  });

  // Load saved preferences
  chrome.storage.local.get(
    ["recruiterName", "webhookUrl", "workingServerUrl", "knownRecruiters"],
    (res) => {
      recruiterInput.value = res.recruiterName || "Suhani Sisodiya";
      const activeUrl = res.webhookUrl || res.workingServerUrl || DEFAULT_URL;
      webhookInput.value = activeUrl;

      if (Array.isArray(res.knownRecruiters) && res.knownRecruiters.length > 0) {
        populateRecruiters(res.knownRecruiters);
      }

      verifyServer(activeUrl);
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

  function setOnlineState(isOnline, info) {
    if (isOnline) {
      connPill.textContent = "Connected";
      connPill.className = "badge-conn";
      heroIconWrap.textContent = "✓";
      heroIconWrap.className = "hero-icon-wrap";
      heroTitle.textContent = "Working Properly";
      heroTitle.style.color = "#0f172a";
      heroSub.textContent = "WhatsApp Web & Gmail sync are actively streaming conversations to CRM.";
      if (info && info.ip && info.port) {
        serverInfoText.textContent = `${info.ip}:${info.port}`;
      }
    } else {
      connPill.textContent = "Offline · Queuing";
      connPill.className = "badge-conn badge-offline";
      heroIconWrap.textContent = "!";
      heroIconWrap.className = "hero-icon-wrap offline";
      heroTitle.textContent = "CRM Offline · Safe Queuing";
      heroTitle.style.color = "#dc2626";
      heroSub.textContent = "Chats and emails will queue locally and auto-sync the moment CRM reconnects.";
    }
  }

  function verifyServer(urlToTest, onComplete) {
    connPill.textContent = "Checking...";
    connPill.className = "badge-conn";

    chrome.runtime.sendMessage(
      { action: "DISCOVER_SERVER", preferredUrl: urlToTest },
      (res) => {
        const ok = res && res.success;
        setOnlineState(ok, res?.info);

        if (ok) {
          if (res.url) {
            webhookInput.value = res.url;
            chrome.storage.local.set({ webhookUrl: res.url, workingServerUrl: res.url });
          }
          if (Array.isArray(res.recruiters) && res.recruiters.length > 0) {
            populateRecruiters(res.recruiters);
          }
        }

        if (res && res.queueCount > 0) {
          queueRow.style.display = "flex";
          queueCountText.textContent = `${res.queueCount} pending`;
        } else {
          queueRow.style.display = "none";
        }

        if (typeof onComplete === "function") onComplete(ok, res);
      }
    );
  }

  // Save Preferences
  saveBtn.addEventListener("click", () => {
    const recruiterName = recruiterInput.value.trim() || "Suhani Sisodiya";
    const webhookUrl = webhookInput.value.trim() || DEFAULT_URL;

    chrome.storage.local.set(
      { recruiterName, webhookUrl, workingServerUrl: webhookUrl },
      () => {
        saveBtn.textContent = `✓ Saved (${recruiterName})`;
        setTimeout(() => { saveBtn.textContent = "Save Settings"; }, 2500);
        verifyServer(webhookUrl);
      }
    );
  });
});
