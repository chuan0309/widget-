# widget-

iOS 液態玻璃風格的小組件＋藍牙連線通知。有兩個版本：

| 資料夾 | 是什麼 |
| --- | --- |
| `desktop/` | **Windows 11 桌面版**：小組件真的貼在桌面上，藍牙裝置連上電腦時右下角跳出玻璃通知 |
| `web/` | 網頁版 Demo：模擬 iPhone 畫面，用瀏覽器打開 `web/index.html` 就能看 |

## Windows 桌面版怎麼跑

1. 先裝 [Node.js](https://nodejs.org/)（選 LTS 版，一路按下一步）
2. 在 `desktop` 資料夾開終端機（資料夾空白處 Shift + 右鍵 →「在終端機中開啟」），輸入：

   ```
   npm install
   npm start
   ```

3. 桌面右上角會出現玻璃小組件（時鐘、天氣、電量、Pinterest），右下角系統匣會多一個藍色圖示

### 想做成 .exe 安裝檔

```
npm run dist
```

做好的檔案在 `desktop/dist/`，有安裝版跟免安裝版（portable）。

### 使用方式

- **拖曳**：按住小組件任何地方就能拖，位置會記住
- **系統匣圖示右鍵**：
  - 顯示測試通知（不用真的連耳機就能看彈窗）
  - 開關個別小組件
  - 切換玻璃效果：「毛玻璃」會真的模糊後面的桌布；「透明圓角」不模糊但是 iOS 那種大圓角
  - 開機自動啟動
  - 開啟設定檔：改天氣的城市（`city` 的 `name`、`lat` 緯度、`lon` 經度）
- **Pinterest 小組件**：第一次會問你要「登入我的 Pinterest」還是「用公開網址」
  - 圖片會像滑 Pinterest 一樣慢慢往上捲，滑鼠移上去會停，點圖片會用瀏覽器打開那個 pin
  - 想換圖版或登出：滑鼠移到小組件上，按右上角的 ↻
  - 詳細設定見下面「Pinterest 怎麼設定」
- 藍牙裝置**連上電腦**時會自動跳通知，電量小組件也會顯示它的電量（要裝置本身有回報電量給 Windows 才看得到 %）

### Pinterest 怎麼設定

**方法 A：登入帳號（官方 API，可以看私密圖版）**

Pinterest 規定要用官方 API，得先申請一個「開發者 App」，只要做一次：

1. 你的 Pinterest 帳號要是**商業帳號**（免費，在 Pinterest 設定裡可以把個人帳號轉成商業帳號）
2. 到 [developers.pinterest.com](https://developers.pinterest.com/) 登入 → My apps → 建立 App，申請 **Trial access**
3. 等 Pinterest 審核（會寄 email 通知）
4. 審核過後，在 App 的設定頁：
   - 找到 **App ID** 和 **App secret**
   - 在 **Redirect URIs** 加上 `http://localhost:8085/`（要一字不差，包含最後的 `/`）
5. 回到桌面的 Pinterest 小組件 → 登入我的 Pinterest → 貼上 App ID、App secret → 到瀏覽器按「允許」
6. 選一個圖版（有鎖頭的是私密圖版），或選「我存的所有 pin」

登入一次之後會自動續期，只要 60 天內有開過程式就不用重新登入。App secret 和登入資料都用 Windows 內建的加密存起來。

> 注意：Pinterest 官方 API **沒有「首頁推薦」**，只能讀你自己的圖版和 pin。
> 另外 Pinterest 文件有寫：2026/9/14 之後建立的 App，讀「非商業帳號」的資料可能會被擋（錯誤代碼 `PINNER_DATA_ACCESS_DENIED`），這也是為什麼第 1 步要用商業帳號。

**方法 B：公開網址（不用登入，最快）**

- 貼個人頁（`pinterest.com/你的帳號/`）→ 顯示你最新的 pin
- 貼某個圖版（`pinterest.com/你的帳號/圖版名稱/`）→ 只顯示那個圖版
- 只能看公開的，而且只會顯示最新約 25 張

### 已知限制

- 按 Win + D（顯示桌面）時小組件會一起被藏起來，點系統匣圖示可以叫回來
- 毛玻璃模式的圓角是 Windows 11 系統決定的（比較小），要大圓角請切換成「透明圓角」
- 天氣資料來自 [Open-Meteo](https://open-meteo.com/)（免費、不用註冊）
