/** Every provider id l2b knows. The config schema's provider enum derives from this list. */
export const PROVIDER_IDS = ['e2b', 'boat'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
