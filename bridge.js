/**
 * Isolated-world bridge for popup settings and page-world status.
 */
(function () {
  "use strict";

  var SETTINGS_KEY = "ytRawVolumeSettings";
  var MESSAGE_SOURCE = "yt-raw-volume-bridge";
  var STATUS_SOURCE = "yt-raw-volume-page";

  var defaultSettings = {
    youtube: true,
    music: true,
  };

  var lastStatus = null;
  var currentSettings = normalizeSettings(defaultSettings);

  function isTopFrame() {
    try {
      return window.top === window;
    } catch (error) {
      return false;
    }
  }

  function normalizeSettings(value) {
    return {
      youtube: !value || value.youtube !== false,
      music: !value || value.music !== false,
    };
  }

  function siteKey() {
    if (location.hostname === "music.youtube.com") return "music";
    if (location.hostname === "www.youtube.com") return "youtube";
    return null;
  }

  function mediaElements() {
    return Array.prototype.slice.call(document.querySelectorAll("audio, video"));
  }

  function youtubeSlider(media) {
    var player = media && media.closest(".html5-video-player");
    return (
      player &&
      player.querySelector('.ytp-volume-panel[role="slider"][aria-valuenow]')
    );
  }

  function musicSlider() {
    return (
      document.querySelector(
        'ytmusic-player-bar #volume-slider[role="slider"][aria-valuenow]'
      ) ||
      document.querySelector(
        "ytmusic-player-bar #volume-slider #sliderBar[aria-valuenow]"
      )
    );
  }

  function sliderVolume(slider) {
    var raw = slider && slider.getAttribute("aria-valuenow");
    if (raw === null) return null;

    var volume = Number(raw) / 100;
    if (!Number.isFinite(volume)) return null;
    if (volume < 0) return 0;
    if (volume > 1) return 1;
    return volume;
  }

  function primaryMedia(media) {
    for (var i = 0; i < media.length; i++) {
      if (!media[i].paused) return media[i];
    }
    return media[0] || null;
  }

  function modeLabel(media) {
    if (!media) return "未検出";
    if (siteKey() === "music") {
      return media.tagName === "VIDEO" && media.videoWidth > 0
        ? "YouTube Music 動画"
        : "YouTube Music 音声のみ";
    }
    return media.tagName === "VIDEO" && media.videoWidth > 0
      ? "YouTube 動画"
      : "YouTube 音声のみ";
  }

  function fallbackStatus() {
    var key = siteKey();
    var media = mediaElements();
    var mainMedia = primaryMedia(media);
    var slider = youtubeSlider(mainMedia) || musicSlider();
    var sliderVol = sliderVolume(slider);
    var enabled = !!key && currentSettings[key] !== false;
    var active = enabled && media.length > 0 && !!slider;
    var reason = "active";

    if (!key) reason = "unsupported";
    else if (!enabled) reason = "domain-disabled";
    else if (!media.length) reason = "waiting-for-media";
    else if (!slider) reason = "waiting-for-slider";

    return {
      actualVolumePercent:
        mainMedia && Number.isFinite(mainMedia.volume)
          ? Math.round(mainMedia.volume * 100)
          : null,
      enabled: enabled,
      host: location.hostname,
      lastRestorePercent: null,
      loudnessDb: null,
      mediaCount: media.length,
      mode: modeLabel(mainMedia),
      normalizationFound: false,
      normalizedVolumePercent: null,
      patchedCount: active ? media.length : 0,
      reason: reason,
      settingKey: key,
      sliderFound: !!slider,
      supported: !!key,
      volumePercent: sliderVol === null ? null : Math.round(sliderVol * 100),
      active: active,
    };
  }

  function postToPage(message) {
    window.postMessage(
      Object.assign(
        {
          source: MESSAGE_SOURCE,
        },
        message
      ),
      "*"
    );
  }

  function postSettings(settings, reloadOnDisable) {
    currentSettings = normalizeSettings(settings);
    postToPage({
      type: "settings",
      reloadOnDisable: reloadOnDisable === true,
      settings: currentSettings,
    });
  }

  function loadSettings() {
    chrome.storage.sync.get(SETTINGS_KEY, function (items) {
      postSettings(items[SETTINGS_KEY] || defaultSettings, false);
    });
  }

  function requestStatus() {
    postToPage({
      type: "request-status",
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;

    var message = event.data;
    if (!message || message.source !== STATUS_SOURCE || message.type !== "status") {
      return;
    }

    lastStatus = message.status || null;
  });

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "sync" || !changes[SETTINGS_KEY]) return;
    postSettings(changes[SETTINGS_KEY].newValue || defaultSettings, true);
    requestStatus();
  });

  if (isTopFrame()) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || message.source !== "yt-raw-volume-popup") return false;
      if (message.type !== "get-status") return false;

      requestStatus();
      setTimeout(function () {
        sendResponse({ status: lastStatus || fallbackStatus() });
      }, 80);

      return true;
    });
  }

  loadSettings();
  setTimeout(loadSettings, 0);
  document.addEventListener("DOMContentLoaded", loadSettings, { once: true });
})();
