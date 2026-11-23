import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractText, getDocumentProxy } from 'unpdf';
import type {
  DocumentChunkPreview,
  DocumentFileType,
  DocumentInjectionScope,
  KnowledgeDocumentItem,
  VectorSearchHit,
} from '../src/types/accounting.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
const VECTOR_STORE_FILE = path.resolve(DATA_DIR, 'atcl-vector-store.json');

export const EMBEDDING_MODEL = 'gemini-embedding-2';

export interface StoredVectorChunk {
  id: string;
  docId: string;
  filename: string;
  chunkIndex: number;
  sectionLabel?: string;
  text: string;
  charCount: number;
  tokenEstimate: number;
  embedding: number[];
}

interface VectorStoreFileSchema {
  version: number;
  embeddingModel: string;
  docs: Record<
    string,
    {
      docId: string;
      filename: string;
      updatedAt: string;
      embeddingDimensions: number;
      chunks: StoredVectorChunk[];
    }
  >;
}

function getEmbeddingClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets to vectorize documents.'
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

function loadVectorStore(): VectorStoreFileSchema {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(VECTOR_STORE_FILE)) {
    return { version: 1, embeddingModel: EMBEDDING_MODEL, docs: {} };
  }
  try {
    const raw = fs.readFileSync(VECTOR_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as VectorStoreFileSchema;
    if (!parsed || typeof parsed.docs !== 'object') {
      return { version: 1, embeddingModel: EMBEDDING_MODEL, docs: {} };
    }
    return parsed;
  } catch {
    return { version: 1, embeddingModel: EMBEDDING_MODEL, docs: {} };
  }
}

function saveVectorStore(store: VectorStoreFileSchema): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${VECTOR_STORE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(store), 'utf-8');
  fs.renameSync(tmpFile, VECTOR_STORE_FILE);
}

export function inferDocumentFileType(filename: string): DocumentFileType {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'PDF';
  if (ext === '.csv' || ext === '.tsv') return 'CSV';
  if (ext === '.md' || ext === '.markdown') return 'MD';
  if (ext === '.json') return 'JSON';
  return 'TXT';
}

export async function extractDocumentText(input: {
  filename: string;
  base64Data?: string;
  textContent?: string;
}): Promise<{
  extractedText: string;
  sizeBytes: number;
  fileType: DocumentFileType;
  pageCount?: number;
}> {
  const cleanName = path.basename(String(input.filename || '').trim());
  const ext = path.extname(cleanName).toLowerCase();
  const fileType = inferDocumentFileType(cleanName);

  if (ext === '.pdf') {
    if (!input.base64Data) {
      throw new Error('PDF uploads require binary base64 file content.');
    }
    const cleanBase64 = input.base64Data.includes(',')
      ? input.base64Data.split(',')[1]
      : input.base64Data;
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.byteLength === 0) {
      throw new Error('Uploaded PDF file is empty.');
    }
    if (buffer.byteLength > 5 * 1024 * 1024) {
      throw new Error('PDF file exceeds 5 MB upload limit.');
    }

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
    const formattedPages = pages
      .map((pageText, idx) => {
        const cleaned = String(pageText || '')
          .replace(/\u0000/g, '')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        return cleaned ? `[Page ${idx + 1}]\n${cleaned}` : '';
      })
      .filter(Boolean);

    const joined = formattedPages.join('\n\n').trim();
    if (!joined) {
      throw new Error(
        'No selectable text could be extracted from this PDF. Ensure the PDF contains embedded text rather than scanned images.'
      );
    }

    return {
      extractedText: joined.slice(0, 150000),
      sizeBytes: buffer.byteLength,
      fileType: 'PDF',
      pageCount: result.totalPages || pages.length,
    };
  }

  // Text-based formats: CSV, TSV, MD, TXT, JSON
  let rawText = '';
  let sizeBytes = 0;
  if (input.textContent !== undefined) {
    rawText = String(input.textContent || '');
    sizeBytes = Buffer.byteLength(rawText, 'utf-8');
  } else if (input.base64Data) {
    const cleanBase64 = input.base64Data.includes(',')
      ? input.base64Data.split(',')[1]
      : input.base64Data;
    const buf = Buffer.from(cleanBase64, 'base64');
    sizeBytes = buf.byteLength;
    rawText = buf.toString('utf-8');
  }

  const cleaned = rawText.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  if (!cleaned) {
    throw new Error('Uploaded document is empty.');
  }
  if (sizeBytes > 2 * 1024 * 1024) {
    throw new Error('Text/CSV/Markdown document exceeds 2 MB limit.');
  }

  return {
    extractedText: cleaned.slice(0, 150000),
    sizeBytes,
    fileType,
  };
}

