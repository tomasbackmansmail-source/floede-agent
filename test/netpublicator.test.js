// Tests for NetPublicator adapter — pure functions only, no network calls.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNetPublicatorUrl } from "../src/adapters/netpublicator.js";

describe("isNetPublicatorUrl", () => {
  it("detects netpublicator.com/bulletinboard URL", () => {
    assert.ok(isNetPublicatorUrl("https://www.netpublicator.com/bulletinboard/public/7c345d11-e969-4d41-8c5d-4e8c9ef45325"));
  });

  it("rejects regular municipality URL", () => {
    assert.ok(!isNetPublicatorUrl("https://www.borlange.se/anslagstavla"));
  });

  it("rejects Ciceron URL", () => {
    assert.ok(!isNetPublicatorUrl("https://anslagstavla.helsingborg.se/#!/billboard/"));
  });

  it("rejects MeetingPlus URL", () => {
    assert.ok(!isNetPublicatorUrl("https://forum.norrtalje.se/digital-bulletin-board"));
  });

  it("handles null", () => {
    assert.ok(!isNetPublicatorUrl(null));
  });

  it("handles empty string", () => {
    assert.ok(!isNetPublicatorUrl(""));
  });
});
