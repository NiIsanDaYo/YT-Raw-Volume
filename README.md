# YT Raw Volume

> YouTube / YouTube Music のラウドネス正規化を無効化するブラウザ拡張機能

YouTubeは視聴者体験の統一を目的として、動画ごとの音量を自動調整（ラウドネスノーマライゼーション）しています。  
**YT Raw Volume** はこの正規化をインターセプトし、動画本来の音量バランスをそのまま届けます。

---

## 機能

- YouTube および YouTube Music のラウドネス正規化を無効化
- スライダーで設定した音量をそのまま維持
- ポップアップから YouTube / YouTube Music を個別に ON/OFF
- ON から OFF に切り替える時は、対象タブを自動で再読み込み
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
本拡張は `document_start` + `MAIN` ワールドで `HTMLMediaElement.prototype.volume` の setter を差し替え、メディア生成直後の初回書き込みから捕捉します。
getter はネイティブ実音量を返すため YouTube の音量 UI 状態は壊さず、YouTube の書き込み後に少し待ってから UI スライダー値をネイティブ setter へ反映します。これにより、正規化書き込みとユーザーの音量操作を別々に判定せず、表示中の音量 UI を単一の正とします。ON から OFF に切り替える場合は、YouTube の内部プレイヤー状態を確実に戻すため対象タブを再読み込みします。

YouTube Music では再読み込み時に確認ダイアログが出ることがあります。本拡張は、拡張の OFF 切り替えで発生する自動再読み込みに限って、その警告を抑止します。

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
