// ==UserScript==
// @name         QA Food 下午茶 foodpanda 菜單匯入器
// @namespace    https://lily0822.github.io/QA/
// @version      1.0.0
// @description  在 foodpanda 店家頁抓取當下商品、圖片與可見客製選項，匯入 QA Food 下午茶點餐房間。
// @match        https://www.foodpanda.com.tw/*
// @match        https://foodpanda.com.tw/*
// @grant        none
// ==/UserScript==

(async function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyBGxFJzUtBp_OoK_7-zoLAj_3vRZgmBbH8",
    authDomain: "qa-food-465bd.firebaseapp.com",
    projectId: "qa-food-465bd",
    storageBucket: "qa-food-465bd.firebasestorage.app",
    messagingSenderId: "392699108790",
    appId: "1:392699108790:web:890937be1502fb37d47517"
  };

  const [{ initializeApp }, { getAuth, signInAnonymously }, { getFirestore, doc, setDoc }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js")
  ]);

  const app = initializeApp(firebaseConfig, `qa-food-importer-${Date.now()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const text = (node) => (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  const priceFromText = (value) => {
    const match = value.match(/(?:NT\$|\$)\s*([0-9,]+)/i);
    return match ? Number(match[1].replace(/,/g, "")) : 0;
  };
  const cleanName = (value) => value
    .replace(/NT\$\s*[0-9,]+/gi, "")
    .replace(/\$\s*[0-9,]+/g, "")
    .replace(/熱門|推薦|加購|客製化|選擇規格/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const normalize = (value) => String(value || "").trim().toLowerCase();

  function panel() {
    const el = document.createElement("div");
    el.id = "qa-food-importer";
    el.innerHTML = `
      <style>
        #qa-food-importer {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          width: 320px;
          padding: 16px;
          border-radius: 20px;
          background: #fff;
          border: 1px solid #fbcfe8;
          box-shadow: 0 18px 50px rgba(236, 72, 153, .25);
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #334155;
        }
        #qa-food-importer h3 { margin: 0 0 10px; font-size: 16px; font-weight: 900; }
        #qa-food-importer input {
          width: 100%;
          box-sizing: border-box;
          height: 40px;
          border: 1px solid #f9a8d4;
          border-radius: 14px;
          padding: 0 12px;
          outline: none;
          margin: 6px 0 10px;
        }
        #qa-food-importer button {
          width: 100%;
          height: 42px;
          border: 0;
          border-radius: 999px;
          background: #ec4899;
          color: white;
          font-weight: 900;
          cursor: pointer;
        }
        #qa-food-importer small { display: block; margin-top: 8px; color: #94a3b8; line-height: 1.5; }
        #qa-food-importer .bar { height: 10px; background: #ffe4e6; border-radius: 999px; overflow: hidden; margin-top: 12px; }
        #qa-food-importer .fill { width: 0%; height: 100%; background: #ec4899; border-radius: 999px; transition: width .2s ease; }
        #qa-food-importer .msg { margin-top: 8px; color: #db2777; font-size: 12px; font-weight: 800; }
      </style>
      <h3>下午茶菜單匯入</h3>
      <label style="font-size:12px;font-weight:800;">房間代碼</label>
      <input id="qa-food-room" placeholder="例如 20260715QA" />
      <button id="qa-food-start">開始抓取 foodpanda 菜單</button>
      <div class="bar"><div id="qa-food-fill" class="fill"></div></div>
      <div id="qa-food-msg" class="msg">等待開始</div>
      <small>請先停在 foodpanda 店家頁。匯入器會讀取目前頁面已載入的商品、圖片與可見客製選項。</small>
    `;
    document.body.appendChild(el);
    return el;
  }

  const ui = panel();
  const roomInput = ui.querySelector("#qa-food-room");
  const startBtn = ui.querySelector("#qa-food-start");
  const fill = ui.querySelector("#qa-food-fill");
  const msg = ui.querySelector("#qa-food-msg");

  roomInput.value = localStorage.getItem("qa-food-import-room") || `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}QA`;

  async function writeProgress(roomId, progress) {
    await setDoc(doc(db, "teatimeRooms", roomId), {
      importProgress: {
        ...progress,
        updatedAt: Date.now()
      }
    }, { merge: true });
  }

  async function setProgress(roomId, percent, message, status = "running") {
    fill.style.width = `${percent}%`;
    msg.textContent = message;
    if (roomId) {
      await writeProgress(roomId, { percent, message, status });
    }
  }

  async function scrollAll(roomId) {
    await setProgress(roomId, 8, "正在展開店家頁面...");
    let lastHeight = 0;
    for (let i = 0; i < 18; i += 1) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(700);
      const nextHeight = document.body.scrollHeight;
      await setProgress(roomId, Math.min(28, 8 + i), `正在載入商品... ${i + 1}`);
      if (nextHeight === lastHeight) break;
      lastHeight = nextHeight;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    await sleep(500);
  }

  function nearestCategory(node) {
    let current = node;
    for (let depth = 0; current && depth < 8; depth += 1) {
      let prev = current.previousElementSibling;
      while (prev) {
        const heading = prev.querySelector?.("h2,h3,h4,[data-testid*='category']");
        const headingText = cleanName(text(heading || prev));
        if (headingText && headingText.length <= 28 && !/NT\$|\$/.test(headingText)) return headingText;
        prev = prev.previousElementSibling;
      }
      current = current.parentElement;
    }
    return "foodpanda 匯入商品";
  }

  function productCandidates() {
    const nodes = Array.from(document.querySelectorAll("article, li, button, [role='button'], [data-testid], div"));
    const seen = new Set();
    const products = [];

    nodes.forEach(node => {
      const body = text(node);
      const price = priceFromText(body);
      if (!price || body.length < 8 || body.length > 700) return;

      const lines = body.split(/\n| {2,}/).map(cleanName).filter(Boolean);
      const name = lines.find(line => !/NT\$|\$|加入|選擇|查看|評分|分鐘/.test(line) && line.length >= 2 && line.length <= 42);
      if (!name) return;

      const key = `${normalize(name)}-${price}`;
      if (seen.has(key)) return;
      seen.add(key);

      const img = node.querySelector("img");
      const imageUrl = img?.currentSrc || img?.src || "";
      products.push({
        node,
        categoryName: nearestCategory(node),
        name,
        price,
        description: lines.find(line => line !== name && !line.includes(String(price)) && line.length > 4 && line.length < 120) || "",
        imageUrl
      });
    });

    return products.slice(0, 180);
  }

  function parseOptionsFromDialog(dialog) {
    const body = text(dialog);
    const sugarDefaults = ["無糖", "微糖", "半糖", "少糖", "正常糖"];
    const iceDefaults = ["去冰", "微冰", "少冰", "正常冰", "熱"];
    const additions = [];

    body.split(/\n| {2,}/).map(cleanName).forEach(line => {
      const price = priceFromText(line);
      const name = cleanName(line);
      if (!name || name.length > 32) return;
      if (/珍珠|粉粿|椰果|仙草|杏仁|布丁|奶蓋|蘆薈|寒天|芋圓|加料/.test(name)) {
        additions.push({ name: name.replace(/NT\$\s*[0-9,]+/i, "").trim(), price: price || 0 });
      }
    });

    const uniqueAdditions = Array.from(new Map(additions.map(item => [item.name, item])).values()).slice(0, 16);
    return {
      sugarOptions: sugarDefaults,
      iceOptions: iceDefaults,
      additions: uniqueAdditions
    };
  }

  async function enrichProduct(product, index, total, roomId) {
    try {
      product.node.scrollIntoView({ block: "center" });
      await sleep(180);
      product.node.click();
      await sleep(650);
      const dialog = document.querySelector("[role='dialog'], [aria-modal='true']");
      if (dialog) {
        product.specs = parseOptionsFromDialog(dialog);
        const close = dialog.querySelector("button[aria-label*='Close'], button[aria-label*='關'], button[aria-label*='close']") ||
          Array.from(dialog.querySelectorAll("button")).find(button => /×|關閉|取消/.test(text(button)));
        if (close) close.click();
        else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(250);
      }
    } catch (error) {
      product.specs = null;
    }
    await setProgress(roomId, Math.round(32 + ((index + 1) / Math.max(total, 1)) * 56), `正在讀取客製選項 ${index + 1}/${total}`);
    return product;
  }

  function fallbackSpecs(product) {
    return product.specs || {
      sugarOptions: ["無糖", "微糖", "半糖", "少糖", "正常糖"],
      iceOptions: ["去冰", "微冰", "少冰", "正常冰", "熱"],
      additions: []
    };
  }

  function restaurantName() {
    const title = cleanName(text(document.querySelector("h1")));
    return title || document.title.replace(/foodpanda.*$/i, "").trim() || "foodpanda 匯入菜單";
  }

  function buildMenu(products) {
    const grouped = new Map();
    products.forEach((product, index) => {
      const category = product.categoryName || "foodpanda 匯入商品";
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push({
        id: `fp-${Date.now()}-${index}`,
        name: product.name,
        price: product.price,
        description: product.description,
        imageUrl: product.imageUrl,
        specs: fallbackSpecs(product)
      });
    });

    return {
      restaurantName: restaurantName(),
      restaurantNote: `由 foodpanda 匯入器於 ${new Date().toLocaleString("zh-TW")} 建立的固定快照。`,
      categories: Array.from(grouped.entries()).map(([categoryName, items]) => ({ categoryName, items }))
    };
  }

  startBtn.addEventListener("click", async () => {
    const roomId = roomInput.value.trim();
    if (!roomId) {
      msg.textContent = "請輸入房間代碼";
      return;
    }

    startBtn.disabled = true;
    startBtn.textContent = "抓取中...";
    localStorage.setItem("qa-food-import-room", roomId);

    try {
      await signInAnonymously(auth);
      await setProgress(roomId, 3, "已連上 Firebase");
      await scrollAll(roomId);

      const products = productCandidates();
      if (!products.length) throw new Error("找不到商品，請確認目前是 foodpanda 店家頁，並先手動向下滑讓商品載入。");

      await setProgress(roomId, 32, `找到 ${products.length} 個商品，開始讀取客製選項`);
      const enriched = [];
      for (let i = 0; i < products.length; i += 1) {
        enriched.push(await enrichProduct(products[i], i, products.length, roomId));
      }

      const menu = buildMenu(enriched);
      await setProgress(roomId, 94, "正在寫入下午茶房間...");
      await setDoc(doc(db, "teatimeRooms", roomId), {
        roomId,
        menu,
        orders: [],
        orderClosed: false,
        importedFrom: location.href,
        importProgress: {
          status: "done",
          percent: 100,
          message: `抓取完成：${menu.categories.reduce((sum, category) => sum + category.items.length, 0)} 個商品`,
          restaurantName: menu.restaurantName,
          updatedAt: Date.now()
        },
        updatedAt: Date.now()
      }, { merge: true });
      await setProgress(roomId, 100, `抓取完成：${menu.restaurantName}`, "done");
      startBtn.textContent = "抓取完成";
    } catch (error) {
      console.error(error);
      await setProgress(roomInput.value.trim(), 100, `抓取失敗：${error.message}`, "error");
      startBtn.disabled = false;
      startBtn.textContent = "重新抓取";
    }
  });
})();
