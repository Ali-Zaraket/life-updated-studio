import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * timestamptz surfaced as an ISO-8601 string (`2026-10-22T08:30:00.000Z`), the
 * format the contracts require, regardless of driver.
 */
const isoTimestamp = customType<{ data: string; driverData: string | Date }>({
  dataType: () => 'timestamp with time zone',
  fromDriver: (v) => (v instanceof Date ? v : new Date(v)).toISOString(),
  toDriver: (v) => v,
});
const ts = (name: string) => isoTimestamp(name);
const createdAt = () => ts('created_at').notNull().default(sql`now()`);

/** Single-row table: the one person who may approve anything. */
export const owners = pgTable(
  'owners',
  {
    id: text('id').primaryKey(),
    singleton: boolean('singleton').notNull().default(true).unique(),
    displayName: text('display_name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('owners_singleton', sql`${t.singleton}`)],
);

export const topics = pgTable('topics', {
  id: text('id').primaryKey(),
  pillar: text('pillar').notNull(),
  title: text('title').notNull(),
  question: text('question').notNull(),
  riskTier: text('risk_tier').notNull(),
  intent: jsonb('intent').notNull(),
  isFixture: boolean('is_fixture').notNull(),
  createdAt: createdAt(),
});

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  doi: text('doi'),
  title: text('title').notNull(),
  authors: jsonb('authors').notNull(),
  institution: text('institution'),
  sourceType: text('source_type').notNull(),
  publishedAt: ts('published_at'),
  retrievedAt: ts('retrieved_at').notNull(),
  originId: text('origin_id').notNull(),
  available: boolean('available').notNull(),
  retractionCheckedAt: ts('retraction_checked_at'),
  retracted: boolean('retracted').notNull(),
  correctionNote: text('correction_note'),
  contentSha256: text('content_sha256'),
});

export const claims = pgTable(
  'claims',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    text: text('text').notNull(),
    locations: jsonb('locations').notNull(),
    status: text('status').notNull(),
    statusReason: text('status_reason'),
    riskTier: text('risk_tier').notNull(),
    timeSensitivity: text('time_sensitivity').notNull(),
    freshUntil: ts('fresh_until'),
    lastCheckedAt: ts('last_checked_at'),
    permittedWording: text('permitted_wording'),
    limitations: text('limitations'),
    isNumeric: boolean('is_numeric').notNull(),
    isCausal: boolean('is_causal').notNull(),
    isConsequential: boolean('is_consequential').notNull(),
    singleOriginJustification: text('single_origin_justification'),
  },
  (t) => [
    check('claims_status', sql`${t.status} in ('supported','supported_with_limits','unresolved','rejected')`),
    check('claims_rejected_reason', sql`${t.status} <> 'rejected' or ${t.statusReason} is not null`),
  ],
);

export const claimEvidence = pgTable('claim_evidence', {
  id: text('id').primaryKey(),
  claimId: text('claim_id')
    .notNull()
    .references(() => claims.id),
  sourceId: text('source_id')
    .notNull()
    .references(() => sources.id),
  stance: text('stance').notNull(),
  supportingPassage: text('supporting_passage').notNull(),
  locator: text('locator').notNull(),
  studyType: text('study_type'),
  population: text('population'),
  limitations: text('limitations'),
  createdAt: createdAt(),
});

export const reviewRecords = pgTable('review_records', {
  id: text('id').primaryKey(),
  claimId: text('claim_id').references(() => claims.id),
  episodeVersionId: text('episode_version_id'),
  reviewerKind: text('reviewer_kind').notNull(),
  reviewer: text('reviewer').notNull(),
  verdict: text('verdict').notNull(),
  notes: text('notes').notNull(),
  documentRef: text('document_ref'),
  authorizedDisplayWording: text('authorized_display_wording'),
  createdAt: createdAt(),
});

