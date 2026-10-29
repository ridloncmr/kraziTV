import { Fragment } from "react";

/**
 * The one sentence that says where a server setting goes, so every screen
 * that asks the owner to set one names both the `.env` file and the Docker
 * `-e` form the same way. It is a sentence, not a paragraph: the caller owns
 * the surrounding element and its styling.
 */
export function SettingLocation({ names }: { names: string[] }) {
  return (
    <>
      {names.map((name, index) => (
        <Fragment key={name}>
          {index > 0 && " and "}
          <code>{name}</code>
        </Fragment>
      ))}{" "}
      {names.length === 1 ? "goes" : "go"} in kraziTV&apos;s <code>.env</code>{" "}
      file, or in <code>-e</code> when it runs in Docker.
    </>
  );
}
