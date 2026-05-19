(function () {
  "use strict";

  var SETTINGS_KEY = "ytRawVolumeSettings";
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

    if (!status.normalizationFound) {
      text += " / 正規化 未取得";
    } else if (
      status.normalizedVolumePercent !== null &&
      status.normalizedVolumePercent !== status.volumePercent
    ) {
      text += " / 正規化 " + status.normalizedVolumePercent + "%";
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

  function refreshSoon() {
    setTimeout(refreshStatus, 140);
  }

  function refreshStatus() {
    requestStatus(activeTab && activeTab.id).then(render);
  }

  function updateSetting(key, value) {
    settings[key] = value;
    render(null);

    storageSet(settings).then(refreshSoon);
  }

  function bindEvents() {
    elements.youtubeToggle.addEventListener("change", function () {
      updateSetting("youtube", elements.youtubeToggle.checked);
    });

    elements.musicToggle.addEventListener("change", function () {
      updateSetting("music", elements.musicToggle.checked);
    });
  }

  function init() {
    bindEvents();

    Promise.all([storageGet(), queryActiveTab()]).then(function (result) {
      settings = result[0];
      activeTab = result[1];
      render(null);
      refreshStatus();
    });
  }

  init();
})();
