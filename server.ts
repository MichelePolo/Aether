import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// AI Configuration Store (In-memory for session)
// In a real app, this might be per-user or persistent
let currentContext = {
  systemInstruction: "You are Aether, an advanced AI development agent. You provide transparent reasoning and can dispatch sub-agents.",
  skills: [
    "Context_Analysis_v2.4",
    "Code_Synthesis_Engine",
    "MCP_Protocol_Adapter",
    "Reasoning_Validator"
  ],
  tools: [
    { name: "GoogleSearch", status: "online", version: "1.2.0" },
    { name: "FileSystem_v1", status: "offline", version: "0.9.5" }
  ],
  mcpServers: [],
  history: [] as any[]
};

// API: Get Current transparent context
app.get("/api/context", (req, res) => {
  res.json(currentContext);
});

// API: Update context components
app.post("/api/context/update", (req, res) => {
  const { systemInstruction, skills, tools, mcpServers } = req.body;
  if (systemInstruction !== undefined) currentContext.systemInstruction = systemInstruction;
  if (skills !== undefined) currentContext.skills = skills;
  if (tools !== undefined) currentContext.tools = tools;
  if (mcpServers !== undefined) currentContext.mcpServers = mcpServers;
  res.json({ status: "ok", context: currentContext });
});

// API: Bulk Overwrite Context (for import/profile load)
app.post("/api/context/bulk-overwrite", (req, res) => {
  const { context } = req.body;
  if (context) {
    currentContext = {
      ...currentContext,
      ...context,
      history: currentContext.history // Preserve history unless specified
    };
    if (context.history) currentContext.history = context.history;
  }
  res.json({ status: "ok", context: currentContext });
});

// API: AI Dispatch
app.post("/api/ai/dispatch", async (req, res) => {
  const { message, model = "gemini-3-flash-preview", modelType = "big-vendor", config = {} } = req.body;

  try {
    if (modelType === "big-vendor") {
      // Logic for Gemini
      const response = await ai.models.generateContent({
        model: model,
        contents: [
          ...currentContext.history,
          { role: 'user', parts: [{ text: message }] }
        ],
        config: {
          systemInstruction: currentContext.systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          ...config
        }
      });

      const responseText = response.text || "";
      
      // Update history
      currentContext.history.push({ role: 'user', parts: [{ text: message }] });
      currentContext.history.push({ role: 'model', parts: [{ text: responseText }] });

      res.json({
        id: Date.now().toString(),
        text: responseText,
        reasoning: "Thinking executed...", // Gemini 3 reasoning is implicit in response.text usually or candidates
        model: model,
        status: "success"
      });
    } else {
      // Local Model Proxy logic (Placeholder for Ollama etc)
      // If user provided a local API URL in config
      const localUrl = config.localUrl || "http://localhost:11434/api/generate";
      res.status(501).json({ error: "Local model dispatch not fully configured. Please provide local proxy settings." });
    }
  } catch (error: any) {
    console.error("AI Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API: Reset History
app.post("/api/context/reset", (req, res) => {
  currentContext.history = [];
  res.json({ status: "ok" });
});

// Vite middleware for development
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupVite();
