# 聚餐日期調查

用 React + TypeScript 製作的團隊聚餐日期調查工具。

網站：https://lily0822.github.io/QA/

## 本機執行

```bash
npm install
npm run dev
```

資料會依月份同步至 Cloud Firestore，並以瀏覽器 localStorage 作為本機備援。

## Firebase

網站使用 Firebase Anonymous Authentication 與 Cloud Firestore 即時同步資料。
Firestore 正式模式的安全規則請使用 [`firestore.rules`](./firestore.rules)。
