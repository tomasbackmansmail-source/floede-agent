// The config schema that Discovery produces and Extraction consumes.
// This is the contract between the two agents.

export const CONFIG_SCHEMA = {
  type: "object",
  required: ["municipality", "platform_guess", "listing_url", "listing_type", "pagination", "requires_subpages", "selectors_hint"],
  properties: {
    municipality: {
      type: "string",
      description: "Municipality name"
    },
    platform_guess: {
      type: "string",
      description: "Best guess at CMS platform: sitevision, netpublicator, meetingsplus, wordpress, custom, unknown"
    },
    listing_url: {
      type: "string",
      description: "Direct URL to the page listing permits/announcements"
    },
    listing_type: {
      type: "string",
      enum: ["table", "list", "cards", "links_to_subpages", "pdf_list", "unknown"],
      description: "How permits are presented on the listing page"
    },
    pagination: {
      type: "object",
      properties: {
        has_pagination: { type: "boolean" },
        type: {
          type: "string",
          enum: ["none", "numbered_pages", "load_more_button", "infinite_scroll", "page_size_selector", "unknown"],
        },
        mechanism: {
          type: "string",
          description: "How to paginate: URL parameter, button selector, or null"
        },
        estimated_total_pages: { type: "number" }
      }
    },
    requires_subpages: {
      type: "object",
      properties: {
        required: { type: "boolean" },
        reason: { type: "string", description: "Why subpages are needed, or null" },
        link_selector_hint: { type: "string", description: "CSS selector hint for detail links, or null" }
      }
    },
    selectors_hint: {
      type: "object",
      description: "CSS selector hints for extraction. These are suggestions, not hard requirements - Haiku will use them as guidance.",
      properties: {
        container: { type: "string", description: "Main container holding all permits" },
        item: { type: "string", description: "Individual permit item" },
        case_number: { type: "string" },
        address: { type: "string" },
        date: { type: "string" },
        description: { type: "string" }
      }
    },
    interaction_recipe: {
      type: "object",
      description: "Steps to reproduce data view if URL alone is insufficient (e.g. dropdown selection, search)",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["select", "click", "type"] },
              selector: { type: "string", description: "CSS selector for the element" },
              value: { type: "string", description: "Value to select/type, or null for click" }
            }
          }
        },
        wait_ms: { type: "number", description: "Milliseconds to wait after each step", default: 3000 }
      }
    },
    notes: {
      type: "string",
      description: "Any observations about the site that might affect extraction"
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Discovery agent's confidence in this config"
    },
    approved: {
      type: "boolean",
      default: false,
      description: "Set to true after human review. Extraction will not run on unapproved configs."
    }
  }
};

// Example of a completed config (Nacka)
export const EXAMPLE_CONFIG = {
  municipality: "Nacka",
  platform_guess: "sitevision",
  listing_url: "https://www.nacka.se/kommun--politik/kungorelser/",
  listing_type: "links_to_subpages",
  pagination: {
    has_pagination: true,
    type: "load_more_button",
    mechanism: "Click button with text 'Fler Nyheter'",
    estimated_total_pages: null
  },
  requires_subpages: {
    required: true,
    reason: "Listing page shows only title and date. Case number, address, status, and permit details are on individual subpages.",
    link_selector_hint: "a[href*='kungorelse-bygglov']"
  },
  selectors_hint: {
    container: ".news-listing",
    item: ".news-item",
    case_number: null,
    address: null,
    date: ".news-date",
    description: null
  },
  notes: "Listing page only shows generic titles like 'Kungorelse bygglov'. Must follow links to individual pages to get permit data. Filter links to only include bygglov-related kungorelser.",
  confidence: "high",
  approved: false
};
