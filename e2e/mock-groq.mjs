// Local stand-in for the Groq API, for browser tests only. Start it, then run the app with
// GROQ_BASE_URL=http://127.0.0.1:4010 GROQ_API_KEY=test. Never used in production.
import http from "node:http";

const json = (res, obj) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const chat = (res, content) => json(res, { choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 120, completion_tokens: 60 } });

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.endsWith("/audio/transcriptions")) return json(res, { text: "Please replace the hero background image with our new photo.", language: "english" });
    const b = JSON.parse(body || "{}");
    const system = b.messages?.[0]?.content ?? "";
    if (system.includes("Infinity Resolve assistant")) {
      const answers = b.messages.filter((m) => m.role === "user").length;
      if (answers < 2) return chat(res, { category: "design_change", ready: false, reply: "Which section of the homepage would you like to change: the hero, menu or footer?", missing: ["section"], summary: {} });
      return chat(res, { category: "design_change", ready: true, reply: "Please check this summary of your request.", missing: [], contradictions: [],
        summary: { title: "Update homepage hero image", requirement: "Replace the homepage hero background image with the client's new photo and keep the current animation.",
          conversation_summary: "The client wants a new hero background image.", page: "Home", section: "Hero", elements: "background image" },
        priority: "normal", priority_reason: "Cosmetic change", scope: "within_scope", scope_reason: "Homepage design is part of the project" });
    }
    if (system.includes("internal briefings")) return chat(res, { conversation_summary: "The client asked to replace the homepage hero image.", clarification: [{ question: "Which section?", answer: "The hero" }],
      admin_tasks: ["Review homepage change request", "Check the client's new photo", "Assign to a developer", "Reply to the client in the portal"],
      priority_explanation: "Cosmetic", scope_explanation: "Within the homepage scope", communication_gaps: [], next_action: "Approve and assign the change." });
    if (system.includes("compare a client's new request")) return chat(res, { contradictions: [], changed_instructions: [] });
    return chat(res, {});
  });
}).listen(4010, "127.0.0.1", () => console.log("mock groq on 4010"));
