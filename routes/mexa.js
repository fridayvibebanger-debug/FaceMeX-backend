import express from "express";
import OpenAI from "openai";

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post("/chat", async (req, res) => {
  const { message } = req.body;

  const completion = await openai.chat.completions.create({
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

  res.json({
    reply: completion.choices[0].message.content,
  });
});

export default router;
