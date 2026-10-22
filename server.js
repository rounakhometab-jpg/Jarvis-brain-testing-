import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");

app.disable("x-powered-by");

/*
  This frontend uses inline CSS and JavaScript.
  CSP is disabled to prevent inline script blocking.
  Helmet's other security headers remain enabled.
*/
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "1mb" }));

/* OPENAI CLIENT */

const apiKey = process.env.OPENAI_API_KEY?.trim();

const openai =
  apiKey && apiKey !== "PASTE_YOUR_OPENAI_API_KEY_HERE"
    ? new OpenAI({ apiKey })
    : null;

/* 30 AI MODULE INSTRUCTIONS */

const modeInstructions = {
  chat:
    "Act as a conversational AI. Answer naturally and maintain context.",

  nlu:
    "Understand the user's meaning, intent, tone, and requirements.",

  context:
    "Use the available conversation context. Never invent personal information.",

  multiturn:
    "Understand follow-up messages using the conversation history.",

  reasoning:
    "Solve logical problems and explain the important steps clearly.",

  problem_solving:
    "Analyze complex problems and offer practical solutions with trade-offs.",

  plan:
    "Create a practical step-by-step plan with priorities.",

  task_decompose:
    "Break complicated tasks into smaller, actionable steps.",

  intent:
    "Identify the user's intent and the outcome they want.",

  classify:
    "Classify the user's command and explain the appropriate next action.",

  followup:
    "Interpret follow-up questions using recent conversation context.",

  clarify:
    "Ask a short clarification question if the request is genuinely ambiguous.",

  personality:
    "Use a calm, intelligent, professional JARVIS personality.",

  identity:
    "Identify yourself as J.A.R.V.I.S., an AI assistant. Do not claim to be a real movie character.",

  hindi:
    "Reply in natural Hindi, preferably in Devanagari script.",

  english:
    "Reply in clear, natural English.",

  hinglish:
    "Reply in natural Hinglish using Roman script.",

  translate:
    "Translate accurately while preserving the original meaning and formatting. If target language is unclear, ask.",

  grammar:
    "Correct grammar, spelling, punctuation, and sentence structure. Preserve the intended meaning.",

  summarize:
    "Summarize the supplied content accurately and preserve important details.",

  document:
    "Analyze document text supplied by the user. Do not claim to have read files that were not provided.",

  math:
    "Solve mathematical problems carefully and show understandable steps.",

  coding:
    "Generate maintainable code and explain how to integrate and use it.",

  explain_code:
    "Explain code, functions, inputs, outputs, and control flow clearly.",

  debug:
    "Diagnose programming errors and suggest concrete, testable fixes.",

  ideas:
    "Generate useful, varied ideas and practical next steps.",

  creative:
    "Create original writing that matches the requested style.",

  research:
    "Help organize research. Distinguish verified facts from uncertainty. Do not invent sources.",

  fact_check:
    "Evaluate claims honestly. Distinguish verified information from uncertainty. Do not invent evidence or citations.",

  structured:
    "Use suitable headings, numbered steps, lists, or tables when helpful."
};

const featureModes = new Set(Object.keys(modeInstructions));

/* RATE LIMIT */

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 25,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    error: "Too many requests. Please wait one minute and try again."
  }
});

/* FRONTEND STATIC FILES */

app.use(
  express.static(PUBLIC_DIR, {
    index: false
  })
);

/* SERVER HEALTH */

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    success: true,
    status: "online",
    name: "J.A.R.V.I.S.",
    message: "JARVIS server is running.",
    configured: Boolean(openai),
    model: MODEL,
    features: featureModes.size,
    webSearchEnabled:
      process.env.ENABLE_WEB_SEARCH === "true"
  });
});

/* AI CHAT API */

