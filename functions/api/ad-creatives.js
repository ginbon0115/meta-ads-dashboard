export async function onRequestGet(context) {
  const { env, request } = context;
  const TOKEN = env.META_ACCESS_TOKEN;
  const ACCOUNT = env.META_AD_ACCOUNT_ID || "act_893698616001048";

  const url = new URL(request.url);
  const ALLOWED_PRESETS = ["last_7d", "last_30d", "last_90d", "this_month"];
  const rawPreset = url.searchParams.get("date_preset") || "last_90d";
  const DATE_PRESET = ALLOWED_PRESETS.includes(rawPreset) ? rawPreset : "last_90d";

  try {
    // Fetch ads with creative info + insights in one shot
    const fields = [
      "id", "name", "status",
      "creative{id,name,instagram_permalink_url,video_id,thumbnail_url}",
      `insights.date_preset(${DATE_PRESET}){spend,actions,impressions,reach}`
    ].join(",");

    const adsRes = await fetch(
      `https://graph.facebook.com/v25.0/${ACCOUNT}/ads?fields=${encodeURIComponent(fields)}&limit=200&access_token=${TOKEN}`
    );
    const adsData = await adsRes.json();

    if (adsData.error) {
      return new Response(JSON.stringify({ error: adsData.error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const ads = adsData.data || [];

    const MSG_ACTION_TYPES = [
      "onsite_conversion.messaging_conversation_started_7d",
      "onsite_conversion.total_messaging_connection",
      "messaging_first_reply",
      "onsite_conversion.messaging_first_reply",
    ];

    const result = ads.map(ad => {
      const creative = ad.creative || {};
      const insightArr = ad.insights?.data || [];
      const ins = insightArr[0] || {};
      const actions = ins.actions || [];

      const spend = parseFloat(ins.spend || 0);
      const reach = parseInt(ins.reach || 0);
      const impressions = parseInt(ins.impressions || 0);

      // Find best messaging action count
      let messages = 0;
      for (const t of MSG_ACTION_TYPES) {
        const found = actions.find(a => a.action_type === t);
        if (found) { messages = Math.max(messages, parseInt(found.value || 0)); }
      }

      const cost_per_message = messages > 0 ? spend / messages : null;

      // Recommendation tier
      let recommendation, rec_color;
      if (spend === 0) {
        recommendation = "無投放數據";
        rec_color = "#999";
      } else if (cost_per_message === null) {
        recommendation = "無私訊數據";
        rec_color = "#888";
      } else if (cost_per_message <= 10) {
        recommendation = "建議繼續投";
        rec_color = "#16a34a";
      } else if (cost_per_message <= 20) {
        recommendation = "可嘗試";
        rec_color = "#d97706";
      } else {
        recommendation = "建議停投";
        rec_color = "#dc2626";
      }

      return {
        ad_id: ad.id,
        ad_name: ad.name,
        ad_status: ad.status,
        creative_id: creative.id || null,
        creative_name: creative.name || null,
        instagram_permalink: creative.instagram_permalink_url || null,
        video_id: creative.video_id || null,
        thumbnail_url: creative.thumbnail_url || null,
        spend,
        reach,
        impressions,
        messages,
        cost_per_message,
        recommendation,
        rec_color,
      };
    });

    // Sort: has spend first, then by cost_per_message ascending (nulls last), then by spend desc
    result.sort((a, b) => {
      if (a.spend === 0 && b.spend > 0) return 1;
      if (a.spend > 0 && b.spend === 0) return -1;
      if (a.cost_per_message !== null && b.cost_per_message !== null) {
        return a.cost_per_message - b.cost_per_message;
      }
      if (a.cost_per_message !== null) return -1;
      if (b.cost_per_message !== null) return 1;
      return b.spend - a.spend;
    });

    return new Response(JSON.stringify({ data: result, date_preset: DATE_PRESET, total: result.length }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
