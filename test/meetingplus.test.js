// Tests for MeetingPlus adapter — pure functions only, no network calls.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMeetingPlusUrl, isMeetingPlusHtml } from "../src/adapters/meetingplus.js";

// ═══════════════════════════════════════════════
// isMeetingPlusUrl
// ═══════════════════════════════════════════════

describe("isMeetingPlusUrl", () => {
  it("detects /digital-bulletin-board path", () => {
    assert.ok(isMeetingPlusUrl("https://forum.norrtalje.se/digital-bulletin-board"));
  });

  it("detects meetingsplus subdomain", () => {
    assert.ok(isMeetingPlusUrl("https://meetingsplus.pitea.se/digital-bulletin-board"));
  });

  it("detects forum.X.se pattern", () => {
    assert.ok(isMeetingPlusUrl("https://forum.norrtalje.se/something"));
  });

  it("detects ondemand.formpipe.com pattern", () => {
    assert.ok(isMeetingPlusUrl("https://tranaskommun.ondemand.formpipe.com/digital-bulletin-board"));
  });

  it("detects edokmeetings subdomain via digital-bulletin-board", () => {
    assert.ok(isMeetingPlusUrl("https://edokmeetings.stockholm.se/digital-bulletin-board"));
  });

  it("rejects regular municipality URLs", () => {
    assert.ok(!isMeetingPlusUrl("https://www.norrtalje.se/bygga-bo/anslagstavla"));
  });

  it("rejects Ciceron URLs", () => {
    assert.ok(!isMeetingPlusUrl("https://anslagstavla.helsingborg.se/#!/billboard/"));
  });

  it("handles null", () => {
    assert.ok(!isMeetingPlusUrl(null));
  });

  it("handles empty string", () => {
    assert.ok(!isMeetingPlusUrl(""));
  });
});

// ═══════════════════════════════════════════════
// isMeetingPlusHtml
// ═══════════════════════════════════════════════

describe("isMeetingPlusHtml", () => {
  it("detects meetingsplus in HTML", () => {
    assert.ok(isMeetingPlusHtml('<script src="/bundles/meetingsplus.js"></script>'));
  });

  it("detects digital-bulletin-board in HTML", () => {
    assert.ok(isMeetingPlusHtml('<a href="/digital-bulletin-board">Anslagstavla</a>'));
  });

  it("detects /api/dbb/ in HTML", () => {
    assert.ok(isMeetingPlusHtml('<script>fetch("/api/dbb/v1.0/announcements")</script>'));
  });

  it("rejects unrelated HTML", () => {
    assert.ok(!isMeetingPlusHtml('<html><body><p>Hello</p></body></html>'));
  });

  it("handles null", () => {
    assert.ok(!isMeetingPlusHtml(null));
  });
});
