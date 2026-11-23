import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  computeBalanceSheet,
  computeFinancialRatios,
  computeGLSummary,
  computeIncomeStatement,
  computeTrialBalance,
  formatBDT,
  reconcileAllRegisters,
  round2,
} from '../src/engine/accountingEngine.ts';
import { DEFAULT_CUSTOM_INSTRUCTIONS, hydrateCustomInstructions } from '../src/data/seedData.ts';
import { searchDocumentVectors } from './vectorStore.ts';
import type {
  AiModelId,
  AiThinkingLevel,
  AiWorkflowKey,
  CustomInstructionsConfig,
  DocumentFileType,
  LedgerState,
  VectorSearchHit,
  VoucherKind,
} from '../src/types/accounting.ts';

export interface RetrievedDocCitation {
  docId: string;
  filename: string;
  fileType: DocumentFileType;
  chunkIndex: number;
  sectionLabel?: string;
  similarity: number;
}

export const ALLOWED_AI_MODELS: readonly AiModelId[] = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-4-argon',
] as const;

export const PAID_TIER_MODELS = new Set<AiModelId>([
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-4-argon',
]);

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiServiceError(
      'GEMINI_API_KEY is not configured on the server. Please add it in Settings > Secrets.',
      503
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class AiServiceError extends Error {
  status: number;
  isPaidModelError?: boolean;

  constructor(message: string, status = 500, isPaidModelError = false) {
    super(message);
    this.name = 'AiServiceError';
    this.status = status;
    this.isPaidModelError = isPaidModelError;
  }
}

function mapGeminiError(err: unknown, model: AiModelId): AiServiceError {
  if (err instanceof AiServiceError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('403') || lower.includes('permission_denied') || lower.includes('api_key_invalid')) {
    return new AiServiceError(
      'Gemini API authentication failed (403/400). Verify GEMINI_API_KEY in Settings > Secrets.',
      403,
      PAID_TIER_MODELS.has(model)
    );
  }
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    const paidHint = PAID_TIER_MODELS.has(model)
      ? ` Model "${model}" requires a billing-enabled API key or higher quota in Settings > Secrets.`
      : ' Rate limit or quota reached — try switching to gemini-3.1-flash-lite or retry shortly.';
    return new AiServiceError(`Gemini API quota exceeded (429).${paidHint}`, 429, PAID_TIER_MODELS.has(model));
  }
  if (lower.includes('404') || lower.includes('not_found')) {
    return new AiServiceError(
      `Requested model "${model}" was not found or is unavailable. Switch to gemini-4-hydrogen in Custom Instructions.`,
      404
    );
  }
  return new AiServiceError(raw || 'Gemini API request failed.', 502);
}

function resolveThinkingLevel(model: AiModelId, level: AiThinkingLevel): ThinkingLevel {
  if (level === 'XHIGH') {
    if (model === 'gemini-4-hydrogen' || model === 'gemini-4-neon') {
      return ThinkingLevel.XHIGH;
    }
    return ThinkingLevel.HIGH;
  }
  if (level === 'HIGH') return ThinkingLevel.HIGH;
  if (level === 'LOW') return ThinkingLevel.LOW;
  return ThinkingLevel.MEDIUM;
}

export function resolveWorkflowModel(
  ci: CustomInstructionsConfig,
  workflow: AiWorkflowKey
): { model: AiModelId; thinkingLevel: AiThinkingLevel } {
  if (!ci.enabled) {
    return {
      model: DEFAULT_CUSTOM_INSTRUCTIONS.models.defaultModel,
      thinkingLevel: DEFAULT_CUSTOM_INSTRUCTIONS.models.defaultThinkingLevel,
    };
  }
  const override = ci.models.workflowOverrides?.[workflow];
  if (override?.enabled) {
    return {
      model: ALLOWED_AI_MODELS.includes(override.model) ? override.model : 'gemini-4-hydrogen',
      thinkingLevel: override.thinkingLevel || 'MEDIUM',
    };
  }
  return {
    model: ALLOWED_AI_MODELS.includes(ci.models.defaultModel)
      ? ci.models.defaultModel
      : 'gemini-4-hydrogen',
    thinkingLevel: ci.models.defaultThinkingLevel || 'MEDIUM',
  };
}

