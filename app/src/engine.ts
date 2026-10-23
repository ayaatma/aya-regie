/**
 * The single door onto the headless engine.
 *
 * Everything the UI knows about scheduling comes through here. No screen imports `@engine/*`
 * directly, and no screen ever reimplements a rule: legality is `isLegal`, the reason is
 * `blockersFor`, the colours are `validate`. See `.claude/memory/project_engine_api.md`.
 */

export { EDITABLE_FIELDS } from '@engine/model.ts';
export type { EditableField } from '@engine/model.ts';

/** Reading the two free-text answers of the form, with the doubt that comes with them. */
export { parseAvailabilityNote, parsePoleAnswer } from '@engine/answers.ts';
export type { AnswerReading } from '@engine/answers.ts';

export {
  DEFAULT_SLOTS,
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_RULES,
  DEFAULT_CATERING,
  shiftHours,
  demandHours,
  toIso,
  toLabel,
  toClock,
} from '@engine/model.ts';
export type {
  Artist,
  CateringRules,
  CateringSettings,
  MealChoice,
  MealTier,
  MealWindow,
  OrganiserShift,
  EventSlot,
  PreferenceSlot,
  Pole,
  Organiser,
  LeaderRole,
  SchedulingRules,
  Shift,
  SkillLevel,
  PoleChoice,
  SlotId,
  Volunteer,
  Window,
} from '@engine/model.ts';

/** La correspondance du formulaire: columns and answers the régisseur decided. */
export {
  ANSWER_KIND_OF,
  EMPTY_FORM_MAPPING,
  MAPPED_FIELDS,
  MAPPED_FIELD_LABEL,
} from '@engine/form-mapping.ts';
export type {
  AnswerKind,
  AnswerMaps,
  ChoiceColumns,
  FormMapping,
  MappedField,
} from '@engine/form-mapping.ts';

/** Le volume horaire: for the event or per day, where a day begins, the options offered. */
export { DEFAULT_VOLUME, dayLabel, eventDays } from '@engine/days.ts';
export type { VolumeScope, VolumeSettings } from '@engine/days.ts';

export { PLAN_FORMAT, PlanIndex, alignPhases, buildBlocks, fmtHours, overlaps, emptyPlan, newEventPlan } from '@engine/plan.ts';

/** The contact file that carries the access codes out to the mailing tool. */
export { brevoContactsCsv, toCsv } from '@engine/csv.ts';
export type { BrevoExport } from '@engine/csv.ts';
export type {
  Assignment,
  AssignmentSource,
  Block,
  BuddyPair,
  LeaderOnPole,
  AvailabilityMode,
  Plan,
} from '@engine/plan.ts';

export { SHIFT_SCOPED, TIER1, TIER2, blockersFor, costsFor, isLegal, validate } from '@engine/validate.ts';
export type {
  ArtistReport,
  Blocker,
  BuddyOutcome,
  GapDiagnosis,
  LegalityContext,
  PlanSummary,
  ShiftReport,
  Tier,
  ValidationIssue,
  ValidationResult,
  VolunteerColour,
  VolunteerReport,
} from '@engine/validate.ts';

export { DEFAULT_WEIGHTS, solve, solveToConvergence, weightsFor } from '@engine/solver.ts';

/** Réglages avancés: which rule blocks, which one costs, and how much. */
export {
  ALWAYS_BLOCKING,
  CONSTRAINT_MODE_LABEL,
  CRITERIA,
  CRITERION_BY_ID,
  CRITERION_GROUP_LABEL,
  DEFAULT_CONSTRAINTS,
  resolveConstraints,
} from '@engine/constraints.ts';
export type {
  ConstraintMode,
  ConstraintSettings,
  CriterionDefinition,
  CriterionGroup,
  CriterionId,
  CriterionOverride,
  CriterionParameter,
  ResolvedConstraints,
} from '@engine/constraints.ts';
export type {
  ConvergeOptions,
  ConvergeResult,
  DroppedAssignment,
  SolveOptions,
  SolveResult,
  SolverWeights,
} from '@engine/solver.ts';

export { buildProposals, groupProposals, summariseProposals } from '@engine/proposals.ts';
export type { Proposal, ProposalGroup, ProposalKind } from '@engine/proposals.ts';

export {
  usableWindows,
  refusedWindows,
  maxAchievableHours,
  allowedVolumes,
  fitsAvailability,
} from '@engine/availability.ts';

export {
  importVolunteers,
  foldIssuesIntoFiches,
  parseCsv,
  bindColumns,
  bindForm,
  surveyForm,
  volunteerIdentity,
  newAccessCode,
  ORGANISER_CODE_LENGTH,
  VOLUNTEER_CODE_LENGTH,
} from '@engine/import.ts';

