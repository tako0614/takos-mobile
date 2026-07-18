import { expect, test } from "bun:test";

import { productAdapter } from "../src/product.ts";

test("Takos mobile does not advertise host creation without a releasable distribution", () => {
  expect(productAdapter).not.toHaveProperty("hostCenterLabel");
  expect(productAdapter).not.toHaveProperty("hostCenterUrl");
  expect(productAdapter).not.toHaveProperty("hostCenterSource");
});
