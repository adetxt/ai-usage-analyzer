export const PRICING_VERSION = '2026-10-27';

const PRICES = {
  claude: [
    [/^claude-opus-4-[5678](?:-\d{8})?$/, [5, 25, 0.5, 6.25]],
    [/^claude-sonnet-4-6(?:-\d{8})?$/, [3, 15, 0.3, 3.75]],
    [/^claude-sonnet-4-5(?:-\d{8})?$/, [3, 15, 0.3, 3.75], 200000],
    [/^claude-sonnet-4(?:-\d{8})?$/, [3, 15, 0.3, 3.75], 200000],
    [/^claude-haiku-4-5(?:-\d{8})?$/, [1, 5, 0.1, 1.25]],
    [/^claude-3-5-haiku(?:-\d{8})?$/, [0.8, 4, 0.08, 1]],
  ],
  codex: [
    [/^gpt-5-5(?:-codex)?(?:-\d{4}-\d{2}-\d{2})?$/, [5, 30, 0.5, 0], 272000],
    [/^gpt-5-4-mini(?:-\d{4}-\d{2}-\d{2})?$/, [0.75, 4.5, 0.075, 0]],
    [/^gpt-5-4-nano(?:-\d{4}-\d{2}-\d{2})?$/, [0.2, 1.25, 0.02, 0]],
    [/^gpt-5-4-pro(?:-\d{4}-\d{2}-\d{2})?$/, [30, 180, 0, 0], 272000],
    [/^gpt-5-4(?:-codex)?(?:-\d{4}-\d{2}-\d{2})?$/, [2.5, 15, 0.25, 0], 272000],
    [/^gpt-5-[23](?:-codex)?(?:-\d{4}-\d{2}-\d{2})?$/, [1.75, 14, 0.175, 0]],
    [/^gpt-5-1(?:-codex)?(?:-\d{4}-\d{2}-\d{2})?$/, [1.25, 10, 0.125, 0]],
    [/^gpt-5-1-codex-mini(?:-\d{4}-\d{2}-\d{2})?$/, [0.25, 2, 0.025, 0]],
    [/^gpt-5-mini(?:-\d{4}-\d{2}-\d{2})?$/, [0.25, 2, 0.025, 0]],
    [/^gpt-5-nano(?:-\d{4}-\d{2}-\d{2})?$/, [0.05, 0.4, 0.005, 0]],
    [/^gpt-5(?:(?:-codex)?(?:-\d{4}-\d{2}-\d{2})?)$/, [1.25, 10, 0.125, 0]],
  ],
};

export function estimateUsage(tool, events) {
  let cost = 0;
  let priced = 0;
  const unknown = new Set();
  for (const { model, usage, provider, aggregated, ambiguousModel } of events) {
    const name = String(model || '').toLowerCase().replace(/[._ ]/g, '-').split('/').pop();
    const price = (PRICES[tool] || []).find(([pattern]) => pattern.test(name));
    if (!price || (tool === 'codex' && provider && provider.toLowerCase() !== 'openai')) { unknown.add(model || '(unknown model)'); continue; }
    if (aggregated || ambiguousModel) { unknown.add(`${model || '(unknown model)'} (aggregate usage)`); continue; }
    const [inputRate, outputRate, cacheRate, writeRate] = price[1];
    const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    const rawInput = nonnegative(usage.input_tokens);
    const cache = nonnegative(tool === 'codex' ? usage.cached_input_tokens : usage.cache_read_input_tokens);
    const input = tool === 'codex' ? Math.max(0, rawInput - cache) : rawInput;
    const output = nonnegative(usage.output_tokens);
    const write = nonnegative(usage.cache_creation_input_tokens);
    const prompt = rawInput + (tool === "claude" ? cache + write : 0);
    const long = price[2] && prompt > price[2];
    cost += (input * inputRate * (long ? 2 : 1) + output * outputRate * (long ? 1.5 : 1) + cache * cacheRate * (long ? 2 : 1) + write * writeRate * (long ? 2 : 1)) / 1000000;
    priced++;
  }
  return { cost, costStatus: unknown.size ? (priced ? 'partial' : 'unavailable') : 'estimated', unknownModels: [...unknown] };
}
