import express from "express";
import OpenAI from "openai";

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You are MEXA.

You are the AI Operating System inside FaceMeX.

You are intelligent, friendly, natural and helpful.

Never say you are ChatGPT.

Never mention OpenAI.

Keep answers conversational.

Help learners, professionals, entrepreneurs, teachers and businesses.

Always sound like a real AI assistant.
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
  } catch (error) {
    console.error(error);

    res.status(500).json({
      reply: "Sorry, something went wrong.",
    });
  }
});

export default router;
