/**
 * YT Raw Volume
 *
 * YouTube / YouTube Music の音量正規化を避け、UI スライダー値を
 * HTMLMediaElement のネイティブ volume setter にそのまま反映する。
 */
(function () {
  "use strict";

  var volumeDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "volume"
  );
  if (!volumeDescriptor || !volumeDescriptor.set) return;

  var nativeSetVolume = volumeDescriptor.set;
  var patchedMedia = new WeakSet();
  var appliedVolumes = new WeakMap();
  var pendingSyncs = new WeakMap();
  var watchedSliders = new WeakSet();
  var scanTimer = 0;

  var SYNC_DELAY_MS = 5;
  var SCAN_DELAY_MS = 100;

  function clampVolume(value) {
    if (!Number.isFinite(value)) return null;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function sliderVolume(slider) {
    var raw = slider && slider.getAttribute("aria-valuenow");
    if (raw === null) return null;
    return clampVolume(Number(raw) / 100);
  }

  function youtubeSlider(media) {
    var player = media.closest(".html5-video-player");
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

  function watchSlider(slider) {
    if (!slider || watchedSliders.has(slider)) return;
    watchedSliders.add(slider);

    new MutationObserver(queueScan).observe(slider, {
      attributes: true,
      attributeFilter: ["aria-valuenow"],
    });
  }

  function sync(media) {
    var slider = findVolumeSlider(media);
    var nextVolume = sliderVolume(slider);
    if (nextVolume === null) return;

    watchSlider(slider);

    if (appliedVolumes.get(media) === nextVolume) return;
    appliedVolumes.set(media, nextVolume);
    nativeSetVolume.call(media, nextVolume);
  }

  function queueSync(media) {
    if (pendingSyncs.has(media)) return;

    var timer = setTimeout(function () {
      pendingSyncs.delete(media);
      sync(media);
    }, SYNC_DELAY_MS);

    pendingSyncs.set(media, timer);
  }

  function patch(media) {
    if (patchedMedia.has(media)) return;

    var currentDescriptor = Object.getOwnPropertyDescriptor(media, "volume");
    if (currentDescriptor && currentDescriptor.configurable === false) return;

    patchedMedia.add(media);
    Object.defineProperty(media, "volume", {
      configurable: true,
      get: function () {
        return 1;
      },
      set: function () {
        queueSync(media);
      },
    });
  }

  function scanMedia(root) {
    var media = [];

    if (root && /^(audio|video)$/.test(root.localName)) {
      media.push(root);
    } else {
      media = Array.prototype.slice.call(
        (root || document).querySelectorAll("audio, video")
      );
    }

    for (var i = 0; i < media.length; i++) {
      patch(media[i]);
      queueSync(media[i]);
    }
  }

  function queueScan() {
    if (scanTimer) return;

    scanTimer = setTimeout(function () {
      scanTimer = 0;
      scanMedia(document);
    }, SCAN_DELAY_MS);
  }

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