export function buildLedgerSnapshotSummary(state: LedgerState): string {
  const tb = computeTrialBalance(state);
  const is = computeIncomeStatement(state);
  const bs = computeBalanceSheet(state);
  const ratios = computeFinancialRatios(state);
  const recon = reconcileAllRegisters(state, false);
  const glSummary = computeGLSummary(state);

  const cashBankAccounts = glSummary
    .filter((a) => ['1210', '1220', '1230', '1240'].includes(a.code))
    .map((a) => `${a.code} ${a.name}: ${formatBDT(a.closingBalance)}`)
    .join('; ');

  const unpostedVouchers = new Set(
    state.journalLines.filter((l) => l.postingStatus !== 'POSTED').map((l) => l.voucherNo)
  ).size;
  const pendingSync = state.postedTransactions.filter((t) => t.registerSynced === 'PENDING').length;

  return [
    `Organization: ${state.config.organizationName} | Fiscal Period: ${state.config.fiscalPeriod} | Currency: ${state.config.currencyCode} (${state.config.currencySymbol})`,
    `Tax IDs: TIN ${state.config.tinNumber || 'N/A'} | BIN/VAT ${state.config.binVatNumber || 'N/A'} | Defaults: VAT ${state.config.defaultVatPct ?? 15}%, TDS ${state.config.defaultTdsPct ?? 5}%, VDS ${state.config.defaultVdsPct ?? 7.5}%`,
    `Approval Controls: Auto-Approve <= ${formatBDT(state.config.autoApproveLimit ?? 250000)} | Dual Sign-Off >= ${formatBDT(state.config.dualApprovalThreshold ?? 1000000)} | Locked Months: ${(state.config.lockedMonths || []).join(', ') || 'None'} | Global Lock Date: ${state.config.globalLockDate || 'None'}`,
    `Live Trial Balance: Closing Dr ${formatBDT(tb.totals.closingDr)} | Closing Cr ${formatBDT(tb.totals.closingCr)} | Balanced: ${tb.isClosingBalanced ? 'YES' : 'NO'}`,
    `Income Statement (FY25): Revenue ${formatBDT(is.totalIncome)} | Gross Profit ${formatBDT(is.grossProfit)} (${is.grossMarginPct.toFixed(2)}%) | Net Profit ${formatBDT(is.netProfit)} (${is.netMarginPct.toFixed(2)}%)`,
    `Balance Sheet (FY25): Assets ${formatBDT(bs.totalAssets)} | Liabilities ${formatBDT(bs.totalLiabilities)} | Equity ${formatBDT(bs.totalEquity)} | Balanced: ${bs.isBalanced ? 'YES' : 'NO'}`,
    `Liquidity & Cash: Current Ratio ${ratios.current.currentRatio.toFixed(2)}x | Quick Ratio ${ratios.current.quickRatio.toFixed(2)}x | Cash & Bank Balances: ${cashBankAccounts || 'N/A'}`,
    `Ledger Operations: Active COA Accounts: ${state.accounts.filter((a) => a.status === 'Active').length} | Unposted Journal Vouchers: ${unpostedVouchers} | Posted Lines: ${state.postedTransactions.length} | Pending Register Sync: ${pendingSync} | Reconciliation Variances: ${recon.discrepancies.length}`,
  ].join('\n');
}

