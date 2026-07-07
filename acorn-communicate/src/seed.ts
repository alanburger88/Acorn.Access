/**
 * Seed a demo tenant end-to-end: brand, customers, approved content,
 * published statement template, composed + delivered communications.
 * Run: npm run seed  (uses ACORN_DATA_DIR, default ./data)
 * Prints the admin API key and live viewer URLs.
 */
import { configFromEnv, createBaseContext } from './kernel/context.js';
import { wireServices } from './wiring.js';
import type { RequestCtx, TemplateBlock } from './kernel/contracts.js';

const config = configFromEnv();
const ctx = createBaseContext(config);
wireServices(ctx);

const { tenants, content, templates, composition, delivery, nba, journeys, print } = ctx.services;

// --- tenant + actors -------------------------------------------------------
const { tenant, adminKey } = tenants.createTenant({
  name: 'First Acorn Bank',
  industry: 'banking',
});

const author: RequestCtx = {
  tenantId: tenant.id,
  actorId: 'usr_seed_author',
  roles: ['business-author', 'designer', 'operator', 'developer'],
  keyId: 'key_seed_author',
};
const approver: RequestCtx = {
  tenantId: tenant.id,
  actorId: 'usr_seed_approver',
  roles: ['compliance-approver'],
  keyId: 'key_seed_approver',
};
const admin: RequestCtx = {
  tenantId: tenant.id,
  actorId: 'usr_seed_admin',
  roles: ['tenant-admin'],
  keyId: 'key_seed_admin',
};

const brand = tenants.createBrand(admin, {
  name: 'First Acorn Bank',
  primaryColor: '#1b3a2f',
  accentColor: '#2f6b4f',
  logoText: 'FIRST ACORN BANK',
  fromEmail: 'statements@firstacorn.example',
  fromSms: 'ACORNBANK',
});

