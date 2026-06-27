import {injectable} from 'inversify';
import axios from 'axios';
import {env} from '#root/utils/env.js';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

/**
 * Thin Voyage AI embeddings client (Anthropic has no embeddings API).
 * Returns `null` on any failure (missing key, timeout, API error) so the
 * caller can degrade to exact-signature dedup instead of failing the submit.
 */
@injectable()
export class EmbeddingService {
  private readonly apiKey = env('VOYAGE_API_KEY');
  private readonly model = env('VOYAGE_MODEL') || 'voyage-3.5-lite';
  private readonly timeoutMs = Number(env('VOYAGE_TIMEOUT_MS') || '2000');

  get modelName(): string {
    return this.model;
  }

  get enabled(): boolean {
    return !!this.apiKey;
  }

  async embed(
    text: string,
    inputType: 'document' | 'query' = 'document',
  ): Promise<number[] | null> {
    if (!this.apiKey) return null;
    try {
      const resp = await axios.post(
        VOYAGE_URL,
        {input: [text], model: this.model, input_type: inputType},
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        },
      );
      const embedding = resp.data?.data?.[0]?.embedding;
      return Array.isArray(embedding) ? embedding : null;
    } catch (err) {
      console.warn('crowd: voyage embed failed:', (err as any)?.message);
      return null;
    }
  }
}
