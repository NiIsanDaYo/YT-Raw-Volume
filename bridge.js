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
    postToPage({
      type: "settings",
      reloadOnDisable: reloadOnDisable === true,
      settings: normalizeSettings(settings),
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
        sendResponse({ status: lastStatus });
      }, 80);

      return true;
    });
  }

  loadSettings();
  setTimeout(loadSettings, 0);
  document.addEventListener("DOMContentLoaded", loadSettings, { once: true });
})();
