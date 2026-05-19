(function () {
  "use strict";

  var SETTINGS_KEY = "ytRawVolumeSettings";
  var REFRESH_INTERVAL_MS = 500;
  var defaultSettings = {
    youtube: true,
    music: true,
  };

  var elements = {
    mediaText: document.getElementById("mediaText"),
    modeText: document.getElementById("modeText"),
    musicToggle: document.getElementById("musicToggle"),
    pageState: document.getElementById("pageState"),
    sliderText: document.getElementById("sliderText"),
    statusText: document.getElementById("statusText"),
    volumeText: document.getElementById("volumeText"),
    youtubeToggle: document.getElementById("youtubeToggle"),
  };

  var activeTab = null;
  var refreshSequence = 0;
  var refreshTimer = 0;
  var liveRefreshTimer = 0;
  var settings = Object.assign({}, defaultSettings);

  function normalizeSettings(value) {
    return {
      youtube: !value || value.youtube !== false,
      music: !value || value.music !== false,
    };
  }

  function storageGet() {
    return new Promise(function (resolve) {
      chrome.storage.sync.get(SETTINGS_KEY, function (items) {
        resolve(normalizeSettings(items[SETTINGS_KEY]));
      });
    });
  }

  function storageSet(nextSettings) {
    return new Promise(function (resolve) {
      chrome.storage.sync.set(
        {
          [SETTINGS_KEY]: normalizeSettings(nextSettings),
        },
        resolve
      );
    });
  }

  function queryActiveTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function requestStatus(tabId) {
    return new Promise(function (resolve) {
      if (!tabId) {
        resolve(null);
        return;
      }

      chrome.tabs.sendMessage(
        tabId,
        {
          source: "yt-raw-volume-popup",
          type: "get-status",
        },
        function (response) {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }

          resolve(response && response.status ? response.status : null);
        }
      );
    });
  }

  function siteKeyFromUrl(url) {
    try {
      var host = new URL(url).hostname;
      if (host === "music.youtube.com") return "music";
      if (host === "www.youtube.com") return "youtube";
      return null;
    } catch (error) {
      return null;
    }
  }

  function fallbackStatusFromTab(tab) {
    var key = tab && siteKeyFromUrl(tab.url);
    if (!key) return null;

    var enabled = settings[key] !== false;
    return {
      actualVolumePercent: null,
      enabled: enabled,
      host: new URL(tab.url).hostname,
      lastRestorePercent: null,
      loudnessDb: null,
      mediaCount: 0,
      mode: "-",
      normalizationFound: false,
      normalizedVolumePercent: null,
      patchedCount: 0,
      reason: enabled ? "waiting-for-media" : "domain-disabled",
      settingKey: key,
      sliderFound: false,
      supported: true,
      volumePercent: null,
      active: false,
    };
  }

  function statusLabel(status) {
    if (!status) return { text: "対象外", className: "off" };
    if (!status.supported) return { text: "対象外", className: "off" };
    if (!status.enabled) return { text: "OFF", className: "off" };
    if (status.active) return { text: "ON", className: "active" };
    return { text: "待機中", className: "pending" };
  }

  function reasonText(status) {
    if (!status) return "このページでは未使用";
    if (!status.supported) return "対象外ページ";
    if (!status.enabled) return "ドメイン設定で無効";
    if (status.active) return "このページで有効";
    if (status.reason === "waiting-for-media") return "Media 待機中";
    if (status.reason === "waiting-for-slider") return "Slider 待機中";
    return "適用待機中";
  }

  function volumeText(status) {
    if (!status || status.volumePercent === null) return "-";
    var text = status.volumePercent + "%";

    if (
      status.actualVolumePercent !== null &&
      status.actualVolumePercent !== status.volumePercent
    ) {
      text += " / 実音量 " + status.actualVolumePercent + "%";
    }

    if (status.lastRestorePercent !== null && !status.enabled) {
      text += " / 復帰 " + status.lastRestorePercent + "%";
    }

    return text;
  }

  function render(status) {
    elements.youtubeToggle.checked = settings.youtube;
    elements.musicToggle.checked = settings.music;

    var label = statusLabel(status);
    elements.pageState.textContent = label.text;
    elements.pageState.className = label.className;
    elements.statusText.textContent = reasonText(status);

    elements.modeText.textContent = status && status.mode ? status.mode : "-";
    elements.volumeText.textContent = volumeText(status);
    elements.mediaText.textContent = status
      ? status.patchedCount + " / " + status.mediaCount
      : "-";
    elements.sliderText.textContent = status
      ? status.sliderFound
        ? "検出"
        : "未検出"
      : "-";
  }

  function scheduleRefresh(delay) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = 0;
      refreshStatus();
    }, delay);
  }

  function refreshStatus() {
    var sequence = ++refreshSequence;

    queryActiveTab().then(function (tab) {
      if (sequence !== refreshSequence) return;

      activeTab = tab;
      requestStatus(tab && tab.id).then(function (status) {
        if (sequence !== refreshSequence) return;
        render(status || fallbackStatusFromTab(tab));
      });
    });
  }

  function updateSetting(key, value) {
    settings[key] = value;
    render(fallbackStatusFromTab(activeTab));

    storageSet(settings).then(function () {
      scheduleRefresh(140);
    });
  }

  function bindEvents() {
    elements.youtubeToggle.addEventListener("change", function () {
      updateSetting("youtube", elements.youtubeToggle.checked);
    });

    elements.musicToggle.addEventListener("change", function () {
      updateSetting("music", elements.musicToggle.checked);
    });

    if (chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
        if (!activeTab || tabId !== activeTab.id) return;
        if (!changeInfo.status && !changeInfo.url) return;

        scheduleRefresh(changeInfo.status === "complete" ? 50 : 250);
      });
    }
  }

  function init() {
    bindEvents();

    Promise.all([storageGet(), queryActiveTab()]).then(function (result) {
      settings = result[0];
      activeTab = result[1];
      render(fallbackStatusFromTab(activeTab));
      refreshStatus();
      liveRefreshTimer = setInterval(refreshStatus, REFRESH_INTERVAL_MS);
    });
  }

  window.addEventListener("unload", function () {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (liveRefreshTimer) clearInterval(liveRefreshTimer);
  });

  init();
})();
