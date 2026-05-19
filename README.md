# YT Raw Volume

> YouTube / YouTube Music のラウドネス正規化を無効化するブラウザ拡張機能

YouTubeは視聴者体験の統一を目的として、動画ごとの音量を自動調整（ラウドネスノーマライゼーション）しています。  
**YT Raw Volume** はこの正規化をインターセプトし、動画本来の音量バランスをそのまま届けます。

---

## 機能

- YouTube および YouTube Music のラウドネス正規化を無効化
- スライダーで設定した音量をそのまま維持
- ポップアップから YouTube / YouTube Music を個別に ON/OFF
- 現在のページで適用中か、media / slider を検出できているかを表示
- 軽量・ノートラッキング・外部通信なし

---

## 対応ブラウザ

- Google Chrome / Chromium 系（Manifest V3 対応）

---

## インストール方法

### 手動インストール（開発者モード）

1. このリポジトリをクローンまたは ZIP でダウンロード
   ```
   git clone https://github.com/NiIsanDaYo/YT-Raw-Volume.git
   ```
2. Chrome で `chrome://extensions/` を開く
3. 右上の「**デベロッパーモード**」をオンにする
4. 「**パッケージ化されていない拡張機能を読み込む**」をクリック
5. ダウンロードしたフォルダを選択

---

## 仕組み

YouTubeは動画再生時に `video.volume` プロパティへ書き込むことで音量正規化を行います。  
本拡張は `document_start` + `MAIN` ワールドで `video.volume` の setter をインスタンス単位で差し替えます。
getter はネイティブ実音量を返すため YouTube の音量 UI 状態は壊さず、YouTube が正規化後の値を書こうとした時だけ UI スライダーの `aria-valuenow` をネイティブ setter へ反映します。ON から OFF に切り替える場合は、YouTube の内部プレイヤー状態を確実に戻すため対象タブを再読み込みします。

---

## ファイル構成

```
YT-Raw-Volume/
├── manifest.json   # 拡張機能のメタデータ（Manifest V3）
├── content.js      # メインロジック（ラウドネス正規化の無効化）
├── bridge.js       # ポップアップ設定とページ内ロジックの橋渡し
├── popup.html      # ポップアップUI
├── popup.css       # ポップアップUIのスタイル
├── popup.js        # ドメイン別設定と状態表示
├── icon16.png      # アイコン（16×16）
├── icon48.png      # アイコン（48×48）
└── icon128.png     # アイコン（128×128）
```
