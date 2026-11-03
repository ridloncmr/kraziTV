// Refreshes the README's desktop scenes in `docs/images/` from the demo
// kraziTV, arranging windows the way an owner would, so the README never
// shows the owner's own library. Every shot is read-only.
//
// Usage (the demo must be running and seeded; see scripts/demo-library):
//   node scripts/live-app/readme-screenshots.mjs
//
// The names below are objects the demo seed creates.

import { hideMachineValues, openDemoApp } from "../demo-library/demo-app.mjs";
import { desktopActions } from "./desktop-actions.mjs";

const out = new URL("../../docs/images/", import.meta.url).pathname;
const names = {
  sitcomChannel: "Classic TV",
  movieChannel: "Movie Night",
  wheel: "The Beverly Hillbillies + The Andy Griffith Show",
  collection: "The Beverly Hillbillies",
};

const { browser, page } = await openDemoApp({ width: 1600, height: 1000 });
const { settle, win, openProgram, maximize, place, menuItem, tab } =
  desktopActions(page);

/** Reloads to an empty desktop, since open windows do not survive a reload. */
const clearDesktop = async () => {
  await page.reload();
  await page.getByRole("button", { name: "start", exact: true }).waitFor();
  await settle();
};
/** Brings a window to the front by pressing on its title bar. */
const raise = async (name) => {
  const box = await win(name).boundingBox();
  await page.mouse.click(box.x + 200, box.y + 12);
  await settle();
};
/** Opens one channel's Properties from My Channels on the given tab. */
const openChannel = async (channel, tabName) => {
  await menuItem(`Actions for ${channel}`, "Properties");
  await tab(win(`${channel} Properties`), tabName);
};
const shot = async (file) => {
  await page.waitForTimeout(400);
  await hideMachineValues(page);
  await page.screenshot({ path: `${out}${file}.png` });
};

try {
  // The guide, the channel list, and two channels' lineups.
  await openProgram("Program Guide");
  await place("Program Guide", { x: 130, y: 18, width: 1000, height: 560 });
  await openProgram("My Channels");
  await place("My Channels", { x: 245, y: 298, width: 565, height: 600 });
  await openChannel(names.sitcomChannel, "Lineup");
  await place(`${names.sitcomChannel} Properties`, {
    x: 760,
    y: 110,
    width: 660,
    height: 480,
  });
  await raise("My Channels");
  await openChannel(names.movieChannel, "Lineup");
  await place(`${names.movieChannel} Properties`, {
    x: 870,
    y: 220,
    width: 660,
    height: 470,
  });
  await raise("My Channels");
  await shot("hero");

  // A show's properties over its channel's lineup, rules behind.
  await clearDesktop();
  await openProgram("My Channels");
  await place("My Channels", { x: 140, y: 18, width: 560, height: 440 });
  await openChannel(names.movieChannel, "Rules");
  await place(`${names.movieChannel} Properties`, {
    x: 190,
    y: 370,
    width: 640,
    height: 420,
  });
  await raise("My Channels");
  await openChannel(names.sitcomChannel, "Lineup");
  await place(`${names.sitcomChannel} Properties`, {
    x: 740,
    y: 120,
    width: 720,
    height: 640,
  });
  await menuItem(`Actions for ${names.wheel}`, "Properties");
  await shot("programming");

  // The catalog, the automatic collections, and one collection's members.
  await clearDesktop();
  await openProgram("Media Library");
  await place("Media Library", { x: 140, y: 18, width: 780, height: 720 });
  await openProgram("Collections");
  await tab(win("Collections"), "Automatic");
  await page
    .getByRole("button", { name: `Open ${names.collection}` })
    .first()
    .click();
  await settle();
  await place(`${names.collection} Properties`, {
    x: 615,
    y: 35,
    width: 645,
    height: 605,
  });
  await raise("Collections");
  await place("Collections", { x: 517, y: 295, width: 600, height: 605 });
  await raise(`${names.collection} Properties`);
  await shot("library");

  // The guide alone, in a short wide window.
  await clearDesktop();
  await page.setViewportSize({ width: 1600, height: 640 });
  await openProgram("Program Guide");
  await maximize("Program Guide");
  await shot("guide");
  console.log(`Saved the README screenshots to ${out}`);
} finally {
  await browser.close();
}
