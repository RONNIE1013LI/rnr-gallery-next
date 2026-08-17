type ImageMetrics = Readonly<{
  imageContexts: number;
  imageAnalysesSucceeded: number;
  imageAnalysesBlocked: number;
  imageAnalysisSuccessRate: number;
  imageRequestOriginalRate: number;
  averageImageAwareCostPerDraftMicrousd: number;
  imageAwareDirectAcceptanceRate: number;
  imageAwareEditRate: number;
  imageAwareRejectionRate: number;
}>;

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function pilotMetricCards(metrics: ImageMetrics) {
  return [
    ["Image contexts", metrics.imageContexts],
    ["Image analyses passed", metrics.imageAnalysesSucceeded],
    ["Image analyses blocked", metrics.imageAnalysesBlocked],
    ["Image analysis success", percent(metrics.imageAnalysisSuccessRate)],
    ["Request original", percent(metrics.imageRequestOriginalRate)],
    ["Image-aware avg cost", `$${(metrics.averageImageAwareCostPerDraftMicrousd / 1_000_000).toFixed(4)}`],
    ["Image-aware direct", percent(metrics.imageAwareDirectAcceptanceRate)],
    ["Image-aware edited", percent(metrics.imageAwareEditRate)],
    ["Image-aware rejected", percent(metrics.imageAwareRejectionRate)],
  ] as const;
}
