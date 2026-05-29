/**
 * YT Raw Volume
 *
 * YouTube / YouTube Music の音量 UI はそのまま使わせる。
 * YouTube が media.volume へ書き込んだ直後に、
 * UI スライダー値をネイティブ volume setter へ入れ直す。
 */
(function () {
  "use strict";

  var MESSAGE_SOURCE = "yt-raw-volume-bridge";
  var STATUS_SOURCE = "yt-raw-volume-page";

  var settings = {
    youtube: true,
    music: true,
  };

  var volumeDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "volume"
  );
  if (!volumeDescriptor || !volumeDescriptor.get || !volumeDescriptor.set) {
    return;
  }

  var nativeGetVolume = volumeDescriptor.get;
  var nativeSetVolume = volumeDescriptor.set;
  var patchedMedia = new Set();
  var pendingSyncs = new WeakMap();
  var requestedVolumes = new WeakMap();
  var watchedMedia = new WeakSet();
  var watchedSliders = new WeakSet();
  var scanTimer = 0;
  var statusTimer = 0;
  var lastRestoreVolume = null;
  var suppressReloadWarning = false;

  var SYNC_DELAY_MS = 0;
  var VOLUME_WRITE_SYNC_DELAY_MS = 5;
  var SCAN_DELAY_MS = 100;
  var STATUS_DELAY_MS = 50;

  window.addEventListener(
    "beforeunload",
    function (event) {
      if (!suppressReloadWarning) return;

      event.stopImmediatePropagation();
      delete event.returnValue;
    },
    true
  );

  function siteKey() {
    if (location.hostname === "music.youtube.com") return "music";
    if (location.hostname === "www.youtube.com") return "youtube";
    return null;
  }

  function domainEnabled() {
    var key = siteKey();
    return !!key && settings[key] !== false;
  }

  function mediaElements(root) {
    if (root && /^(audio|video)$/.test(root.localName)) return [root];
    return Array.prototype.slice.call(
      (root || document).querySelectorAll("audio, video")
    );
  }

  function clampVolume(value) {
    if (!Number.isFinite(value)) return null;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function nativeVolume(media) {
    return clampVolume(nativeGetVolume.call(media));
  }

  function setNativeVolume(media, volume) {
    volume = clampVolume(Number(volume));
    if (volume === null) return;
    nativeSetVolume.call(media, volume);
  }

  function storedPlayerState() {
    try {
      var raw = localStorage.getItem("yt-player-volume");
      if (!raw) return null;

      var value = JSON.parse(raw);
      var data = value && value.data;
      if (typeof data === "string") data = JSON.parse(data);
      return data || null;
    } catch (error) {
      return null;
    }
  }

  function playerVolume(state) {
    if (!state || state.volume === undefined) return null;
    return clampVolume(Number(state.volume) / 100);
  }

  function volumeFromPercent(value, max) {
    value = Number(value);
    if (!Number.isFinite(value)) return null;

    max = Number(max);
    if (!Number.isFinite(max) || max <= 0) max = value > 1 ? 100 : 1;
    return clampVolume(value / max);
  }

  function sliderVolume(slider) {
    if (!slider) return null;

    if (slider.value !== undefined && slider.value !== "") {
      var fromValue = volumeFromPercent(
        slider.value,
        slider.max || slider.getAttribute("max")
      );
      if (fromValue !== null) return fromValue;
    }

    var raw = slider.getAttribute("aria-valuenow");
    if (raw === null) return null;
    return volumeFromPercent(raw, slider.getAttribute("aria-valuemax") || 100);
  }

  function volumeSliderSelector() {
    return [
      '.ytp-volume-panel[role="slider"]',
      'input#volume-input[role="slider"]',
      "input.ytdVolumeControlsNativeSlider",
      'ytmusic-player-bar #volume-slider[role="slider"]',
      "ytmusic-player-bar #volume-slider #sliderBar",
    ].join(",");
  }

  function hasVolumeSlider(root) {
    if (!root || root.nodeType !== 1) return false;
    var selector = volumeSliderSelector();
    return (
      (root.matches && root.matches(selector)) ||
      (root.querySelector && !!root.querySelector(selector))
    );
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

  function findVolumeSlider(media) {
    return youtubeSlider(media) || musicSlider();
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

  function targetVolume(media) {
    var state = storedPlayerState();

    if (currentMuted(media)) return 0;

    var volume = sliderVolume(findVolumeSlider(media));
    if (volume !== null) return volume;

    if (state && state.muted === true) return 0;

    volume = playerVolume(state);
    if (volume !== null) return volume;

    return null;
  }

  function sliderPercent(media) {
    var volume = targetVolume(media);
    return volume === null ? null : Math.round(volume * 100);
  }

  function watchSlider(slider) {
    if (!slider || watchedSliders.has(slider)) return;
    watchedSliders.add(slider);

    var syncAll = function () {
      Array.prototype.slice.call(patchedMedia).forEach(queueSync);
      queueStatus();
    };

    new MutationObserver(function () {
      syncAll();
    }).observe(slider, {
      attributes: true,
      attributeFilter: ["aria-valuenow", "value"],
    });

    slider.addEventListener("input", syncAll, true);
    slider.addEventListener("change", syncAll, true);
  }

  function sync(media) {
    if (!domainEnabled() || !media.isConnected) return;

    var slider = findVolumeSlider(media);
    watchSlider(slider);

    var volume = targetVolume(media);
    if (volume === null) return;

    if (Math.abs(nativeVolume(media) - volume) > 0.001) {
      setNativeVolume(media, volume);
    }
  }

  function queueSync(media, delay) {
    if (!domainEnabled()) return;

    var existingTimer = pendingSyncs.get(media);
    if (existingTimer) clearTimeout(existingTimer);

    var timer = setTimeout(function () {
      pendingSyncs.delete(media);
      sync(media);
      queueStatus();
    }, delay === undefined ? SYNC_DELAY_MS : delay);

    pendingSyncs.set(media, timer);
  }

  function clearSync(media) {
    var timer = pendingSyncs.get(media);
    if (timer) clearTimeout(timer);
    pendingSyncs.delete(media);
  }

  function watchMedia(media) {
    if (watchedMedia.has(media)) return;

    watchedMedia.add(media);
    media.addEventListener(
      "volumechange",
      function () {
        queueSync(media, VOLUME_WRITE_SYNC_DELAY_MS);
        queueStatus();
      },
      true
    );
  }

  function interceptVolumeSet(media, value) {
    var requestedVolume = clampVolume(Number(value));
    if (requestedVolume === null) return;

    if (!domainEnabled()) {
      setNativeVolume(media, requestedVolume);
      return;
    }

    requestedVolumes.set(media, requestedVolume);
    patchedMedia.add(media);
    watchMedia(media);

    watchSlider(findVolumeSlider(media));
    queueSync(media, VOLUME_WRITE_SYNC_DELAY_MS);
    queueStatus();
  }

  function installVolumeInterceptor() {
    Object.defineProperty(HTMLMediaElement.prototype, "volume", {
      configurable: volumeDescriptor.configurable,
      enumerable: volumeDescriptor.enumerable,
      get: function () {
        return nativeGetVolume.call(this);
      },
      set: function (value) {
        interceptVolumeSet(this, value);
      },
    });
  }

  function patch(media) {
    if (!domainEnabled()) return;

    patchedMedia.add(media);
    watchMedia(media);
    queueSync(media);
  }

  function restore(media) {
    if (!patchedMedia.has(media)) return;

    clearSync(media);

    var percent = sliderPercent(media);
    var fallbackVolume = requestedVolumes.get(media);

    patchedMedia.delete(media);
    requestedVolumes.delete(media);

    var player = playerFor(media);
    if (player && percent !== null && typeof player.setVolume === "function") {
      try {
        player.setVolume(percent);
      } catch (error) {}
    } else if (fallbackVolume !== undefined) {
      setNativeVolume(media, fallbackVolume);
      lastRestoreVolume = fallbackVolume;
      return;
    }

    lastRestoreVolume = nativeVolume(media);
  }

  function restoreAll() {
    Array.prototype.slice.call(patchedMedia).forEach(restore);
  }

  function syncPatchedMedia() {
    Array.prototype.slice.call(patchedMedia).forEach(queueSync);
  }

  function reloadAfterDisable() {
    setTimeout(function () {
      suppressReloadWarning = true;
      try {
        window.onbeforeunload = null;
      } catch (error) {}
      location.reload();
    }, 50);
  }

  function scanMedia(root) {
    if (!domainEnabled()) {
      restoreAll();
      queueStatus();
      return;
    }

    var media = mediaElements(root);
    for (var i = 0; i < media.length; i++) {
      patch(media[i]);
    }

    if (hasVolumeSlider(root)) syncPatchedMedia();

    cleanupDetachedMedia();
    queueStatus();
  }

  function cleanupDetachedMedia() {
    Array.prototype.slice.call(patchedMedia).forEach(function (media) {
      if (!media.isConnected) {
        clearSync(media);
        requestedVolumes.delete(media);
        patchedMedia.delete(media);
      }
    });
  }

  function queueScan() {
    if (scanTimer) return;

    scanTimer = setTimeout(function () {
      scanTimer = 0;
      scanMedia(document);
    }, SCAN_DELAY_MS);
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

  function statusReason(status) {
    if (!status.supported) return "unsupported";
    if (!status.enabled) return "domain-disabled";
    if (!status.mediaCount) return "waiting-for-media";
    if (!status.sliderFound) return "waiting-for-slider";
    if (!status.patchedCount) return "waiting-for-patch";
    return "active";
  }

  function getStatus() {
    var media = mediaElements(document);
    var mainMedia = primaryMedia(media);
    var slider = findVolumeSlider(mainMedia);
    var sliderVol = sliderVolume(slider);
    var muted = currentMuted(mainMedia);
    var displayVol = muted ? 0 : sliderVol;
    var actualVol = muted ? 0 : mainMedia ? nativeVolume(mainMedia) : null;
    var enabled = domainEnabled();
    var patchedCount = 0;

    for (var i = 0; i < media.length; i++) {
      if (patchedMedia.has(media[i])) patchedCount++;
    }

    var status = {
      actualVolumePercent: actualVol === null ? null : Math.round(actualVol * 100),
      enabled: enabled,
      host: location.hostname,
      lastRestorePercent:
        lastRestoreVolume === null ? null : Math.round(lastRestoreVolume * 100),
      loudnessDb: null,
      mediaCount: media.length,
      mode: modeLabel(mainMedia),
      normalizationFound: false,
      normalizedVolumePercent: null,
      patchedCount: patchedCount,
      settingKey: siteKey(),
      sliderFound: !!slider,
      supported: !!siteKey(),
      volumePercent: displayVol === null ? null : Math.round(displayVol * 100),
    };

    status.active = enabled && patchedCount > 0 && status.sliderFound;
    status.reason = statusReason(status);
    return status;
  }

  function postStatus() {
    window.postMessage(
      {
        source: STATUS_SOURCE,
        type: "status",
        status: getStatus(),
      },
      "*"
    );
  }

  function queueStatus() {
    if (statusTimer) return;

    statusTimer = setTimeout(function () {
      statusTimer = 0;
      postStatus();
    }, STATUS_DELAY_MS);
  }

  function applySettings(nextSettings, reloadOnDisable) {
    var wasEnabled = domainEnabled();
    var hadPatchedMedia = patchedMedia.size > 0;

    settings.youtube = nextSettings && nextSettings.youtube !== false;
    settings.music = nextSettings && nextSettings.music !== false;

    if (domainEnabled()) {
      scanMedia(document);
    } else {
      restoreAll();
      queueStatus();
      if (reloadOnDisable && wasEnabled && hadPatchedMedia) reloadAfterDisable();
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;

    var message = event.data;
    if (!message || message.source !== MESSAGE_SOURCE) return;

    if (message.type === "settings") {
      applySettings(message.settings, message.reloadOnDisable);
    } else if (message.type === "request-status") {
      postStatus();
    }
  });

  installVolumeInterceptor();
  scanMedia(document);

  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      for (var j = 0; j < records[i].addedNodes.length; j++) {
        var node = records[i].addedNodes[j];
        if (node.nodeType !== 1) continue;

        scanMedia(node);
        queueScan();
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
