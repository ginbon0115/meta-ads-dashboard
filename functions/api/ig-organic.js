export async function onRequestGet(context) {
  const { env } = context;
  const token = env.META_ACCESS_TOKEN;
  const adAccountId = env.AD_ACCOUNT_ID;

  function classifyContent(caption) {
    const text = (caption || '').toLowerCase();
    const groupKeywords = ['團購', '進群', '社群', 'line', '加入', '社團', '私訊', '留言'];
    const purchaseKeywords = ['購買', '下單', '連結', '訂購', '購買頁', '點連結', '搶購', '限量', '馬上買'];
    const knowledgeKeywords = ['你知道嗎', '其實', '原來', '教你', '秘密', '差別', '為什麼', '認識', '注意', '迷思', '真的嗎', '檢測', '認證'];
    const lifestyleKeywords = ['我家', '孩子', '小孩', '老婆', '日常', '分享', '帶你', '今天', '阿嫤', '家人'];
    if (groupKeywords.some(k => text.includes(k))) return 'group';
    if (purchaseKeywords.some(k => text.includes(k))) return 'purchase';
    if (knowledgeKeywords.some(k => text.includes(k))) return 'knowledge';
    if (lifestyleKeywords.some(k => text.includes(k))) return 'lifestyle';
    return 'mixed';
  }

  // 純有機評分（最高 59 分，確保有廣告數據的排前面）
  function calculateOrganicScore(saveRate, avgWatchSec, plays, intentCount) {
    let intentScore = 0;
    if (intentCount >= 20) intentScore = 45;
    else if (intentCount >= 10) intentScore = 36;
    else if (intentCount >= 5) intentScore = 27;
    else if (intentCount >= 2) intentScore = 18;
    else if (intentCount >= 1) intentScore = 10;

    let saveScore = 3;
    if (saveRate >= 5) saveScore = 35;
    else if (saveRate >= 3) saveScore = 28;
    else if (saveRate >= 2) saveScore = 21;
    else if (saveRate >= 1) saveScore = 14;
    else if (saveRate >= 0.5) saveScore = 8;

    let watchScore = 1;
    if (avgWatchSec >= 25) watchScore = 15;
    else if (avgWatchSec >= 20) watchScore = 12;
    else if (avgWatchSec >= 15) watchScore = 9;
    else if (avgWatchSec >= 10) watchScore = 6;
    else if (avgWatchSec >= 6) watchScore = 3;

    let playsScore = 1;
    if (plays >= 100000) playsScore = 5;
    else if (plays >= 50000) playsScore = 4;
    else if (plays >= 20000) playsScore = 3;
    else if (plays >= 10000) playsScore = 2;

    const raw = intentScore + saveScore + watchScore + playsScore;
    return {
      total: Math.min(59, raw),
      intent: intentScore,
      save: saveScore,
      watch: watchScore,
      plays: playsScore
    };
  }

  // 廣告數據評分（基礎 60 分起跳）
  function calculateAdScore(adData) {
    let score = 60;
    const cpp = adData.cost_per_message || 0;
    const messages = adData.messages || 0;

    if (cpp <= 10) score += 30;
    else if (cpp <= 20) score += 15;
    else score += 5;

    if (messages >= 300) score += 10;

    return Math.min(100, score);
  }

  function getGrade(score) {
    if (score >= 75) return { label: '強烈建議投', color: '#e85d04', show_ad: true };
    if (score >= 55) return { label: '建議投', color: '#2d6a4f', show_ad: true };
    if (score >= 35) return { label: '看情況', color: '#b5851a', show_ad: true };
    return { label: '暫不建議投', color: '#666', show_ad: false };
  }

  function getRecommendation(contentType, saveRate, shareRate, avgWatchSec, plays, intentCount) {
    const highSave = saveRate > 5;
    const goodEngagement = saveRate > 2 || shareRate > 1.5;
    const lowEngagement = saveRate < 0.5 && shareRate < 0.5 && plays < 1000;
    const hasIntent = intentCount >= 1;

    if (lowEngagement && !hasIntent) {
      return { ad_type: 'skip', reason: '觸及太低，先優化有機成效再考慮投廣' };
    }
    if (hasIntent) {
      return { ad_type: 'messaging', reason: `留言中有 ${intentCount} 則購買意圖，私訊廣告乘勝追擊直接轉換` };
    }
    if (contentType === 'group') {
      if (highSave) return { ad_type: 'messaging', reason: `儲存率 ${saveRate.toFixed(1)}% 高，有進群意愿，私訊廣告直接帶人加 LINE 群` };
      if (goodEngagement) return { ad_type: 'messaging', reason: '團購型內容互動佳，私訊廣告直接帶進 LINE 群轉換' };
      return { ad_type: 'messaging', reason: '團購型內容 CTA 是進群，對應私訊廣告' };
    }
    if (contentType === 'purchase') {
      if (highSave) return { ad_type: 'conversion', reason: `儲存率 ${saveRate.toFixed(1)}% 高，有購買意圖，轉換廣告追真實 ROAS` };
      if (goodEngagement) return { ad_type: 'conversion', reason: '導購型內容互動佳，轉換廣告直追購買 ROAS' };
      return { ad_type: 'reach', reason: '導購型但互動偏低，先投觸及廣告養溫，再轉換廣告收割' };
    }
    if (contentType === 'knowledge') {
      if (highSave) return { ad_type: 'reach', reason: `儲存率 ${saveRate.toFixed(1)}% 高，知識型好內容，觸及廣告讓更多陌生人看到` };
      return { ad_type: 'reach', reason: '知識型影片建立「他懂這個」印象，觸及廣告養陌生受眾最有效' };
    }
    if (contentType === 'lifestyle') {
      if (shareRate > 2) return { ad_type: 'reach', reason: `分享率 ${shareRate.toFixed(1)}% 高，生活型內容有擴散力，觸及廣告讓更多人認識小赫` };
      return { ad_type: 'reach', reason: '生活型影片適合 IP 建立，投觸及廣告讓陌生受眾認識你這個人' };
    }
    if (highSave) return { ad_type: 'messaging', reason: `儲存率 ${saveRate.toFixed(1)}% 高，有購買/進群意愿，私訊廣告乘勝追擊` };
    if (shareRate > 3) return { ad_type: 'reach', reason: `分享率 ${shareRate.toFixed(1)}% 高，擴散潛力強，觸及廣告讓更多人看到` };
    if (avgWatchSec > 15) return { ad_type: 'reach', reason: `平均觀看 ${avgWatchSec} 秒，留住率高，觸及廣告養溫受眾` };
    return { ad_type: 'reach', reason: '建議先投觸及廣告擴大曝光，觀察受眾反應' };
  }

  try {
    // 1. 取得 IG 帳號 ID
    const pagesRes = await fetch(
      `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,instagram_business_account{id,name,username}&access_token=${token}`
    );
    const pagesData = await pagesRes.json();

    let igId = null, igUsername = null;
    for (const page of (pagesData.data || [])) {
      if (page.instagram_business_account) {
        igId = page.instagram_business_account.id;
        igUsername = page.instagram_business_account.username;
        break;
      }
    }
    if (!igId) { igId = '17841453561052646'; igUsername = 'hehehaxi0115'; }

    // 2. Cursor-based pagination 抓全部貼文（每頁 50 筆）
    let allMedia = [];
    let nextUrl = `https://graph.facebook.com/v25.0/${igId}/media?` +
      `fields=id,caption,media_type,media_product_type,timestamp,permalink` +
      `&limit=50&access_token=${token}`;

    while (nextUrl && allMedia.length < 500) {
      const mediaRes = await fetch(nextUrl);
      const mediaData = await mediaRes.json();
      const pageItems = mediaData.data || [];
      allMedia = allMedia.concat(pageItems);

      if (mediaData.paging && mediaData.paging.next) {
        nextUrl = mediaData.paging.next;
      } else {
        nextUrl = null;
      }
    }

    // 3. 過濾影片，上限 100 支
    const videoMedia = allMedia
      .filter(m => m.media_type === 'VIDEO' || m.media_product_type === 'REELS')
      .slice(0, 100);

    // 4. 拉廣告素材，做 permalink 比對
    let adPermalinkMap = {};
    if (adAccountId) {
      try {
        const adsRes = await fetch(
          `https://graph.facebook.com/v19.0/act_${adAccountId}/ads` +
          `?fields=id,name,creative{instagram_permalink_url,video_id},insights{spend,actions}` +
          `&date_preset=last_90d&limit=100&access_token=${token}`
        );
        const adsData = await adsRes.json();
        for (const ad of (adsData.data || [])) {
          const igUrl = ad.creative?.instagram_permalink_url;
          if (!igUrl) continue;

          const insights = ad.insights?.data?.[0] || {};
          const spendUSD = parseFloat(insights.spend || 0);
          const spend = Math.round(spendUSD * 30); // USD → NT$
          const actions = insights.actions || [];
          const msgAction = actions.find(a =>
            a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
            a.action_type === 'onsite_conversion.total_messaging_connection'
          );
          const msgCount = parseInt(msgAction?.value || 0);
          const costPerMsg = msgCount > 0 ? Math.round(spend / msgCount * 100) / 100 : null;

          adPermalinkMap[igUrl] = {
            ad_name: ad.name,
            spend,
            messages: msgCount,
            cost_per_message: costPerMsg
          };
        }
      } catch (e) {
        // 廣告 API 失敗不影響主流程
      }
    }

    // 5. 查所有影片的 insights
    const reels = await Promise.all(videoMedia.map(async (m) => {
      let totalTime = 0, reach = 0, saved = 0, shares = 0, avgWatch = 0;
      try {
        const insRes = await fetch(
          `https://graph.facebook.com/v25.0/${m.id}/insights?` +
          `metric=reach,saved,shares,ig_reels_avg_watch_time,ig_reels_video_view_total_time` +
          `&access_token=${token}`
        );
        const insData = await insRes.json();
        for (const item of (insData.data || [])) {
          const v = item.values?.[0]?.value ?? item.value ?? 0;
          if (item.name === 'reach') reach = v;
          if (item.name === 'saved') saved = v;
          if (item.name === 'shares') shares = v;
          if (item.name === 'ig_reels_avg_watch_time') avgWatch = v;
          if (item.name === 'ig_reels_video_view_total_time') totalTime = v;
        }
      } catch (e) {}

      // 抓留言（最多100則）
      let comments = [];
      let intentCount = 0;
      try {
        const commentsRes = await fetch(
          `https://graph.facebook.com/v25.0/${m.id}/comments?fields=id,text&limit=100&access_token=${token}`
        );
        const commentsData = await commentsRes.json();
        comments = commentsData.data || [];

        const intentKeywords = [
          '連結', '想買', '+1', '🔥', '加入', '團購', '在哪', '哪裡買',
          '怎麼買', '購買', '下單', '要買', '我要', '訂購', '預購', '報名',
          '詢問', '私訊', 'dm', 'DM', 'link', '連', '1', '１'
        ];

        intentCount = comments.filter(c => {
          const text = (c.text || '');
          return intentKeywords.some(k => text.includes(k));
        }).length;
      } catch (e) {}

      const totalComments = comments.length;
      const plays = avgWatch > 0 ? Math.round(totalTime / avgWatch) : 0;
      const saveRate = reach > 0 ? saved / reach * 100 : 0;
      const shareRate = reach > 0 ? shares / reach * 100 : 0;
      const watchSec = Math.round(avgWatch / 1000);

      // 6. 廣告交叉比對
      const adData = m.permalink ? (adPermalinkMap[m.permalink] || null) : null;

      // 7. 依有無廣告數據走不同評分邏輯
      let scoreData, totalScore;
      if (adData) {
        totalScore = calculateAdScore(adData);
        const cpp = adData.cost_per_message || 0;
        scoreData = {
          total: totalScore,
          ad_base: 60,
          ad_cpp_bonus: cpp <= 10 ? 30 : cpp <= 20 ? 15 : 5,
          ad_msg_bonus: adData.messages >= 300 ? 10 : 0
        };
      } else {
        const organic = calculateOrganicScore(saveRate, watchSec, plays, intentCount);
        totalScore = organic.total;
        scoreData = { total: totalScore, intent: organic.intent, save: organic.save, watch: organic.watch, plays: organic.plays };
      }

      const contentType = classifyContent(m.caption);
      const rec = getRecommendation(contentType, saveRate, shareRate, watchSec, plays, intentCount);
      const grade = getGrade(totalScore);

      return {
        id: m.id,
        caption: (m.caption || '').substring(0, 100),
        timestamp: m.timestamp,
        permalink: m.permalink,
        media_type: m.media_type,
        media_product_type: m.media_product_type,
        plays, reach, saved, shares,
        avg_watch_sec: watchSec,
        save_rate: Math.round(saveRate * 10) / 10,
        share_rate: Math.round(shareRate * 10) / 10,
        intent_comments: intentCount,
        total_comments: totalComments,
        score: totalScore,
        grade_label: grade.label,
        grade_color: grade.color,
        grade_show_ad: grade.show_ad,
        score_breakdown: scoreData,
        content_type: contentType,
        ad_type_recommendation: rec.ad_type,
        recommendation_reason: rec.reason,
        ig_username: igUsername,
        ad_data: adData
      };
    }));

    reels.sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({
      ig_id: igId, ig_username: igUsername, reels,
      debug: {
        total_media: allMedia.length,
        video_count: videoMedia.length,
        ad_matched: reels.filter(r => r.ad_data !== null).length,
        pages_error: pagesData.error || null
      }
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