export function compileCustomInstructions(
  state: LedgerState,
  workflow: AiWorkflowKey,
  options?: {
    extraContext?: string;
    includeChartOfAccounts?: boolean;
    ragHits?: VectorSearchHit[];
  }
): {
  systemInstruction: string;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  activeRulesCount: number;
  activeGlossaryCount: number;
  activeDocumentsCount: number;
  vectorizedChunksCount: number;
} {
  const ci = hydrateCustomInstructions(state.config.customInstructions);
  const { model, thinkingLevel } = resolveWorkflowModel(ci, workflow);
  const targetDocScope =
    workflow === 'assistant' ? 'assistant' : workflow === 'reportInsights' ? 'reporting' : 'global';

  const enabledDocs = ci.knowledge.documents.filter(
    (d) =>
      d.enabled &&
      (targetDocScope === 'global' || d.scope === 'global' || d.scope === targetDocScope)
  );
  const ragHits = options?.ragHits || [];

  const buildDocumentContextBlock = (): string | null => {
    if (ragHits.length > 0) {
      const blocks = ragHits.map(
        (h) =>
          `--- Document Store [Source: ${h.filename} (${h.fileType}) | Chunk #${h.chunkIndex + 1}${h.sectionLabel ? ` · ${h.sectionLabel}` : ''} | Similarity ${(h.similarity * 100).toFixed(1)}%] ---\n${h.text}`
      );
      return `=== VECTORIZED DOCUMENT STORE CONTEXT (GLOBAL SEMANTIC RAG) ===\nUse the following retrieved policy, schedule, and reference excerpts to ground your analysis and cite filenames where relevant:\n\n${blocks.join('\n\n')}`;
    }

    if (enabledDocs.length > 0) {
      const MAX_TOTAL_DOC_CHARS = 12000;
      let remaining = MAX_TOTAL_DOC_CHARS;
      const docBlocks: string[] = [];
      for (const doc of enabledDocs) {
        if (remaining <= 0) break;
        const snippet = doc.extractedText.slice(0, remaining);
        remaining -= snippet.length;
        docBlocks.push(
          `--- Document Store: ${doc.filename} (${doc.fileType} · ${doc.vectorStatus === 'vectorized' ? `${doc.chunkCount} vector chunks indexed` : 'unindexed excerpt'}) ---\n${snippet}`
        );
      }
      return `=== DOCUMENT STORE GLOBAL REFERENCE CONTEXT ===\n${docBlocks.join('\n\n')}`;
    }

    return null;
  };

  if (!ci.enabled) {
    const docBlock = buildDocumentContextBlock();
    const fallbackSections = [
      DEFAULT_CUSTOM_INSTRUCTIONS.prompts.globalSystemPrompt,
      DEFAULT_CUSTOM_INSTRUCTIONS.prompts.workflowPrompts[workflow],
      ...(docBlock ? [docBlock] : []),
      `=== LIVE ERP SNAPSHOT ===\n${buildLedgerSnapshotSummary(state)}`,
    ];
    return {
      systemInstruction: fallbackSections.join('\n\n'),
      model,
      thinkingLevel,
      activeRulesCount: 0,
      activeGlossaryCount: 0,
      activeDocumentsCount: enabledDocs.length,
      vectorizedChunksCount: ragHits.length,
    };
  }

  const toneDescriptions: Record<CustomInstructionsConfig['style']['aiTone'], string> = {
    'executive-concise': 'Executive & Concise: lead with key numbers, bullet takeaways, and zero fluff.',
    'audit-formal': 'Audit & Statutory Formal: precise IFRS/BFRS terminology, formal control language, and explicit evidence references.',
    'analytical-detailed': 'Analytical & Detailed: walk through variance drivers, formulas, and multi-period comparisons.',
    'plain-english': 'Plain Business English: explain accounting mechanics clearly for non-CPA operational stakeholders.',
  };

  const enabledRules = ci.knowledge.rules.filter((r) => r.enabled);
  const enabledGlossary = ci.knowledge.glossary.filter((g) => g.enabled);

  const sections: string[] = [];

  sections.push(`=== GLOBAL SYSTEM PERSONA ===\n${ci.prompts.globalSystemPrompt.trim()}`);

  const wfPrompt = ci.prompts.workflowPrompts[workflow]?.trim();
  if (wfPrompt) {
    sections.push(`=== WORKFLOW DIRECTIVE (${workflow.toUpperCase()}) ===\n${wfPrompt}`);
  }

  sections.push(
    `=== STYLE & OUTPUT FORMATTING ===\nTone: ${toneDescriptions[ci.style.aiTone]}\nFormatting Rules: ${ci.style.responseFormattingRules.trim()}`
  );

  if (ci.models.includeReasoningSummary) {
    sections.push(
      'Reasoning Transparency: Briefly include a 1-2 line "Basis & Assumptions" note showing which rules, Document Store citations, or GL figures informed your output.'
    );
  }

  if (enabledRules.length > 0) {
    sections.push(
      `=== ORGANIZATION BUSINESS & ACCOUNTING RULES ===\n${enabledRules
        .map((r, idx) => `${idx + 1}. [${r.category}] ${r.title}: ${r.content}`)
        .join('\n')}`
    );
  }

  if (enabledGlossary.length > 0) {
    sections.push(
      `=== DOMAIN GLOSSARY ===\n${enabledGlossary
        .map((g) => `- ${g.term}: ${g.definition}`)
        .join('\n')}`
    );
  }

  const docBlock = buildDocumentContextBlock();
  if (docBlock) {
    sections.push(docBlock);
  }

  if (ci.prompts.prohibitedBehaviors.trim()) {
    sections.push(`=== STRICT GUARDRAILS & PROHIBITIONS ===\n${ci.prompts.prohibitedBehaviors.trim()}`);
  }

  sections.push(`=== LIVE ATCL ERP SNAPSHOT ===\n${buildLedgerSnapshotSummary(state)}`);

  if (options?.includeChartOfAccounts) {
    const coaList = state.accounts
      .filter((a) => a.status === 'Active')
      .map((a) => `${a.code} | ${a.name} | ${a.category} | ${a.group}`)
      .join('\n');
    sections.push(`=== ACTIVE ATCL CHART OF ACCOUNTS ===\n${coaList}`);
  }

  if (options?.extraContext?.trim()) {
    sections.push(`=== CURRENT WORKSPACE CONTEXT ===\n${options.extraContext.trim()}`);
  }

  return {
    systemInstruction: sections.join('\n\n'),
    model,
    thinkingLevel,
    activeRulesCount: enabledRules.length,
    activeGlossaryCount: enabledGlossary.length,
    activeDocumentsCount: enabledDocs.length,
    vectorizedChunksCount: ragHits.length,
  };
}

