export async function onRequestGet(context) {
  const { env } = context;
  const token = env.META_ACCESS_TOKEN;
  const rawAdAccountId = env.AD_ACCOUNT_ID || '';
  const adAccountId = rawAdAccountId.replace(/^act_/, '');

  const INTENT_KEYWORDS = ['連結','怎麼買','想知道','想了解','想入群','想買','哪裡買','🙌','+1','加入'];
  const MIN_RATIO = 0.05; // 最低門檻 %

  async function batchFetch(requests, tokenStr) {
    const chunks = [];
    for (let i = 0; i < requests.length; i += 50) {
      chunks.push(requests.slice(i, i + 50));
    }
    const chunkResults = await Promise.all(chunks.map(chunk =>
      fetch('https://graph.facebook.com/v25.0/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: chunk, access_token: tokenStr })
      }).then(r => r.json()).then(d => Array.isArray(d) ? d : [])
    ));
    return chunkResults.flat();
  }

  try {
    // 快取讀取（TTL 1小時）
    const CACHE_KEY = 'ig_organic_cache';
    const cached = await context.env.IG_ORGANIC_CACHE?.get(CACHE_KEY);
    if (cached) {
      return new Response(cached, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Cache': 'HIT' } });
    }

    // 1. 取 IG 帳號 ID
    // System User Token 只有 ads_management 權限，/me/accounts 回傳空陣列
    // 需要 instagram_basic + pages_read_engagement 才能讀 IG
    // 暫時 hardcode IG ID，先測試 token 是否有 IG 讀取能力
    const IG_ID_HARDCODED = env.IG_ACCOUNT_ID || '17841453561052646';
    const IG_USERNAME_HARDCODED = 'hehehaxi0115';

    // 先嘗試用 /me/accounts 動態取得（有正確權限時會成功）
    let igId = null, igUsername = null;
    try {
      const pagesRes = await fetch(`https://graph.facebook.com/v25.0/me/accounts?fields=id,name,instagram_business_account{id,name,username}&access_token=${token}`);
      const pagesData = await pagesRes.json();
      for (const p of (pagesData.data || [])) {
        if (p.instagram_business_account) { igId = p.instagram_business_account.id; igUsername = p.instagram_business_account.username; break; }
      }
    } catch (_) {}

    // fallback：hardcode
    if (!igId) { igId = IG_ID_HARDCODED; igUsername = IG_USERNAME_HARDCODED; }

    // 先測試這個 token 是否真的能讀 IG media
    const igTestRes = await fetch(`https://graph.facebook.com/v25.0/${igId}?fields=id,username,media_count&access_token=${token}`);
    const igTestData = await igTestRes.json();
    if (igTestData.error) {
      // Token 沒有 IG 讀取權限，回傳明確說明
      return new Response(JSON.stringify({
        error: 'token_missing_ig_permission',
        message: 'Token 缺少 instagram_basic 權限，無法讀取 IG 資料。請到 Meta Business Suite 幫 System User 加上 instagram_basic、instagram_manage_insights、pages_read_engagement 權限後重新產生 Token。',
        token_scopes: ['ads_management', 'public_profile'],
        required_scopes: ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement', 'pages_show_list'],
        ig_id_attempted: igId,
        api_error: igTestData.error
      }), { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    // 2. 翻完所有公開貼文
    let allMedia = [];
    let nextUrl = `https://graph.facebook.com/v25.0/${igId}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink&limit=100&access_token=${token}`;
    let pageCount = 0;
    while (nextUrl && pageCount < 10) {
      const r = await fetch(nextUrl);
      const d = await r.json();
      allMedia = allMedia.concat(d.data || []);
      pageCount++;
      nextUrl = d.paging?.next || null;
    }
    const videoMedia = allMedia.filter(m => m.media_type === 'VIDEO' || m.media_product_type === 'REELS');

    // 3. 廣告素材比對
    let adPermalinkMap = {}, adVideoIdMap = {};
    if (adAccountId) {
      try {
        const adsRes = await fetch(`https://graph.facebook.com/v25.0/act_${adAccountId}/ads?fields=id,name,creative{id,instagram_permalink_url,video_id},insights.date_preset(last_90d){spend,actions}&limit=200&access_token=${token}`);
        const adsData = await adsRes.json();
        const MSG_TYPES = ['onsite_conversion.messaging_conversation_started_7d','onsite_conversion.total_messaging_connection','onsite_conversion.messaging_first_reply','messaging_first_reply'];
        for (const ad of (adsData.data || [])) {
          const igUrl = ad.creative?.instagram_permalink_url;
          const videoId = ad.creative?.video_id;
          const ins = ad.insights?.data?.[0] || {};
          const spend = parseFloat(ins.spend || 0);
          const actions = ins.actions || [];
          let msgCount = 0;
          for (const t of MSG_TYPES) { const f = actions.find(a => a.action_type === t); if (f) msgCount = Math.max(msgCount, parseInt(f.value || 0)); }
          const adEntry = { ad_name: ad.name, spend, messages: msgCount, cost_per_message: msgCount > 0 ? Math.round(spend / msgCount * 100) / 100 : null };
          if (igUrl) { const n = igUrl.replace(/\/$/, ''); adPermalinkMap[n] = adEntry; adPermalinkMap[n + '/'] = adEntry; }
          if (videoId) adVideoIdMap[videoId] = adEntry;
        }
      } catch (_) {}
    }

    // 4. Batch 拉全部影片 insights
    const insightRequests = videoMedia.map(m => ({
      method: 'GET',
      relative_url: `${m.id}/insights?metric=reach,saved,shares,ig_reels_avg_watch_time,ig_reels_video_view_total_time`
    }));
    // 5. Batch 拉全部影片留言（全部，不限前50）
    const commentRequests = videoMedia.map(m => ({
      method: 'GET',
      relative_url: `${m.id}/comments?fields=id,text&summary=true&limit=100`
    }));

    const [insightResults, commentResults] = await Promise.all([
      batchFetch(insightRequests, token),
      batchFetch(commentRequests, token)
    ]);

    // 6. 整合資料，計算 intent_ratio
    const reels = videoMedia.map((m, i) => {
      // insights
      let reach = 0, saved = 0, shares = 0, avgWatch = 0, totalTime = 0;
      const ins = insightResults[i];
      if (ins && ins.code === 200) {
        try {
          const d = JSON.parse(ins.body);
          for (const item of (d.data || [])) {
            const v = item.values?.[0]?.value ?? item.value ?? 0;
            if (item.name === 'reach') reach = v;
            if (item.name === 'saved') saved = v;
            if (item.name === 'shares') shares = v;
            if (item.name === 'ig_reels_avg_watch_time') avgWatch = v;
            if (item.name === 'ig_reels_video_view_total_time') totalTime = v;
          }
        } catch (_) {}
      }
      const plays = avgWatch > 0 ? Math.round(totalTime / avgWatch) : 0;
      const watchSec = Math.round(avgWatch / 1000);

      // comments
      let totalComments = 0, intentComments = 0;
      const cmt = commentResults[i];
      if (cmt && cmt.code === 200) {
        try {
          const d = JSON.parse(cmt.body);
          const comments = d.data || [];
          totalComments = d.summary?.total_count ?? comments.length;
          intentComments = comments.filter(c => INTENT_KEYWORDS.some(k => (c.text || '').includes(k))).length;
        } catch (_) {}
      }

      const intentRatio = plays > 0 ? intentComments / plays * 100 : 0;

      // ad data
      let adData = null;
      const normLink = (m.permalink || '').replace(/\/$/, '');
      if (normLink && adPermalinkMap[normLink]) adData = adPermalinkMap[normLink];
      else if (m.permalink && adPermalinkMap[m.permalink]) adData = adPermalinkMap[m.permalink];
      else if (m.id && adVideoIdMap[m.id]) adData = adVideoIdMap[m.id];

      return {
        id: m.id,
        caption: (m.caption || '').substring(0, 100),
        timestamp: m.timestamp,
        permalink: m.permalink,
        plays,
        reach,
        saved,
        shares,
        avg_watch_sec: watchSec,
        intent_comments: intentComments,
        total_comments: totalComments,
        intent_ratio: Math.round(intentRatio * 10000) / 10000,
        ad_data: adData,
        ig_username: igUsername,
      };
    });

    // 7. 過濾 + 排序
    const filtered = reels
      .filter(r => r.intent_ratio >= MIN_RATIO)
      .sort((a, b) => b.intent_ratio - a.intent_ratio);

    const responseBody = JSON.stringify({
      ig_id: igId,
      ig_username: igUsername,
      total_videos: videoMedia.length,
      shown_videos: filtered.length,
      reels: filtered,
      debug: { total_media: allMedia.length, video_count: videoMedia.length, pages_fetched: pageCount }
    });
    await context.env.IG_ORGANIC_CACHE?.put(CACHE_KEY, responseBody, { expirationTtl: 3600 });
    return new Response(responseBody, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Cache': 'MISS' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
