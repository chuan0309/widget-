# Privacy Policy — Glass Widgets

_Last updated: 2026-11-26_

Glass Widgets is a personal desktop app for Windows that shows widgets (clock, weather, battery, Pinterest pins) on the user's own desktop. It is not a web service and has no server.

## What data the app uses

- **Pinterest data**: when the user signs in with Pinterest, the app reads the user's own boards and Pins (including secret boards, if the user allows it) only to display the Pin images in a desktop widget on that user's computer. The app does not create, edit, or delete anything on Pinterest.
- **Pinterest access tokens and app credentials**: stored only on the user's computer, encrypted with the Windows Data Protection API. They are never sent anywhere except to Pinterest's own API.
- **Bluetooth device names and battery levels**: read from Windows on the user's computer to show connection notifications and battery levels. This data never leaves the computer.
- **Weather**: the city's coordinates are sent to Open-Meteo (api.open-meteo.com) to get the forecast. If the user chooses the Central Weather Administration (opendata.cwa.gov.tw) as the source, the app sends the user's own CWA key (stored encrypted on the computer) and the name of the county to CWA to get the township forecast.
- **Location (optional, on by default)**: to show local weather, the app asks the Windows location service for the computer's position. That position (or, if the location service is off, the computer's IP address) is sent to BigDataCloud (api.bigdatacloud.net) only to look up the city name. It can be turned off in the Weather page.
- **Google Calendar (optional)**: when the user signs in with Google, the app reads the user's calendars (read-only) to show upcoming events on that user's desktop. Tokens are stored encrypted on the computer and are only sent to Google.

## What the app does not do

- It does not collect, sell, or share any personal data.
- It has no analytics, ads, or tracking.
- It does not send any data to the developer.

## Removing data

Signing out in the Pinterest widget deletes the stored tokens. Uninstalling the app and deleting the folder `%APPDATA%\Glass Widgets` removes all locally stored settings. Users can also revoke the app's access at any time in their Pinterest account settings.

## Contact

Questions about this policy can be sent through this project's GitHub page: https://github.com/chuan0309/widget-

---

# 隱私權政策（中文）

Glass Widgets 是一個在 Windows 桌面顯示小組件的個人程式，沒有伺服器。

- **Pinterest 資料**：登入後只會讀取使用者自己的圖版和 Pin，用來在使用者自己的電腦桌面上顯示圖片，不會新增、修改或刪除任何東西。
- **登入資料**：只存在使用者的電腦上，並用 Windows 內建加密保護，只會傳給 Pinterest 官方 API。
- **藍牙裝置名稱和電量**：只在使用者電腦上讀取，不會傳出去。
- **天氣**：只會把城市座標傳給 Open-Meteo 取得天氣；如果選了中央氣象署，會把使用者自己的授權碼（加密存在電腦上）和縣市名稱傳給氣象署取得鄉鎮預報。
- **自動定位**（可以關掉）：用 Windows 定位服務找電腦的位置（沒開的話用網路 IP），只傳給 BigDataCloud 查城市名稱。
- **Google 日曆**（選用）：登入後只會讀取行事曆來顯示在桌面上，不會修改；登入資料加密存在電腦上，只會傳給 Google。
- 不收集、不販賣、不分享任何個人資料；沒有廣告、追蹤或數據分析。
- 在小組件按「登出」會刪除登入資料；也可以隨時到 Pinterest 帳號設定取消授權。
