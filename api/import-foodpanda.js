const PRICE_RE = /(?:NT\$|\$)\s*([0-9,]+)/i;

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toPrice(value) {
  if (typeof value === "number") return value > 1000 ? Math.round(value / 100) : value;
  const match = cleanText(value).match(PRICE_RE);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function normalizeUrl(input) {
  const url = new URL(input);
  if (!/foodpanda\.com\.tw$/i.test(url.hostname) && !/\.foodpanda\.com\.tw$/i.test(url.hostname)) {
    throw new Error("請貼 foodpanda 台灣店家網址");
  }
  return url.toString();
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractJsonPayloads(html) {
  const payloads = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html))) {
    const body = match[1]?.trim();
    if (!body || body.length < 20) continue;
    if (body.startsWith("{") || body.startsWith("[")) {
      const parsed = safeJsonParse(body);
      if (parsed) payloads.push(parsed);
    }
    const nextMatch = body.match(/self\.__next_f\.push\(\s*(\[.*\])\s*\)/s);
    if (nextMatch) {
      const parsed = safeJsonParse(nextMatch[1]);
      if (parsed) payloads.push(parsed);
    }
  }

  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextData) {
    const parsed = safeJsonParse(nextData[1]);
    if (parsed) payloads.push(parsed);
  }
  return payloads;
}

function walk(value, visitor, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach(item => walk(item, visitor, seen));
    return;
  }
  Object.values(value).forEach(item => walk(item, visitor, seen));
}

function findString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && cleanText(value)) return cleanText(value);
  }
  return "";
}

function findImage(obj) {
  const direct = findString(obj, ["image", "imageUrl", "image_url", "photo", "photoUrl", "picture", "logo"]);
  if (direct) return direct;
  for (const key of ["images", "image_urls", "photos", "pictures"]) {
    const value = obj?.[key];
    if (Array.isArray(value)) {
      const found = value.find(item => typeof item === "string") || value.map(findImage).find(Boolean);
      if (found) return found;
    }
  }
  return "";
}

function findPrice(obj) {
  for (const key of ["price", "unitPrice", "priceValue", "displayPrice", "formattedPrice", "originalPrice"]) {
    const price = toPrice(obj?.[key]);
    if (price) return price;
  }
  return 0;
}

function parseModifierGroups(obj) {
  const additions = [];
  const sugarOptions = new Set();
  const iceOptions = new Set();
  const defaultSugar = ["無糖", "微糖", "半糖", "少糖", "正常糖"];
  const defaultIce = ["去冰", "微冰", "少冰", "正常冰", "熱"];

  walk(obj, node => {
    const name = findString(node, ["name", "title", "label", "displayName"]);
    if (!name || name.length > 32) return;
    if (/無糖|微糖|半糖|少糖|正常糖|全糖/.test(name)) sugarOptions.add(name);
    if (/去冰|微冰|少冰|正常冰|熱|溫/.test(name)) iceOptions.add(name);
    if (/珍珠|粉粿|椰果|仙草|杏仁|布丁|奶蓋|蘆薈|寒天|芋圓|加料|波霸/.test(name)) {
      additions.push({ name, price: findPrice(node) || 0 });
    }
  });

  return {
    sugarOptions: sugarOptions.size ? Array.from(sugarOptions) : defaultSugar,
    iceOptions: iceOptions.size ? Array.from(iceOptions) : defaultIce,
    additions: Array.from(new Map(additions.map(item => [item.name, item])).values()).slice(0, 20)
  };
}

