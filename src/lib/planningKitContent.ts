/**
 * Event Planning Kit content, per the OEV Lead Magnet spec
 * (ClickUp doc 8cqnrff-4977, page 8cqnrff-11737).
 *
 * Single source of truth: the /planning-kit page and the PDF export both render
 * from here, so the printed plan can never drift from the web version.
 *
 * Field ids are persisted in localStorage. Changing an id discards whatever a
 * visitor already typed into that field, so treat them as stable keys.
 */

export const KIT_PHONE = "407 974 5979";
export const KIT_ADDRESS = "3847 E Colonial Dr, Orlando, FL 32803";
export const KIT_OFFER_CODE = "PLAN50";

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "note"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "ordered"; items: string[] }
  | { kind: "checklist"; id: string; items: string[]; twoColumn?: boolean }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "worksheet"; id: string; headers: string[]; labels: string[] }
  | { kind: "schedule"; id: string; activities: string[] }
  | { kind: "offer" };

export type Section = {
  number?: string;
  title: string;
  blocks: Block[];
};

export const VENUE_SNAPSHOT: Section = {
  title: "Venue Snapshot",
  blocks: [
    {
      kind: "table",
      headers: ["Venue Detail", "Information"],
      rows: [
        ["Capacity", "Up to 90 guests"],
        ["Furniture", "10 tables and 90 chairs"],
        ["Kitchen", "Prep kitchen for staging and reheating; no cooking"],
        ["Parking", "Free parking in the Colonial Town Center plaza"],
        ["Address", KIT_ADDRESS],
        ["Questions", `Call or text ${KIT_PHONE}`],
        ["Booking", "orlandoeventvenue.org/book"],
        ["Offer", `Use ${KIT_OFFER_CODE} for $50 OFF your venue rental`],
      ],
    },
  ],
};