interface RawChunk {
  chunkIndex: number;
  sectionLabel?: string;
  text: string;
}

export function chunkDocumentText(
  text: string,
  fileType: DocumentFileType,
  targetChars = 900
): RawChunk[] {
  const normalizedTarget = Math.min(1600, Math.max(400, Math.round(targetChars || 900)));
  const overlapChars = Math.min(200, Math.round(normalizedTarget * 0.15));
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const chunks: RawChunk[] = [];

  if (fileType === 'CSV') {
    const lines = clean.split('\n').filter((l) => l.trim().length > 0);
    const header = lines[0] || '';
    const dataRows = lines.slice(1);
    if (dataRows.length === 0) {
      return [{ chunkIndex: 0, sectionLabel: 'CSV Header', text: header }];
    }

    let currentLines: string[] = [];
    let currentLen = header.length + 12;
    let rowStart = 1;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (currentLines.length > 0 && currentLen + row.length + 1 > normalizedTarget) {
        chunks.push({
          chunkIndex: chunks.length,
          sectionLabel: `CSV Rows ${rowStart}-${rowStart + currentLines.length - 1}`,
          text: `Columns: ${header}\n${currentLines.join('\n')}`,
        });
        rowStart = i + 1;
        currentLines = [];
        currentLen = header.length + 12;
      }
      currentLines.push(row);
      currentLen += row.length + 1;
    }

    if (currentLines.length > 0) {
      chunks.push({
        chunkIndex: chunks.length,
        sectionLabel: `CSV Rows ${rowStart}-${rowStart + currentLines.length - 1}`,
        text: `Columns: ${header}\n${currentLines.join('\n')}`,
      });
    }
    return chunks;
  }

  // Heading & Page-aware splitting for MD, PDF, TXT, JSON
  const paragraphs = clean.split(/\n{2,}/);
  let activeSection = fileType === 'PDF' ? 'Page 1' : 'Document Body';
  let buffer = '';

  const flushBuffer = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    if (trimmed.length <= normalizedTarget * 1.35) {
      chunks.push({
        chunkIndex: chunks.length,
        sectionLabel: activeSection,
        text: trimmed,
      });
    } else {
      // Sliding window split for oversized single paragraph
      let start = 0;
      while (start < trimmed.length) {
        const end = Math.min(trimmed.length, start + normalizedTarget);
        const slice = trimmed.slice(start, end).trim();
        if (slice) {
          chunks.push({
            chunkIndex: chunks.length,
            sectionLabel: activeSection,
            text: slice,
          });
        }
        if (end >= trimmed.length) break;
        start = Math.max(start + 1, end - overlapChars);
      }
    }
    buffer = '';
  };

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    // Detect Markdown heading or [Page X] marker
    const mdHeading = /^(#{1,4})\s+(.+)$/m.exec(trimmedPara);
    const pdfPage = /^\[(Page \d+)\]/i.exec(trimmedPara);
    if (mdHeading) {
      if (buffer.length > normalizedTarget * 0.4) {
        flushBuffer();
      }
      activeSection = mdHeading[2].trim().slice(0, 64);
    } else if (pdfPage) {
      if (buffer.length > normalizedTarget * 0.4) {
        flushBuffer();
      }
      activeSection = pdfPage[1];
    }

    if (buffer.length > 0 && buffer.length + trimmedPara.length + 2 > normalizedTarget) {
      flushBuffer();
    }

    buffer = buffer ? `${buffer}\n\n${trimmedPara}` : trimmedPara;
  }

  flushBuffer();
  return chunks;
}

