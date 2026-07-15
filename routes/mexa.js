import express from "express";

const router = express.Router();

router.post("/chat", async (req, res) => {

  const { message } = req.body;

  // Later this becomes OpenAI / DeepSeek

  const reply =
    "You said: " + message;

  res.json({
    reply,
  });

});

export default router;
