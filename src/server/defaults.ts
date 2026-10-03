export const DEFAULT_MILESTONES: { title: string; description: string; weight: number }[] = [
  { title: "Offer accepted", description: "The project offer has been accepted and the engagement is confirmed.", weight: 2 },
  { title: "Requirements collected", description: "Business details, pages, menu items, photos and brand preferences gathered.", weight: 5 },
  { title: "Quotation approved", description: "The final quotation and scope have been reviewed and approved.", weight: 2 },
  { title: "Advance payment confirmed", description: "The advance payment has been received and confirmed.", weight: 3 },
  { title: "Design and layout", description: "Visual direction, colour palette, typography and page layouts.", weight: 15 },
  { title: "Homepage development", description: "Building the homepage with hero, highlights, and calls to action.", weight: 15 },
  { title: "Menu and content integration", description: "Menu, gallery, about, contact and location content added.", weight: 12 },
  { title: "Mobile responsiveness", description: "Layouts refined for phones and tablets.", weight: 8 },
  { title: "Client review and feedback", description: "You review the preview and share feedback.", weight: 6 },
  { title: "Revisions", description: "Agreed changes from your feedback are implemented.", weight: 8 },
  { title: "Final testing", description: "Cross-browser, performance, forms and link testing.", weight: 8 },
  { title: "Final payment", description: "The remaining balance is settled.", weight: 3 },
  { title: "Domain connection and deployment", description: "The website goes live on your domain with SSL.", weight: 8 },
  { title: "Project handover", description: "Credentials, documentation and training handed over.", weight: 5 },
];

export const DEFAULT_TEMPLATE = {
  name: "Cafe / restaurant website",
  description: "Standard small-business website for cafes and restaurants",
  content: {
    project_description:
      "Design and development of a modern, mobile-friendly website for your cafe/restaurant, including menu presentation, photo gallery, location and contact details.",
    items: [
      { description: "UI/UX design (up to 5 pages)", details: "Custom layout, colour palette and typography", quantity: 1, unit_price: 12000 },
      { description: "Website development", details: "Home, About, Menu, Gallery, Contact", quantity: 1, unit_price: 18000 },
      { description: "Menu & content integration", details: "Up to 60 menu items with categories", quantity: 1, unit_price: 5000 },
      { description: "Google Maps, WhatsApp & social integration", details: null, quantity: 1, unit_price: 3000 },
      { description: "Basic on-page SEO setup", details: "Titles, meta descriptions, sitemap", quantity: 1, unit_price: 2000 },
    ],
    payment_terms: [
      { label: "Advance payment", percent: 50, due: "On quotation acceptance" },
      { label: "Final payment", percent: 50, due: "Before domain connection and deployment" },
    ],
    included_features: [
      "Responsive design for mobile, tablet and desktop",
      "Menu page with categories and prices",
      "Photo gallery",
      "Contact form, click-to-call and WhatsApp button",
      "Google Maps location",
      "SSL certificate setup",
    ],
    exclusions: [
      "Domain registration and hosting fees (billed by the provider)",
      "Online ordering, table reservations or payment gateway",
      "Professional photography and copywriting",
      "Paid advertising and ongoing SEO campaigns",
    ],
    revisions_included: 2,
    maintenance_terms: "30 days of free bug-fix support after launch. Ongoing maintenance is available on a monthly plan.",
    domain_hosting_terms:
      "Domain and hosting are purchased in the client's name. We will configure DNS and deployment; renewal fees are the client's responsibility.",
    delivery_timeline: "Approximately 3–4 weeks from advance payment and receipt of all content.",
    terms_conditions:
      "1. Work begins after the advance payment is confirmed.\n2. Timelines depend on timely feedback and content from the client.\n3. Additional revisions or features outside this scope are quoted separately.\n4. Ownership of the website transfers to the client on receipt of full payment.\n5. This quotation is valid until the expiry date shown.",
    tax_label: "Tax",
    tax_rate: 0,
    valid_days: 15,
  },
};
