/**
 * YT Raw Volume
 *
 * YouTubeの音量正規化（ラウドネスノーマライゼーション）を無効化する。
 * video.volume をインスタンスレベルで上書きし、YouTubeの内部音量操作を遮断。
 * 代わりにUIスライダーの aria-valuenow からユーザー設定値を読み取り適用する。
 */
(function () {
  "use strict";

  // --- ネイティブ setter の確保 ---
  // シャドウイング後に取得するとダミーを掴むため、起動時に1回だけ取得する
  var desc = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "volume"
  );
  if (!desc || !desc.set) return;
  var nativeSet = desc.set;

  // 処理済みマーカー（Symbolで他スクリプトとの名前衝突を完全に回避）
  var PATCHED = Symbol("ytRawVolume");

  /**
   * スライダーの aria-valuenow を読み取り、ネイティブsetterで音量を設定する。
   * 値が未設定(null)または前回と同値なら何もしない。
   */
  function sync(slider, video) {
    var raw = slider.getAttribute("aria-valuenow");
    if (raw === null) return;
    var vol = raw / 100;
    if (vol === video._vol) return;
    video._vol = vol;
    nativeSet.call(video, vol);
  }

  /**
   * 動画プレイヤーに対応する音量スライダーを探す。
   * YouTube通常版 / YouTube Music それぞれのセレクタに対応。
   */
  function findSlider(playerRoot) {
    return (
      playerRoot.querySelector(".ytp-volume-panel") ||
      document.querySelector("ytmusic-player-bar #volume-slider #sliderBar")
    );
  }

  /**
   * video要素の volume プロパティをシャドウイングし、正規化を無効化する。
   * 処理済み・DOM未接続・スライダー未出現の場合はスキップ。
   */
  function patch(video) {
    if (video[PATCHED]) return;

    // プレイヤーコンテナを探索（階層の深さに依存しない）
    // 見つからなければデバウンス付きリトライで再試行される
    var root = video.closest(".html5-video-player");
    if (!root) return;

    var slider = findSlider(root);
    if (!slider) return;

    video[PATCHED] = true;
    video._vol = -1; // 初期値（どの正規音量とも一致しない値で初回syncを保証）

    Object.defineProperty(video, "volume", {
      get: function () {
        return 1;
      },
      set: function () {
        setTimeout(function () {
          sync(slider, video);
        }, 5);
      },
    });

    sync(slider, video);
  }

  // --- 初期化 & DOM監視 ---

  /** 未処理のvideo要素をすべてスキャンしてパッチする */
  function scan() {
    var vids = document.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) patch(vids[i]);
  }

  scan();

  // DOM変動を監視し、動画追加やスライダー出現を検知する
  // デバウンス(100ms)で高頻度の再スキャンを抑制
  var timer = 0;

  new MutationObserver(function (recs) {
    var needScan = false;

    for (var i = 0; i < recs.length; i++) {
      var added = recs[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].tagName === "VIDEO") {
          patch(added[j]);
        } else if (added[j].nodeType === 1) {
          needScan = true;
        }
      }
    }

    // 要素追加があった場合、未処理動画を再試行（スライダー遅延出現に対応）
    if (needScan && !timer) {
      timer = setTimeout(function () {
        timer = 0;
        scan();
      }, 100);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
