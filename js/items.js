// Inventory list — same items and order as the paper
// "STX Weekly Tool Trailer Inventory RV2" sheet.
// The first 32 items print in the left column of the PDF, the rest on the right.
// To add/remove/rename tools, edit this list only.
window.STX_SECTIONS = [
  {
    title: "Safety & PPE",
    items: [
      "5 lb Fire Extinguisher",
      "25-Man First Aid Kit",
      "10-Gal Spill Kit",
      "MSDS / SDS Book",
      "Combustible Placard",
      "PPE Tote w/ JSA",
      "Safety Glasses",
      "Gloves – S",
      "Gloves – M",
      "Gloves – L",
      "Gloves – XL",
      "Portable Derails (2)",
    ],
  },
  {
    title: "Consumables",
    items: [
      "Switch Lubricant",
      "Fuel Cans (2)",
      "Mixed Fuel (2)",
      "Marking Paint",
      "Tie Plugs",
      "Saw Blades (3 Boxes)",
    ],
  },
  {
    title: "Hydraulic Tools",
    items: [
      "Hyd Power Pack",
      "50' Hoses (2)",
      "Hyd Hammer",
      "Hyd Impact",
      "Hyd Spike Puller",
      "Hyd Drill",
      'Drill Bit 1-1/8"',
      'Drill Bit 1-1/4"',
      'Drill Bit 1-1/2"',
      "Hyd Saw",
      "Spare Hyd Hoses (2)",
    ],
  },
  {
    title: "Gas & Power Tools",
    items: [
      "Gas Saw Kit",
      "Gas Drill Kit",
      "Chain Saw",
      "Backpack Blower",
      "Water Cannon",
    ],
  },
  {
    title: "Measuring & Gauges",
    items: [
      "Transit & Rod",
      "Measuring Wheel",
      "Track Gauge",
      "Ratchet Gauge",
      "3-Ball Roadmaster",
      "Tie Fiddle Marker",
      "B&O Punch",
    ],
  },
  {
    title: "Rail Handling",
    items: [
      "Mech Rail Stretcher",
      "Pulling Block",
      "Rail Bender",
      "Rail Turners (2)",
      "Rail Dogs (2)",
      "Dog Cables (2)",
      "20' Chains (2)",
      "Clevises (4)",
      "Track Jacks (4)",
    ],
  },
  {
    title: "Hand Tools",
    items: [
      "Lining Bars (4)",
      "Nipping Spoons (4)",
      "Claw Bars (4)",
      "Spike Mauls (4)",
      "Maul Handles",
      "Ballast Picks (2)",
      "Tie Adzes (2)",
      "Sledgehammers (4)",
      "Spike Lifters (2)",
      "Track Shovels (4)",
      "Switch Brooms (2)",
      "Track Wrenches (2)",
    ],
  },
];

// Number of items in the left column of the printed PDF (matches the paper form).
window.STX_LEFT_COLUMN_COUNT = 32;

// Follow-up answers for items marked REPAIR or NEED.
window.STX_METHODS = {
  SUPERVISOR: { label: "Site Supervisor", short: "Site Sup." },
  YARD: { label: "Delivery from Yard / Consumable Manager", short: "Yard / CM" },
};
