import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const NOTION_DB_ID = process.env.NOTION_DB_ID?.trim();
const APP_PASSWORD = process.env.APP_PASSWORD;

// Auth middleware
function requireAuth(req, res, next) {
  const token = req.headers['x-app-token'];
  if (token && token === APP_PASSWORD) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    res.json({ token: APP_PASSWORD });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// Token verification (used on app load to check stored token)
app.get('/api/auth-check', requireAuth, (req, res) => {
  res.json({ ok: true });
});

app.post('/api/analyze-and-save', requireAuth, async (req, res) => {
  const { url, note } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Fetch page content using Jina AI reader (handles JS-rendered pages, social media, etc.)
  let pageContent = '';
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadarSaver/1.0)',
        'Accept': 'text/plain',
      },
    });
    clearTimeout(timeout);
    if (response.ok) {
      const text = await response.text();
      pageContent = text.trim().slice(0, 2000);
    }
  } catch {
    // Jina failed — try direct fetch as fallback
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RadarSaver/1.0)' },
      });
      clearTimeout(timeout);
      const html = await response.text();
      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000);
    } catch {
      // Can't fetch — rely on URL alone
    }
  }

  // Ask Claude to analyze
  const prompt = `Analyze this URL and return a JSON object with metadata about the content.

URL: ${url}
${note ? `User note: "${note}"` : ''}
${pageContent ? `\nPage content excerpt:\n${pageContent}` : ''}

Return ONLY a valid JSON object (no markdown, no code fences) with exactly these fields:

{
  "title": "short descriptive name of the content (not the raw URL)",
  "author": "name of the person or organization who created the content — use null if unknown",
  "type": "one of: Tool | Post | Video | Article | Thread | Newsletter | Book | Song | Film",
  "source": "one of: LinkedIn | Twitter/X | Instagram | YouTube | Newsletter | Website | Other",
  "topic": ["array of one or more from the list below"],
  "relevance": "one of: ⭐ High | 👀 Medium | 🗃️ Low",
  "summary": "1-2 sentences: what it is and why it's worth saving"
}

Topic options (use exact strings):
"🤖 AI & Tech", "🛠️ Product Building", "💼 Business", "💡 Ideas & Inspiration",
"📈 Career & Jobs", "📚 Books & Learning", "🏋️ Health & Fitness", "🎨 Design & Creativity",
"🎮 Entertainment", "🎵 Music", "🎬 Films", "💰 Finance", "🌍 Travel", "🎯 Personal", "🔀 Other"

Relevance context: the user is a non-technical founder learning to build AI-powered micro-products to become self-employed. They are interested in entrepreneurship, AI tools (especially Claude), product building, and indie hacking. Rate relevance accordingly.`;

  let analysis;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      const rawText = message.content[0].text.trim();
      const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      analysis = JSON.parse(jsonText);
      break;
    } catch (err) {
      const isRetryable = err.status === 529 || err.status === 500 || err.status === 503;
      if (isRetryable && attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      console.error('Claude error:', err);
      return res.status(500).json({ error: 'Failed to analyze URL with Claude: ' + err.message });
    }
  }

  // Save to Notion
  let notionPageId = null;
  try {
    const properties = {
      Title: {
        title: [{ text: { content: analysis.title } }],
      },
      Type: {
        select: { name: analysis.type },
      },
      Source: {
        select: { name: analysis.source },
      },
      Topic: {
        multi_select: analysis.topic.map((t) => ({ name: t })),
      },
      Relevance: {
        select: { name: analysis.relevance },
      },
      Summary: {
        rich_text: [{ text: { content: analysis.summary } }],
      },
      URL: {
        url: url,
      },
      Status: {
        select: { name: '📥 Saved' },
      },
    };

    if (analysis.author) {
      properties.Author = {
        rich_text: [{ text: { content: analysis.author } }],
      };
    }

    const page = await notion.pages.create({
      parent: { database_id: NOTION_DB_ID },
      properties,
    });
    notionPageId = page.id;
  } catch (err) {
    console.error('Notion error:', err);
    return res.status(500).json({ error: 'Saved by Claude but failed to write to Notion: ' + err.message });
  }

  res.json({ ...analysis, pageId: notionPageId });
});

app.post('/api/update-entry', requireAuth, async (req, res) => {
  const { pageId, currentAnalysis, feedback, url } = req.body;
  if (!pageId || !feedback) return res.status(400).json({ error: 'pageId and feedback are required' });

  const prompt = `You previously analyzed a URL and produced this metadata:
${JSON.stringify(currentAnalysis, null, 2)}

The user has reviewed it and wants changes: "${feedback}"

Return an updated version of the JSON object with ONLY the fields that need to change updated. Keep all other fields exactly as they are.
Return ONLY a valid JSON object (no markdown, no code fences) with exactly these fields:

{
  "title": "short descriptive name of the content (not the raw URL)",
  "author": "name of the person or organization who created the content — use null if unknown",
  "type": "one of: Tool | Post | Video | Article | Thread | Newsletter | Book | Song | Film",
  "source": "one of: LinkedIn | Twitter/X | Instagram | YouTube | Newsletter | Website | Other",
  "topic": ["array of one or more from the list below"],
  "relevance": "one of: ⭐ High | 👀 Medium | 🗃️ Low",
  "summary": "1-2 sentences: what it is and why it's worth saving"
}

Topic options (use exact strings):
"🤖 AI & Tech", "🛠️ Product Building", "💼 Business", "💡 Ideas & Inspiration",
"📈 Career & Jobs", "📚 Books & Learning", "🏋️ Health & Fitness", "🎨 Design & Creativity",
"🎮 Entertainment", "🎵 Music", "🎬 Films", "💰 Finance", "🌍 Travel", "🎯 Personal", "🔀 Other"`;

  let revised;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      const rawText = message.content[0].text.trim();
      const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(jsonText);
      // Merge with currentAnalysis so any fields Claude omits fall back to existing values
      revised = { ...currentAnalysis, ...parsed };
      break;
    } catch (err) {
      const isRetryable = err.status === 529 || err.status === 500 || err.status === 503;
      if (isRetryable && attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      console.error('Claude error:', err);
      return res.status(500).json({ error: 'Failed to revise with Claude: ' + err.message });
    }
  }

  // Update Notion page
  try {
    const properties = {
      Title: { title: [{ text: { content: revised.title } }] },
      Type: { select: { name: revised.type } },
      Source: { select: { name: revised.source } },
      Topic: { multi_select: revised.topic.map((t) => ({ name: t })) },
      Relevance: { select: { name: revised.relevance } },
      Summary: { rich_text: [{ text: { content: revised.summary } }] },
    };
    if (revised.author) {
      properties.Author = { rich_text: [{ text: { content: revised.author } }] };
    }
    await notion.pages.update({ page_id: pageId, properties });
  } catch (err) {
    console.error('Notion update error:', err);
    return res.status(500).json({ error: 'Revised by Claude but failed to update Notion: ' + err.message });
  }

  res.json({ ...revised, pageId });
});

// Serve built frontend in production
const distPath = join(__dirname, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_, res) => res.sendFile(join(distPath, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Radar Saver server running on http://localhost:${PORT}`));
