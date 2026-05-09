export async function onRequestGet(context) {
  const { env } = context;
  const token = env.META_ACCESS_TOKEN;
  const adAccountId = env.META_AD_ACCOUNT_ID || "act_893698616001048";

  const insightsUrl = `https://graph.facebook.com/v25.0/${adAccountId}/insights?` +
    `fields=campaign_name,ad_name,impressions,reach,spend,video_play_actions,` +
    `video_avg_time_watched_actions,video_thruplay_watched_actions,` +
    `cost_per_thruplay,actions,cost_per_action_type` +
    `&breakdowns=publisher_platform,impression_device` +
    `&filtering=[{"field":"publisher_platform","operator":"IN","value":["instagram"]}]` +
    `&date_preset=last_30d&level=ad&limit=50&access_token=${token}`;

  try {
    const insightsRes = await fetch(insightsUrl);
    const insightsData = await insightsRes.json();

    const rows = (insightsData.data || []).map(row => {
      const spend = parseFloat(row.spend || 0);
      const impressions = parseInt(row.impressions || 0);
      const reach = parseInt(row.reach || 0);

      const plays = (row.video_play_actions || []).find(a => a.action_type === 'video_view');
      const plays3s = plays ? parseInt(plays.value) : 0;

      const thruplay = (row.video_thruplay_watched_actions || []).find(a => a.action_type === 'video_view');
      const completions = thruplay ? parseInt(thruplay.value) : 0;

      const watchTime = (row.video_avg_time_watched_actions || []).find(a => a.action_type === 'video_view');
      const avgWatchSec = watchTime ? parseFloat(watchTime.value) : 0;

      const msgAction = (row.actions || []).find(a => a.action_type === 'onsite_conversion.messaging_conversation_started_7d');
      const messages = msgAction ? parseInt(msgAction.value) : 0;

      return {
        campaign_name: row.campaign_name || '—',
        ad_name: row.ad_name || '—',
        platform: row.publisher_platform || '—',
        device: row.impression_device || '—',
        spend,
        impressions,
        reach,
        plays3s,
        completions,
        completion_rate: plays3s > 0 ? Math.round((completions / plays3s) * 100) : 0,
        avg_watch_sec: Math.round(avgWatchSec * 10) / 10,
        messages,
        cost_per_message: messages > 0 ? Math.round((spend / messages) * 10) / 10 : null,
        cpm: impressions > 0 ? Math.round((spend / impressions) * 1000 * 10) / 10 : 0
      };
    }).filter(r => r.platform === 'instagram');

    return new Response(JSON.stringify({ data: rows }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
