let total = 0;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Telegram bot server is running");
  }

  try {
    const body = req.body;
    const message = body.message?.text;
    const chatId = body.message?.chat?.id;

    if (!message || !chatId) {
      return res.status(200).send("ok");
    }

    let reply = "";

    if (message === "총액") {
      reply = `현재 누적: ${total}원`;
    } else if (message === "초기화") {
      total = 0;
      reply = "누적 금액을 0원으로 초기화했습니다.";
    } else {
      const match = message.match(/[+-]?\d+/);

      if (match) {
        const amount = parseInt(match[0], 10);
        total += amount;
        reply = `${amount}원 반영 완료\n현재 누적: ${total}원`;
      } else {
        reply = "숫자 금액을 보내거나 '총액', '초기화'를 입력하세요.";
      }
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: reply
      })
    });

    return res.status(200).send("ok");
  } catch (error) {
    return res.status(200).send("error");
  }
}