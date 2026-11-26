# Glass Widgets

Windows 11 桌面小組件 App，iOS 液態玻璃風格：

- 桌面上的玻璃小組件：時鐘、天氣、電量、Google 日曆、Pinterest，每個都有小／中／大三種尺寸
- 小組件待在「桌面那一層」：開 Chrome 等視窗時會被蓋住、不會擋到你；被蓋住時會停止更新省電
- 藍牙裝置連上電腦時，從螢幕正上方中間跳出 MacBook 瀏海風格的通知（電量低也會提醒）

用 [Electron](https://www.electronjs.org/) 做的，跟 Discord、VS Code 桌面版是同一種技術，打包後就是一般的 Windows 程式（.exe）。

## 下載安裝（一般使用者）

1. 在電腦上打開這個 GitHub 專案 →「Actions」分頁 → 點最上面那次執行（綠色勾勾）
2. 拉到最下面「Artifacts」，下載 **Glass-Widgets-Windows**（是一個 zip）
3. 解壓縮，裡面有兩個檔案，選一個：
   - `Glass-Widgets-Setup-1.0.x.exe`：**安裝版**，會出現在開始選單，**會自動更新**
   - `Glass-Widgets-Portable-1.0.x.exe`：**免安裝版**，直接點兩下就能用（不會自動更新）
4. 第一次打開 Windows 可能會跳出藍色的「Windows 已保護您的電腦」→ 按「其他資訊」→「仍要執行」
   （因為這個程式沒有買數位簽章，不是病毒）

### 自動更新

用「安裝版」（`Glass-Widgets-Setup-….exe`）安裝的話，程式會自己檢查新版（開機 30 秒後、之後每 6 小時），
在背景下載好，關掉程式時自動裝好；也可以在管理程式「一般」頁按「立即重新啟動並更新」。

- 新版是從這個專案的 GitHub **Releases** 下載的，所以 **專案要設成公開** 才能自動更新
- 每次程式碼合併進 `main`，GitHub 會自動打包並發佈一個新版本（版本號 1.0.x 自動往上加）
- 免安裝版（portable）沒辦法自動更新

## 自己從原始碼執行（開發用）

1. 先裝 [Node.js](https://nodejs.org/)（選 LTS 版，一路按下一步）
2. 在這個專案資料夾開終端機（資料夾空白處 Shift + 右鍵 →「在終端機中開啟」），輸入：

   ```
   npm install
   npm start
   ```

3. 桌面右上角會出現玻璃小組件（時鐘、天氣、電量、Pinterest），右下角系統匣會多一個藍色圖示

### 想做成 .exe 安裝檔

```
npm run dist
```

做好的檔案在 `dist/`，有安裝版跟免安裝版（portable）。

### 使用方式

- **拖曳**：按住小組件任何地方就能拖，位置會記住
- **右鍵**：在小組件上按右鍵可以改大小（小／中／大）或移除
- **管理程式**：所有設定都在這個視窗裡。打開方式：點右下角系統匣的圖示，或是再點一次程式捷徑。第一次啟動時會自動打開
  - **小組件**：開關每個小組件、把小組件叫回來、重設位置
  - **外觀**：「圓角毛玻璃」（預設，蘋果那種大圓角，後面是模糊的桌布）或「Windows 毛玻璃」（Windows 自己模糊，圓角很小）
  - **藍牙通知**：連線通知、電量低提醒的開關、低電量門檻、每台裝置要不要通知、測試通知
  - **Google 日曆**：貼上 Google 日曆「iCal 格式的私人網址」就能顯示行程（不用登入，裡面有步驟說明）
  - **Pinterest**：登入／登出、選圖版，或改用公開網址
  - **天氣**：搜尋並更換城市
  - **一般**：開機自動啟動、設定資料夾、完全離開程式
- 關掉管理程式的視窗不會關掉小組件，程式會留在系統匣；右鍵系統匣圖示可以「離開」
- **Pinterest 小組件**：第一次會問你要「登入我的 Pinterest」還是「用公開網址」
  - 圖片會像滑 Pinterest 一樣慢慢往上捲，滑鼠移上去會停，點圖片會用瀏覽器打開那個 pin
  - 想換圖版或登出：滑鼠移到小組件上，按右上角的 ↻
  - 詳細設定見下面「Pinterest 怎麼設定」
- **藍牙通知＋電量**：所有藍牙裝置（耳機、滑鼠、鍵盤、手把、手機、喇叭…）連上電腦都會跳通知；電量剩 20% 以下也會跳提醒
  - 電量小組件一頁顯示 4 個（電腦＋3 個裝置），裝置多的話每 6 秒自動翻頁，滑鼠移上去會停
  - 電量讀取來源：耳機類走「免持通話」回報的電量；滑鼠、鍵盤、新款手把等低功耗藍牙裝置讀標準的「電池服務」
  - 讀不到電量的裝置會顯示灰色圓圈＋「已連線」（例如 PS5 手把的電量藏在自家格式裡，Windows 讀不到）
  - **用 USB 接收器（2.4G）連的裝置不是藍牙**，例如 Sony INZONE 耳機插接收器時、羅技 Unifying/Bolt 接收器，這些目前偵測不到

### 讓「使用 Google／Pinterest 帳號登入」按鈕能用（開發者做一次就好）

Google 和 Pinterest 規定：每個用「帳號登入」的程式都要先跟他們登記，拿到程式 ID。
登記好之後放進 GitHub 的加密設定，GitHub 打包時會自動放進程式裡；之後使用者只要按「登入」。
（還沒設定的話，程式會改用「進階」裡的手動方式：iCal 網址、Pinterest App ID。）

**Google（Google 日曆用）**

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建一個專案（名稱隨便，例如 Glass Widgets）
2. 「API 和服務」→「程式庫」→ 搜尋 **Google Calendar API** → 啟用
3. 「Google 驗證平台」（舊版叫「OAuth 同意畫面」）：
   - 品牌：填應用程式名稱、你的 email
   - 目標對象：選「外部」，把自己的 Gmail 加進「測試使用者」
   - 資料存取：新增範圍 `.../auth/calendar.readonly`
   - 最後在「目標對象」按 **發布應用程式**（改成「實際運作中」）。不發布的話，Google 每 7 天會要你重新登入一次
4. 「用戶端」→ 建立用戶端 → 應用程式類型選 **電腦版應用程式** → 複製 **用戶端 ID** 和 **用戶端密碼**
5. 到這個 GitHub 專案 → Settings → Secrets and variables → Actions → New repository secret，新增：
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

第一次登入時 Google 會顯示「Google 尚未驗證這個應用程式」，因為這是自己用的程式、沒送 Google 審核。按「進階」→「前往 Glass Widgets（不安全）」就可以繼續。

**Pinterest**

Pinterest 的 App 審核通過後，一樣在 GitHub Secrets 新增 `PINTEREST_APP_ID` 和 `PINTEREST_APP_SECRET`（App 設定的 Redirect URI 要有 `http://localhost:8085/`）。

> 注意：這些 ID 和密碼會被打包進程式裡（桌面程式都是這樣，Google 也把電腦版的密碼視為「不算祕密」）。
> 懂程式的人有辦法從安裝檔裡挖出來，但他們拿去也只能用「你的」程式名義請別人登入，看不到你的資料。

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
- 「圓角毛玻璃」模式後面看到的是**模糊的桌布**，不是真正透過去的畫面：小組件被其他視窗蓋住一半時，玻璃裡看到的還是桌布。小組件平常都在桌面上，所以通常看不出來
- 「Windows 毛玻璃」模式的圓角是 Windows 11 系統決定的，只有 8px
- 天氣資料來自 [Open-Meteo](https://open-meteo.com/)（免費、不用註冊）

## 圖示來源

裝置、天氣等圖示來自 Google 的 [Material Symbols](https://fonts.google.com/icons)（Apache License 2.0），授權全文在 `renderer/ICONS-LICENSE.txt`。
