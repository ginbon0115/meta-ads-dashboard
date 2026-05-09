export async function onRequestPost(context) {
  const { env, request } = context;
  const { campaign_id, action, new_daily_budget } = await request.json();
  const token = env.META_ACCESS_TOKEN;

  let result = {};

  try {
    if (action === 'pause') {
      const res = await fetch(`https://graph.facebook.com/v25.0/${campaign_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED', access_token: token })
      });
      result = await res.json();
    } else if (action === 'restart') {
      const res = await fetch(`https://graph.facebook.com/v25.0/${campaign_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE', access_token: token })
      });
      result = await res.json();
    } else if (action === 'adjust_budget' && new_daily_budget) {
      result = { note: '預算調整需要透過廣告組合（Ad Set）設定，請至 Meta 廣告後台手動調整日預算。' };
    } else if (action === 'keep') {
      result = { note: '維持現狀，不需要執行任何操作。' };
    } else if (action === 'create_similar') {
      result = { note: '複製優化建議：請至 Meta 廣告後台複製此活動，並根據 AI 建議調整素材與受眾。' };
    } else {
      result = { note: '不明動作，未執行。' };
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