export const episodes = pgTable(
  'episodes',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    format: text('format').notNull(),
    state: text('state').notNull(),
    stateReason: text('state_reason'),
    heldFrom: text('held_from'),
    currentVersionId: text('current_version_id'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    check('episodes_hold_reason', sql`${t.state} not in ('blocked','failed','cancelled') or (${t.stateReason} is not null and length(trim(${t.stateReason})) > 0)`),
    check('episodes_held_from', sql`${t.state} not in ('blocked','failed','cancelled') or ${t.heldFrom} is not null`),
  ],
);

/** Every transition, for audit and for the studio timeline. */
export const episodeTransitions = pgTable('episode_transitions', {
  id: text('id').primaryKey(),
  episodeId: text('episode_id')
    .notNull()
    .references(() => episodes.id),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reason: text('reason'),
  actor: jsonb('actor').notNull(),
  at: createdAt(),
});

/** Immutable (trigger). A material edit inserts a new row. */
export const episodeVersions = pgTable(
  'episode_versions',
  {
    id: text('id').primaryKey(),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episodes.id),
    versionNumber: integer('version_number').notNull(),
    content: jsonb('content').notNull(),
    contentSha256: text('content_sha256').notNull(),
    claimLedgerSha256: text('claim_ledger_sha256').notNull(),
    supersedesVersionId: text('supersedes_version_id'),
    createdBy: jsonb('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('episode_versions_number').on(t.episodeId, t.versionNumber)],
);

export const episodeLinks = pgTable('episode_links', {
  episodeId: text('episode_id')
    .primaryKey()
    .references(() => episodes.id),
  parentQuestion: text('parent_question'),
  resolvedQuestion: text('resolved_question').notNull(),
  nextQuestion: text('next_question'),
  relatedEpisodeId: text('related_episode_id').references(() => episodes.id),
  relationshipReason: text('relationship_reason'),
  endingReferencesRelated: boolean('ending_references_related').notNull(),
});

export const voiceProfiles = pgTable(
  'voice_profiles',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    profile: jsonb('profile').notNull(),
    approvedByOwnerAt: ts('approved_by_owner_at'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] })],
);

export const licenses = pgTable('licenses', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  scope: text('scope').notNull(),
  termsUrl: text('terms_url'),
  attribution: text('attribution'),
  receiptRef: text('receipt_ref'),
  createdAt: createdAt(),
});

export const assets = pgTable('assets', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  uri: text('uri').notNull(),
  sha256: text('sha256').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  mimeType: text('mime_type').notNull(),
  licenseId: text('license_id').references(() => licenses.id),
  source: text('source').notNull(),
  nativeResolution: text('native_resolution'),
  upscaleMethod: text('upscale_method'),
  createdAt: createdAt(),
});

export const renders = pgTable('renders', {
  id: text('id').primaryKey(),
  episodeVersionId: text('episode_version_id')
    .notNull()
    .references(() => episodeVersions.id),
  kind: text('kind').notNull(),
  manifest: jsonb('manifest').notNull(),
  outputAssetId: text('output_asset_id').references(() => assets.id),
  validation: jsonb('validation'),
  source: text('source').notNull(),
  createdAt: createdAt(),
});

/** Immutable (trigger). */
export const releasePackages = pgTable('release_packages', {
  id: text('id').primaryKey(),
  episodeId: text('episode_id')
    .notNull()
    .references(() => episodes.id),
  episodeVersionId: text('episode_version_id')
    .notNull()
    .references(() => episodeVersions.id),
  content: jsonb('content').notNull(),
  packageSha256: text('package_sha256').notNull().unique(),
  createdAt: createdAt(),
});

/** Insert-only except for a one-time revocation (trigger). */
export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    releasePackageId: text('release_package_id')
      .notNull()
      .references(() => releasePackages.id),
    approverKind: text('approver_kind').notNull(),
    approverId: text('approver_id')
      .notNull()
      .references(() => owners.id),
    signedApproval: jsonb('signed_approval').notNull(),
    keyId: text('key_id').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    check('approvals_owner_only', sql`${t.approverKind} = 'owner'`),
    check('approvals_revocation_reason', sql`(${t.revokedAt} is null) = (${t.revokedReason} is null)`),
    index('approvals_package').on(t.releasePackageId),
  ],
);