function parseFromJson(payloads) {
  const products = [];
  const seen = new Set();
  let restaurantName = "";

  payloads.forEach(payload => {
    walk(payload, node => {
      const possibleRestaurant = findString(node, ["restaurantName", "vendorName", "name", "title"]);
      if (!restaurantName && possibleRestaurant && /restaurant|vendor|chain|brand/i.test(Object.keys(node).join(" "))) {
        restaurantName = possibleRestaurant;
      }

      const name = findString(node, ["name", "title", "productName", "itemName", "dishName"]);
      const price = findPrice(node);
      if (!name || !price || name.length > 80) return;

      const objectKeys = Object.keys(node).join(" ").toLowerCase();
      if (!/product|dish|item|menu|food|price|variation/.test(objectKeys)) return;

      const key = `${name.toLowerCase()}-${price}`;
      if (seen.has(key)) return;
      seen.add(key);

      products.push({
        name,
        price,
        description: findString(node, ["description", "subtitle", "shortDescription"]),
        imageUrl: findImage(node),
        categoryName: findString(node, ["categoryName", "menuCategory", "category"]) || "foodpanda 匯入商品",
        specs: parseModifierGroups(node)
      });
    });
  });

  return { restaurantName, products };
}

function parseFromHtml(html) {
  const title = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "foodpanda 匯入菜單");
  const cards = [];
  const blockRe = /<(?:article|li|div|button)[^>]*>(?=[\s\S]{0,1200}?(?:NT\$|\$)\s*[0-9,]+)([\s\S]{20,1800}?)<\/(?:article|li|div|button)>/gi;
  let match;
  const seen = new Set();
  while ((match = blockRe.exec(html))) {
    const block = match[0];
    const plain = cleanText(block);
    const price = toPrice(plain);
    if (!price) continue;
    const img = block.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1] || "";
    const name = cleanText(plain.replace(PRICE_RE, "").split(/加入|選擇|查看|熱門|推薦/)[0]).slice(0, 80);
    if (!name || name.length < 2) continue;
    const key = `${name.toLowerCase()}-${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      name,
      price,
      description: "",
      imageUrl: img,
      categoryName: "foodpanda 匯入商品",
      specs: parseModifierGroups({ name })
    });
  }
  return { restaurantName: title.replace(/\s*\|\s*foodpanda.*$/i, ""), products: cards };
}

function makeMenu(url, restaurantName, products) {
  if (!products.length) {
    throw new Error("沒有解析到商品。foodpanda 可能改版或需要登入/地區資訊。");
  }
  const grouped = new Map();
  products.slice(0, 220).forEach((product, index) => {
    const categoryName = product.categoryName || "foodpanda 匯入商品";
    if (!grouped.has(categoryName)) grouped.set(categoryName, []);
    grouped.get(categoryName).push({
      id: `fp-${Date.now()}-${index}`,
      name: product.name,
      price: product.price,
      description: product.description || "",
      imageUrl: product.imageUrl || "",
      specs: product.specs || {
        sugarOptions: ["無糖", "微糖", "半糖", "少糖", "正常糖"],
        iceOptions: ["去冰", "微冰", "少冰", "正常冰", "熱"],
        additions: []
      }
    });
  });
  return {
    restaurantName: restaurantName || "foodpanda 匯入菜單",
    restaurantNote: `由 foodpanda 於 ${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 匯入的固定快照。`,
    importedFrom: url,
    categories: Array.from(grouped.entries()).map(([categoryName, items]) => ({ categoryName, items }))
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const url = normalizeUrl(req.body?.url || "");
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-TW,zh;q=0.9,en;q=0.8"
      }
    });
    if (!response.ok) throw new Error(`foodpanda 回應 ${response.status}`);
    const html = await response.text();

    const jsonParsed = parseFromJson(extractJsonPayloads(html));
    const htmlParsed = jsonParsed.products.length ? { restaurantName: "", products: [] } : parseFromHtml(html);
    const products = jsonParsed.products.length ? jsonParsed.products : htmlParsed.products;
    const restaurantName = jsonParsed.restaurantName || htmlParsed.restaurantName;
    const menu = makeMenu(url, restaurantName, products);
    return res.status(200).json({ menu, count: products.length });
  } catch (error) {
    return res.status(400).json({ error: error.message || "匯入失敗" });
  }
}
