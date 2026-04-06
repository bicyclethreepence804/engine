/**
 * Secondary export surface for the hosting application that assembles full reports from
 * engine primitives. Same implementation as the rest of `@kiploks/engine-core`; this entry
 * is not semver-stable and is omitted from the published npm package (see `prepack` in
 * package.json). Prefer the root export (`import { ... } from '@kiploks/engine-core'`) for
 * integrations unless you mirror the host assembly graph.
 */

export * from "./decisionArtifacts";
export * from "./analyzeCardSummary";
export * from "./standalonePayloadValidation";
export * from "./buildTestResultDataFromUnified";
export * from "./riskAnalysis";
export { riskBuilderFromRCore } from "./riskCore";
export * from "./analysisReportTypes";
export * from "./summaryBlockEngine";
export * from "./whatIfScenarios";
export * from "./finalVerdictEngine";
export * from "./strategyActionPlanPrecomputed";
export * from "./integrity";
export * from "./validateReportInvariants";
export * from "./parameterSensitivity";
export * from "./proBenchmarkMetrics";
export * from "./dataQualityGuard";
