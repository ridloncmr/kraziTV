// The demo library: public-domain shows and films that TMDB knows, so wiki
// screenshots look like a real catalog without showing the owner's own.
// Files are placeholder title cards; only the names and lengths are real.

/**
 * Where the demo instance answers. `localhost` rather than 127.0.0.1, because
 * browsers share cookies across ports, and the owner's real kraziTV session
 * lives on 127.0.0.1.
 */
export const DEMO_URL = "http://localhost:3100";

/**
 * The demo's timezone, for the server and the screenshot browser alike, so
 * the screens never show the owner's own timezone. The wiki's example zone.
 */
export const DEMO_TIMEZONE = "America/New_York";

/** The demo account's password. The demo holds no private data. */
export const DEMO_PASSWORD = "demo-password";

/** Each show gets a season-1 folder of episodes this many minutes long. */
export const shows = [
  { title: "The Beverly Hillbillies", year: 1962, episodes: 6, minutes: 25 },
  { title: "The Andy Griffith Show", year: 1960, episodes: 6, minutes: 25 },
  { title: "The Dick Van Dyke Show", year: 1961, episodes: 6, minutes: 25 },
  { title: "Bonanza", year: 1959, episodes: 4, minutes: 50 },
  { title: "The Lone Ranger", year: 1949, episodes: 4, minutes: 25 },
  { title: "Dragnet", year: 1951, episodes: 4, minutes: 26 },
  { title: "One Step Beyond", year: 1959, episodes: 4, minutes: 25 },
];

/** Movies, with the tags the seed gives them for tag collections and rules. */
export const movies = [
  {
    title: "Night of the Living Dead",
    year: 1968,
    minutes: 96,
    tags: ["Halloween"],
  },
  {
    title: "House on Haunted Hill",
    year: 1959,
    minutes: 75,
    tags: ["Halloween"],
  },
  { title: "Carnival of Souls", year: 1962, minutes: 78, tags: ["Halloween"] },
  {
    title: "The Little Shop of Horrors",
    year: 1960,
    minutes: 72,
    tags: ["Halloween"],
  },
  { title: "Nosferatu", year: 1922, minutes: 94, tags: ["Halloween"] },
  {
    title: "It's a Wonderful Life",
    year: 1946,
    minutes: 130,
    tags: ["Christmas"],
  },
  {
    title: "Santa Claus Conquers the Martians",
    year: 1964,
    minutes: 81,
    tags: ["Christmas"],
  },
  { title: "His Girl Friday", year: 1940, minutes: 92, tags: [] },
  { title: "My Man Godfrey", year: 1936, minutes: 94, tags: [] },
  { title: "Charade", year: 1963, minutes: 113, tags: [] },
  { title: "The General", year: 1926, minutes: 78, tags: [] },
  { title: "The Kid", year: 1921, minutes: 68, tags: [] },
  { title: "Plan 9 from Outer Space", year: 1957, minutes: 79, tags: [] },
  { title: "Detour", year: 1945, minutes: 68, tags: [] },
  { title: "D.O.A.", year: 1949, minutes: 83, tags: [] },
  {
    title: "Sherlock Holmes and the Secret Weapon",
    year: 1942,
    minutes: 68,
    tags: [],
  },
  { title: "The Woman in Green", year: 1945, minutes: 68, tags: [] },
  { title: "Terror by Night", year: 1946, minutes: 60, tags: [] },
  { title: "Dressed to Kill", year: 1946, minutes: 72, tags: [] },
];
