export async function onRequestPost(context) {
  const { request, env } = context;
  const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { campaign_name, spend, reach, messages, cost_per_message, impressions, objective } = body;

  const userMsg = `
活動名稱：${campaign_name}
目標：${objective || '未知'}
本月花費：NT$${spend !== null && spend !== undefined ? Math.round(spend).toLocaleString() : '無資料'}
觸及人數：${reach?.toLocaleString() || 0}
私訊數：${messages || 0}
每則私訊成本：${cost_per_message !== null && cost_per_message !== undefined ? `NT$${Math.round(cost_per_message)}` : '無資料'}

請給出三點具體改善建議，格式如下：
1. 【受眾調整】...
2. 【素材/文案方向】...
3. 【預算分配】...

每點 2-3 句話，白話文，直接可以執行的建議。
  `.trim();

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      stream: true,
      system: [
        {
          type: "text",
          text: `你是一位台灣電商廣告分析師，專精私域流量（LINE 社群）經營。
客戶是水果食品團購網紅，主要收入來源是：
- 透過 Meta 廣告吸引用戶私訊
- 私訊後引導加入 LINE 社群
- 在 LINE 社群發佈團購活動成交

因此最重要的指標是「每私訊成本」（越低越好），目標是 NT$15 以下。
NT$8-12 屬於優秀，NT$12-20 普通，NT$20 以上需要優化。

分析時要用繁體中文、白話文、結論先說，不要說廢話。
給出的建議要具體可執行，不要給教科書式的泛泛建議。`,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [{ role: "user", content: userMsg }]
    })
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`));
              }
            } catch {}
          }
        }
      }
    } finally {
      await writer.write(encoder.encode("data: [DONE]\n\n"));
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
