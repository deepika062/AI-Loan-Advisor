// src/advisor.js
// The grounded advisor. This is where "responsible + non-hallucinating AI" lives.
//
// Design contract:
//   1. Every number is computed by src/emi.js / src/recommend.js — NEVER by the LLM.
//   2. The LLM receives those numbers as an authoritative CONTEXT block and is
//      instructed to use ONLY them, quote them exactly, and never invent figures
//      or guarantee approval.
//   3. A fixed compliance disclaimer is appended by CODE, so it can never be
//      dropped or reworded by the model.
//   4. If the LLM is unavailable, we fall back to a deterministic, template-based
//      explanation — the product still works and never goes silent.

import { llmQuery, LLMError } from './llm.js';

export const DISCLAIMER =
  'Disclaimer: This is an automated estimate for guidance only, based on the mock ' +
  'information provided. It is not a loan offer or a guarantee of approval. Final ' +
  'eligibility, interest rate, and terms are subject to underwriting, credit checks, ' +
  'and document verification. Please verify all figures before making a decision.';

// Bonus: multilingual simulation. The compliance disclaimer is a legal artifact,
// so we keep vetted translations in code rather than letting the model translate it.
export const DISCLAIMERS = {
  English: DISCLAIMER,
  Hindi:
    'अस्वीकरण: यह केवल मार्गदर्शन हेतु एक स्वचालित अनुमान है, जो दी गई नमूना जानकारी पर ' +
    'आधारित है। यह ऋण प्रस्ताव या स्वीकृति की गारंटी नहीं है। अंतिम पात्रता, ब्याज दर और ' +
    'शर्तें अंडरराइटिंग, क्रेडिट जांच और दस्तावेज़ सत्यापन के अधीन हैं। निर्णय लेने से पहले सभी ' +
    'आंकड़ों की पुष्टि करें।',
  Spanish:
    'Aviso: Esta es una estimación automatizada solo con fines orientativos, basada en ' +
    'los datos de muestra proporcionados. No es una oferta de préstamo ni una garantía de ' +
    'aprobación. La elegibilidad, la tasa de interés y los términos finales están sujetos a ' +
    'evaluación crediticia y verificación de documentos. Verifique todas las cifras antes de decidir.',
  French:
    'Avertissement : ceci est une estimation automatisée à titre indicatif uniquement, basée ' +
    'sur les données fictives fournies. Il ne s’agit ni d’une offre de prêt ni d’une garantie ' +
    'd’approbation. L’éligibilité, le taux et les conditions définitifs dépendent de l’analyse ' +
    'du dossier et de la vérification des documents. Vérifiez tous les chiffres avant de décider.',
};

const SUPPORTED_LANGUAGES = Object.keys(DISCLAIMERS);

const SYSTEM_RULES = `You are "LoanWise", a responsible loan advisory assistant for a fintech lender.

STRICT GROUNDING RULES — follow without exception:
- Use ONLY the facts in the CONTEXT block. Do not use outside knowledge about specific rates or products.
- All numbers (EMI, interest, totals, rates, FOIR) in CONTEXT are pre-computed and authoritative. Quote them EXACTLY. Never recalculate, round differently, or estimate your own numbers.
- NEVER guarantee or promise loan approval. Approval always depends on underwriting and verification.
- If a product is marked ineligible, do not recommend it; you may briefly explain why using the given reasons.
- If the user asks for something not in CONTEXT, say you don't have that information rather than inventing it.
- Do not provide tax, legal, or investment advice.
- Be concise (under ~150 words unless comparing), plain-language, neutral, and transparent about trade-offs.
- Always be honest about affordability/FOIR stress when flagged.

Write a helpful, conversational reply to the user's message, grounded strictly in CONTEXT.`;

/**
 * Build the grounding prompt from authoritative facts + user message + short history.
 */
function buildPrompt(facts, userMessage, history, language) {
  const context = {
    borrowerProfile: facts.profile,
    obligationLimitPct: facts.constants.maxFoirPct,
    recommendedProduct: facts.recommendation,
    allEligibleProducts: facts.eligible,
    ineligibleProducts: facts.ineligible,
    tenureTradeoffIllustration: facts.tenureTradeoff,
  };

  const historyText = (history || [])
    .slice(-4)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const langLine =
    language && language !== 'English'
      ? `\nLANGUAGE: Write your entire reply in ${language}. Keep all numbers, currency amounts, ` +
        `rates, and product names exactly as given in CONTEXT — translate only the surrounding prose.`
      : '';

  return [
    SYSTEM_RULES,
    langLine,
    '',
    'CONTEXT (authoritative, scoped to this authenticated user only):',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
    historyText ? `\nRECENT CONVERSATION:\n${historyText}` : '',
    '',
    `USER MESSAGE: ${userMessage}`,
    '',
    'Your grounded reply:',
  ].join('\n');
}

/**
 * Deterministic fallback used when the LLM is unreachable, so the assistant
 * never fails silently and never depends on the model for correctness.
 */
function deterministicReply(facts) {
  if (!facts.recommendation) {
    const why = facts.ineligible.map((p) => `• ${p.name}: ${p.reasons[0]}`).join('\n');
    return `Based on your profile, no product currently fits your request. Key reasons:\n${why}\n\nYou could try a smaller amount, a longer tenure, or adding collateral.`;
  }
  const r = facts.recommendation;
  const stress = r.affordable ? '' : ` Note: this exceeds the ${facts.constants.maxFoirPct}% obligation limit (FOIR ${r.foirPct}%), so repayment stress is high.`;
  const others = facts.eligible
    .slice(1, 3)
    .map((p) => `${p.name} (EMI ₹${p.emi.toLocaleString('en-IN')} @ ${p.offeredRatePct}%)`)
    .join(', ');
  return (
    `Recommended: ${r.name} at ${r.offeredRatePct}% for ${r.tenureMonths} months.\n` +
    `• EMI: ₹${r.emi.toLocaleString('en-IN')} / month\n` +
    `• Total interest: ₹${r.totalInterest.toLocaleString('en-IN')}\n` +
    `• Total repayment: ₹${r.totalPayment.toLocaleString('en-IN')}\n` +
    `• Monthly obligations (FOIR): ${r.foirPct}% of income.${stress}` +
    (others ? `\n\nOther eligible options: ${others}.` : '')
  );
}

/**
 * Produce a grounded advisory reply.
 * @param {object} facts        Output of buildRecommendation().
 * @param {string} userMessage  The user's question/message.
 * @param {object} [opts]       { history, metadata, language }
 * @returns {Promise<{ reply:string, grounded:boolean, source:'llm'|'fallback', language:string, usage?:object }>}
 */
export async function advise(facts, userMessage, opts = {}) {
  const language = SUPPORTED_LANGUAGES.includes(opts.language) ? opts.language : 'English';
  const disclaimer = DISCLAIMERS[language];
  const prompt = buildPrompt(facts, userMessage, opts.history, language);
  try {
    const { text, usage } = await llmQuery(prompt, { metadata: opts.metadata });
    const reply = (text || '').trim() || deterministicReply(facts);
    return { reply: `${reply}\n\n${disclaimer}`, grounded: true, source: 'llm', language, usage };
  } catch (err) {
    if (!(err instanceof LLMError)) console.error('Advisor error:', err);
    return {
      reply: `${deterministicReply(facts)}\n\n${disclaimer}`,
      grounded: true,
      source: 'fallback',
      language,
    };
  }
}
