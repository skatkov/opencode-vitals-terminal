/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  // The unit tests exercise this logic, not the host-loaded plugin entrypoints.
  mutate: ["src/**/*.ts"],
  testRunner: "tap",
  tap: {
    testFiles: ["test/*.test.ts"],
    nodeArgs: ["--conditions=browser", "--experimental-strip-types", "--test-reporter=tap"],
  },
  coverageAnalysis: "perTest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  typescriptChecker: { prioritizePerformanceOverAccuracy: false },
  concurrency: 4,
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // Every type-valid mutant in the configured source scope must be detected.
  thresholds: { high: 100, low: 100, break: 100 },
}
