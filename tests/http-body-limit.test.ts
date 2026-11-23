import assert from "node:assert/strict";
import test from "node:test";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "../lib/http/body-limit.ts";

test("no Content-Length header is not treated as too large (a chunked request omits it)", () => {
  const req = new Request("http://localhost/x", { method: "POST" });
  assert.equal(isBodyTooLarge(req, 100), false);
});

test("a Content-Length under the cap passes", () => {
  const req = new Request("http://localhost/x", { method: "POST", headers: { "content-length": "50" } });
  assert.equal(isBodyTooLarge(req, 100), false);
});

test("a Content-Length at exactly the cap passes", () => {
  const req = new Request("http://localhost/x", { method: "POST", headers: { "content-length": "100" } });
  assert.equal(isBodyTooLarge(req, 100), false);
});

test("a Content-Length over the cap is rejected", () => {
  const req = new Request("http://localhost/x", { method: "POST", headers: { "content-length": "101" } });
  assert.equal(isBodyTooLarge(req, 100), true);
});

test("a non-numeric Content-Length fails safe rather than blocking the request", () => {
  const req = new Request("http://localhost/x", { method: "POST", headers: { "content-length": "not-a-number" } });
  assert.equal(isBodyTooLarge(req, 100), false);
});

test("JSON_BODY_MAX_BYTES is generous but bounded", () => {
  assert.equal(JSON_BODY_MAX_BYTES, 100 * 1024);
});
