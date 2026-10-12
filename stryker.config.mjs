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
  concurrency: 4,
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // Collect an initial baseline without imposing a mutation-score gate yet.
  thresholds: { high: 80, low: 60, break: null },
}
