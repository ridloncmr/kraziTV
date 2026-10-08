import {
  AVATAR_IDS,
  AccountPicture,
} from "../branding/avatars/account-picture.js";
import { formText } from "../controls/form-text.js";
import type { AccountProfile } from "../http/contracts.js";
import { ProfileChangeForm } from "./profile-change-form.js";

/**
 * Account Settings' **Change my picture** task: every built-in drawing in a
 * grid with the current one selected. The grid is native radio inputs, so the
 * browser moves the selection with the arrow keys; each option is named by its
 * avatar ID because `AccountPicture` is decorative. The server's answer goes
 * to `onChanged`.
 */
export function ChangePictureView({
  avatarId,
  onChanged,
  onCancel,
}: {
  avatarId: string;
  onChanged: (account: AccountProfile) => void;
  onCancel: () => void;
}) {
  /** Sends the checked ID; one option always starts checked, so it is never empty. */
  function prepare(form: FormData) {
    return { change: { avatarId: formText(form, "avatarId") } };
  }

  return (
    <ProfileChangeForm
      title="Change your picture"
      submitLabel="Change Picture"
      prepare={prepare}
      onChanged={onChanged}
      onCancel={onCancel}
    >
      <div
        role="radiogroup"
        aria-label="Pick a new picture"
        className="avatar-picker"
      >
        {AVATAR_IDS.map((id) => (
          <label key={id} className="avatar-option">
            <input
              type="radio"
              name="avatarId"
              value={id}
              aria-label={id}
              defaultChecked={id === avatarId}
            />
            <AccountPicture avatarId={id} size={48} />
          </label>
        ))}
      </div>
    </ProfileChangeForm>
  );
}
