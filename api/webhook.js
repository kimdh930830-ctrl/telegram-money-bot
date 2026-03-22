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

async function sendTelegramMessage(chatId, text) {
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

async function getMonthlyTotal(chatId, year, month) {
  const url =
    `${process.env.SUPABASE_URL}/rest/v1/monthly_totals` +
    `?chat_id=eq.${encodeURIComponent(chatId)}` +
    `&year=eq.${year}` +
    `&month=eq.${month}` +
    `&select=total`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
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

  const response = await fetch(url, {
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
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
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

          if (amount >= 0) {
            reply = `${amount}원 반영 완료\n현재 ${currentYear}년 ${currentMonth}월 누적: ${total}원`;
          } else {
            reply = `${amount}원 반영 완료\n현재 ${currentYear}년 ${currentMonth}월 누적: ${total}원`;
          }
        } else {
          reply =
            "숫자, '총액', '초기화', '3월', '2026년 3월' 형식으로 입력하세요.\n사진과 함께 보낼 때는 캡션에 금액을 적어주세요.";
        }
      }
    }

    await sendTelegramMessage(chatId, reply);
    return res.status(200).send("ok");
  } catch (error) {
    console.error("Webhook Error:", error);
    return res.status(200).send("error");
  }
}