/** The pole organisers' own form, which is a different and much smaller one. */
export { importOrganisers, bindOrganiserColumns, organiserIdentity } from '@engine/import-organisers.ts';
export type {
  OrganiserColumnMap,
  OrganiserFormField,
  OrganiserImportOptions,
  OrganiserImportResult,
} from '@engine/import-organisers.ts';

export {
  FIELD_LABEL,
  applyReconciliation,
  existingCodes,
  keptByDefault,
  mergeWithManual,
  plannedVolunteers,
  reconcileVolunteers,
  summariseReconciliation,
  resubmittedCancelled,
} from '@engine/reconcile.ts';

/** Bénévole ↔ orga, as one pure function with its consequences listed. See `@engine/convert.ts`. */
export { convertPerson } from '@engine/convert.ts';
export type { Conversion } from '@engine/convert.ts';
export type {
  FieldChange,
  Reconciliation,
  VolunteerRemoval,
  VolunteerUpdate,
} from '@engine/reconcile.ts';
export type {
  ColumnMap,
  FormField,
  FormBinding,
  FormSurvey,
  SurveyAnswer,
  ImportIssue,
  AnswerDoubt,
  ImportOptions,
  ImportResult,
  IssueSeverity,
  ResolvedBuddy,
  PhotoLink,
} from '@engine/import.ts';

/** The trombinoscope's photos: object names, what a re-import fetches, the crop. */
export { driveFileIds, needsDriveFetch, parsePhotoObjectName, photoObjectName, squareCrop } from '@engine/photos.ts';
export type { PhotoSource } from '@engine/photos.ts';

/**
 * The montage and the démontage: two grids that no rule and no solver touches.
 *
 * Their own door onto the engine, like everything else here. A screen that draws a phase asks
 * this file for the day-parts, the placements and the fills; it never recomputes a night, a
 * half-day boundary or somebody's presence for itself. See `@engine/phase.ts`.
 */
export {
  GENERAL_POLE_KEY,
  allPlacements,
  declaredPlacements,
  declaredPole,
  declaredWindows,
  phaseIssues,
  clipWindows,
  alignPhase,
  defaultPhase,
  defaultPhaseStart,
  DEFAULT_PHASE_HOURS,
  DEFAULT_MIRROR_WORDS,
  DEFAULT_PHASE_OPTIONS,
  mirrorLabel,
  eventFills,
  generalPole,
  hoursOnPhase,
  mergeWindows,
  organiserPresence,
  phaseClashes,
  phaseDayParts,
  phaseDays,
  phasePeople,
  placementsFor,
  subtractWindows,
  volunteerPresence,
  windowHours,
  windowsOverlap,
  workedWindows,
} from '@engine/phase.ts';
export type {
  PersonKind,
  Phase,
  PhaseAssignment,
  PhaseClash,
  PhaseDay,
  PhaseDayPart,
  PhaseEvent,
  PhaseEventFill,
  PhaseIssue,
  PhaseIssueCode,
  PhaseId,
  MirrorWord,
  PhaseOptions,
  PhasePerson,
  PhasePlacement,
  PhasePole,
} from '@engine/phase.ts';
export { absentFromPhase, ANY_POLE_LABEL, choicePoleLabel } from '@engine/model.ts';
export type { PhasePresence } from '@engine/model.ts';

/**
 * Les repas et les tickets boisson: who eats at which service, and what the caterer is told.
 *
 * The same door as everything else. A screen never counts a plate itself and never decides who
 * is owed a meal: it asks `cateringReport` and draws the answer. See `@engine/catering.ts`.
 */
export {
  MOMENT_LABEL,
  cateringCsv,
  cateringReport,
  defaultMealChoices,
  drinksForHours,
  isNoAllergy,
  isStandardDiet,
  mealServices,
  mealsForHours,
  serviceKey,
  setMealChoice,
} from '@engine/catering.ts';
export type {
  CateringPerson,
  CateringReport,
  DietCount,
  MealService,
  MomentId,
  ServiceFill,
} from '@engine/catering.ts';

/**
 * Les artistes: the moments an act occupies, on the exploit's axis and on each phase's own, and
 * what a member of it eats and is handed. Nothing here is a rule. See `@engine/artists.ts`.
 */