export const rejections = pgTable('approval_rejections', {
  id: text('id').primaryKey(),
  releasePackageId: text('release_package_id')
    .notNull()
    .references(() => releasePackages.id),
  ownerId: text('owner_id')
    .notNull()
    .references(() => owners.id),
  feedback: text('feedback').notNull(),
  createdAt: createdAt(),
});

export const publishJobs = pgTable(
  'publish_jobs',
  {
    id: text('id').primaryKey(),
    releasePackageId: text('release_package_id')
      .notNull()
      .references(() => releasePackages.id),
    approvalId: text('approval_id')
      .notNull()
      .references(() => approvals.id),
    episodeId: text('episode_id')
      .notNull()
      .references(() => episodes.id),
    accountId: text('account_id').notNull(),
    adapterMode: text('adapter_mode').notNull(),
    state: text('state').notNull(),
    stateReason: text('state_reason'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    scheduledFor: ts('scheduled_for').notNull(),
    nextAttemptAt: ts('next_attempt_at'),
    containerId: text('container_id'),
    containerCreatedAt: ts('container_created_at'),
    remoteMediaId: text('remote_media_id'),
    permalink: text('permalink'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    check('publish_jobs_mode', sql`${t.adapterMode} in ('mock','live')`),
    check(
      'publish_jobs_reason',
      sql`${t.state} not in ('failed','cancelled','needs_reconciliation','retry_wait') or ${t.stateReason} is not null`,
    ),
    check('publish_jobs_published', sql`${t.state} <> 'published' or (${t.remoteMediaId} is not null and ${t.permalink} is not null)`),
    // At most one live attempt per package, and per episode+account: a second job cannot be queued while one is in flight or done.
    uniqueIndex('publish_jobs_one_live_per_package')
      .on(t.releasePackageId)
      .where(sql`${t.state} not in ('failed','cancelled')`),
    uniqueIndex('publish_jobs_one_live_per_episode_account')
      .on(t.episodeId, t.accountId)
      .where(sql`${t.state} not in ('failed','cancelled')`),
  ],
);

export const instagramMedia = pgTable('instagram_media', {
  id: text('id').primaryKey(),
  publishJobId: text('publish_job_id')
    .notNull()
    .unique()
    .references(() => publishJobs.id),
  accountId: text('account_id').notNull(),
  remoteMediaId: text('remote_media_id').notNull().unique(),
  permalink: text('permalink').notNull(),
  publishedAt: ts('published_at').notNull(),
  source: text('source').notNull(),
});

export const metricRawResponses = pgTable('metric_raw_responses', {
  id: text('id').primaryKey(),
  instagramMediaId: text('instagram_media_id').references(() => instagramMedia.id),
  source: text('source').notNull(),
  apiVersion: text('api_version').notNull(),
  body: jsonb('body').notNull(),
  retrievedAt: ts('retrieved_at').notNull(),
});

export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    accountId: text('account_id').notNull(),
    instagramMediaId: text('instagram_media_id').references(() => instagramMedia.id),
    metric: text('metric').notNull(),
    definition: text('definition').notNull(),
    unit: text('unit').notNull(),
    window: text('window').notNull(),
    mediaAgeSec: integer('media_age_sec'),
    apiVersion: text('api_version').notNull(),
    retrievedAt: ts('retrieved_at').notNull(),
    value: doublePrecision('value'),
    unavailabilityReason: text('unavailability_reason'),
    source: text('source').notNull(),
    rawResponseId: text('raw_response_id').references(() => metricRawResponses.id),
  },
  (t) => [
    check('metric_null_xor_reason', sql`(${t.value} is null) <> (${t.unavailabilityReason} is null)`),
    check('metric_nonnegative', sql`${t.value} is null or ${t.value} >= 0`),
    check('metric_source', sql`${t.source} in ('mock','manual_import','live')`),
    check('metric_scope', sql`(${t.scope} = 'media') = (${t.instagramMediaId} is not null)`),
    index('metric_snapshots_media').on(t.instagramMediaId, t.metric, t.window),
  ],
);

