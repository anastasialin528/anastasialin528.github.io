/* api.js — 全站共用的後端 Web App 端點（/exec） */
window.API_URL = 'https://script.google.com/macros/s/AKfycbwMd1KYDGOl74_qIc_H-FNUHHdtttz3Efwhlv12SadWQc2v6GOfcRSy9I6p_863aeqO/exec';

/* ====== 統計模組（首頁 + 內文頁通用） ====== */

// 本地快取 key（用 localStorage 存，讓數字秒顯示）
const LS_CACHE_KEY = 'stats-cache-v1';
// 防止同一個人同一篇文章重複按讚的 key 前綴
const LIKE_FLAG_PREFIX = 'liked:';
// 首頁很多篇文章時，一次最多請求幾篇（避免 payload 太大）
const BATCH_MAX = 80;

/** 工具：讀取/儲存本地快取 **/
function loadLocalCache() {
  try { return JSON.parse(localStorage.getItem(LS_CACHE_KEY) || '{}'); }
  catch { return {}; }
}
function saveLocalCache(obj) {
  try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify(obj)); } catch {}
}

/** 先把快取數字灌進畫面（瀏覽數 / 讚數） **/
function hydrateFromCache(ids) {
  const cache = loadLocalCache();
  ids.forEach(id => {
    const box = document.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
    if (!box) return;
    const stat = cache[id];
    if (!stat) return;
    const v = box.querySelector('.views');
    const l = box.querySelector('.likes');
    if (v && typeof stat.views === 'number') v.textContent = stat.views;
    if (l && typeof stat.likes === 'number') l.textContent = stat.likes;
  });
}

/** 批次向後端拿最新數字 **/
async function fetchStatsBatch(ids) {
  const res = await fetch(window.API_URL, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ action:'get', ids })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.msg || 'server error');
  return json.data; // { id: {views,likes}, ... }
}

/** 把最新數字更新到畫面 + 本地快取 **/
function applyStatsToDomAndCache(obj) {
  const cache = loadLocalCache();
  Object.entries(obj).forEach(([id, {views, likes}]) => {
    cache[id] = { views: Number(views)||0, likes: Number(likes)||0 };
    const box = document.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
    if (!box) return;
    const v = box.querySelector('.views');
    const l = box.querySelector('.likes');
    if (v) v.textContent = cache[id].views;
    if (l) l.textContent = cache[id].likes;
  });
  saveLocalCache(cache);
}

/** 回報瀏覽數（用 sendBeacon，不會卡住頁面） **/
function reportView(id) {
  const payload = { action:'view', id };
  const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
  const ok = navigator.sendBeacon(window.API_URL, blob);
  if (!ok) {
    fetch(window.API_URL, { 
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body: JSON.stringify(payload), 
      keepalive:true 
    }).catch(()=>{});
  }
}

/** 處理按讚按鈕（樂觀更新 + 防連按） **/
function setupLikeHandler() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.like-btn');
    if (!btn) return;
    const id = btn.dataset.postId;
    if (!id) return;
    const flagKey = LIKE_FLAG_PREFIX + id;
    if (localStorage.getItem(flagKey)) {
      // 已經按過讚，不重複送
      return;
    }
    // 樂觀 +1
    const box = document.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
    const span = box?.querySelector('.likes');
    const original = Number(span?.textContent || 0);
    if (span) span.textContent = original + 1;
    btn.disabled = true;

    try {
      // **修改點 1：將 GET 請求改為 POST 請求，並將資料放入 body**
      const payload = { action: 'like', id: id };
      const res = await fetch(window.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      if (!json.ok) throw new Error(json.msg || 'like failed');
      // 成功：標記已按過讚 + 更新快取
      localStorage.setItem(flagKey, '1');
      const cache = loadLocalCache();
      cache[id] = cache[id] || {views:0, likes:0};
      cache[id].likes = Number(json.likes)|| (original+1);
      saveLocalCache(cache);
    } catch (err) {
      // 失敗：還原
      if (span) span.textContent = original;
      btn.disabled = false;
      alert('送出失敗，等等再試試');
    }
  });
}

/** 主流程：自動執行 **/
(async function main(){
  // 收集頁面上所有 data-post-id
  const ids = [...document.querySelectorAll('[data-post-id]')].map(el => el.dataset.postId);
  if (!ids.length) return;

  // 先用本地快取填數字
  hydrateFromCache(ids);

  // 再向後端批次拿最新數字（必要時分批）
  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    const slice = ids.slice(i, i + BATCH_MAX);
    try {
      const data = await fetchStatsBatch(slice);
      applyStatsToDomAndCache(data);
    } catch (err) {
      console.warn('fetchStatsBatch error:', err);
    }
  }

  // **修改點 2：回報瀏覽數的邏輯只在單篇文章頁面執行**
  // 檢查是否為單篇文章頁面，如果是，才回報瀏覽數。
  if (ids.length === 1) {
    const primaryId = ids[0];
    window.addEventListener('load', () => setTimeout(() => reportView(primaryId), 300));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') reportView(primaryId);
    });
  }

  // 啟用按讚事件監聽
  setupLikeHandler();
})();
