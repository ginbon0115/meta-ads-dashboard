export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await request.json();
  const { campaigns: rawCampaigns, kpi } = body;

  // 過濾：只保留有花費或有私訊的活動，最多15個
  const campaigns = rawCampaigns
    .filter(c => (c.spend > 0) || (c.messages > 0))
    .slice(0, 15);

  // 如果沒有任何有效活動，直接回傳空建議
  if (campaigns.length === 0) {
    return new Response(JSON.stringify({ suggestions: [], note: '沒有有效廣告數據' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const prompt = `你是一個 Meta 廣告 AI 投手，專門服務台灣水果食品團購帳號「小赫頂頂」。

## 業務背景
- 廣告目標：讓潛在客戶傳私訊詢問 → 加入 LINE 群 → 團購轉換
- 核心指標：每私訊成本（越低越好）
- 優秀：NT$8以下、良好：NT$8-12、普通：NT$12-20、需停投：>NT$20 或有花費但0私訊

## KPI 目標
- 目標每私訊成本：NT$${kpi.target_cost_per_msg}
- 單活動日預算上限：NT$${kpi.max_daily_budget}
- 停投門檻：每私訊超過 NT$${kpi.stop_threshold}

## 目前廣告活動資料（含歷史成效）
${JSON.stringify(campaigns, null, 2)}

## 分析重點
1. **暫停中但歷史成效好的活動**（每私訊 < NT$15）→ 優先建議重啟
2. **暫停中且歷史成效差的活動**（每私訊 > NT$20 或 0 私訊但有花費）→ 建議維持暫停
3. **活躍中表現好的活動** → 建議維持或增加預算
4. **活躍中表現差的活動** → 建議暫停

**重要：** 就算所有活動都在暫停，也要根據歷史數據給出「重啟建議」或「維持暫停理由」。絕對不能回傳空列表。

## 回傳格式
回傳純 JSON 陣列（不要有其他文字）：
[
  {
    "campaign_id": "活動ID",
    "campaign_name": "活動名稱",
    "action": "restart" | "pause" | "adjust_budget" | "keep" | "skip",
    "priority": "high" | "medium" | "low",
    "budget_min": 最保守的日預算數字或null,
    "budget_max": 積極衝量的日預算數字或null,
    "budget_suggested": 最推薦的日預算數字或null,
    "reason": "一句話說明原因（白話，像在跟台灣老闆說話，提到具體數字）",
    "expected_result": "預期效果（具體說預計每私訊成本或私訊數）"
  }
]

budget_min/budget_max/budget_suggested 三個都要填，單位 NT$，只填整數。例如 budget_min:300, budget_max:800, budget_suggested:500。action 是 skip/keep/pause 的話填 null。

每個活動都要給一個建議，不能跳過。`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    if (!data.content || !data.content[0]) {
      return new Response(JSON.stringify({ suggestions: [], debug: data }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    const text = data.content[0].text;

    // 嘗試解析 JSON
    let suggestions = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0]);
      }
    } catch(parseErr) {
      // 解析失敗，回傳 debug info
    }

    return new Response(JSON.stringify({ suggestions, rawText: text.substring(0, 500) }), {
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