export const experiments = pgTable('experiments', {
  id: text('id').primaryKey(),
  hypothesis: text('hypothesis').notNull(),
  change: text('change').notNull(),
  evaluationWindow: text('evaluation_window').notNull(),
  result: text('result'),
  decision: text('decision'),
  rollback: text('rollback'),
  createdAt: createdAt(),
});

export const costEvents = pgTable(
  'cost_events',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    units: doublePrecision('units').notNull(),
    unitType: text('unit_type').notNull(),
    amountMicroUsd: bigint('amount_micro_usd', { mode: 'number' }).notNull(),
    estimated: boolean('estimated').notNull(),
    source: text('source').notNull(),
    episodeId: text('episode_id').references(() => episodes.id),
    jobId: text('job_id'),
    createdAt: createdAt(),
  },
  (t) => [check('cost_nonnegative', sql`${t.amountMicroUsd} >= 0`)],
);

/** Append-only (trigger). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    at: createdAt(),
    actor: jsonb('actor').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    details: jsonb('details').notNull(),
  },
  (t) => [index('audit_entity').on(t.entityType, t.entityId)],
);

/** Single-row operational switches. */
export const settings = pgTable(
  'settings',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    publishingPaused: boolean('publishing_paused').notNull().default(false),
    pausedReason: text('paused_reason'),
    spendingStopped: boolean('spending_stopped').notNull().default(false),
    spendingCapMicroUsd: bigint('spending_cap_micro_usd', { mode: 'number' }),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
    updatedBy: jsonb('updated_by'),
  },
  (t) => [
    check('settings_singleton', sql`${t.singleton}`),
    check('settings_pause_reason', sql`not ${t.publishingPaused} or ${t.pausedReason} is not null`),
  ],
);

/** Lease-based job queue. Domain state (e.g. publish jobs) lives in its own table. */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    state: text('state').notNull().default('queued'),
    runAt: ts('run_at').notNull().default(sql`now()`),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: ts('lease_expires_at'),
    lastError: text('last_error'),
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().default(sql`now()`),
  },
  (t) => [
    check('jobs_state', sql`${t.state} in ('queued','leased','succeeded','failed','cancelled')`),
    check('jobs_lease', sql`${t.state} <> 'leased' or (${t.leaseOwner} is not null and ${t.leaseExpiresAt} is not null)`),
    index('jobs_ready').on(t.state, t.runAt),
  ],
);

/** A flagged problem with published or queued content and the owner's resolution. */
export const corrections = pgTable(
  'corrections',
  {
    id: text('id').primaryKey(),
    trigger: jsonb('trigger').notNull(),
    plan: jsonb('plan').notNull(),
    planSha256: text('plan_sha256').notNull(),
    status: text('status').notNull().default('open'),
    flaggedBy: jsonb('flagged_by').notNull(),
    resolution: text('resolution'),
    resolvedBy: jsonb('resolved_by'),
    createdAt: createdAt(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    check('corrections_status', sql`${t.status} in ('open','resolved','dismissed')`),
    check('corrections_resolution', sql`${t.status} = 'open' or (${t.resolution} is not null and ${t.resolvedAt} is not null and ${t.resolvedBy} is not null)`),
  ],
);

/** Instagram credentials, sealed with AES-256-GCM. The key lives only in local env. */
export const instagramCredentials = pgTable('instagram_credentials', {
  accountId: text('account_id').primaryKey(),
  igUserId: text('ig_user_id').notNull(),
  username: text('username'),
  tokenSealed: text('token_sealed').notNull(),
  keyId: text('key_id').notNull(),
  scopes: jsonb('scopes').notNull(),
  issuedAt: ts('issued_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  updatedAt: ts('updated_at').notNull().default(sql`now()`),
});

/** One-time OAuth `state` values; consumed on callback. */
export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  purpose: text('purpose').notNull(),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});
