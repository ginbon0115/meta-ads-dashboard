export async function onRequestPost(context) {
  const { env, request } = context;
  const TOKEN = env.META_ACCESS_TOKEN;
  const ACCOUNT = "act_255960679";
  const IG_ACTOR_ID = "17841453561052646";

  // Audience IDs
  const AUDIENCES = {
    lookalike_1p: "6940464644325",
    video_view_25: "6940463971925",
    ig_profile: "6940450050925",
    buyers: "6940447983525",
  };

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
  const objectiveMap = {
    reach: "OUTCOME_REACH",
    engagement: "OUTCOME_ENGAGEMENT",
    conversion: "OUTCOME_SALES",
  };

  // Optimization goal mapping
  const optimizationMap = {
    reach: "REACH",
    engagement: "CONVERSATIONS",
    conversion: "OFFSITE_CONVERSIONS",
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
      special_ad_categories: "[]",
      access_token: TOKEN,
    });

    const campaignRes = await fetch(
      `https://graph.facebook.com/v25.0/${ACCOUNT}/campaigns`,
      { method: "POST", body: campaignBody }
    );
    const campaignData = await campaignRes.json();

    if (campaignData.error) {
      return new Response(
        JSON.stringify({ success: false, error: campaignData.error.message, step: "campaign" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    campaignId = campaignData.id;
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message, step: "campaign" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Step 2: Ad Set ────────────────────────────────────────────────────────
  let adsetId;
  try {
    const targeting = {
      geo_locations: { countries: ["TW"] },
      age_min: 25,
      age_max: 44,
      custom_audiences: audienceConfig.include,
    };
    if (audienceConfig.exclude.length > 0) {
      targeting.excluded_custom_audiences = audienceConfig.exclude;
    }

    const adsetPayload = {
      name: "【草稿】受眾組合",
      campaign_id: campaignId,
      daily_budget: budget * 100, // cents
      billing_event: "IMPRESSIONS",
      optimization_goal: optimizationMap[ad_type] || "CONVERSATIONS",
      targeting: JSON.stringify(targeting),
      status: "PAUSED",
      access_token: TOKEN,
    };

    const adsetBody = new URLSearchParams(adsetPayload);

    const adsetRes = await fetch(
      `https://graph.facebook.com/v25.0/${ACCOUNT}/adsets`,
      { method: "POST", body: adsetBody }
    );
    const adsetData = await adsetRes.json();

    if (adsetData.error) {
      return new Response(
        JSON.stringify({ success: false, error: adsetData.error.message, step: "adset" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    adsetId = adsetData.id;
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message, step: "adset" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Step 3: Ad Creative ───────────────────────────────────────────────────
  let creativeId;
  try {
    // Try source_instagram_media_id first
    const creativeBody = new URLSearchParams({
      name: "【草稿】素材",
      instagram_actor_id: IG_ACTOR_ID,
      source_instagram_media_id: reel_id,
      access_token: TOKEN,
    });

    const creativeRes = await fetch(
      `https://graph.facebook.com/v25.0/${ACCOUNT}/adcreatives`,
      { method: "POST", body: creativeBody }
    );
    const creativeData = await creativeRes.json();

    if (creativeData.error) {
      // Fallback: object_story_spec with photo_data url
      const fallbackSpec = JSON.stringify({
        instagram_actor_id: IG_ACTOR_ID,
        photo_data: { url: reel_permalink || `https://www.instagram.com/reel/${reel_id}/` },
      });
      const fallbackBody = new URLSearchParams({
        name: "【草稿】素材",
        object_story_spec: fallbackSpec,
        access_token: TOKEN,
      });

      const fallbackRes = await fetch(
        `https://graph.facebook.com/v25.0/${ACCOUNT}/adcreatives`,
        { method: "POST", body: fallbackBody }
      );
      const fallbackData = await fallbackRes.json();

      if (fallbackData.error) {
        return new Response(
          JSON.stringify({ success: false, error: fallbackData.error.message, step: "creative" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      creativeId = fallbackData.id;
    } else {
      creativeId = creativeData.id;
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message, step: "creative" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
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
        JSON.stringify({ success: false, error: adData.error.message, step: "ad" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    adId = adData.id;
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: e.message, step: "ad" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
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
      manager_url: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=255960679&selected_campaign_ids=${campaignId}`,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