export const SECTIONS: Section[] = [
  {
    number: "1",
    title: "What We Provide and What You Bring",
    blocks: [
      {
        kind: "paragraph",
        text: "This is the most important part of the kit. Knowing what is already at the venue will help you avoid unnecessary purchases and last-minute problems.",
      },
      {
        kind: "table",
        headers: ["Included With Your Rental", "You Bring or Arrange"],
        rows: [
          ["Room for up to 90 guests", "Food and your caterer"],
          ["10 tables and 90 chairs", "Plates, bowls, cups, and utensils"],
          ["Prep kitchen for staging and reheating", "Serving trays, bowls, tongs, and spoons"],
          ["Two bathrooms", "Tablecloths and other linens"],
          ["Free plaza parking", "Ice and coolers"],
          ["Wi-Fi", "Water, soda, juice, and other nonalcoholic drinks"],
          ["Standard venue cleaning", "Decorations and signs"],
          ["Bar service options through OEV", "Extra trash bags"],
          ["Available LED wall and audiovisual packages", "Setup, event, and closing helpers"],
        ],
      },
      { kind: "subheading", text: "Important Food Information" },
      {
        kind: "bullets",
        items: [
          "You may choose your own caterer.",
          "Professional caterers must provide proof of insurance.",
          "There is no cooking at the venue.",
          "The kitchen is for staging, assembling, and reheating food.",
          "Food should arrive ready to serve or only need warming.",
        ],
      },
      { kind: "subheading", text: "Important Alcohol Information" },
      {
        kind: "paragraph",
        text: "Alcohol and bartending must be arranged through Orlando Event Venue. Bar packages begin at $18 per guest. Contact the team before purchasing or arranging alcohol.",
      },
      { kind: "subheading", text: "The Items Most Often Forgotten" },
      { kind: "paragraph", text: "If you remember nothing else, remember:" },
      {
        kind: "checklist",
        id: "most-forgotten",
        twoColumn: true,
        items: [
          "Plates, cups, and utensils",
          "Serving spoons and tongs",
          "Serving bowls, trays, and platters",
          "Tablecloths",
          "Ice",
          "Extra trash bags",
        ],
      },
    ],
  },
  {
    number: "2",
    title: "Your Event Budget",
    blocks: [
      {
        kind: "paragraph",
        text: "You do not need a complicated spreadsheet. Estimate the main expenses before buying anything, then update the actual amount as you spend.",
      },
      {
        kind: "worksheet",
        id: "budget",
        headers: ["Expense", "Estimated", "Actual"],
        labels: [
          "Venue rental and applicable fees",
          "Food or catering",
          "Drinks and ice",
          "Bar service, if added",
          "Plates, cups, and utensils",
          "Serving pieces",
          "Tablecloths and linens",
          "Decorations and signs",
          "LED wall or audiovisual services",
          "Event helpers and tips",
          "Last-minute items",
          "Total",
        ],
      },
      {
        kind: "paragraph",
        text: "Planning tip: Keep approximately 10 percent of the budget available for last-minute items.",
      },
      { kind: "offer" },
    ],
  },
  {
    number: "3",
    title: "Your Planning Timeline",
    blocks: [
      {
        kind: "table",
        headers: ["Time Before the Event", "What to Complete"],
        rows: [
          ["Four or more weeks", "Begin your booking, estimate attendance, choose a caterer, and review bar and audiovisual needs."],
          ["After confirmation", "Send invitations and begin tracking attendance."],
          ["Fifteen days", "Complete the remaining balance for a direct OEV booking."],
          ["Two weeks", "Confirm the guest count, caterer, proof of insurance, layout, linens, and decorations."],
          ["One week", "Confirm the timeline, gather supplies, and assign helpers."],
          ["Two or three days", "Buy ice and drinks, charge equipment, print the run sheet, and pack supplies."],
          ["Day before", "Review the Event Page, confirm access instructions, and load the vehicle."],
          ["Event day", "Arrive, set up, follow the run sheet, and enjoy the event."],
          ["After the event", "Restore the furniture, bag the trash, lock the entrance, and submit the Guest Report."],
        ],
      },
      { kind: "subheading", text: "Four or More Weeks Before" },
      {
        kind: "checklist",
        id: "timeline-4weeks",
        items: [
          "Begin your booking.",
          "Set a rough guest count. The venue holds up to 90 guests.",
          "Choose your caterer or decide what food you will bring.",
          "Decide whether you need bar service.",
          "Decide whether you need the LED wall or audiovisual services.",
          "Plan for the remaining direct-booking balance, due 15 days before the event.",
        ],
      },
      {
        kind: "note",
        text: "Your date is held after the first 50 percent is received. OEV will then review the timing, guest count, and setup before sending a separate confirmation.",
      },
      { kind: "subheading", text: "Two Weeks Before" },
      {
        kind: "checklist",
        id: "timeline-2weeks",
        items: [
          "Confirm the final guest count.",
          "Confirm the caterer and arrival time.",
          "Confirm that a professional caterer has supplied proof of insurance.",
          "Sketch the room and table layout.",
          "Purchase or reserve tableware, linens, and serving pieces.",
          "Review the venue rules before finalizing decorations.",
        ],
      },
      { kind: "subheading", text: "One Week Before" },
      {
        kind: "checklist",
        id: "timeline-1week",
        items: [
          "Confirm the event timeline with the caterer and helpers.",
          "Complete the Bring List.",
          "Gather supplies in one location.",
          "Assign people to help with setup and closing.",
        ],
      },
      { kind: "subheading", text: "Two or Three Days Before" },
      {
        kind: "checklist",
        id: "timeline-3days",
        items: [
          "Buy ice, drinks, and fresh food.",
          "Charge speakers, lights, phones, and other equipment.",
          "Print the run sheet and table layout.",
          "Pack supplies into labeled boxes or bins.",
        ],
      },
      { kind: "subheading", text: "Day Before" },
      {
        kind: "checklist",
        id: "timeline-daybefore",
        items: [
          "Review the access instructions on your Event Page.",
          "Confirm who will arrive first.",
          "Load the vehicle or place everything by the door.",
          "Rest. The planning is complete.",
        ],
      },
      { kind: "subheading", text: "After the Event" },
      {
        kind: "checklist",
        id: "timeline-after",
        items: [
          "Restore the tables and chairs.",
          "Bag all trash and place it on the back patio.",
          "Turn off the lights.",
          "Confirm that personal items have been removed.",
          "Lock the entrance.",
          "Submit the Guest Report through your Event Page.",
        ],
      },
    ],
  },
  {
    number: "4",
    title: "Complete Bring List",
    blocks: [
      { kind: "subheading", text: "Food and Serving" },
      {
        kind: "checklist",
        id: "bring-food",
        twoColumn: true,
        items: [
          "Serving spoons",
          "Tongs and ladle",
          "Platters, serving bowls, and trays",
          "Cutting board and sharp knife",
          "Can opener and bottle opener",
          "Foil and cling wrap",
          "Containers for leftovers",
          "Warming trays and approved fuel, if needed",
          "Ice and coolers",
          "Paper towels and hand wipes",
        ],
      },
      { kind: "subheading", text: "Tableware" },
      {
        kind: "checklist",
        id: "bring-tableware",
        twoColumn: true,
        items: [
          "Plates and bowls",
          "Cups for cold drinks",
          "Cups for hot drinks",
          "Forks, knives, and spoons",
          "Napkins",
          "Tablecloths and linens",
          "Centerpieces or table decorations",
        ],
      },
      { kind: "subheading", text: "Drinks" },
      {
        kind: "checklist",
        id: "bring-drinks",
        twoColumn: true,
        items: [
          "Water",
          "Soft drinks",
          "Juice",
          "Drink dispensers or pitchers",
          "Cups and straws",
          "Extra ice",
          "Bar service arranged with OEV if alcohol will be served",
        ],
      },
      { kind: "subheading", text: "Setup and Decorations" },
      {
        kind: "checklist",
        id: "bring-setup",
        twoColumn: true,
        items: [
          "Welcome sign",
          "Table numbers or directional signs",
          "Removable hooks that leave no residue",
          "Approved tape that leaves no residue",
          "Scissors",
          "Markers",
          "Zip ties or twist ties",
          "Extension cord",
          "Power strip",
          "Phone and speaker chargers",
          "Lighter or matches only when flames have been approved in advance",
        ],
      },
      { kind: "subheading", text: "Trash and Closing" },
      {
        kind: "paragraph",
        text: "OEV handles standard cleaning. You are responsible for bagging the trash, placing it on the back patio, and restoring the tables and chairs.",
      },
      {
        kind: "checklist",
        id: "bring-trash",
        items: [
          "Extra trash bags",
          "Wipes for quick spills",
          "Containers for leftover food",
          "Helpers assigned for closing",
        ],
      },
      { kind: "subheading", text: "Just in Case" },
      {
        kind: "checklist",
        id: "bring-justincase",
        twoColumn: true,
        items: [
          "Small first-aid kit",
          "Phone charger",
          "Pen and paper",
          "Safety pins",
          "Small sewing kit",
          "Stain-remover pen",
          "Cash for tips",
          "Printed run sheet",
          "Printed table layout",
        ],
      },
    ],
  },
  {
    number: "5",
    title: "Your Table and Room Plan",
    blocks: [
      { kind: "paragraph", text: "You have 10 tables and 90 chairs available." },
      { kind: "paragraph", text: "Start by deciding which tables will not be used for guest seating:" },
      {
        kind: "bullets",
        items: [
          "Food and drinks table",
          "Gift, sign-in, or guest-book table",
          "Bar or service table, if needed",
          "Remaining tables for guests",
        ],
      },
      { kind: "subheading", text: "Common Layouts" },
      {
        kind: "table",
        headers: ["Event Style", "Suggested Layout", "Planning Note"],
        rows: [
          ["Meal or celebration", "Round seating tables", "Leave enough room between tables for guests and servers."],
          ["Workshop or presentation", "Rows facing the front", "Keep a center or side aisle open."],
          ["Corporate meeting", "U-shaped arrangement", "Confirm that all guests can see and hear the presenter."],
          ["Social gathering", "Mixed seating and open space", "Preserve room for mingling or dancing."],
        ],
      },
      {
        kind: "paragraph",
        text: "If round tables are used, estimate approximately 8 to 10 guests per table. Confirm the final plan using the guest count and actual arrangement.",
      },
      { kind: "subheading", text: "Leave Room For" },
      {
        kind: "checklist",
        id: "layout-clearance",
        twoColumn: true,
        items: [
          "A clear path to the bathrooms",
          "A clear path to the exit",
          "A line around the food table",
          "An open area for dancing or mingling",
          "The bar area, if bar service is added",
          "Guests using wheelchairs or walkers",
        ],
      },
      { kind: "subheading", text: "Layout Notes" },
      {
        kind: "worksheet",
        id: "layout-notes",
        headers: ["Area", "Plan"],
        labels: [
          "Guest seating",
          "Food and drinks",
          "Gifts or sign-in",
          "Bar service",
          "Dancing or activity area",
          "Welcome sign",
        ],
      },
    ],
  },
  {
    number: "6",
    title: "Help Every Guest Participate",
    blocks: [
      {
        kind: "checklist",
        id: "accessibility",
        items: [
          "Keep clear, wide paths for guests using a wheelchair or walker.",
          "Confirm accessible parking and entrance information with OEV.",
          "Do not reserve or block public accessible spaces without authorization.",
          "Service animals are welcome in accordance with applicable law.",
          "Ask guests about food allergies and dietary needs.",
          "Share dietary information with the caterer.",
          "Create a calm area for anyone who may need a short break.",
        ],
      },
    ],
  },
  {
    number: "7",
    title: "Food and Drink Plan",
    blocks: [
      { kind: "subheading", text: "Food" },
      {
        kind: "worksheet",
        id: "food-plan",
        headers: ["Decision", "Your Plan"],
        labels: [
          "Caterer, drop-off service, or food brought by host",
          "Caterer arrival time",
          "Food service time",
          "Person responsible for food setup",
          "Method for keeping hot food warm",
          "Method for keeping cold food cold",
          "Person responsible for leftovers",
        ],
      },
      {
        kind: "note",
        text: "Remember: The kitchen is for staging and reheating. Food should arrive ready to serve or only need warming.",
      },
      { kind: "subheading", text: "Drinks" },
      {
        kind: "checklist",
        id: "drinks",
        items: [
          "Place water and nonalcoholic drinks where guests can reach them.",
          "Plan approximately two drinks per guest during the first hour and one drink per additional hour.",
          "Bring enough cups, straws, pitchers, or dispensers.",
          "Purchase more ice than the initial estimate.",
          "Arrange alcohol and bartending with OEV before the event.",
        ],
      },
    ],
  },
  {
    number: "8",
    title: "Help Guests Find the Venue",
    blocks: [
      { kind: "paragraph", text: "The entrance can be easy to miss the first time." },
      {
        kind: "ordered",
        items: [
          "Park in the Colonial Town Center plaza.",
          "Look for the GLOBAL sign with 3847.",
          "Face the GLOBAL sign.",
          "Use the door on the left.",
        ],
      },
      { kind: "subheading", text: "Guest Arrival Checklist" },
      {
        kind: "checklist",
        id: "arrival",
        items: [
          "Send the address to guests.",
          "Send the parking instructions on the morning of the event.",
          "Explain that the entrance is beside the GLOBAL sign.",
          "Place a welcome sign near the entrance.",
          "Assign a greeter.",
          "Give the greeter a list of important telephone numbers.",
        ],
      },
      { kind: "note", text: `Venue address: ${KIT_ADDRESS}. OEV telephone number: ${KIT_PHONE}.` },
    ],
  },
  {
    number: "9",
    title: "Your Day-of Run Sheet",
    blocks: [
      { kind: "paragraph", text: "Choose helpers before filling in the schedule." },
      {
        kind: "worksheet",
        id: "helpers",
        headers: ["Responsibility", "Assigned Person", "Telephone"],
        labels: [
          "Welcome guests",
          "Monitor food and drinks",
          "Watch the timeline",
          "Lead the main activity",
          "Help close the venue",
        ],
      },
      { kind: "subheading", text: "Event Schedule" },
      {
        kind: "schedule",
        id: "schedule",
        activities: [
          "Venue access",
          "Tables and chairs",
          "Linens and decorations",
          "Food and drink setup",
          "Final venue check",
          "Guest arrival",
          "Food service",
          "Main moment or activity",
          "Wind-down begins",
          "Guests leave",
          "Breakdown and closing",
        ],
      },
      { kind: "subheading", text: "Before Guests Arrive" },
      {
        kind: "checklist",
        id: "before-guests",
        items: [
          "Bathrooms are ready.",
          "Tables and chairs are arranged.",
          "Food and drinks are ready.",
          "Trash bags are installed.",
          "Music, lighting, and equipment are working.",
          "Welcome and directional signs are in place.",
          "Walkways and exits are clear.",
        ],
      },
      { kind: "subheading", text: "Closing Checklist" },
      { kind: "paragraph", text: "Complete everything before the reservation ends." },
      {
        kind: "checklist",
        id: "closing",
        items: [
          "All guests have left.",
          "All trash is bagged and placed on the back patio.",
          "Tables and chairs are returned to their original arrangement.",
          "The prep kitchen is checked.",
          "Both bathrooms are checked.",
          "Personal items and equipment are packed.",
          "Remotes and venue equipment are returned.",
          "All lights are turned off.",
          "The entrance is locked.",
          "The Guest Report is submitted.",
        ],
      },
      { kind: "note", text: `In an emergency, call 911. The venue address is ${KIT_ADDRESS}.` },
    ],
  },
  {
    number: "10",
    title: "The Small Things People Forget",
    blocks: [
      { kind: "paragraph", text: "Review this checklist before leaving home." },
      { kind: "subheading", text: "Food and Service" },
      {
        kind: "checklist",
        id: "small-food",
        items: [
          "Serving spoons and tongs",
          "Knife and cutting board",
          "Can opener",
          "Bottle opener",
          "Serving bowls and trays",
          "Ice, plus extra ice",
          "Cups for hot and cold drinks",
          "Containers for leftovers",
          "Paper towels and wipes",
        ],
      },
      { kind: "subheading", text: "Setup and Closing" },
      {
        kind: "checklist",
        id: "small-setup",
        items: [
          "Extra trash bags",
          "Tablecloths for every table",
          "Removable hooks or approved tape",
          "Scissors and markers",
          "Extension cord and power strip",
          "Phone and speaker chargers",
          "Printed timeline and room layout",
          "Welcome sign",
          "Person assigned to help close",
        ],
      },
      { kind: "subheading", text: "Also Remember" },
      {
        kind: "checklist",
        id: "small-also",
        twoColumn: true,
        items: [
          "First-aid kit",
          "Stain-remover pen",
          "Cash for tips",
          "Accessible parking and entrance information",
          "Event Page link",
          "Reservation number",
          "Contact information for the person arriving first",
        ],
      },
    ],
  },
  {
    number: "11",
    title: "Venue Rules to Plan Around",
    blocks: [
      { kind: "paragraph", text: "The complete rules will appear on your Event Page after booking." },
      {
        kind: "table",
        headers: ["Venue Rule", "What It Means for Your Plan"],
        rows: [
          ["Maximum capacity is 90 guests", "Do not invite or admit more than 90 people."],
          ["Alcohol and bartending run through OEV", "Arrange bar service with OEV in advance."],
          ["You may choose your caterer", "Professional caterers must provide proof of insurance."],
          ["No cooking on site", "Food must arrive ready to serve or only need warming."],
          ["No glitter, confetti, rice, or sparklers", "Choose decorations that can be removed cleanly."],
          ["No nails or staples", "Use approved removable hooks or materials that leave no residue."],
          ["Open flames require advance approval", "Do not bring candles or similar items without approval."],
          ["Doors remain closed after 9 PM", "Plan music and guest movement accordingly."],
          ["No indoor smoking or vaping", "Smoking and vaping are also prohibited immediately outside."],
          ["Pets are not permitted", "Service animals remain permitted under applicable law."],
          ["Setup and breakdown must fit within the reserved time", "Include both activities in the event schedule."],
          ["Host restores tables and chairs", "Assign helpers before the event."],
          ["Host bags the trash", "Place all bagged trash on the back patio."],
          ["Guest Report is required", "Submit it through the Event Page after the event."],
        ],
      },
      { kind: "note", text: "Cameras and noise sensors help OEV monitor the venue." },
    ],
  },
];

/** Every checklist id paired with its item count, for state initialisation. */
export function checklistIds(): { id: string; count: number }[] {
  const out: { id: string; count: number }[] = [];
  for (const section of SECTIONS) {
    for (const block of section.blocks) {
      if (block.kind === "checklist") out.push({ id: block.id, count: block.items.length });
    }
  }
  return out;
}

/** Total number of checkable items across the whole kit. */
export function totalCheckableItems(): number {
  return checklistIds().reduce((sum, c) => sum + c.count, 0);
}
