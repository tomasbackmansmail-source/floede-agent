// src/sdk-runner.js — Executes research/debug tasks via Anthropic Messages API
// Uses web_search server-side tool. No npm dependencies — fetch only.

const log = (...args) => console.log('[sdk-runner]', ...args);
const warn = (...args) => console.warn('[sdk-runner]', ...args);

const MODEL_MAP = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
};

const MODEL_COSTS = {
  'claude-haiku-4-5-20251001': { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 },
  'claude-sonnet-4-5-20250929': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};

export async function runResearchTask(task) {
  const maxTurns = task.max_turns || 8;
  const maxCost = task.max_cost_usd || 0.50;
  const modelKey = task.model || 'haiku';
  const model = MODEL_MAP[modelKey] || MODEL_MAP.haiku;
  const costs = MODEL_COSTS[model] || MODEL_COSTS['claude-haiku-4-5-20251001'];

  const systemPrompt =
    'Du är en autonom research-agent för Floede AB. Floede gör offentlig data användbar genom att extrahera strukturerad data från myndigheter och kommuner i Sverige.\n\n' +
    'Din uppgift: ' + task.syfte + '\n\n' +
    'Vertikal: ' + task.vertical + '\n\n' +
    'Regler:\n' +
    '- Var specifik med URL:er, datum och exakta data du hittar\n' +
    '- Om du inte hittar det du söker, rapportera vad du prövade och varför det inte fungerade\n' +
    '- Rapportera strukturerat med tydliga rubriker';

  const messages = [{ role: 'user', content: task.syfte }];
  let totalCost = 0;
  let turnsUsed = 0;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      turnsUsed++;
      log(`Turn ${turnsUsed}/${maxTurns}, cost so far: $${totalCost.toFixed(4)}`);

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${errText}`);
      }

      const data = await res.json();

      // Track cost
      if (data.usage) {
        totalCost += data.usage.input_tokens * costs.input;
        totalCost += data.usage.output_tokens * costs.output;
      }

      // Check for end_turn
      if (data.stop_reason === 'end_turn') {
        const textBlocks = (data.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text);
        const result = textBlocks.join('\n\n');
        log(`Completed in ${turnsUsed} turns, cost: $${totalCost.toFixed(4)}`);
        return { status: 'completed', result, cost_usd: totalCost, turns_used: turnsUsed };
      }

      // Check for tool_use (web_search is server-side but API requires tool_result)
      if (data.stop_reason === 'tool_use') {
        // Add assistant response to messages
        messages.push({ role: 'assistant', content: data.content });

        // Find tool_use blocks and send back tool_results
        const toolUseBlocks = (data.content || []).filter((b) => b.type === 'tool_use');
        const toolResults = toolUseBlocks.map((b) => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: '',
        }));
        messages.push({ role: 'user', content: toolResults });

        // Budget check at 80%
        if (totalCost > maxCost * 0.8) {
          // Collect any text so far
          const textBlocks = (data.content || [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text);
          const result = textBlocks.join('\n\n') || 'Budget limit reached before completion.';
          log(`Budget limit (80% of $${maxCost}) reached at $${totalCost.toFixed(4)}`);
          return { status: 'budget_limit', result, cost_usd: totalCost, turns_used: turnsUsed };
        }

        continue;
      }

      // Unknown stop_reason — treat as completed
      const textBlocks = (data.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text);
      const result = textBlocks.join('\n\n') || 'No text response.';
      log(`Ended with stop_reason: ${data.stop_reason}, turns: ${turnsUsed}`);
      return { status: 'completed', result, cost_usd: totalCost, turns_used: turnsUsed };
    }

    // Max turns reached
    log(`Max turns (${maxTurns}) reached, cost: $${totalCost.toFixed(4)}`);
    return { status: 'max_turns', result: 'Max turns reached.', cost_usd: totalCost, turns_used: turnsUsed };
  } catch (err) {
    warn(`Error: ${err.message}`);
    return { status: 'error', result: null, error: err.message, cost_usd: totalCost, turns_used: turnsUsed };
  }
}
