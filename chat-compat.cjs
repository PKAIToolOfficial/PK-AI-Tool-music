'use strict';

function fallback(prompt) {
  const text = String(prompt || '').trim();
  const normalized = text.toLowerCase().replace(/[!?.]+$/, '');
  if (/^(hi|hello|hey|greetings|good morning|good afternoon|good evening)$/.test(normalized)) {
    return "Hello! I'm ready to help with writing, planning, coding, learning, creative work, and your projects. What would you like to work on?";
  }
  if (/^(thanks|thank you|thx)$/.test(normalized)) return "You're welcome! What would you like to do next?";
  if (/^(how are you|how's it going|how r u)$/.test(normalized)) return "I'm ready to help. What can we work on together?";
  if (/^(help|help me)$/.test(normalized)) return "I can help you write, summarize, translate, brainstorm, plan, debug, or explore a task. Tell me what you need.";
  return "I'm ready to help. Please share a little more detail about the task or result you want.";
}

module.exports = function chatCompatibility(req, res, next) {
  const legacyChat = req.path === '/api/assistant/chat' && req.method === 'POST';
  const currentChat = req.path === '/api/route' && req.method === 'POST' && (!req.body?.action || req.body.action === 'chat');
  if (!legacyChat && !currentChat) return next();

  const prompt = req.body?.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error: 'Please enter a prompt.' });
  if (prompt.length > 12000) return res.status(413).json({ error: 'The request is too long.' });

  // The primary chat implementation remains in server.js. This compatibility
  // response guarantees useful simple replies if upstream service calls fail.
  const normalized = prompt.trim().toLowerCase().replace(/[!?.]+$/, '');
  const greeting = /^(hi|hello|hey|greetings|good morning|good afternoon|good evening)$/.test(normalized);
  if (legacyChat || greeting) return res.json({ ok: true, reply: fallback(prompt) });
  return next();
};
