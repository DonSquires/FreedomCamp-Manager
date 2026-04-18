#!/usr/bin/env node

import process from 'node:process';
import readline from 'node:readline';

function resolveBaseUrl() {
  const raw =
    process.env.BOB_SERVICE_URL || process.env.INFERENCE_SERVICE_URL || '';
  return String(raw).trim().replace(/\/+$/, '');
}

function resolveApiKey() {
  return String(
    process.env.BOB_INFERENCE_API_KEY ||
      process.env.INFERENCE_API_KEY ||
      ''
  ).trim();
}

class BobConversation {
  constructor(context = {}) {
    this.baseUrl = resolveBaseUrl();
    this.apiKey = resolveApiKey();
    this.timeoutMs = Number(process.env.BOB_CHAT_TIMEOUT_MS || 30000);
    this.conversation = [];
    this.context = context;
    this.rl = null;

    if (!this.baseUrl || !this.apiKey) {
      const missing = [
        !this.baseUrl
          ? 'BOB_SERVICE_URL-or-INFERENCE_SERVICE_URL'
          : null,
        !this.apiKey
          ? 'BOB_INFERENCE_API_KEY-or-INFERENCE_API_KEY'
          : null,
      ]
        .filter(Boolean)
        .join(', ');
      throw new Error(`[BobChat] Missing config: ${missing}`);
    }
  }

  createReadlineInterface() {
    return readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async sendMessage(message, role = 'user') {
    this.conversation.push({ role, message });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      console.log(`\n[Agent] Sending to Bob...\n`);

      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-inference-api-key': this.apiKey,
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          message,
          context: this.context,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `Bob /chat failed (${response.status}): ${body.slice(0, 300)}`
        );
      }

      const payload = await response.json().catch(() => ({}));
      const bobReply =
        payload.message ||
        payload.response ||
        JSON.stringify(payload).slice(0, 200);

      this.conversation.push({
        role: 'bob',
        message: bobReply,
        metadata: {
          provider: payload.provider || 'unknown',
          fallback: payload.fallback === true,
        },
      });

      console.log(`\n[Bob] ${bobReply}\n`);
      return bobReply;
    } finally {
      clearTimeout(timer);
    }
  }

  async interactiveLoop() {
    return new Promise((resolve) => {
      this.rl = this.createReadlineInterface();

      const askNext = () => {
        this.rl.question(
          '[Agent] Your turn (or "exit" to end): ',
          async (input) => {
            if (
              input.toLowerCase() === 'exit' ||
              input.toLowerCase() === 'quit'
            ) {
              console.log('\n[Chat] Conversation ended.\n');
              this.rl.close();
              resolve(this.conversation);
              return;
            }

            if (!input.trim()) {
              askNext();
              return;
            }

            try {
              await this.sendMessage(input, 'agent');
              askNext();
            } catch (err) {
              console.error(`[Chat Error] ${err.message}`);
              this.rl.close();
              resolve(this.conversation);
            }
          }
        );
      };

      askNext();
    });
  }

  async runProgrammatic(turns) {
    // Programmatic mode: execute pre-defined turns without readline
    // Useful for scripted collaboration
    for (const turn of turns) {
      if (typeof turn === 'string') {
        await this.sendMessage(turn, 'agent');
      } else if (turn.role === 'agent' || turn.role === 'user') {
        await this.sendMessage(turn.message, 'agent');
      }
    }
    return this.conversation;
  }

  printConversation() {
    console.log('\n========== Conversation Summary ==========\n');
    for (const turn of this.conversation) {
      const prefix = turn.role === 'bob' ? '[Bob]' : '[You]';
      console.log(`${prefix}\n${turn.message}\n`);
    }
    console.log('==========================================\n');
  }
}

// Export for use as module
export { BobConversation };

// CLI mode: standalone interactive chat
async function main() {
  const args = process.argv.slice(2);
  const isInteractive = !args.length || args[0] === '--interactive';

  console.log(`
╔════════════════════════════════════════╗
║       Bob Collaboration Chat          ║
║   Multi-turn Agent ↔ Bob Dialogue     ║
╚════════════════════════════════════════╝
`);

  try {
    const chat = new BobConversation({
      workdir: process.cwd(),
      timestamp: new Date().toISOString(),
    });

    if (isInteractive) {
      await chat.interactiveLoop();
    } else {
      // Support piped initial message
      const initialMessage = args.join(' ');
      if (initialMessage) {
        await chat.sendMessage(initialMessage, 'agent');
        // Then start interactive loop
        await chat.interactiveLoop();
      }
    }

    chat.printConversation();
  } catch (err) {
    console.error(`\n[Fatal] ${err.message}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