export async function runInstructionSandboxTest(
  state: LedgerState,
  prompt: string,
  workflow: AiWorkflowKey,
  overrideConfig?: CustomInstructionsConfig
): Promise<{
  text: string;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  compiledChars: number;
  activeRulesCount: number;
  activeGlossaryCount: number;
  activeDocumentsCount: number;
  retrievedDocs: RetrievedDocCitation[];
}> {
  const effectiveState: LedgerState = overrideConfig
    ? {
        ...state,
        config: {
          ...state.config,
          customInstructions: overrideConfig,
        },
      }
    : state;

  const ci = hydrateCustomInstructions(effectiveState.config.customInstructions);
  const ragScope = workflow === 'assistant' ? 'assistant' : workflow === 'reportInsights' ? 'reporting' : 'global';
  const ragHits = await searchDocumentVectors({
    query: prompt,
    documents: ci.knowledge.documents,
    targetScope: ragScope,
    topK: 6,
  }).catch(() => []);

  const compiled = compileCustomInstructions(effectiveState, workflow, {
    includeChartOfAccounts: workflow === 'voucherDrafting',
    ragHits,
  });

  const ai = getAiClient();
  try {
    const response = await ai.models.generateContent({
      model: compiled.model,
      contents: prompt,
      config: {
        systemInstruction: compiled.systemInstruction,
        thinkingConfig: {
          thinkingLevel: resolveThinkingLevel(compiled.model, compiled.thinkingLevel),
        },
      },
    });

    return {
      text: response.text || 'No text returned by model.',
      model: compiled.model,
      thinkingLevel: compiled.thinkingLevel,
      compiledChars: compiled.systemInstruction.length,
      activeRulesCount: compiled.activeRulesCount,
      activeGlossaryCount: compiled.activeGlossaryCount,
      activeDocumentsCount: compiled.activeDocumentsCount,
      retrievedDocs: ragHits.map((h) => ({
        docId: h.docId,
        filename: h.filename,
        fileType: h.fileType,
        chunkIndex: h.chunkIndex,
        sectionLabel: h.sectionLabel,
        similarity: h.similarity,
      })),
    };
  } catch (err) {
    throw mapGeminiError(err, compiled.model);
  }
}

