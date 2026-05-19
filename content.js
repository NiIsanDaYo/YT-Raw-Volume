/**
 * YT Raw Volume
 *
 * YouTube / YouTube Music の通常の音量 UI は壊さず、YouTube が正規化で
 * HTMLMediaElement.volume を下げた後に UI スライダー値へ戻す。
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
  var watchedMedia = new Set();
  var correctionTimers = new WeakMap();
  var correctingMedia = new WeakSet();
  var watchedSliders = new WeakSet();
  var loudnessByVideoId = Object.create(null);
  var currentLoudnessDb = null;
  var lastRestoreVolume = null;
  var scanTimer = 0;
  var statusTimer = 0;

  var CORRECTION_GUARD_MS = 80;
  var CORRECTION_DELAY_MS = 30;
  var SCAN_DELAY_MS = 100;
  var STATUS_DELAY_MS = 50;

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

  function currentVideoId() {
    try {
      return new URL(location.href).searchParams.get("v");
    } catch (error) {
      return null;
    }
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

    correctingMedia.add(media);
    nativeSetVolume.call(media, volume);

    setTimeout(function () {
      correctingMedia.delete(media);
    }, CORRECTION_GUARD_MS);
  }

  function recordLoudness(loudnessDb, videoId) {
    var value = Number(loudnessDb);
    if (!Number.isFinite(value)) return;

    currentLoudnessDb = value;
    if (videoId) loudnessByVideoId[videoId] = value;
  }

  function responseVideoId(response) {
    return (
      response &&
      response.videoDetails &&
      typeof response.videoDetails.videoId === "string" &&
      response.videoDetails.videoId
    );
  }

  function scanLoudness(response, depth) {
    if (!response || typeof response !== "object" || depth > 7) return;

    var audioConfig =
      (response.playerConfig && response.playerConfig.audioConfig) ||
      response.audioConfig;

    if (audioConfig && "loudnessDb" in audioConfig) {
      recordLoudness(audioConfig.loudnessDb, responseVideoId(response));
    }

    var skipKeys = {
      adaptiveFormats: true,
      captions: true,
      formats: true,
      hlsManifestUrl: true,
      responseContext: true,
      streamingData: true,
      thumbnails: true,
      trackingParams: true,
    };

    for (var key in response) {
      if (skipKeys[key]) continue;
      scanLoudness(response[key], depth + 1);
    }
  }

  function scanKnownLoudnessSources() {
    scanLoudness(window.ytInitialPlayerResponse, 0);
    scanLoudness(window.ytInitialData, 0);

    var rawPlayerResponse =
      window.ytplayer &&
      window.ytplayer.config &&
      window.ytplayer.config.args &&
      window.ytplayer.config.args.raw_player_response;

    scanLoudness(rawPlayerResponse, 0);
  }

  function hookInitialPlayerResponse() {
    var value = window.ytInitialPlayerResponse;

    try {
      Object.defineProperty(window, "ytInitialPlayerResponse", {
        configurable: true,
        enumerable: true,
        get: function () {
          return value;
        },
        set: function (nextValue) {
          value = nextValue;
          setTimeout(function () {
            scanLoudness(nextValue, 0);
          }, 0);
        },
      });
    } catch (error) {
      scanLoudness(value, 0);
    }
  }

  function hookFetch() {
    if (!window.fetch) return;

    var nativeFetch = window.fetch;
    window.fetch = function () {
      var input = arguments[0];
      var responsePromise = nativeFetch.apply(this, arguments);

      responsePromise
        .then(function (response) {
          var url = "";

          try {
            url = typeof input === "string" ? input : input && input.url;
            if (!url || url.indexOf("/youtubei/v1/player") === -1) return;

            response
              .clone()
              .json()
              .then(function (data) {
                scanLoudness(data, 0);
              })
              .catch(function () {});
          } catch (error) {}
        })
        .catch(function () {});

      return responsePromise;
    };
  }

  function hookXhr() {
    if (!window.XMLHttpRequest) return;

    var nativeOpen = XMLHttpRequest.prototype.open;
    var nativeSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function () {
      this.__ytRawVolumeUrl = arguments[1];
      return nativeOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      var xhr = this;

      xhr.addEventListener("load", function () {
        var url = String(xhr.__ytRawVolumeUrl || "");
        if (url.indexOf("/youtubei/v1/player") === -1) return;

        try {
          scanLoudness(JSON.parse(xhr.responseText), 0);
        } catch (error) {}
      });

      return nativeSend.apply(this, arguments);
    };
  }

  function currentLoudnessDbValue() {
    var videoId = currentVideoId();
    var loudnessDb =
      videoId && loudnessByVideoId[videoId] !== undefined
        ? loudnessByVideoId[videoId]
        : currentLoudnessDb;

    return Number.isFinite(loudnessDb) ? loudnessDb : null;
  }

  function loudnessFactor() {
    var loudnessDb = currentLoudnessDbValue();
    if (!Number.isFinite(loudnessDb) || loudnessDb <= 0) return 1;
    return clampVolume(Math.pow(10, -loudnessDb / 20));
  }

  function sliderVolume(slider) {
    var raw = slider && slider.getAttribute("aria-valuenow");
    if (raw === null) return null;
    return clampVolume(Number(raw) / 100);
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

  function findVolumeSlider(media) {
    return youtubeSlider(media) || musicSlider();
  }

  function sliderPercent(media) {
    var volume = sliderVolume(findVolumeSlider(media));
    return volume === null ? null : Math.round(volume * 100);
  }

  function playerFor(media) {
    return (
      (media && media.closest(".html5-video-player")) ||
      document.getElementById("movie_player")
    );
  }

  function watchSlider(slider) {
    if (!slider || watchedSliders.has(slider)) return;
    watchedSliders.add(slider);

    new MutationObserver(function () {
      queueScan();
      queueStatus();
    }).observe(slider, {
      attributes: true,
      attributeFilter: ["aria-valuenow"],
    });
  }

  function rawTargetVolume(media) {
    return sliderVolume(findVolumeSlider(media));
  }

  function normalizedTargetVolume(media) {
    var raw = rawTargetVolume(media);
    return raw === null ? null : clampVolume(raw * loudnessFactor());
  }

  function correctVolume(media) {
    if (!domainEnabled() || !media.isConnected) return;

    var target = rawTargetVolume(media);
    if (target === null) return;

    watchSlider(findVolumeSlider(media));

    var current = nativeVolume(media);
    if (current === null || Math.abs(current - target) < 0.002) return;

    setNativeVolume(media, target);
  }

  function queueCorrection(media, delay) {
    if (!domainEnabled() || correctionTimers.has(media)) return;

    var timer = setTimeout(function () {
      correctionTimers.delete(media);
      correctVolume(media);
      queueStatus();
    }, delay);

    correctionTimers.set(media, timer);
  }

  function onVolumeChange(event) {
    var media = event.currentTarget;
    if (correctingMedia.has(media)) return;

    queueCorrection(media, CORRECTION_DELAY_MS);
  }

  function watchMedia(media) {
    if (watchedMedia.has(media)) return;

    watchedMedia.add(media);
    media.addEventListener("volumechange", onVolumeChange, true);
  }

  function clearCorrection(media) {
    var timer = correctionTimers.get(media);
    if (timer) clearTimeout(timer);
    correctionTimers.delete(media);
  }

  function restoreYouTubeVolume(media) {
    var player = playerFor(media);
    var percent = sliderPercent(media);

    if (player && percent !== null && typeof player.setVolume === "function") {
      try {
        player.setVolume(percent);
      } catch (error) {}
    }

    var volume = normalizedTargetVolume(media);
    if (volume !== null) {
      lastRestoreVolume = volume;
      setNativeVolume(media, volume);
    }
  }

  function restoreAll() {
    Array.prototype.slice.call(watchedMedia).forEach(function (media) {
      clearCorrection(media);
      restoreYouTubeVolume(media);
    });
  }

  function scanMedia(root) {
    if (!domainEnabled()) {
      restoreAll();
      queueStatus();
      return;
    }

    var media = mediaElements(root);
    for (var i = 0; i < media.length; i++) {
      watchMedia(media[i]);
      queueCorrection(media[i], CORRECTION_DELAY_MS);
    }

    cleanupDetachedMedia();
    queueStatus();
  }

  function cleanupDetachedMedia() {
    Array.prototype.slice.call(watchedMedia).forEach(function (media) {
      if (!media.isConnected) {
        clearCorrection(media);
        media.removeEventListener("volumechange", onVolumeChange, true);
        watchedMedia.delete(media);
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
    if (!status.patchedCount) return "waiting-for-media-watch";
    return "active";
  }

  function getStatus() {
    var media = mediaElements(document);
    var mainMedia = primaryMedia(media);
    var slider = findVolumeSlider(mainMedia);
    var currentVolume = sliderVolume(slider);
    var loudnessDb = currentLoudnessDbValue();
    var enabled = domainEnabled();
    var watchedCount = 0;

    for (var i = 0; i < media.length; i++) {
      if (watchedMedia.has(media[i])) watchedCount++;
    }

    var status = {
      actualVolumePercent:
        mainMedia && nativeVolume(mainMedia) !== null
          ? Math.round(nativeVolume(mainMedia) * 100)
          : null,
      enabled: enabled,
      host: location.hostname,
      lastRestorePercent:
        lastRestoreVolume === null ? null : Math.round(lastRestoreVolume * 100),
      loudnessDb: loudnessDb,
      mediaCount: media.length,
      mode: modeLabel(mainMedia),
      normalizedVolumePercent:
        currentVolume === null
          ? null
          : Math.round(currentVolume * loudnessFactor() * 100),
      normalizationFound: loudnessDb !== null,
      patchedCount: watchedCount,
      settingKey: siteKey(),
      sliderFound: !!slider,
      supported: !!siteKey(),
      volumePercent:
        currentVolume === null ? null : Math.round(currentVolume * 100),
    };

    status.active = enabled && watchedCount > 0 && status.sliderFound;
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

  function applySettings(nextSettings) {
    settings.youtube = nextSettings && nextSettings.youtube !== false;
    settings.music = nextSettings && nextSettings.music !== false;

    if (domainEnabled()) {
      scanMedia(document);
    } else {
      restoreAll();
      queueStatus();
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;

    var message = event.data;
    if (!message || message.source !== MESSAGE_SOURCE) return;

    if (message.type === "settings") {
      applySettings(message.settings);
    } else if (message.type === "request-status") {
      postStatus();
    }
  });

  hookInitialPlayerResponse();
  hookFetch();
  hookXhr();
  scanKnownLoudnessSources();
  setTimeout(scanKnownLoudnessSources, 500);

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
