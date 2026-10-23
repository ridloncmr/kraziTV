import type { Kysely } from "kysely";
import {
  type Migration,
  type MigrationProvider,
  Migrator,
} from "kysely/migration";

import { initialCatalogMigration } from "./001-initial-catalog.js";
import { mediaCollectionsMigration } from "./002-media-collections.js";
import { channelsMigration } from "./003-channels.js";
import { programmingBlocksMigration } from "./004-programming-blocks.js";
import { schedulesMigration } from "./005-schedules.js";
import { mediaVideoMigration } from "./006-media-video.js";
import { catalogRemovalMigration } from "./007-catalog-removal.js";
import { accountsAndSessionsMigration } from "./008-accounts-and-sessions.js";
import { serverSettingsMigration } from "./009-server-settings.js";
import { contentMetadataMigration } from "./010-content-metadata.js";
import { episodeMetadataMigration } from "./011-episode-metadata.js";
import { metadataCorrectionsMigration } from "./012-metadata-corrections.js";
import { metadataRefreshMigration } from "./013-metadata-refresh.js";
import { collectionMaintenanceMigration } from "./014-collection-maintenance.js";
import { collectionExclusionsMigration } from "./015-collection-exclusions.js";
import { tagsMigration } from "./016-tags.js";
import { recommendationDecisionsMigration } from "./017-recommendation-decisions.js";
import { playbackProgressPerModeMigration } from "./018-playback-progress-per-mode.js";
import { orderedPlaybackModesMigration } from "./019-ordered-playback-modes.js";
import { orderFingerprintsMigration } from "./020-order-fingerprints.js";
import { sourceAssignmentsMigration } from "./021-source-assignments.js";
import { turnsEndedByEditsMigration } from "./022-turns-ended-by-edits.js";
import { assignmentParticipationMigration } from "./023-assignment-participation.js";
import { programmingRulesMigration } from "./024-programming-rules.js";
import { configurationRevisionsMigration } from "./025-configuration-revisions.js";
import { programmingTimezoneMigration } from "./026-programming-timezone.js";
import { reservationsMigration } from "./027-reservations.js";
import { reservationInterruptsMigration } from "./028-reservation-interrupts.js";
import { reservationRequestKeysMigration } from "./029-reservation-request-keys.js";
import { programmingRevisionMigration } from "./030-programming-revision.js";
import { correctedReleaseYearMigration } from "./031-corrected-release-year.js";
import { unlistedEpisodeMigration } from "./032-unlisted-episode.js";
import { assignmentNamesMigration } from "./033-assignment-names.js";
import type { DatabaseSchema } from "../schema/database-schema.js";

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  "001_initial_catalog": initialCatalogMigration,
  "002_media_collections": mediaCollectionsMigration,
  "003_channels": channelsMigration,
  "004_programming_blocks": programmingBlocksMigration,
  "005_schedules": schedulesMigration,
  "006_media_video": mediaVideoMigration,
  "007_catalog_removal": catalogRemovalMigration,
  "008_accounts_and_sessions": accountsAndSessionsMigration,
  "009_server_settings": serverSettingsMigration,
  "010_content_metadata": contentMetadataMigration,
  "011_episode_metadata": episodeMetadataMigration,
  "012_metadata_corrections": metadataCorrectionsMigration,
  "013_metadata_refresh": metadataRefreshMigration,
  "014_collection_maintenance": collectionMaintenanceMigration,
  "015_collection_exclusions": collectionExclusionsMigration,
  "016_tags": tagsMigration,
  "017_recommendation_decisions": recommendationDecisionsMigration,
  "018_playback_progress_per_mode": playbackProgressPerModeMigration,
  "019_ordered_playback_modes": orderedPlaybackModesMigration,
  "020_order_fingerprints": orderFingerprintsMigration,
  "021_source_assignments": sourceAssignmentsMigration,
  "022_turns_ended_by_edits": turnsEndedByEditsMigration,
  "023_assignment_participation": assignmentParticipationMigration,
  "024_programming_rules": programmingRulesMigration,
  "025_configuration_revisions": configurationRevisionsMigration,
  "026_programming_timezone": programmingTimezoneMigration,
  "027_reservations": reservationsMigration,
  "028_reservation_interrupts": reservationInterruptsMigration,
  "029_reservation_request_keys": reservationRequestKeysMigration,
  "030_programming_revision": programmingRevisionMigration,
  "031_corrected_release_year": correctedReleaseYearMigration,
  "032_unlisted_episode": unlistedEpisodeMigration,
  "033_assignment_names": assignmentNamesMigration,
});

class CommittedMigrationProvider implements MigrationProvider {
  // Returns the fixed committed history so every environment sees the same order.
  async getMigrations(): Promise<Record<string, Migration>> {
    return { ...migrations };
  }
}

// Applies the committed migration history and surfaces the original migration error.
export async function migrateDatabase(
  db: Kysely<DatabaseSchema>,
): Promise<void> {
  const { error } = await new Migrator({
    db,
    provider: new CommittedMigrationProvider(),
  }).migrateToLatest();

  if (error !== undefined) {
    // Kysely types the failure as unknown; rethrow it unwrapped.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw error;
  }
}
