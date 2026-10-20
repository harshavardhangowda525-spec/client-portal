-- Infinity Web & Apps — AI services in the pricing catalog (Settings → Pricing configuration → Optional services).
-- Prices are starting points; edit them any time. Each proposal still uses the actual price you quote.

select set_config('app.role', 'system', false);

alter table pricing_services drop constraint pricing_services_category_check;
alter table pricing_services add constraint pricing_services_category_check check (category in ('website', 'app', 'both', 'ai'));

insert into pricing_services (category, name, description, unit, min_price, max_price, open_ended, default_price, position)
select 'ai', v.name, v.description, v.unit, v.min_price, v.max_price, v.open_ended, v.default_price::numeric, 100 + v.pos
from (values
  (1,  'AI appointment & inquiry automation', 'Answers enquiries and books appointments automatically on your website or WhatsApp, with reminders and confirmations.', 'fixed', 2999, 9999, true, null),
  (2,  'AI website chatbot', 'A chatbot trained on your business information that answers customer questions 24/7.', 'fixed', 4999, 15000, false, null),
  (3,  'WhatsApp AI assistant', 'Automatic replies, FAQs and order or booking updates on WhatsApp (via the official WhatsApp Business API).', 'fixed', 5999, 20000, false, null),
  (4,  'AI customer support assistant', 'Answers from your own documents and policies, and hands over to a person when needed.', 'fixed', 9999, 35000, true, null),
  (5,  'AI lead capture & qualification', 'Collects visitor details, asks qualifying questions and sends hot leads to you instantly.', 'fixed', 4999, 15000, false, null),
  (6,  'AI voice call assistant', 'Answers phone calls, takes bookings and messages in a natural voice.', 'fixed', 14999, 50000, true, null),
  (7,  'AI content writing', 'SEO-friendly blog posts, product descriptions and page copy, reviewed by our team.', 'per_page', 499, 1999, false, null),
  (8,  'AI image generation & editing', 'Marketing visuals, product photo clean-up and background removal.', 'fixed', 2999, 10000, false, null),
  (9,  'AI social media automation', 'Generates and schedules posts and captions for your social channels.', 'fixed', 3999, 12000, false, null),
  (10, 'AI email & follow-up automation', 'Personalised follow-ups, reminders and email campaigns sent automatically.', 'fixed', 3999, 12000, false, null),
  (11, 'AI product recommendations', 'Suggests relevant products to each customer to increase sales.', 'fixed', 7999, 25000, false, null),
  (12, 'AI smart search', 'Search that understands what customers mean, not just exact words.', 'fixed', 5999, 20000, false, null),
  (13, 'AI document & invoice data extraction', 'Reads invoices, forms and receipts and fills the data in automatically.', 'fixed', 7999, 30000, true, null),
  (14, 'AI review & feedback analysis', 'Summarises customer reviews and feedback and highlights what to improve.', 'fixed', 4999, 15000, false, null),
  (15, 'AI business reports & analytics', 'Plain-language insights and automatic reports from your sales and business data.', 'fixed', 9999, 35000, true, null),
  (16, 'AI translation & multilingual support', 'Translates your website, app or chatbot into Indian and international languages.', 'fixed', 2999, 10000, false, null),
  (17, 'Custom AI workflow automation', 'Connects your tools and automates repetitive tasks with AI (per workflow).', 'per_item', 4999, 25000, true, null)
) as v(pos, name, description, unit, min_price, max_price, open_ended, default_price)
where not exists (select 1 from pricing_services s where s.category = 'ai' and s.name = v.name);

-- AI providers bill usage separately; enter the real quote per proposal.
insert into external_cost_catalog (name, category, billing, period, position)
select 'AI usage (model API credits)', 'api', 'recurring', 'monthly', 100
where not exists (select 1 from external_cost_catalog where name = 'AI usage (model API credits)');

select set_config('app.role', '', false);
