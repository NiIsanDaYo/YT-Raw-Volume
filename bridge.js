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
    var reel = media && media.closest("ytd-reel-video-renderer");
    var shortsSlider =
      reel &&
      reel.querySelector(
        'input#volume-input[role="slider"], input.ytdVolumeControlsNativeSlider'
      );
    if (reel) return shortsSlider || null;

    var player = media && media.closest(".html5-video-player");
    return (
      player &&
      player.querySelector('.ytp-volume-panel[role="slider"]')
    );
  }

  function musicSlider() {
    return (
      document.querySelector(
        'ytmusic-player-bar #volume-slider[role="slider"]'
      ) ||
      document.querySelector("ytmusic-player-bar #volume-slider #sliderBar")
    );
  }

  function volumeFromPercent(value, max) {
    var volume = Number(value);
    if (!Number.isFinite(volume)) return null;

    max = Number(max);
    if (!Number.isFinite(max) || max <= 0) max = 100;
    volume = volume / max;
    if (volume < 0) return 0;
    if (volume > 1) return 1;
    return volume;
  }

  function sliderVolume(slider) {
    if (!slider) return null;

    if (slider.value !== undefined && slider.value !== "") {
      var fromValue = volumeFromPercent(
        slider.value,
        slider.max ||
          slider.getAttribute("max") ||
          slider.getAttribute("aria-valuemax") ||
          100
      );
      if (fromValue !== null) return fromValue;
    }

    var raw = slider.getAttribute("aria-valuenow");
    if (raw === null) return null;
    return volumeFromPercent(raw, slider.getAttribute("aria-valuemax") || 100);
  }

  function primaryMedia(media) {
    for (var i = 0; i < media.length; i++) {
      if (!media[i].paused) return media[i];
    }
    return media[0] || null;
  }

  function playerFor(media) {
    return (
      (media && media.closest(".html5-video-player")) ||
      document.getElementById("movie_player")
    );
  }

  function currentMuted(media) {
    var player = playerFor(media);
    return !!(
      (media && media.muted) ||
      (player && player.classList && player.classList.contains("ytp-muted"))
    );
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
    var muted = currentMuted(mainMedia);
    var displayVol = muted ? 0 : sliderVol;
    var actualVol =
      mainMedia && Number.isFinite(mainMedia.volume) ? mainMedia.volume : null;
    var enabled = !!key && currentSettings[key] !== false;
    var active = enabled && media.length > 0 && !!slider;
    var reason = "active";

    if (!key) reason = "unsupported";
    else if (!enabled) reason = "domain-disabled";
    else if (!media.length) reason = "waiting-for-media";
    else if (!slider) reason = "waiting-for-slider";

    return {
      actualVolumePercent:
        actualVol === null ? null : Math.round((muted ? 0 : actualVol) * 100),
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
      volumePercent: displayVol === null ? null : Math.round(displayVol * 100),
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