export {
  MOMENT_WORD,
  actsOfPerson,
  memberIsLinked,
  artistInvitations,
  artistMemberDrinks,
  artistMemberName,
  artistMoments,
  artistMomentsIn,
  artistMomentsInExploit,
  artistPresence,
  artistTravelLine,
  phaseOffset,
} from '@engine/artists.ts';
export type { ArtistMoment, ArtistMomentKind } from '@engine/artists.ts';
export {
  makeArtist,
  makeArtistMember,
  makeCarTrip,
  DEFAULT_TICKETING,
  DEFAULT_TRAVEL_RATES,
  PERSON_STATUS_LABEL,
  BUILT_IN_STATUSES,
  DEFAULT_GUEST_TYPES,
  statusLabel,
} from '@engine/model.ts';
export type {
  ArtistMember,
  ArtistMemberRole,
  ArtistPayment,
  CarTrip,
  FuelKind,
  Guest,
  MealPersonKind,
  PersonStatus,
  GuestType,
  TicketType,
  BraceletType,
  ExtraPerson,
  TicketPersonKind,
  TicketingChoice,
  TicketingSettings,
  TravelRates,
} from '@engine/model.ts';

/**
 * La billetterie: the door's list, derived every time; the default ticket and bracelet; the
 * CSV with or without phones. See `@engine/ticketing.ts`.
 */
export {
  defaultBracelets,
  defaultTicketType,
  setTicketingChoice,
  ticketingCsv,
  ticketingReport,
} from '@engine/ticketing.ts';
export type { StatusTag, TicketingReport, TicketingRow } from '@engine/ticketing.ts';
export { artistGuests } from '@engine/artists.ts';

// Préparer l'événement depuis le formulaire, 2026-09-16.
export { applySetup, inferSetup } from '@engine/setup-inference.ts';
export type { SetupChoice, SetupProposal } from '@engine/setup-inference.ts';

// Competences, 2026-09-15.
export type { SkillTag } from '@engine/model.ts';
// Teams, 2026-09-15.
export type { Team } from '@engine/model.ts';
// Side activities, 2026-09-15.
export type { SideActivity } from '@engine/model.ts';
// Le Magasin, 2026-09-15.
export { EQUIPMENT_STATUSES, EQUIPMENT_STATUS_LABEL } from '@engine/model.ts';
export type { EquipmentItem, EquipmentStatus } from '@engine/model.ts';
export type { TeamReport } from '@engine/validate.ts';

// Availability day by day, 2026-09-15.
export {
  dayAvailability,
  phaseDayTicks,
  withDayAvailability,
} from '@engine/presence-days.ts';

// Application tracking, 2026-09-15: status, steps, Réserve and stamina.
export {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  DEFAULT_APPLICATION_STEPS,
  ENERGY_LABEL,
  ENERGY_PROFILES,
  statusOf,
} from '@engine/model.ts';
export type { ApplicationStatus, ApplicationStep, EnergyProfile, StepMail, StepMailVariant, StepReply } from '@engine/model.ts';
export { STEP_REPLIES, STEP_REPLY_LABEL } from '@engine/model.ts';

// Validation of everybody and the validation mails, 2026-10-22.
export { BUILT_IN_AUDIENCES, MAIL_AUDIENCES, applicationStatusOf } from '@engine/model.ts';
export type { AudienceMail, MailAudience, MailKind, MailSet, MailTemplate } from '@engine/model.ts';
export {
  DEFAULT_MAILS,
  DEFAULT_MAIL_TEMPLATES,
  MAIL_AUDIENCE_LABEL,
  MAIL_KIND_LABEL,
  MAIL_PLACEHOLDERS,
  audienceLabel,
  audienceOptions,
  audiencesWithoutMail,
  isMailAddress,
  mailFor,
  mailsOf,
  registrantOf,
  registrants,
  renderMail,
  renderTemplate,
  setRegistrationStatus,
  withAudience,
  withMails,
} from '@engine/registration.ts';

// The follow-up by mail after the validation, 2026-10-22.
export {
  batchMembers,
  blankStepMail,
  followUpOf,
  inTarget,
  isPlaced,
  placedPending,
  planningFingerprint,
  planningText,
  stateLabel,
  stepAudiences,
  stepPersons,
  stepProgress,
  stepTextFor,
  targetLabel,
  usesPlanning,
} from '@engine/followup.ts';
export type {
  StepPerson,
  StepPersonKind,
  BatchKind,
  FollowUp,
  FollowUpMark,
  MailFact,
  ReplyFact,
  StepProgress,
  StepState,
  Tone,
} from '@engine/followup.ts';
export type { Registrant, RegistrantKind, RenderedMail } from '@engine/registration.ts';

/** The one normal form every answer is compared in: accents, case, punctuation and emoji gone. */
export { normalise } from '@engine/text.ts';