async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getEmbeddingClient();
  const vectors: number[][] = [];
  const BATCH_SIZE = 20;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
    });
    const embeddings = res.embeddings || [];
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Embedding response mismatch: expected ${batch.length} vectors, received ${embeddings.length}.`
      );
    }
    for (const emb of embeddings) {
      const vals = emb.values || [];
      if (vals.length === 0) {
        throw new Error('Gemini embedding model returned an empty vector.');
      }
      vectors.push(vals);
    }
  }

  return vectors;
}

export async function vectorizeAndStoreDocument(
  doc: KnowledgeDocumentItem,
  chunkSizeTarget?: number
): Promise<{
  chunkCount: number;
  embeddingDimensions: number;
  embeddingModel: string;
  vectorizedAt: string;
}> {
  const rawChunks = chunkDocumentText(
    doc.extractedText,
    doc.fileType || inferDocumentFileType(doc.filename),
    chunkSizeTarget ?? doc.chunkSizeTarget ?? 900
  );

  if (rawChunks.length === 0) {
    throw new Error('Document produced zero text chunks to vectorize.');
  }

  const chunkTexts = rawChunks.map(
    (c) => `Source: ${doc.filename}${c.sectionLabel ? ` (${c.sectionLabel})` : ''}\n${c.text}`
  );

  const embeddings = await generateBatchEmbeddings(chunkTexts);
  const dims = embeddings[0]?.length || 0;
  const now = new Date().toISOString();

  const storedChunks: StoredVectorChunk[] = rawChunks.map((raw, idx) => ({
    id: `${doc.id}-CHK-${String(idx + 1).padStart(3, '0')}`,
    docId: doc.id,
    filename: doc.filename,
    chunkIndex: raw.chunkIndex,
    sectionLabel: raw.sectionLabel,
    text: raw.text,
    charCount: raw.text.length,
    tokenEstimate: Math.ceil(raw.text.length / 4),
    embedding: embeddings[idx],
  }));

  const store = loadVectorStore();
  store.docs[doc.id] = {
    docId: doc.id,
    filename: doc.filename,
    updatedAt: now,
    embeddingDimensions: dims,
    chunks: storedChunks,
  };
  saveVectorStore(store);

  return {
    chunkCount: storedChunks.length,
    embeddingDimensions: dims,
    embeddingModel: EMBEDDING_MODEL,
    vectorizedAt: now,
  };
}

export function deleteDocumentVectors(docId: string): void {
  const store = loadVectorStore();
  if (store.docs[docId]) {
    delete store.docs[docId];
    saveVectorStore(store);
  }
}

export function clearVectorStore(): void {
  saveVectorStore({ version: 1, embeddingModel: EMBEDDING_MODEL, docs: {} });
}

export function getDocumentChunks(docId: string): DocumentChunkPreview[] {
  const store = loadVectorStore();
  const entry = store.docs[docId];
  if (!entry) return [];
  return entry.chunks.map((c) => ({
    id: c.id,
    docId: c.docId,
    filename: c.filename,
    chunkIndex: c.chunkIndex,
    sectionLabel: c.sectionLabel,
    text: c.text,
    charCount: c.charCount,
    tokenEstimate: c.tokenEstimate,
    embeddingDimensions: c.embedding.length,
  }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export async function searchDocumentVectors(options: {
  query: string;
  documents: KnowledgeDocumentItem[];
  targetScope: DocumentInjectionScope;
  topK?: number;
  maxTotalChars?: number;
}): Promise<VectorSearchHit[]> {
  const cleanQuery = String(options.query || '').trim();
  if (!cleanQuery) return [];

  const eligibleDocs = options.documents.filter(
    (d) =>
      d.enabled &&
      d.vectorStatus === 'vectorized' &&
      (options.targetScope === 'global' ||
        d.scope === 'global' ||
        d.scope === options.targetScope)
  );
  if (eligibleDocs.length === 0) return [];

  const store = loadVectorStore();
  const candidateChunks: Array<{ doc: KnowledgeDocumentItem; chunk: StoredVectorChunk }> = [];
  for (const doc of eligibleDocs) {
    const stored = store.docs[doc.id];
    if (!stored || stored.chunks.length === 0) continue;
    for (const chunk of stored.chunks) {
      if (chunk.embedding && chunk.embedding.length > 0) {
        candidateChunks.push({ doc, chunk });
      }
    }
  }

  if (candidateChunks.length === 0) return [];

  const [queryVector] = await generateBatchEmbeddings([cleanQuery]);
  if (!queryVector || queryVector.length === 0) return [];

  const scored = candidateChunks
    .map(({ doc, chunk }) => ({
      docId: doc.id,
      filename: doc.filename,
      fileType: doc.fileType,
      scope: doc.scope,
      chunkIndex: chunk.chunkIndex,
      sectionLabel: chunk.sectionLabel,
      text: chunk.text,
      similarity: Number(cosineSimilarity(queryVector, chunk.embedding).toFixed(4)),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const topK = options.topK ?? 8;
  const maxTotalChars = options.maxTotalChars ?? 12000;
  const results: VectorSearchHit[] = [];
  let charBudget = maxTotalChars;

  for (const hit of scored) {
    if (results.length >= topK) break;
    if (charBudget <= 0) break;
    // Keep very relevant hits, or at least top 3 matches regardless of score threshold
    if (results.length >= 3 && hit.similarity < 0.22) break;
    const boundedText = hit.text.slice(0, charBudget);
    charBudget -= boundedText.length;
    results.push({
      ...hit,
      text: boundedText,
    });
  }

  return results;
}