export async function streamAssistantChat(
  state: LedgerState,
  messages: Array<{ role: 'user' | 'model'; text: string }>,
  activeRoute: string,
  onChunk: (chunkText: string) => void
): Promise<{
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  activeRulesCount: number;
  activeDocumentsCount: number;
  retrievedDocs: RetrievedDocCitation[];
}> {
  const ai = getAiClient();
  const validHistory = messages
    .filter((m) => m.text && m.text.trim())
    .slice(-12);

  if (validHistory.length === 0) {
    throw new AiServiceError('Message cannot be empty.', 400);
  }

  const latestUserMessage =
    [...validHistory].reverse().find((m) => m.role === 'user')?.text || validHistory[validHistory.length - 1].text;

  const ci = hydrateCustomInstructions(state.config.customInstructions);
  const ragHits = await searchDocumentVectors({
    query: `${latestUserMessage}\nActive ERP view: ${activeRoute}`,
    documents: ci.knowledge.documents,
    targetScope: 'assistant',
    topK: 8,
    maxTotalChars: 12000,
  });

  const compiled = compileCustomInstructions(state, 'assistant', {
    includeChartOfAccounts: true,
    extraContext: `User is currently viewing route: ${activeRoute}.`,
    ragHits,
  });

  const contents = validHistory.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  try {
    const stream = await ai.models.generateContentStream({
      model: compiled.model,
      contents,
      config: {
        systemInstruction: compiled.systemInstruction,
        thinkingConfig: {
          thinkingLevel: resolveThinkingLevel(compiled.model, compiled.thinkingLevel),
        },
      },
    });

    for await (const chunk of stream) {
      if (chunk.text) {
        onChunk(chunk.text);
      }
    }

    return {
      model: compiled.model,
      thinkingLevel: compiled.thinkingLevel,
      activeRulesCount: compiled.activeRulesCount,
      activeDocumentsCount: compiled.activeDocumentsCount,
      retrievedDocs: ragHits.map((h) => ({
        docId: h.docId,
        filename: h.filename,
        fileType: h.fileType,
        chunkIndex: h.chunkIndex,
        sectionLabel: h.sectionLabel,
        similarity: h.similarity,
      })),
    };
  } catch (err) {
    throw mapGeminiError(err, compiled.model);
  }
}

export interface DraftedVoucherResponse {
  narration: string;
  counterparty: string;
  reference: string;
  date: string;
  reasoning: string;
  lines: Array<{
    glCode: string;
    glName: string;
    debit: number;
    credit: number;
    memo: string;
  }>;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
}

