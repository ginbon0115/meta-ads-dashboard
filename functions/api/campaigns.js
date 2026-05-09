export async function onRequestGet(context) {
  const { env } = context;
  const TOKEN = env.META_ACCESS_TOKEN;
  const ACCOUNT = env.META_AD_ACCOUNT_ID || "act_893698616001048";

  try {
    const [campaignsRes, insightsRes] = await Promise.all([
      fetch(
        `https://graph.facebook.com/v25.0/${ACCOUNT}/campaigns?fields=id,name,status,objective,daily_budget&limit=50&access_token=${TOKEN}`
      ),
      fetch(
        `https://graph.facebook.com/v25.0/${ACCOUNT}/insights?` +
        `fields=campaign_id,campaign_name,spend,reach,impressions,actions,action_values,cost_per_action_type` +
        `&level=campaign&date_preset=last_30d&limit=50&access_token=${TOKEN}`
      )
    ]);

    const campaigns = await campaignsRes.json();
    const insights = await insightsRes.json();

    const insightMap = {};
    for (const d of (insights.data || [])) {
      insightMap[d.campaign_id] = d;
    }

    const result = (campaigns.data || []).map(c => {
      const ins = insightMap[c.id] || {};
      const actions = ins.actions || [];
      const actionValues = ins.action_values || [];

      const spend = parseFloat(ins.spend || 0);
      const reach = parseInt(ins.reach || 0);
      const impressions = parseInt(ins.impressions || 0);

      const messagesAction = actions.find(a =>
        a.action_type === "onsite_conversion.messaging_conversation_started_7d"
      );
      const msgCount = messagesAction ? parseInt(messagesAction.value) : 0;

      const PURCHASE_TYPES = ["omni_purchase", "purchase", "website_purchase"];
      const purchaseAction = actions.find(a => PURCHASE_TYPES.includes(a.action_type));
      const revenueAction = actionValues.find(a => PURCHASE_TYPES.includes(a.action_type));

      const purchaseCount = purchaseAction ? parseInt(purchaseAction.value) : 0;
      const revenue = revenueAction ? parseFloat(revenueAction.value) : 0;
      const roas = spend > 0 && revenue > 0 ? revenue / spend : null;
      const cost_per_purchase = purchaseCount > 0 ? spend / purchaseCount : null;

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        daily_budget: c.daily_budget,
        spend,
        reach,
        impressions,
        messages: msgCount,
        cost_per_message: msgCount > 0 ? spend / msgCount : null,
        purchases: purchaseCount,
        revenue,
        roas,
        cost_per_purchase,
        cpm: impressions > 0 ? spend / impressions * 1000 : 0,
      };
    });

    return new Response(JSON.stringify({ data: result }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
