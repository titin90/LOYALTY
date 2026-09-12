/**
 * Esquema de la plataforma de fidelización.
 *
 * Reglas que este archivo hace cumplir (ver CLAUDE.md):
 *  - Toda tabla lleva `tenant_id`. Única excepción: `tenants`, donde `id` ES el tenant.
 *  - Los índices compuestos empiezan por `tenant_id`: toda query del panel filtra por él.
 *  - `point_events` es append-only. El saldo de `cards.points_balance` lo mantiene un
 *    trigger; nunca se actualiza desde la aplicación.
 *
 * Las políticas RLS, los triggers y las funciones `SECURITY DEFINER` viven en
 * migraciones SQL escritas a mano (drizzle/migrations/*_rls_*.sql) porque son la
 * superficie de seguridad y deben revisarse como SQL, no generarse.
 */
import { sql, relations } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const tenantPlan = pgEnum('tenant_plan', ['trial', 'basic', 'pro']);
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended', 'cancelled']);
export const memberRole = pgEnum('member_role', ['owner', 'staff']);
export const cardStatus = pgEnum('card_status', ['active', 'blocked']);
export const walletPlatform = pgEnum('wallet_platform', ['apple', 'google']);

/** `balance` y `sessions` quedan reservados para membresías prepagadas (Fase 2). */
export const pointEventKind = pgEnum('point_event_kind', [
  'earn',
  'redeem',
  'welcome_bonus',
  'referral',
  'adjust',
  'expire',
]);

/** `cross` queda reservado para alianzas entre tiendas (Fase 2). No se usa en v1. */
export const referralScope = pgEnum('referral_scope', ['intra', 'cross']);
export const referralStatus = pgEnum('referral_status', ['pending', 'paid', 'void']);

export const actorType = pgEnum('actor_type', ['staff', 'customer', 'system', 'platform']);

/** Derechos ARCO de la Ley 21.719. */
export const dsrKind = pgEnum('dsr_kind', [
  'access',
  'rectification',
  'deletion',
  'objection',
  'portability',
]);
export const dsrStatus = pgEnum('dsr_status', ['open', 'in_progress', 'resolved', 'rejected']);

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/* -------------------------------------------------------------------------- */
/* Negocios y personal                                                        */
/* -------------------------------------------------------------------------- */

export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    slug: text().notNull(),
    name: text().notNull(),
    plan: tenantPlan().notNull().default('trial'),
    status: tenantStatus().notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    check('tenants_slug_format', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'`),
  ],
);

/**
 * Parámetros configurables por negocio. Columnas tipadas a propósito en vez de un
 * jsonb: la lógica de dominio los lee por nombre y un jsonb suelto invita a typos
 * que el compilador no atrapa.
 */
export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid()
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Nunca mostrar el contador en cero: todo cliente nuevo entra con puntos. */
  welcomeBonusPoints: integer().notNull().default(1),
  /** Modelo cerrado: monto fijo, configurable por negocio. */
  referralBonusPoints: integer().notNull().default(2),
  /** Puntos que suma una visita escaneada. */
  pointsPerVisit: integer().notNull().default(1),
  /** Antifraude: ventana mínima entre dos `earn` de la misma tarjeta. */
  earnCooldownMinutes: integer().notNull().default(240),
  googleReviewUrl: text(),
  reviewPromptCooldownDays: integer().notNull().default(90),
  reviewPromptMinVisits: integer().notNull().default(3),
  /** Un cliente está "en riesgo" si supera su cadencia propia por este factor. */
  riskMultiplier: integer().notNull().default(2),
});

export const tenantMembers = pgTable(
  'tenant_members',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid().notNull(),
    role: memberRole().notNull().default('staff'),
    name: text().notNull(),
    /** PIN de 4 dígitos hasheado con bcrypt. Nunca en claro, nunca en logs. */
    pinHash: text(),
    failedPinAttempts: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tenant_members_tenant_user_key').on(t.tenantId, t.userId),
    index('tenant_members_tenant_idx').on(t.tenantId, t.active),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    lastSeenAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('devices_tenant_idx').on(t.tenantId)],
);

/* -------------------------------------------------------------------------- */
/* Clientes — SIEMPRE por tenant. No existe tabla global de personas.          */
/* -------------------------------------------------------------------------- */

export const customers = pgTable(
  'customers',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** E.164. Sin verificar en v1, pero validado en formato.
     *  Nombre de columna explícito: la derivación automática de Drizzle produce
     *  `phone_e_164` al partir en el límite del dígito. */
    phoneE164: text('phone_e164').notNull(),
    /** Borrado lógico de cara al negocio; el job de purga lo hace físico. */
    deletedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('customers_tenant_phone_key').on(t.tenantId, t.phoneE164),
    index('customers_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('customers_phone_e164', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

/** Consentimiento específico por negocio y versionado (Ley 21.719, art. sobre consentimiento). */
export const consents = pgTable(
  'consents',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    purpose: text().notNull().default('loyalty'),
    version: text().notNull(),
    grantedAt: createdAt(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('consents_tenant_customer_idx').on(t.tenantId, t.customerId)],
);

/* -------------------------------------------------------------------------- */
/* Tarjeta                                                                    */
/* -------------------------------------------------------------------------- */

export const cards = pgTable(
  'cards',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** Lo que va dentro del QR del pase. Opaco, sin PII. */
    serial: text().notNull(),
    /** Proyección mantenida por trigger. NUNCA se escribe desde la aplicación. */
    pointsBalance: integer().notNull().default(0),
    status: cardStatus().notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cards_serial_key').on(t.serial),
    uniqueIndex('cards_tenant_customer_key').on(t.tenantId, t.customerId),
    check('cards_balance_non_negative', sql`${t.pointsBalance} >= 0`),
  ],
);

export const cardDesigns = pgTable(
  'card_designs',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    config: jsonb().notNull(),
    publishedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('card_designs_tenant_version_key').on(t.tenantId, t.version)],
);

