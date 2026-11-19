import express from "express";
import OpenAI from "openai";

const router = express.Router();

let openai;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  if (!openai) openai = new OpenAI({ apiKey });
  return openai;
}

router.post("/chat", async (req, res) => {
  const client = getOpenAIClient();
  if (!client) {
    return res.status(503).json({
      error: "openai_not_configured",
      message: "Mexa chat is unavailable because OpenAI is not configured on the server.",
    });
  }

  try {
    const { message } = req.body;
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You are MEXA.

You are the AI operating system inside FaceMeX.

You help with:
- Careers
- Education
- Business
- Daily life

Always answer naturally.
Never say you're ChatGPT.
`,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    return res.json({
      reply: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error("Mexa chat request failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return res.status(502).json({
      error: "mexa_request_failed",
      message: "Mexa could not complete the request. Please try again.",
    });
  }
});

export default router;
