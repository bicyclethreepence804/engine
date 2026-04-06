/**
 * Integration payloads before/after Zone A normalization.
 * Canonical normalization: mapPayloadToUnified in @kiploks/engine-core.
 */

/** Raw JSON from an adapter (Freqtrade, etc.) before normalization. */
export type IntegrationPayloadRaw = Record<string, unknown>;

/**
 * After mapPayloadToUnified: camelCase keys and decimal returns for backtest results and WFA periods.
 * Full shape is integration-specific until a published JSON Schema exists.
 */
export type UnifiedIntegrationPayload = Record<string, unknown>;