export async function draftVoucherWithAi(
  state: LedgerState,
  instruction: string,
  voucherKind?: VoucherKind | 'MasterJournal'
): Promise<DraftedVoucherResponse> {
  const compiled = compileCustomInstructions(state, 'voucherDrafting', {
    includeChartOfAccounts: true,
    extraContext: `Target voucher context: ${voucherKind || 'MasterJournal'}. Today's date: ${new Date().toISOString().slice(0, 10)}.`,
  });

  const ai = getAiClient();
  const activeMap = new Map(
    state.accounts.filter((a) => a.status === 'Active').map((a) => [a.code, a])
  );

  try {
    const response = await ai.models.generateContent({
      model: compiled.model,
      contents: `Draft a balanced double-entry accounting voucher for the following instruction:\n"${instruction.trim()}"\n\nRequirements:\n- Use ONLY valid GL codes from the Active ATCL Chart of Accounts.\n- Total Debits MUST equal Total Credits exactly (to 2 decimal places).\n- Each line must have either debit > 0 (and credit = 0) or credit > 0 (and debit = 0).`,
      config: {
        systemInstruction: compiled.systemInstruction,
        thinkingConfig: {
          thinkingLevel: resolveThinkingLevel(compiled.model, compiled.thinkingLevel),
        },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            narration: { type: Type.STRING, description: 'Clear accounting narration for the voucher' },
            counterparty: { type: Type.STRING, description: 'Customer, vendor, bank, or counterparty name' },
            reference: { type: Type.STRING, description: 'Suggested invoice, PO, or bank reference' },
            date: { type: Type.STRING, description: 'Transaction date in YYYY-MM-DD format' },
            reasoning: { type: Type.STRING, description: 'Brief accounting rationale citing applied rules or tax rates' },
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  glCode: { type: Type.STRING, description: 'Exact 4-digit GL account code from Active COA' },
                  debit: { type: Type.NUMBER, description: 'Debit amount in BDT (>= 0)' },
                  credit: { type: Type.NUMBER, description: 'Credit amount in BDT (>= 0)' },
                  memo: { type: Type.STRING, description: 'Short line-level explanation' },
                },
                required: ['glCode', 'debit', 'credit', 'memo'],
              },
            },
          },
          required: ['narration', 'counterparty', 'reference', 'date', 'reasoning', 'lines'],
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim()) as {
      narration?: string;
      counterparty?: string;
      reference?: string;
      date?: string;
      reasoning?: string;
      lines?: Array<{ glCode: string; debit: number; credit: number; memo?: string }>;
    };

    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const validatedLines = rawLines
      .map((l) => {
        const acc = activeMap.get(String(l.glCode || '').trim());
        if (!acc) return null;
        return {
          glCode: acc.code,
          glName: acc.name,
          debit: Math.max(0, round2(Number(l.debit) || 0)),
          credit: Math.max(0, round2(Number(l.credit) || 0)),
          memo: String(l.memo || '').trim(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && (x.debit > 0 || x.credit > 0));

    if (validatedLines.length < 2) {
      throw new AiServiceError(
        'AI could not map at least two valid active GL accounts for this instruction. Try naming the expense/asset and payment bank.',
        422
      );
    }

    return {
      narration: String(parsed.narration || instruction).trim(),
      counterparty: String(parsed.counterparty || 'General Counterparty').trim(),
      reference: String(parsed.reference || 'AI-DRAFT').trim(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || ''))
        ? String(parsed.date)
        : new Date().toISOString().slice(0, 10),
      reasoning: String(parsed.reasoning || '').trim(),
      lines: validatedLines,
      model: compiled.model,
      thinkingLevel: compiled.thinkingLevel,
    };
  } catch (err) {
    throw mapGeminiError(err, compiled.model);
  }
}

export interface ReportInsightsResponse {
  headline: string;
  executiveSummary: string;
  keyObservations: string[];
  riskFlags: string[];
  recommendedActions: string[];
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
  retrievedDocs?: RetrievedDocCitation[];
}

