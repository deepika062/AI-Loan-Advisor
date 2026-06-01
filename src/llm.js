// src/llm.js
// Thin client for the provided LLM wrapper API.
// Endpoint: POST {LLM_API_URL}  Body: { prompt, metadata? }  -> { response, usage, latency }

const LLM_API_URL = process.env.LLM_API_URL || 'https://llm-wrapper-741152993481.asia-south1.run.app/llm/query';
const LLM_API_TOKEN = process.env.LLM_API_TOKEN;

export class LLMError extends Error {}

/**
 * Send a prompt to the LLM wrapper and return the model's text response.
 * @param {string} prompt
 * @param {object} [opts]
 * @param {object} [opts.metadata]  Trace metadata (e.g. { traceId, userId }).
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ text:string, usage:object, latency:number }>}
 */
export async function llmQuery(prompt, opts = {}) {
  if (!LLM_API_TOKEN) throw new LLMError('LLM_API_TOKEN is not configured.');
  const { metadata, timeoutMs = 45000 } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_TOKEN}`,
      },
      body: JSON.stringify(metadata ? { prompt, metadata } : { prompt }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new LLMError(`LLM wrapper returned ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return { text: data.response ?? '', usage: data.usage, latency: data.latency };
  } catch (err) {
    if (err.name === 'AbortError') throw new LLMError('LLM request timed out.');
    throw err instanceof LLMError ? err : new LLMError(`LLM request failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}
