/**
 * One media item of a media-item reservation, in saved order. Deleting the
 * reservation deletes its items; an item a reservation names cannot be
 * deleted while it does.
 */
export interface ReservationItemTable {
  reservation_id: string;
  position: number;
  media_item_id: string;
}