export async function generateReportInsights(
  state: LedgerState,
  reportScope: 'summary' | 'trial-balance' | 'income' | 'balance-sheet' | 'monthly' | 'audit',
  focusQuestion?: string
): Promise<ReportInsightsResponse> {
  const recon = reconcileAllRegisters(state, false);
  const tb = computeTrialBalance(state);
  const is = computeIncomeStatement(state);
  const bs = computeBalanceSheet(state);

  let scopeContext = '';
  if (reportScope === 'trial-balance') {
    const topRows = tb.rows
      .slice()
      .sort((a, b) => (b.closingDr + b.closingCr) - (a.closingDr + a.closingCr))
      .slice(0, 12)
      .map((r) => `${r.code} ${r.name}: FY25 Dr ${formatBDT(r.closingDr)} / Cr ${formatBDT(r.closingCr)} vs FY24 Dr ${formatBDT(r.priorDr)} / Cr ${formatBDT(r.priorCr)}`)
      .join('\n');
    scopeContext = `Report Focus: Comparative Trial Balance.\nBalanced: ${tb.isClosingBalanced} (Diff: ${tb.closingDiff.toFixed(2)}).\nTop Accounts:\n${topRows}`;
  } else if (reportScope === 'income') {
    scopeContext = `Report Focus: Income Statement (P&L).\nFY25 Revenue ${formatBDT(is.totalIncome)} (FY24 ${formatBDT(is.priorYear.totalIncome)}), Gross Profit ${formatBDT(is.grossProfit)} (${is.grossMarginPct.toFixed(2)}%), Operating Profit ${formatBDT(is.operatingProfit)}, Net Profit ${formatBDT(is.netProfit)} (${is.netMarginPct.toFixed(2)}%).`;
  } else if (reportScope === 'balance-sheet') {
    scopeContext = `Report Focus: Balance Sheet.\nTotal Assets ${formatBDT(bs.totalAssets)} (FY24 ${formatBDT(bs.priorYear.totalAssets)}), Total Liabilities ${formatBDT(bs.totalLiabilities)}, Total Equity ${formatBDT(bs.totalEquity)}, Variance ${bs.variance.toFixed(2)}.`;
  } else if (reportScope === 'audit') {
    scopeContext = `Report Focus: Register Reconciliation & Audit Integrity.\nChecked: ${recon.totalChecked} | Reconciled: ${recon.reconciledCount} | Discrepancies: ${recon.discrepancies.length}.\nDiscrepancy Details: ${recon.discrepancies.map((d) => `${d.code} ${d.name}: Expected ${formatBDT(d.expected)} vs Actual ${formatBDT(d.actual)} (Diff ${formatBDT(d.diff)})`).join('; ') || 'Zero discrepancies.'}`;
  } else {
    scopeContext = `Report Focus: General Ledger & Monthly Activity Overview (${reportScope}).`;
  }

  const ci = hydrateCustomInstructions(state.config.customInstructions);
  const retrievalQuery = focusQuestion?.trim()
    ? `${reportScope} financial reporting IFRS audit policy: ${focusQuestion.trim()}`
    : `${reportScope} IFRS statutory reporting policy compliance ratios audit accounting treatment`;

  const ragHits = await searchDocumentVectors({
    query: retrievalQuery,
    documents: ci.knowledge.documents,
    targetScope: 'reporting',
    topK: 8,
    maxTotalChars: 12000,
  });

  const compiled = compileCustomInstructions(state, 'reportInsights', {
    extraContext: scopeContext,
    ragHits,
  });

  const ai = getAiClient();
  const prompt = focusQuestion?.trim()
    ? `Analyze the ${reportScope} report and specifically address: ${focusQuestion.trim()}`
    : `Provide an executive IFRS/controller analysis for the ${reportScope} view, highlighting material variances, ratios, and actionable next steps.`;

  try {
    const response = await ai.models.generateContent({
      model: compiled.model,
      contents: prompt,
      config: {
        systemInstruction: compiled.systemInstruction,
        thinkingConfig: {
          thinkingLevel: resolveThinkingLevel(compiled.model, compiled.thinkingLevel),
        },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING, description: 'Concise 1-line analytical headline' },
            executiveSummary: { type: Type.STRING, description: '2-4 sentence executive synthesis grounded in actual figures' },
            keyObservations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3 to 5 bullet observations citing specific GL codes and BDT figures',
            },
            riskFlags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '0 to 3 compliance, liquidity, or reconciliation alerts (empty if none)',
            },
            recommendedActions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2 to 4 concrete next steps for the finance controller',
            },
          },
          required: ['headline', 'executiveSummary', 'keyObservations', 'riskFlags', 'recommendedActions'],
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim()) as Partial<ReportInsightsResponse>;
    return {
      headline: parsed.headline || 'Executive Financial Commentary',
      executiveSummary: parsed.executiveSummary || '',
      keyObservations: Array.isArray(parsed.keyObservations) ? parsed.keyObservations : [],
      riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
      recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions : [],
      model: compiled.model,
      thinkingLevel: compiled.thinkingLevel,
      retrievedDocs: ragHits.map((h) => ({
        docId: h.docId,
        filename: h.filename,
        fileType: h.fileType,
        chunkIndex: h.chunkIndex,
        sectionLabel: h.sectionLabel,
        similarity: h.similarity,
      })),
    };
  } catch (err) {
    throw mapGeminiError(err, compiled.model);
  }
}

