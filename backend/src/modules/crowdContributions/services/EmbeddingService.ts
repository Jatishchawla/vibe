import {injectable} from 'inversify';
import axios from 'axios';
import {env} from '#root/utils/env.js';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

// 'openai' = any OpenAI-compatible embeddings API (Google Gemini, OpenAI, ...).
type EmbedProvider = 'voyage' | 'ollama' | 'openai' | 'none';

/**
 * Embeddings for near-duplicate detection. Providers behind one flag:
 *   - 'openai' : OpenAI-compatible API (e.g. Google Gemini text-embedding-004) — free tier
 *   - 'ollama' : local Ollama server (free/offline, e.g. nomic-embed-text)
 *   - 'voyage' : hosted Voyage AI API
 * Returns `null` on any failure so dedup degrades to exact-signature matching.
 *
 * Provider resolution: CROWD_EMBED_PROVIDER if set, else 'voyage' when a Voyage
 * key is present, else 'none'.
 */
@injectable()
export class EmbeddingService {
  private readonly provider: EmbedProvider;
  private readonly voyageKey = env('VOYAGE_API_KEY');
  private readonly voyageModel = env('VOYAGE_MODEL') || 'voyage-3.5-lite';
  private readonly ollamaBaseUrl =
    env('OLLAMA_BASE_URL') || 'http://localhost:11434';
  private readonly ollamaModel = env('CROWD_EMBED_MODEL') || 'nomic-embed-text';
  // OpenAI-compatible (Gemini / OpenAI). Falls back to the LLM creds so one
  // Gemini key can power both the judge and embeddings.
  private readonly openaiBaseUrl =
    env('CROWD_EMBED_BASE_URL') || env('CROWD_LLM_BASE_URL') || '';
  private readonly openaiKey =
    env('CROWD_EMBED_API_KEY') || env('CROWD_LLM_API_KEY') || '';
  private readonly openaiModel =
    env('CROWD_EMBED_MODEL') || 'text-embedding-004';
  private readonly timeoutMs = Number(
    env('CROWD_EMBED_TIMEOUT_MS') || env('VOYAGE_TIMEOUT_MS') || '6000',
  );

  constructor() {
    const configured = (env('CROWD_EMBED_PROVIDER') || '').toLowerCase();
    if (['voyage', 'ollama', 'openai', 'none'].includes(configured)) {
      this.provider = configured as EmbedProvider;
    } else if (this.voyageKey) {
      this.provider = 'voyage';
    } else {
      this.provider = 'none';
    }
  }

  get modelName(): string {
    if (this.provider === 'ollama') return this.ollamaModel;
    if (this.provider === 'openai') return this.openaiModel;
    return this.voyageModel;
  }

  get enabled(): boolean {
    return this.provider !== 'none';
  }

  async embed(
    text: string,
    inputType: 'document' | 'query' = 'document',
  ): Promise<number[] | null> {
    try {
      if (this.provider === 'ollama') return await this._ollama(text);
      if (this.provider === 'openai') return await this._openai(text);
      if (this.provider === 'voyage') return await this._voyage(text, inputType);
      return null;
    } catch (err) {
      console.warn('crowd: embedding failed:', (err as any)?.message);
      return null;
    }
  }

  private async _voyage(
    text: string,
    inputType: 'document' | 'query',
  ): Promise<number[] | null> {
    if (!this.voyageKey) return null;
    const resp = await axios.post(
      VOYAGE_URL,
      {input: [text], model: this.voyageModel, input_type: inputType},
      {
        headers: {
          Authorization: `Bearer ${this.voyageKey}`,
          'Content-Type': 'application/json',
        },
        timeout: this.timeoutMs,
      },
    );
    const embedding = resp.data?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  }

  private async _openai(text: string): Promise<number[] | null> {
    if (!this.openaiBaseUrl || !this.openaiKey) return null;
    const resp = await axios.post(
      `${this.openaiBaseUrl}/embeddings`,
      {model: this.openaiModel, input: text},
      {
        headers: {
          Authorization: `Bearer ${this.openaiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: this.timeoutMs,
      },
    );
    const embedding = resp.data?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  }

  private async _ollama(text: string): Promise<number[] | null> {
    const resp = await axios.post(
      `${this.ollamaBaseUrl}/api/embeddings`,
      {model: this.ollamaModel, prompt: text},
      {timeout: this.timeoutMs},
    );
    const embedding = resp.data?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  }
}
