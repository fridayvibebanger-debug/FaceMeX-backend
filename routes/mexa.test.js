import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";

test("Mexa route loads without an OpenAI key and reports configuration on request", async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const { default: mexaRouter } = await import("./mexa.js");
    const app = express();
    app.use(express.json());
    app.use("/api/mexa", mexaRouter);

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }));

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/mexa/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "openai_not_configured",
      message: "Mexa chat is unavailable because OpenAI is not configured on the server.",
    });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
