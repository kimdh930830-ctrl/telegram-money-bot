function getKoreaDate() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function parseMonthQuery(text) {
  const trimmed = text.trim();

  let m = trimmed.match(/^(\d{4})년\s*(\d{1,2})월$/);
  if (m) {
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
  }

  m = trimmed.match(/^(\d{1,2})월$/);
  if (m) {
    const d = getKoreaDate();
    return { year: d.getFullYear(), month: parseInt(m[1], 10) };
  }

  return null;
}

async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}

async function getTotal(chatId, year, month) {
  const url =
    `${process.env.SUPABASE_URL}/rest/v1/monthly_totals` +
    `?chat_id=eq.${chatId}&year=eq.${year}&month=eq.${month}&select=total`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    }
  });

  const data = await res.json();

  if (!Array.isArray(data) || data.length === 0) {
    return 0;
  }

  return data[0].total || 0;
}

async function upsertTotal(chatId, year, month, amount) {
  const current = await getTotal(chatId, year, month);
  const next = current + amount;

  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/monthly_totals`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify([
      {
        chat_id: String(chatId),
        year,
        month,
        total: next,
        updated_at: new Date().toISOString()
      }
    ])
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }

  return next;
}

async function resetTotal(chatId, year, month) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/monthly_totals`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify([
      {
        chat_id: String(chatId),
        year,
        month,
        total: 0,
        updated_at: new Date().toISOString()
      }
    ])
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }

  return 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("ok");
  }

  try {
    const message = req.body.message?.text?.trim();
    const chatId = req.body.message?.chat?.id;

    if (!message || !chatId) {
      return res.status(200).send("ok");
    }

    const now = getKoreaDate();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    let reply = "";

    if (message === "총액") {
      const total = await getTotal(String(chatId), currentYear, currentMonth);
      reply = `${currentYear}년 ${currentMonth}월 누적: ${total}원`;
    } else if (message === "초기화") {
      await resetTotal(String(chatId), currentYear, currentMonth);
      reply = `${currentYear}년 ${currentMonth}월 누적 금액을 0원으로 초기화했습니다.`;
    } else {
      const monthQuery = parseMonthQuery(message);

      if (monthQuery) {
        const total = await getTotal(String(chatId), monthQuery.year, monthQuery.month);
        reply = `${monthQuery.year}년 ${monthQuery.month}월 누적: ${total}원`;
      } else {
        const match = message.match(/[+-]?\d+/);

        if (match) {
          const amount = parseInt(match[0], 10);
          const total = await upsertTotal(String(chatId), currentYear, currentMonth, amount);
          reply = `${amount}원 반영 완료\n현재 ${currentYear}년 ${currentMonth}월 누적: ${total}원`;
        } else {
          reply = "숫자, '총액', '초기화', '3월', '2026년 3월'로 입력하세요.";
        }
      }
    }

    await sendTelegram(chatId, reply);
    return res.status(200).send("ok");
  } catch (error) {
    console.error(error);
    return res.status(200).send("error");
  }
}
