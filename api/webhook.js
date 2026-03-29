function getKoreaDate() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function getMessageText(body) {
  return (
    body?.message?.text?.trim() ||
    body?.message?.caption?.trim() ||
    ""
  );
}

function parseMonthQuery(text) {
  const trimmed = text.trim();

  let match = trimmed.match(/^(\d{4})년\s*(\d{1,2})월$/);
  if (match) {
    return {
      year: parseInt(match[1], 10),
      month: parseInt(match[2], 10)
    };
  }

  match = trimmed.match(/^(\d{1,2})월$/);
  if (match) {
    const now = getKoreaDate();
    return {
      year: now.getFullYear(),
      month: parseInt(match[1], 10)
    };
  }

  return null;
}

async function fetchWithRetry(url, options = {}, label = "unknown-fetch") {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[${label}] attempt ${attempt} start`, {
        url,
        method: options.method || "GET"
      });

      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000)
      });

      console.log(`[${label}] attempt ${attempt} response`, {
        status: response.status,
        ok: response.ok
      });

      return response;
    } catch (error) {
      console.error(`[${label}] attempt ${attempt} failed`, {
        message: error?.message,
        cause: error?.cause ? String(error.cause) : null,
        stack: error?.stack
      });

      if (attempt === 2) {
        throw error;
      }
    }
  }
}

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    },
    "telegram-send"
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`telegram-send failed: ${JSON.stringify(data)}`);
  }

  return data;
}

async function getMonthlyTotal(chatId, year, month) {
  const url =
    `${process.env.SUPABASE_URL}/rest/v1/monthly_totals` +
    `?chat_id=eq.${encodeURIComponent(chatId)}` +
    `&year=eq.${year}` +
    `&month=eq.${month}` +
    `&select=total`;

  const response = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      }
    },
    "supabase-get-total"
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`supabase-get-total failed: ${JSON.stringify(data)}`);
  }

  if (!Array.isArray(data) || data.length === 0) {
    return 0;
  }

  return Number(data[0].total || 0);
}

async function saveMonthlyTotal(chatId, year, month, total) {
  const url =
    `${process.env.SUPABASE_URL}/rest/v1/monthly_totals` +
    `?on_conflict=chat_id,year,month`;

  const response = await fetchWithRetry(
    url,
    {
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
          total,
          updated_at: new Date().toISOString()
        }
      ])
    },
    "supabase-save-total"
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`supabase-save-total failed: ${JSON.stringify(data)}`);
  }

  return total;
}

async function addToMonthlyTotal(chatId, year, month, amount) {
  const currentTotal = await getMonthlyTotal(chatId, year, month);
  const newTotal = currentTotal + amount;
  return await saveMonthlyTotal(chatId, year, month, newTotal);
}

async function resetMonthlyTotal(chatId, year, month) {
  return await saveMonthlyTotal(chatId, year, month, 0);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("ok");
  }

  try {
    const body = req.body;
    const message = getMessageText(body);
    const chatId = body?.message?.chat?.id;

    console.log("[webhook] incoming", {
      hasText: !!body?.message?.text,
      hasCaption: !!body?.message?.caption,
      message,
      chatId
    });

    if (!message || !chatId) {
      return res.status(200).send("ok");
    }

    const now = getKoreaDate();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    let reply = "";

    if (message === "총액") {
      const total = await getMonthlyTotal(String(chatId), currentYear, currentMonth);
      reply = `${currentYear}년 ${currentMonth}월 누적: ${total}원`;
    } else if (message === "초기화") {
      await resetMonthlyTotal(String(chatId), currentYear, currentMonth);
      reply = `${currentYear}년 ${currentMonth}월 누적 금액을 0원으로 초기화했습니다.`;
    } else {
      const monthQuery = parseMonthQuery(message);

      if (monthQuery) {
        const total = await getMonthlyTotal(
          String(chatId),
          monthQuery.year,
          monthQuery.month
        );
        reply = `${monthQuery.year}년 ${monthQuery.month}월 누적: ${total}원`;
      } else {
        const amountMatch = message.match(/[+-]?\d+/);

        if (amountMatch) {
          const amount = parseInt(amountMatch[0], 10);
          const total = await addToMonthlyTotal(
            String(chatId),
            currentYear,
            currentMonth,
            amount
          );

          reply = `${amount}원 반영 완료\n현재 ${currentYear}년 ${currentMonth}월 누적: ${total}원`;
        } else {
          reply =
            "숫자, '총액', '초기화', '3월', '2026년 3월' 형식으로 입력하세요.\n사진과 함께 보낼 때는 캡션에 금액을 적어주세요.";
        }
      }
    }

    console.log("[webhook] reply", { reply });

    await sendTelegramMessage(chatId, reply);

    return res.status(200).send("ok");
  } catch (error) {
    console.error("[webhook] fatal error", {
      message: error?.message,
      cause: error?.cause ? String(error.cause) : null,
      stack: error?.stack
    });

    return res.status(200).send("error");
  }
}