// --- customers --------------------------------------------------------------
const ada = tenants.createCustomer(admin, {
  externalRef: 'CUST-1001',
  name: 'Ada Okafor',
  email: 'ada@example.com',
  phone: '+1-555-201-7788',
  locale: 'en-US',
  address: { line1: '12 Elm St', city: 'Madison', region: 'WI', postalCode: '53703', country: 'US' },
});
const ben = tenants.createCustomer(admin, {
  externalRef: 'CUST-1002',
  name: 'Ben Torres',
  email: 'bounce@example.com', // simulated hard bounce → failover to SMS
  phone: '+1-555-943-2210',
  locale: 'en-US',
  address: { line1: '88 Oak Ave', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
});
tenants.setPreferences(admin, ben.id, { channelPriority: ['email', 'sms'], paperless: false });

// --- approved content (SoD: author writes, approver approves) ---------------
function approvedContent(key: string, type: 'disclosure' | 'faq', title: string, body: string) {
  const { version } = content.createContent(author, { key, type, title, body });
  content.submitForReview(author, version.id);
  content.review(approver, version.id, 'approved');
}

approvedContent(
  'disclosure.billing-rights',
  'disclosure',
  'Your Billing Rights',
  'If you think there is an error on your statement, write to us within 60 days after the error appeared. ' +
    'We will acknowledge your letter within 30 days and resolve the inquiry within 90 days. ' +
    'You may withhold payment on the disputed amount while we investigate.',
);
approvedContent(
  'faq.minimum-payment',
  'faq',
  'How is my minimum payment calculated?',
  'Your minimum payment is 2% of your statement balance or $25, whichever is greater. ' +
    'Paying only the minimum means interest accrues on the remaining balance.',
);
approvedContent(
  'faq.payment-due-date',
  'faq',
  'When is my payment due?',
  'Your payment is due on the date shown in the Account Summary section. ' +
    'Payments received by 5pm Central Time on the due date are credited the same day.',
);
approvedContent(
  'faq.dispute-charge',
  'faq',
  'How do I dispute a charge?',
  'Use the Dispute a charge action in this document, or contact support. ' +
    'Provide the transaction date and amount; provisional credit is typically issued within 2 business days.',
);

// --- statement template ------------------------------------------------------
const blocks: TemplateBlock[] = [
  {
    kind: 'summary',
    title: 'Hi {{customer.firstName}}, here is your {{period}} statement',
    text: 'Your new balance is {{account.newBalance|currency}} and the minimum payment of {{account.minimumDue|currency}} is due on {{account.dueDate|date}}.',
  },
  {
    kind: 'section',
    id: 'account-summary',
    title: 'Account Summary',
    collapsible: false,
    explanation:
      'This section shows what you owed last month, what changed, and what you owe now. New Balance is the total; Minimum Due is the smallest amount you can pay to keep the account current.',
    blocks: [
      { kind: 'field-row', label: 'Previous Balance', value: '{{account.previousBalance|currency}}' },
      { kind: 'field-row', label: 'Payments Received', value: '{{account.payments|currency}}' },
      { kind: 'field-row', label: 'New Charges', value: '{{account.newCharges|currency}}' },
      { kind: 'field-row', label: 'New Balance', value: '{{account.newBalance|currency}}' },
      { kind: 'field-row', label: 'Minimum Due', value: '{{account.minimumDue|currency}}' },
      { kind: 'field-row', label: 'Payment Due Date', value: '{{account.dueDate|date}}' },
    ],
  },
  {
    kind: 'section',
    id: 'transactions',
    title: 'Transactions',
    collapsible: true,
    explanation: 'Every charge and credit on your account this period, newest first.',
    blocks: [
      {
        kind: 'table',
        itemsPath: 'transactions',
        columns: [
          { header: 'Date', valuePath: 'date', format: 'date' },
          { header: 'Description', valuePath: 'description' },
          { header: 'Amount', valuePath: 'amount', align: 'right', format: 'currency' },
        ],
      },
    ],
  },
  {
    kind: 'section',
    id: 'fees-interest',
    title: 'Fees and Interest',
    collapsible: true,
    condition: { path: 'account.feesCharged', op: 'gt', value: 0 },
    explanation:
      'Fees or interest were charged this period. Paying your full balance by the due date avoids interest next period.',
    blocks: [
      { kind: 'field-row', label: 'Fees Charged', value: '{{account.feesCharged|currency}}' },
      { kind: 'field-row', label: 'Interest Charged', value: '{{account.interestCharged|currency}}' },
    ],
  },
  {
    kind: 'section',
    id: 'billing-rights',
    title: 'Your Billing Rights',
    collapsible: true,
    blocks: [{ kind: 'content-ref', contentKey: 'disclosure.billing-rights' }],
  },
  {
    kind: 'section',
    id: 'actions',
    title: 'What you can do',
    collapsible: false,
    blocks: [
      { kind: 'action', action: 'pay', label: 'Pay {{account.minimumDue|currency}} now' },
      { kind: 'action', action: 'dispute', label: 'Dispute a charge' },
      { kind: 'action', action: 'update-details', label: 'Update my contact details' },
      { kind: 'action', action: 'contact', label: 'Contact support' },
    ],
  },
];

const { template, version } = templates.createTemplate(author, {
  key: 'credit-card-statement',
  name: 'Credit Card Statement',
  communicationType: 'statement',
  brandId: brand.id,
  intendedOutcome: 'payment_completed',
  dataContract: {
    fields: [
      { path: 'customer.firstName', type: 'string', required: true },
      { path: 'period', type: 'string', required: true },
      { path: 'account.previousBalance', type: 'number', required: true },
      { path: 'account.payments', type: 'number', required: true },
      { path: 'account.newCharges', type: 'number', required: true },
      { path: 'account.newBalance', type: 'number', required: true },
      { path: 'account.minimumDue', type: 'number', required: true },
      { path: 'account.dueDate', type: 'date', required: true },
      { path: 'account.feesCharged', type: 'number', required: false },
      { path: 'account.interestCharged', type: 'number', required: false },
      { path: 'transactions', type: 'array', required: true },
    ],
    sample: {
      customer: { firstName: 'Sam' },
      period: 'June 2026',
      account: {
        previousBalance: 900.0,
        payments: 900.0,
        newCharges: 431.55,
        newBalance: 431.55,
        minimumDue: 25.0,
        dueDate: '2026-07-25',
        feesCharged: 0,
        interestCharged: 0,
      },
      transactions: [{ date: '2026-06-03', description: 'Grocery Mart', amount: 82.13 }],
    },
  },
  blocks,
  channels: {
    email: { subject: 'Your {{period}} statement — {{account.newBalance|currency}} balance' },
    sms: {
      text: 'First Acorn Bank: your {{period}} statement is ready. Balance {{account.newBalance|currency}}, min due {{account.minimumDue|currency}}. View securely: {{link}}',
    },
  },
});
templates.publish(approver, version.id);

// --- compose + deliver two live communications -------------------------------
const adaData = {
  customerRef: ada.externalRef,
  customer: { firstName: 'Ada' },
  period: 'June 2026',
  account: {
    previousBalance: 1250.4,
    payments: 1250.4,
    newCharges: 1874.22,
    newBalance: 1874.22,
    minimumDue: 37.48,
    dueDate: '2026-07-25',
    feesCharged: 0,
    interestCharged: 0,
  },
  transactions: [
    { date: '2026-06-02', description: 'Grocery Mart', amount: 96.41 },
    { date: '2026-06-05', description: 'Madison Utilities', amount: 143.5 },
    { date: '2026-06-11', description: 'Cloud Books', amount: 28.99 },
    { date: '2026-06-14', description: 'Rail Pass', amount: 62.0 },
    { date: '2026-06-19', description: 'Fresh Table Restaurant', amount: 88.75 },
    { date: '2026-06-23', description: 'Payment — thank you', amount: -1250.4 },
    { date: '2026-06-27', description: 'Air Travel Co', amount: 1454.57 },
  ],
};

const benData = {
  customer: { firstName: 'Ben' },
  period: 'June 2026',
  account: {
    previousBalance: 640.1,
    payments: 200.0,
    newCharges: 321.8,
    newBalance: 761.9,
    minimumDue: 25.0,
    dueDate: '2026-07-25',
    feesCharged: 35.0,
    interestCharged: 12.44,
  },
  transactions: [
    { date: '2026-06-04', description: 'Hardware Depot', amount: 210.55 },
    { date: '2026-06-09', description: 'Corner Cafe', amount: 18.25 },
    { date: '2026-06-16', description: 'Late Fee', amount: 35.0 },
    { date: '2026-06-21', description: 'Streaming Plus', amount: 15.99 },
    { date: '2026-06-25', description: 'Payment — thank you', amount: -200.0 },
  ],
};

// third customer used by the dunning journey demo
const cara = tenants.createCustomer(admin, {
  externalRef: 'CUST-1003',
  name: 'Cara Lindqvist',
  email: 'cara@example.com',
  phone: '+1-555-882-4471',
  locale: 'en-US',
  address: { line1: '5 Birch Ln', city: 'Denver', region: 'CO', postalCode: '80202', country: 'US' },
});

async function main() {
  const comAda = await composition.compose({
    tenantId: tenant.id,
    templateId: template.id,
    customerId: ada.id,
    data: adaData,
  });
  await delivery.deliver({ tenantId: tenant.id, communicationId: comAda.id });
  nba.recommend(tenant.id, comAda.id);

  const comBen = await composition.compose({
    tenantId: tenant.id,
    templateId: template.id,
    customerId: ben.id,
    data: benData,
  });
  await delivery.deliver({ tenantId: tenant.id, communicationId: comBen.id });
  nba.recommend(tenant.id, comBen.id);

  // --- dunning journey: statement → wait for payment → remind → wait → end
  const dunning = journeys.createJourney(author, {
    key: 'statement-dunning',
    name: 'Statement with payment follow-up',
    entryStepId: 'send-statement',
    steps: [
      { id: 'send-statement', kind: 'send', templateId: template.id, next: 'wait-payment' },
      {
        id: 'wait-payment',
        kind: 'wait',
        until: 'outcome-achieved',
        timeoutMs: 5 * 60_000,
        onEvent: 'done',
        onTimeout: 'remind',
      },
      { id: 'remind', kind: 'remind', next: 'wait-again' },
      {
        id: 'wait-again',
        kind: 'wait',
        until: 'outcome-achieved',
        timeoutMs: 10 * 60_000,
        onEvent: 'done',
        onTimeout: 'give-up',
      },
      { id: 'done', kind: 'end', result: 'completed' },
      { id: 'give-up', kind: 'end', result: 'abandoned' },
    ],
  });
  const instance = await journeys.start({
    tenantId: tenant.id,
    journeyId: dunning.id,
    customerId: cara.id,
    data: {
      customer: { firstName: 'Cara' },
      period: 'June 2026',
      account: {
        previousBalance: 0,
        payments: 0,
        newCharges: 412.35,
        newBalance: 412.35,
        minimumDue: 25.0,
        dueDate: '2026-07-25',
        feesCharged: 0,
        interestCharged: 0,
      },
      transactions: [
        { date: '2026-06-07', description: 'Mountain Outfitters', amount: 289.4 },
        { date: '2026-06-15', description: 'City Bikes', amount: 122.95 },
      ],
    },
  });

  // --- print batch over the two delivered statements
  const batch = await print.createBatch(admin, { communicationIds: [comAda.id, comBen.id] });

  const linkAda = ctx.services.delivery.getSecureLink(tenant.id, comAda.id);
  const linkBen = ctx.services.delivery.getSecureLink(tenant.id, comBen.id);

  console.log('──────────────────────────────────────────────────────');
  console.log('Seed complete: First Acorn Bank demo tenant');
  console.log(`  tenant id:        ${tenant.id}`);
  console.log(`  admin API key:    ${adminKey.secret}`);
  console.log(`  console:          ${config.baseUrl}/console`);
  console.log(`  Ada's statement:  ${config.baseUrl}/view/${linkAda?.token}`);
  console.log(`  Ben's statement:  ${config.baseUrl}/view/${linkBen?.token}`);
  console.log(`  outbox (.eml/.sms): ${config.outboxDir}`);
  console.log(`  dunning journey:  ${dunning.id} (instance ${instance.id}, step ${instance.currentStepId})`);
  console.log(`  print batch:      ${batch.id} (${batch.pieceIds.length} pieces, ${batch.suppressed.length} suppressed)`);
  console.log(`  MCP server:       ACORN_MCP_API_KEY=${adminKey.secret} npm run mcp`);
  console.log('──────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
