export async function onRequestGet(context) {
  const { env } = context;
  const token = env.META_ACCESS_TOKEN;

  try {
    // 取 IG 帳號 ID
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
    if (!igId) igId = '17841453561052646';

    // 翻完所有分頁，純計數（只拿 id + media_type，最快）
    let total = 0, videoCount = 0, pageCount = 0;
    let nextUrl = `https://graph.facebook.com/v25.0/${igId}/media?fields=id,media_type,media_product_type&limit=100&access_token=${token}`;

    while (nextUrl && pageCount < 20) { // 最多 20 頁（2000 篇）
      const res = await fetch(nextUrl);
      const data = await res.json();
      if (data.error) break;
      const items = data.data || [];
      total += items.length;
      videoCount += items.filter(m =>
        m.media_type === 'VIDEO' || m.media_product_type === 'REELS'
      ).length;
      pageCount++;
      nextUrl = data.paging?.next || null;
    }

    return new Response(JSON.stringify({
      ig_username: igUsername,
      total_posts: total,
      total_videos: videoCount,
      pages_fetched: pageCount,
      note: '不含典藏，僅計公開貼文'
    }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