export interface GeneratedTemplateResponse {
  name: string;
  code: string;
  description: string;
  htmlContent: string;
  cssContent: string;
  notes: string;
  model: AiModelId;
  thinkingLevel: AiThinkingLevel;
}

export async function generateTemplateWithAi(
  state: LedgerState,
  prompt: string,
  options: {
    category: string;
    dataSource: string;
    paperSize: string;
    existingHtml?: string;
    existingCss?: string;
  }
): Promise<GeneratedTemplateResponse> {
  const ci = hydrateCustomInstructions(state.config.customInstructions);
  const compiled = compileCustomInstructions(state, 'templateStudio', {
    extraContext: [
      `Target Category: ${options.category} | Data Source: ${options.dataSource} | Paper Size: ${options.paperSize}`,
      `Active Brand Accent Color: ${ci.style.accentHex} | UI Theme Preset: ${ci.style.themePreset}`,
      'Available ATCL Merge Tokens: {{org_name}}, {{org_address}}, {{org_tin}}, {{org_bin}}, {{fiscal_period}}, {{doc_title}}, {{doc_number}}, {{doc_date}}, {{party_name}}, {{reference_no}}, {{status_label}}, {{amount_total_fmt}}, {{subtotal_fmt}}, {{tax_fmt}}, {{line_items_rows}}, {{gl_summary_rows}}, {{printed_at}}.',
      options.existingHtml
        ? `Refine the following existing HTML template based on user instructions:\n${options.existingHtml.slice(0, 6000)}`
        : 'Create a brand-new, self-contained HTML + CSS document layout.',
    ].join('\n'),
  });

  const ai = getAiClient();
  try {
    const response = await ai.models.generateContent({
      model: compiled.model,
      contents: prompt.trim(),
      config: {
        systemInstruction: compiled.systemInstruction,
        thinkingConfig: {
          thinkingLevel: resolveThinkingLevel(compiled.model, compiled.thinkingLevel),
        },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Clean template title' },
            code: { type: Type.STRING, description: 'Short uppercase template code e.g. TPL-AI-01' },
            description: { type: Type.STRING, description: 'One-sentence description of template purpose' },
            htmlContent: { type: Type.STRING, description: 'Valid HTML body snippet using ATCL {{merge_tokens}} and semantic tables (no <script> tags)' },
            cssContent: { type: Type.STRING, description: 'Clean scoped CSS rules for print and desktop preview' },
            notes: { type: Type.STRING, description: 'Brief note on tokens and layout choices' },
          },
          required: ['name', 'code', 'description', 'htmlContent', 'cssContent', 'notes'],
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim()) as Partial<GeneratedTemplateResponse>;
    return {
      name: String(parsed.name || 'AI Generated Template').trim(),
      code: String(parsed.code || 'TPL-AI-01').trim().toUpperCase(),
      description: String(parsed.description || 'Generated using ATCL Custom Instructions').trim(),
      htmlContent: String(parsed.htmlContent || '').trim(),
      cssContent: String(parsed.cssContent || '').trim(),
      notes: String(parsed.notes || '').trim(),
      model: compiled.model,
      thinkingLevel: compiled.thinkingLevel,
    };
  } catch (err) {
    throw mapGeminiError(err, compiled.model);
  }
}