export const walletPasses = pgTable(
  'wallet_passes',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cardId: uuid()
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    platform: walletPlatform().notNull(),
    /** Serial de Apple u object id de Google. */
    externalId: text().notNull(),
    /** Token del header `Authorization: ApplePass`. Guardado hasheado. */
    authTokenHash: text(),
    lastPushedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('wallet_passes_card_platform_key').on(t.cardId, t.platform),
    index('wallet_passes_tenant_idx').on(t.tenantId),
  ],
);

export const appleRegistrations = pgTable(
  'apple_registrations',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    passId: uuid()
      .notNull()
      .references(() => walletPasses.id, { onDelete: 'cascade' }),
    deviceLibraryIdentifier: text().notNull(),
    pushToken: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('apple_registrations_pass_device_key').on(t.passId, t.deviceLibraryIdentifier),
  ],
);

/* -------------------------------------------------------------------------- */
/* Ledger — append-only                                                       */
/* -------------------------------------------------------------------------- */

export const pointEvents = pgTable(
  'point_events',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cardId: uuid()
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    delta: integer().notNull(),
    kind: pointEventKind().notNull(),
    staffId: uuid().references(() => tenantMembers.id, { onDelete: 'set null' }),
    deviceId: uuid().references(() => devices.id, { onDelete: 'set null' }),
    /** Generada en el cliente. Hace segura la cola offline del escáner. */
    idempotencyKey: text().notNull(),
    meta: jsonb().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('point_events_tenant_idempotency_key').on(t.tenantId, t.idempotencyKey),
    index('point_events_card_created_idx').on(t.cardId, t.createdAt),
    index('point_events_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('point_events_delta_not_zero', sql`${t.delta} <> 0`),
  ],
);

export const rewards = pgTable(
  'rewards',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    threshold: integer().notNull(),
    active: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('rewards_tenant_active_idx').on(t.tenantId, t.active),
    check('rewards_threshold_positive', sql`${t.threshold} > 0`),
  ],
);

export const redemptions = pgTable(
  'redemptions',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    cardId: uuid()
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    rewardId: uuid()
      .notNull()
      .references(() => rewards.id, { onDelete: 'restrict' }),
    staffId: uuid().references(() => tenantMembers.id, { onDelete: 'set null' }),
    pointEventId: uuid()
      .notNull()
      .references(() => pointEvents.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [index('redemptions_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

export const referrals = pgTable(
  'referrals',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    referrerCustomerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    referredCustomerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    scope: referralScope().notNull().default('intra'),
    status: referralStatus().notNull().default('pending'),
    rewardedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('referrals_one_per_referred_key').on(t.tenantId, t.referredCustomerId),
    index('referrals_tenant_referrer_idx').on(t.tenantId, t.referrerCustomerId),
    check('referrals_no_self', sql`${t.referrerCustomerId} <> ${t.referredCustomerId}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Compliance y operación                                                     */
/* -------------------------------------------------------------------------- */

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorType: actorType().notNull(),
    actorId: uuid(),
    action: text().notNull(),
    targetTable: text(),
    targetId: uuid(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

export const dsrRequests = pgTable(
  'dsr_requests',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid().references(() => customers.id, { onDelete: 'set null' }),
    kind: dsrKind().notNull(),
    status: dsrStatus().notNull().default('open'),
    dueAt: timestamp({ withTimezone: true }).notNull(),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('dsr_requests_tenant_status_idx').on(t.tenantId, t.status, t.dueAt)],
);

/** Respalda el tope de una solicitud de reseña cada N días por cliente. */
export const reviewPrompts = pgTable(
  'review_prompts',
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    sentAt: createdAt(),
  },
  (t) => [index('review_prompts_tenant_customer_idx').on(t.tenantId, t.customerId, t.sentAt)],
);

/* -------------------------------------------------------------------------- */
/* Relaciones                                                                 */
/* -------------------------------------------------------------------------- */

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  settings: one(tenantSettings, {
    fields: [tenants.id],
    references: [tenantSettings.tenantId],
  }),
  members: many(tenantMembers),
  customers: many(customers),
  rewards: many(rewards),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
  card: one(cards, { fields: [customers.id], references: [cards.customerId] }),
  consents: many(consents),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  tenant: one(tenants, { fields: [cards.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [cards.customerId], references: [customers.id] }),
  events: many(pointEvents),
  passes: many(walletPasses),
}));

export const pointEventsRelations = relations(pointEvents, ({ one }) => ({
  card: one(cards, { fields: [pointEvents.cardId], references: [cards.id] }),
  staff: one(tenantMembers, { fields: [pointEvents.staffId], references: [tenantMembers.id] }),
}));

/** Toda tabla del esquema, para que la suite de aislamiento no dependa de una lista a mano. */
export const ALL_TABLES = [
  tenants,
  tenantSettings,
  tenantMembers,
  devices,
  customers,
  consents,
  cards,
  cardDesigns,
  walletPasses,
  appleRegistrations,
  pointEvents,
  rewards,
  redemptions,
  referrals,
  auditLog,
  dsrRequests,
  reviewPrompts,
] as const;