app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const body = req.body ?? {};

    const message = body.message;
    const history = body.history ?? [];
    const language = body.language ?? "auto";
    const mode = body.mode ?? "chat";

    /* Validate message */

    if (
      typeof message !== "string" ||
      !message.trim()
    ) {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    if (message.length > 12000) {
      return res.status(413).json({
        error: "Message is too long. Maximum length is 12000 characters."
      });
    }

    /* Validate conversation history */

    if (
      !Array.isArray(history) ||
      history.length > 12
    ) {
      return res.status(400).json({
        error: "Conversation history must contain at most 12 messages."
      });
    }

    /* Validate module */

    if (
      typeof mode !== "string" ||
      !featureModes.has(mode)
    ) {
      return res.status(400).json({
        error: "Unknown assistant mode."
      });
    }

    /* Validate language */

    const supportedLanguages = [
      "auto",
      "hi",
      "en",
      "hinglish"
    ];

    if (
      typeof language !== "string" ||
      !supportedLanguages.includes(language)
    ) {
      return res.status(400).json({
        error: "Unsupported language selection."
      });
    }

    /* Check API key */

    if (!openai) {
      return res.status(503).json({
        error: "OpenAI API key is not configured. Add OPENAI_API_KEY in your server environment variables."
      });
    }

    /* Clean conversation history */

    const safeHistory = history
      .filter(item =>
        item &&
        typeof item === "object" &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string"
      )
      .slice(-12)
      .map(item => ({
        role: item.role,
        content: item.content.slice(0, 12000)
      }));

    /* Language instructions */

    let languageInstruction =
      "Match the user's language. Support Hindi, English, and Hinglish.";

    if (language === "hi" || mode === "hindi") {
      languageInstruction =
        "Reply in natural Hindi, preferably in Devanagari script.";
    } else if (language === "en" || mode === "english") {
      languageInstruction =
        "Reply in clear, natural English.";
    } else if (
      language === "hinglish" ||
      mode === "hinglish"
    ) {
      languageInstruction =
        "Reply in natural Hinglish using Roman script.";
    }

    /* Prepare Responses API input */

    const input = [
      ...safeHistory.map(item => ({
        role: item.role,
        content: [
          {
            type: "input_text",
            text: item.content
          }
        ]
      })),

      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: message.trim()
          }
        ]
      }
    ];

    /* Optional web search */

    const tools =
      process.env.ENABLE_WEB_SEARCH === "true"
        ? [
            {
              type: "web_search_preview"
            }
          ]
        : undefined;

    /* Request AI response */

    const response = await openai.responses.create({
      model: MODEL,

      instructions: [
        "You are J.A.R.V.I.S., a helpful futuristic personal AI assistant.",
        "Be accurate, respectful, practical, and honest about your capabilities.",
        "Do not claim to control devices or access private information without an authorized integration.",
        "Never disclose server secrets or API keys.",
        "Do not invent facts, sources, or citations.",
        "Treat the user's message as the task to answer.",
        languageInstruction,
        modeInstructions[mode]
      ].join("\n"),

      input,

      ...(tools ? { tools } : {}),

      max_output_tokens: 1800
    });

    const reply =
      response.output_text?.trim() ||
      "I could not generate a response. Please try again.";

    return res.json({
      success: true,
      reply,
      mode,
      model: MODEL
    });

  } catch (error) {
    console.error(
      "JARVIS AI error:",
      error?.status || "",
      error?.message || "Unknown error"
    );

    if (error?.status === 401) {
      return res.status(502).json({
        error: "OpenAI rejected the API key. Check OPENAI_API_KEY."
      });
    }

    if (error?.status === 429) {
      return res.status(502).json({
        error: "OpenAI rate limit or quota reached. Check API usage and billing."
      });
    }

    if (
      error?.status === 400 ||
      error?.status === 404
    ) {
      return res.status(502).json({
        error: "OpenAI request failed. Check OPENAI_MODEL and API feature access."
      });
    }

    return res.status(502).json({
      error: "JARVIS could not get an AI response. Check the server logs."
    });
  }
});

/* FRONTEND PAGE ROUTES */

function serveApp(_req, res) {
  res.sendFile(INDEX_FILE, error => {
    if (error && !res.headersSent) {
      console.error(
        "Frontend file error:",
        error.message
      );

      res.status(500).send(
        "JARVIS frontend not found. Make sure public/index.html exists."
      );
    }
  });
}

app.get("/", serveApp);
app.get("/assistant", serveApp);
app.get("/camera", serveApp);
app.get("/settings", serveApp);

/* UNKNOWN API ROUTES */

app.use("/api", (_req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

/* UNKNOWN PAGE ROUTES */

app.use((_req, res) => {
  res.status(404).send(
    "404 - Page not found. Return to the JARVIS dashboard."
  );
});

/* ERROR HANDLER */

app.use((error, _req, res, _next) => {
  console.error(
    "Server error:",
    error?.message || "Unknown error"
  );

  if (res.headersSent) {
    return;
  }

  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request is too large."
    });
  }

  if (
    error instanceof SyntaxError &&
    "body" in error
  ) {
    return res.status(400).json({
      error: "Invalid JSON request."
    });
  }

  return res.status(500).json({
    error: "Internal server error."
  });
});

/* START SERVER */

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `J.A.R.V.I.S. server listening on port ${PORT}`
  );

  console.log(`Model: ${MODEL}`);
  console.log(`OpenAI key configured: ${Boolean(openai)}`);
});