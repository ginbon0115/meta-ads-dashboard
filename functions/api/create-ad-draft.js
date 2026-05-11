export async function onRequestPost(context) {
  const { env, request } = context;
  const TOKEN = env.META_ACCESS_TOKEN;
  const ACCOUNT = "act_893698616001048";
  const IG_ACTOR_ID = "17841453561052646";
  const PAGE_ID = "248488591682054";

  // Audience IDs（2026-05-11 更新，全部有效）
  const AUDIENCES = {
    lookalike_1p: "120244307160720375",  // 類似廣告受眾 (1%) - 1shop購買者名單
    video_view_25: "120244307204000375", // 水果導社群的相關影片
    ig_profile: "120244307153430375",    // IG商業檔案近365天互動過
    buyers: "120244278842650375",        // 1shop購買者名單
  };

  // 目前有效的受眾 ID
  const VALID_AUDIENCE_IDS = new Set([
    "120244307160720375",
    "120244307204000375",
    "120244307153430375",
    "120244278842650375",
  ]);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid JSON body", step: "parse" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { reel_id, reel_permalink, ad_type, budget, days, caption } = body;

  if (!reel_id || !ad_type || !budget) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing required fields: reel_id, ad_type, budget", step: "validate" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const dateStr = new Date().toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" }).replace("/", "");
  const shortCaption = (caption || "").substring(0, 20).trim();
  const campaignName = `【草稿】${shortCaption} - ${ad_type} - ${dateStr}`;

  // Objective mapping
  // 全部用 OUTCOME_ENGAGEMENT，才能複製 template adset（120239729095080375 是 ENGAGEMENT）
  // reach/conversion 只是受眾策略不同，objective 一致才不會 Objective Mismatch
  const objectiveMap = {
    reach: "OUTCOME_ENGAGEMENT",
    engagement: "OUTCOME_ENGAGEMENT",
    conversion: "OUTCOME_ENGAGEMENT",
  };

  // Optimization goal mapping
  // engagement 用 POST_ENGAGEMENT（與 template adset 120239729095080375 一致，
  // 避免 copy 後 update 時 attribution_spec 衝突）
  const optimizationMap = {
    reach: "POST_ENGAGEMENT",
    engagement: "POST_ENGAGEMENT",
    conversion: "POST_ENGAGEMENT",
  };

  // Audience targeting by ad type
  const targetingMap = {
    reach: {
      include: [{ id: AUDIENCES.lookalike_1p }],
      exclude: [],
    },
    engagement: {
      include: [{ id: AUDIENCES.video_view_25 }, { id: AUDIENCES.ig_profile }],
      exclude: [{ id: AUDIENCES.buyers }],
    },
    conversion: {
      include: [{ id: AUDIENCES.buyers }, { id: AUDIENCES.lookalike_1p }],
      exclude: [],
    },
  };

  const audienceConfig = targetingMap[ad_type] || targetingMap.engagement;

  // ── Step 1: Campaign ──────────────────────────────────────────────────────
  let campaignId;
  try {
    const campaignBody = new URLSearchParams({
      name: campaignName,
      objective: objectiveMap[ad_type] || "OUTCOME_ENGAGEMENT",
      status: "PAUSED",
      special_ad_categories: JSON.stringify([]),
      is_adset_budget_sharing_enabled: "false",
      access_token: TOKEN,
    });

    const campaignRes = await fetch(
      `https://graph.facebook.com/v25.0/${ACCOUNT}/campaigns`,
      { method: "POST", body: campaignBody }
    );
    const campaignData = await campaignRes.json();

    if (campaignData.error) {
      return new Response(
        JSON.stringify({ success: false, error: campaignData.error.error_user_msg || campaignData.error.message, error_detail: JSON.stringify(campaignData.error), step: "campaign" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    campaignId = campaignData.id;
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message, step: "campaign" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Step 2: Ad Set（複製 template adset，繞過台灣廣告主驗證）────────────────
  // Template adset 120243110991180375：（4/21）淨淨&荷康 campaign 底下的組合
  // optimization_goal=CONVERSATIONS, destination_type=MESSAGING_INSTAGRAM_DIRECT_MESSENGER
  // 女性25-48，台灣，購物行為+媽媽受眾，7天歸因 → 小赫成效最好的公式
  const TEMPLATE_ADSET_ID = "120243110991180375";

  let adsetId;
  try {
    // 受眾 targeting（共用）
    const validInclude = audienceConfig.include.filter(a => VALID_AUDIENCE_IDS.has(a.id));
    const validExclude = audienceConfig.exclude.filter(a => VALID_AUDIENCE_IDS.has(a.id));
    const targeting = {
      geo_locations: { countries: ["TW"] },
      age_min: 28,
      age_max: 44,
      genders: [2],
    };
    if (validInclude.length > 0) targeting.custom_audiences = validInclude;
    if (validExclude.length > 0) targeting.excluded_custom_audiences = validExclude;

    // 2a. 先嘗試複製 template adset（繞過台灣廣告主驗證）
    const copyBody = new URLSearchParams({
      campaign_id: campaignId,
      status_option: "PAUSED",
      access_token: TOKEN,
    });
    const copyRes = await fetch(
      `https://graph.facebook.com/v25.0/${TEMPLATE_ADSET_ID}/copies`,
      { method: "POST", body: copyBody }
    );
    const copyData = await copyRes.json();

    if (!copyData.error) {
      // 複製成功 → 更新名稱、預算、受眾、歸因（1天點擊）
      adsetId = copyData.copied_adset_id || copyData.id;
      const updateBody = new URLSearchParams({
        name: "【草稿】受眾組合",
        daily_budget: budget * 100,
        targeting: JSON.stringify(targeting),
        attribution_spec: JSON.stringify([{ event_type: "CLICK_THROUGH", window_days: 1 }]),
        access_token: TOKEN,
      });
      const updateRes = await fetch(
        `https://graph.facebook.com/v25.0/${adsetId}`,
        { method: "POST", body: updateBody }
      );
      const updateData = await updateRes.json();
      if (updateData.error) {
        return new Response(
          JSON.stringify({ success: false, error: updateData.error.error_user_msg || updateData.error.message, error_detail: JSON.stringify(updateData.error), step: "adset_update" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    } else {
      // 複製失敗 → 直接建立新 adset
      const freshBody = new URLSearchParams({
        name: "【草稿】受眾組合",
        campaign_id: campaignId,
        status: "PAUSED",
        daily_budget: budget * 100,
        billing_event: "IMPRESSIONS",
        optimization_goal: "CONVERSATIONS",
        destination_type: "MESSAGING_INSTAGRAM_DIRECT_MESSENGER",
        promoted_object: JSON.stringify({ page_id: PAGE_ID }),
        targeting: JSON.stringify(targeting),
        attribution_spec: JSON.stringify([{ event_type: "CLICK_THROUGH", window_days: 1 }]),
        access_token: TOKEN,
      });
      const freshRes = await fetch(
        `https://graph.facebook.com/v25.0/${ACCOUNT}/adsets`,
        { method: "POST", body: freshBody }
      );
      const freshData = await freshRes.json();
      if (freshData.error) {
        return new Response(
          JSON.stringify({ success: false, error: freshData.error.error_user_msg || freshData.error.message, error_detail: JSON.stringify(freshData.error), step: "adset_fresh" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      adsetId = freshData.id;
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message, step: "adset" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Step 3: Ad Creative ───────────────────────────────────────────────────
  let creativeId;
  try {
    // 試法 1：page_id + source_instagram_media_id（不傳 instagram_actor_id）
    const creativeBody = new URLSearchParams({
      name: "【草稿】素材",
      object_story_spec: JSON.stringify({
        page_id: PAGE_ID,
        video_data: {
          video_id: reel_id,
          title: (caption || "").substring(0, 25).trim() || "小赫頂頂",
          call_to_action: { type: "LEARN_MORE", value: { link: reel_permalink || "https://www.instagram.com/" } },
        },
      }),
      access_token: TOKEN,
    });

    const creativeRes = await fetch(
      `https://graph.facebook.com/v25.0/${ACCOUNT}/adcreatives`,
      { method: "POST", body: creativeBody }
    );
    const creativeData = await creativeRes.json();

    if (creativeData.error) {
      // 試法 2：source_instagram_media_id + page_id（不帶 object_story_spec）
      const fallbackBody = new URLSearchParams({
        name: "【草稿】素材",
        source_instagram_media_id: reel_id,
        object_story_spec: JSON.stringify({ page_id: PAGE_ID }),
        access_token: TOKEN,
      });

      const fallbackRes = await fetch(
        `https://graph.facebook.com/v25.0/${ACCOUNT}/adcreatives`,
        { method: "POST", body: fallbackBody }
      );
      const fallbackData = await fallbackRes.json();

      if (fallbackData.error) {
        // 試法 3：純 source_instagram_media_id（讓 Meta 自動推斷 actor）
        const fallback3Body = new URLSearchParams({
          name: "【草稿】素材",
          source_instagram_media_id: reel_id,
          access_token: TOKEN,
        });
        const fallback3Res = await fetch(
          `https://graph.facebook.com/v25.0/${ACCOUNT}/adcreatives`,
          { method: "POST", body: fallback3Body }
        );
        const fallback3Data = await fallback3Res.json();

        if (fallback3Data.error) {
          // Creative 失敗（常見原因：App 開發模式）→ 回傳 partial success
          // Campaign + Adset 已建立，讓使用者去 Ads Manager 手動選素材發布
          const managerUrl = `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=893698616001048&selected_campaign_ids=${campaignId}`;
          return new Response(
            JSON.stringify({
              success: true,
              partial: true,
              campaign_id: campaignId,
              adset_id: adsetId,
              manager_url: managerUrl,
              note: "Campaign 和廣告組合已建立完成。請到 Meta 後台選擇 Reel 素材並按發布。",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        creativeId = fallback3Data.id;
      } else {
        creativeId = fallbackData.id;
      }
    } else {
      creativeId = creativeData.id;
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message, step: "creative" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Step 4: Ad ────────────────────────────────────────────────────────────
  let adId;
  try {
    const adBody = new URLSearchParams({
      name: "【草稿】廣告",
      adset_id: adsetId,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: "PAUSED",
      access_token: TOKEN,
    });

    const adRes = await fetch(
      `https://graph.facebook.com/v25.0/${ACCOUNT}/ads`,
      { method: "POST", body: adBody }
    );
    const adData = await adRes.json();

    if (adData.error) {
      return new Response(
        JSON.stringify({ success: false, error: adData.error.error_user_msg || adData.error.message, error_detail: JSON.stringify(adData.error), step: "ad" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    adId = adData.id;
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message, step: "ad" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  return new Response(
    JSON.stringify({
      success: true,
      campaign_id: campaignId,
      adset_id: adsetId,
      creative_id: creativeId,
      ad_id: adId,
      manager_url: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=893698616001048&selected_campaign_ids=${campaignId}`,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
