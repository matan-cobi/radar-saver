import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const NOTION_DB_ID = process.env.NOTION_DB_ID?.trim();

async function pickIcon(title, type) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `Pick a single emoji that best represents this content. Reply with ONLY the emoji, nothing else.\n\nTitle: "${title}"\nType: ${type || 'Unknown'}`,
      }],
    });
    const emoji = message.content?.[0]?.text?.trim();
    return emoji || '📌';
  } catch {
    return '📌';
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  if (!NOTION_DB_ID) {
    console.error('NOTION_DB_ID is not set in .env');
    process.exit(1);
  }

  let cursor;
  let total = 0;
  let updated = 0;

  console.log('Fetching pages from Notion...');

  do {
    const query = { database_id: NOTION_DB_ID, page_size: 100 };
    if (cursor) query.start_cursor = cursor;

    const response = await notion.databases.query(query);

    for (const page of response.results) {
      total++;
      if (page.icon !== null) {
        console.log(`  [skip] ${page.properties.Title?.title?.[0]?.plain_text || 'Untitled'} — already has icon`);
        continue;
      }

      const title = page.properties.Title?.title?.[0]?.plain_text || 'Untitled';
      const type = page.properties.Type?.select?.name || null;

      console.log(`  [icon] ${title}...`);
      const emoji = await pickIcon(title, type);

      try {
        await notion.pages.update({
          page_id: page.id,
          icon: { type: 'emoji', emoji },
        });
        console.log(`         → ${emoji}`);
        updated++;
      } catch (err) {
        console.error(`         → ERROR: ${err.message}`);
      }

      await sleep(500);
    }

    cursor = response.next_cursor;
  } while (cursor);

  console.log(`\nDone. ${updated} of ${total} pages updated with icons.`);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
